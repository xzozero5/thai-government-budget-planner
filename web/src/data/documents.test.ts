/// <reference types="node" />
/**
 * T-206 item 8 — `data/documents.ts`: `findDocuments` (ค้น sources.json) + `getDoc` (อ่านเนื้อหา
 * แบบจำกัดจำนวน chunk เสมอ) — ย้ายมาจาก `repo.test.ts` เดิม (`getDoc`) + เทสต์ใหม่
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetManifestCache } from './manifest';
import {
  clampFindDocumentsLimit,
  clampMaxChunks,
  collectDocCoverageNotes,
  DocNotFoundError,
  findDocuments,
  FIND_DOCUMENTS_MAX_LIMIT,
  GET_DOC_DEFAULT_MAX_CHUNKS,
  GET_DOC_MAX_MAX_CHUNKS,
  getDoc,
  resetSourcesCache,
} from './documents';
import { createFixtureFetch, fixtureFilePath } from './testFixtures';
import { ManifestSchema, type SourceDoc } from './types';

const manifestFixture: unknown = JSON.parse(readFileSync(fixtureFilePath('manifest.json'), 'utf8'));

beforeEach(() => {
  resetManifestCache();
  resetSourcesCache();
  vi.stubGlobal('fetch', createFixtureFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetManifestCache();
  resetSourcesCache();
});

function makeDoc(overrides: Partial<SourceDoc> & Pick<SourceDoc, 'doc_id' | 'collection'>): SourceDoc {
  return {
    rel_path: 'x.pdf',
    kind: 'pdf',
    bytes: 1,
    sha1: 'a',
    pages: null,
    has_text_layer: null,
    extracted: true,
    title_guess: null,
    meeting_no: null,
    meeting_date: null,
    topic: null,
    agency_guess: null,
    province: null,
    gov_level: null,
    level: null,
    fiscal_years: [],
    text_chunks_file: null,
    n_chunks: null,
    note: null,
    duplicates: null,
    ...overrides,
  };
}

const manifest = ManifestSchema.parse(manifestFixture);

describe('collectDocCoverageNotes (T-206 F8) — pure function ไม่ต้อง fetch', () => {
  it('collection "pbo" + fiscal_years [2562] → ได้ ADR-004 (source_incomplete)', () => {
    const doc = makeDoc({ doc_id: 'd1', collection: 'pbo', fiscal_years: [2562] });
    const notes = collectDocCoverageNotes(manifest, doc);
    expect(notes.some((n) => n.decision_ref === 'ADR-004')).toBe(true);
  });

  it('collection "pbo" + fiscal_years [2567] → ได้ no_oracle', () => {
    const doc = makeDoc({ doc_id: 'd2', collection: 'pbo', fiscal_years: [2567] });
    const notes = collectDocCoverageNotes(manifest, doc);
    expect(notes.some((n) => n.status === 'no_oracle')).toBe(true);
  });

  it('collection "province_budget" + fiscal_years [2570] → ได้ ADR-005 (ราชาเทวะ/upstream_ocr)', () => {
    const doc = makeDoc({ doc_id: 'd3', collection: 'province_budget', fiscal_years: [2570] });
    const notes = collectDocCoverageNotes(manifest, doc);
    expect(notes.some((n) => n.decision_ref === 'ADR-005')).toBe(true);
    expect(notes.some((n) => n.status.includes('upstream_ocr'))).toBe(true);
  });

  it('collection "committee" (ไม่มี fiscal_years) → ได้ org_unmapped (V9)', () => {
    const doc = makeDoc({ doc_id: 'd4', collection: 'committee', fiscal_years: [] });
    const notes = collectDocCoverageNotes(manifest, doc);
    expect(notes.some((n) => n.status === 'org_unmapped')).toBe(true);
  });

  it('collection "open_sso" → ไม่มี note เลย (ไม่ผูกกับ dataset ใดใน BudgetLine)', () => {
    const doc = makeDoc({ doc_id: 'd5', collection: 'open_sso', fiscal_years: [2570] });
    expect(collectDocCoverageNotes(manifest, doc)).toEqual([]);
  });
});

describe('getDoc', () => {
  it('extracted: false → คืน note แทน chunks พร้อม coverageNotes', async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('sources.json')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              makeDoc({ doc_id: 'd_scan', collection: 'pbo', extracted: false, kind: 'jpg' }),
            ]),
            { status: 200 },
          ),
        );
      }
      return createFixtureFetch()(input);
    });
    const result = await getDoc('d_scan');
    expect(result.chunks).toBeNull();
    expect(result.totalChunks).toBe(0);
    expect(result.note).toContain('เอกสารนี้เป็นเอกสารสแกน');
    expect(Array.isArray(result.coverageNotes)).toBe(true);
  });

  it('extracted: true + มี text_chunks_file, ไม่ระบุ page/query → คืน chunk แรกไม่เกิน GET_DOC_DEFAULT_MAX_CHUNKS', async () => {
    const result = await getDoc('d_b2216ce7d082');
    expect(result.chunks).not.toBeNull();
    expect(result.chunks?.length).toBeGreaterThan(0);
    expect(result.chunks?.length).toBeLessThanOrEqual(GET_DOC_DEFAULT_MAX_CHUNKS);
    // T-206 F14: ห้ามคืนทั้งเอกสาร — totalChunks บอกจำนวนจริงทั้งหมด (อาจ > chunks.length)
    expect(result.totalChunks).toBeGreaterThanOrEqual(result.chunks?.length ?? 0);
  });

  it('มี query → จัดอันดับด้วย searchDocChunksText แล้วคืนเฉพาะ top chunks', async () => {
    const withoutQuery = await getDoc('d_b2216ce7d082');
    const anyChunk = withoutQuery.chunks?.[0];
    if (!anyChunk) {
      throw new Error('คาดว่า fixture นี้ต้องมี chunk อย่างน้อย 1 chunk');
    }
    const needle = anyChunk.text.slice(0, 10);
    const result = await getDoc('d_b2216ce7d082', { query: needle, maxChunks: 3 });
    expect(result.chunks).not.toBeNull();
    expect(result.chunks?.length).toBeLessThanOrEqual(3);
    expect(result.chunks?.every((c) => c.text.includes(needle))).toBe(true);
  });

  it('doc_id ไม่พบ → DocNotFoundError', async () => {
    await expect(getDoc('d_ไม่มีจริง')).rejects.toBeInstanceOf(DocNotFoundError);
  });
});

describe('clampMaxChunks', () => {
  it('ไม่ระบุ → ค่าเริ่มต้น', () => {
    expect(clampMaxChunks(undefined)).toBe(GET_DOC_DEFAULT_MAX_CHUNKS);
  });
  it('เกินเพดาน → clamp ที่ GET_DOC_MAX_MAX_CHUNKS', () => {
    expect(clampMaxChunks(999)).toBe(GET_DOC_MAX_MAX_CHUNKS);
  });
});

describe('findDocuments', () => {
  it('ไม่มี query — กรอง collection ตรง ๆ', async () => {
    const result = await findDocuments({ collection: 'pbo' });
    expect(result.docs.length).toBeGreaterThan(0);
    expect(result.docs.every((d) => d.collection === 'pbo')).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(result.docs.length);
  });

  it('มี query — เจอเอกสารที่ title_guess ตรงคำค้น', async () => {
    const result = await findDocuments({ query: '2567' });
    expect(result.docs.some((d) => d.doc_id === 'd_e94359b751bc')).toBe(true);
  });

  it('fiscalYear filter — เฉพาะเอกสารที่มีปีนั้นใน fiscal_years', async () => {
    const result = await findDocuments({ fiscalYear: 2566 });
    expect(result.docs.every((d) => d.fiscal_years.includes(2566))).toBe(true);
  });

  it('hasText filter (extracted) — กรองเฉพาะเอกสารที่อ่านเนื้อหาได้', async () => {
    const result = await findDocuments({ hasText: true, limit: FIND_DOCUMENTS_MAX_LIMIT });
    expect(result.docs.every((d) => d.extracted)).toBe(true);
  });

  it('limit ถูก clamp ไม่ให้เกิน FIND_DOCUMENTS_MAX_LIMIT', async () => {
    const result = await findDocuments({ limit: 999 });
    expect(result.docs.length).toBeLessThanOrEqual(FIND_DOCUMENTS_MAX_LIMIT);
  });
});

describe('clampFindDocumentsLimit', () => {
  it('ค่าเริ่มต้น 10', () => {
    expect(clampFindDocumentsLimit(undefined)).toBe(10);
  });
  it('เกินเพดาน → clamp', () => {
    expect(clampFindDocumentsLimit(999)).toBe(FIND_DOCUMENTS_MAX_LIMIT);
  });
});
