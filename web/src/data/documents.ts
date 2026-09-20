/**
 * T-206 item 8 — เอกสารต้นทาง (`sources.json`) — ค้น metadata (`findDocuments`) + อ่านเนื้อหา
 * (`getDoc`) แยกออกจาก `repo.ts` (คนละความรับผิดชอบ: budget lines vs เอกสารดิบ)
 *
 * ห้าม import React (module boundary — docs/04-ARCHITECTURE.md §3)
 * ห้าม fetch ข้าม origin (N5) — โหลดผ่าน `loadJson`/`loadJsonGz`/`dataUrl` ของ `manifest.ts` เท่านั้น
 *
 * ค้นหา: `sources.json` มีแค่ 318 รายการ (เล็กพอที่จะ build MiniSearch ทั้งก้อนใน browser โดยไม่ต้อง
 * prebuilt index แบบ catalog — ต่างจาก `search.ts` ที่ catalog มีนับหมื่นรายการ) ใช้ tokenizer ไทย
 * ชุดเดียวกับ catalog (`buildIndexQuery`/`DEFAULT_CATALOG_SEARCH_OPTIONS` จาก `search.ts`) เพื่อไม่ให้
 * มีกฎ fold/tokenize ซ้ำสองชุดในโปรเจกต์
 */
import MiniSearch, { type Options } from 'minisearch';
import { buildIndexQuery, DEFAULT_CATALOG_SEARCH_OPTIONS, searchDocChunksText } from './search';
import { coverageNotesFor, loadJson, loadJsonGz, loadManifest } from './manifest';
import { tokenizeThai } from './thaiText';
import {
  type CoverageNote,
  type Dataset,
  type DocChunk,
  DocChunksFileSchema,
  type Manifest,
  type SourceDoc,
  type SourceDocCollection,
  type SourceDocKind,
  SourcesFileSchema,
} from './types';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class DocNotFoundError extends Error {
  constructor(docId: string) {
    super(`ไม่พบเอกสารต้นทาง (doc_id): ${docId}`);
    this.name = 'DocNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// loadSources — cache เป็น promise เดียวต่อ module (เหมือน loadManifest) — แก้ F13 (โหลดใหม่ทุกครั้ง)
// ---------------------------------------------------------------------------

let sourcesPromise: Promise<SourceDoc[]> | null = null;

/** ล้าง cache ของ `sources.json` + ดัชนีค้นหาเอกสาร (ไว้ใช้ใน test เท่านั้น) */
export function resetSourcesCache(): void {
  sourcesPromise = null;
  docSearchStatePromise = null;
}

/** โหลด `sources.json` (fetch + Zod validate) แบบ lazy — cache เป็น promise เดียวต่อ module */
export function loadSources(fetchImpl: typeof fetch = fetch): Promise<SourceDoc[]> {
  sourcesPromise ??= loadJson('sources.json', SourcesFileSchema, fetchImpl).catch((err: unknown) => {
    sourcesPromise = null;
    throw err;
  });
  return sourcesPromise;
}

// ---------------------------------------------------------------------------
// coverage notes ของเอกสาร (T-206 F8)
// ---------------------------------------------------------------------------

/**
 * แม็พ `SourceDoc.collection` → `Dataset[]` ที่เกี่ยวข้อง เพื่อดึง coverage note ของ manifest มาแนบให้
 * `getDoc` — **ข้อจำกัดที่ทราบแล้ว (T-206)**: `SourceDoc` ไม่มีฟิลด์ dataset ตรง ๆ (มีแค่
 * `collection`) และ `province_budget` ครอบ 3 dataset พร้อมกัน (`act_2570_province`,
 * `local_ordinance_2570`, `local_subsidy_2570`) ⇒ เอกสารบางฉบับอาจได้ note ที่จริง ๆ เกี่ยวกับเอกสาร
 * ฉบับอื่นในกลุ่มเดียวกัน/ปีเดียวกัน (เช่น ADR-005 "ราชาเทวะ" อาจติดไปกับทุกเอกสาร province_budget
 * ปี 2570 ไม่ใช่แค่ฉบับของ อบต. ราชาเทวะ) — ยอมรับความไม่แม่นยำนี้ไว้ก่อนเพราะ pipeline ยังไม่ผูก
 * dataset ต่อเอกสารมาให้ (`[UNVERIFIED]` เรื่อง precision ของ mapping นี้)
 */
const DOC_COLLECTION_DATASETS: Record<SourceDocCollection, Dataset[]> = {
  pbo: ['pbo_disbursement'],
  committee: ['committee_table'],
  province_budget: ['act_2570_province', 'local_ordinance_2570', 'local_subsidy_2570'],
  // ไม่มี dataset ของ BudgetLine ที่ตรงกับ collection นี้โดยตรง ณ ตอนนี้
  open_sso: [],
};

/** pure function (ทดสอบตรงได้โดยไม่ต้อง fetch) — รวม coverage note ของทุก dataset ที่ collection ของ
 * เอกสารนี้ครอบคลุม กรองด้วยปีงบประมาณของเอกสาร (`fiscal_years`) ถ้ามีระบุ */
export function collectDocCoverageNotes(manifest: Manifest, doc: SourceDoc): CoverageNote[] {
  const datasets = DOC_COLLECTION_DATASETS[doc.collection];
  const seen = new Set<string>();
  const notes: CoverageNote[] = [];
  for (const dataset of datasets) {
    const relevant =
      doc.fiscal_years.length > 0
        ? doc.fiscal_years.flatMap((fy) => coverageNotesFor(manifest, { dataset, fiscalYear: fy }))
        : coverageNotesFor(manifest, { dataset });
    for (const note of relevant) {
      const key = `${note.dataset}|${String(note.fiscal_year_be)}|${note.note}`;
      if (!seen.has(key)) {
        seen.add(key);
        notes.push(note);
      }
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// findDocuments — ค้น sources.json (318 รายการ) ด้วย MiniSearch ที่ build ใน browser
// ---------------------------------------------------------------------------

interface DocSearchDoc {
  id: string;
  title_guess: string;
  rel_path: string;
  topic: string;
  agency_guess: string;
}

function docMiniSearchOptions(): Options<DocSearchDoc> {
  return {
    fields: ['title_guess', 'rel_path', 'topic', 'agency_guess'],
    storeFields: [],
    idField: 'id',
    tokenize: (text: string) => tokenizeThai(text),
    processTerm: (term: string) => term,
  };
}

interface DocSearchState {
  mini: MiniSearch<DocSearchDoc>;
  byId: Map<string, SourceDoc>;
}

let docSearchStatePromise: Promise<DocSearchState> | null = null;

function buildDocSearchState(sources: SourceDoc[]): DocSearchState {
  const mini = new MiniSearch<DocSearchDoc>(docMiniSearchOptions());
  mini.addAll(
    sources.map((d) => ({
      id: d.doc_id,
      title_guess: d.title_guess ?? '',
      rel_path: d.rel_path,
      topic: d.topic ?? '',
      agency_guess: d.agency_guess ?? '',
    })),
  );
  return { mini, byId: new Map(sources.map((d) => [d.doc_id, d])) };
}

function loadDocSearch(fetchImpl: typeof fetch): Promise<DocSearchState> {
  docSearchStatePromise ??= loadSources(fetchImpl)
    .then(buildDocSearchState)
    .catch((err: unknown) => {
      docSearchStatePromise = null;
      throw err;
    });
  return docSearchStatePromise;
}

export interface FindDocumentsParams {
  query?: string;
  collection?: SourceDocCollection;
  agency?: string;
  meetingNo?: number;
  province?: string;
  fiscalYear?: number;
  kind?: SourceDocKind;
  hasText?: boolean;
  /** ≤ `FIND_DOCUMENTS_MAX_LIMIT` (ตัดอัตโนมัติถ้าเกิน), ค่าเริ่มต้น `FIND_DOCUMENTS_DEFAULT_LIMIT` */
  limit?: number;
}

export interface FindDocumentsResult {
  docs: SourceDoc[];
  /** จำนวนเอกสารที่ตรงเงื่อนไขทั้งหมด (ก่อนตัด `limit`) */
  total: number;
}

export const FIND_DOCUMENTS_DEFAULT_LIMIT = 10;
export const FIND_DOCUMENTS_MAX_LIMIT = 20;

/** clamp `limit` ให้อยู่ในช่วง `[0, FIND_DOCUMENTS_MAX_LIMIT]` — pure function แยกทดสอบง่าย */
export function clampFindDocumentsLimit(limit: number | undefined): number {
  const requested = limit ?? FIND_DOCUMENTS_DEFAULT_LIMIT;
  if (!Number.isFinite(requested)) {
    return FIND_DOCUMENTS_DEFAULT_LIMIT;
  }
  return Math.max(0, Math.min(Math.trunc(requested), FIND_DOCUMENTS_MAX_LIMIT));
}

function matchesDocFilters(doc: SourceDoc, params: FindDocumentsParams): boolean {
  // QA B5/B-002: inventory ตั้งใจลงทะเบียน "ทุกไฟล์" รวมไฟล์ระบบ (`.DS_Store` → kind "other") เพื่อให้นับครบ
  // แต่ไฟล์พวกนี้ไม่ใช่เอกสาร — ไม่คืนให้ผู้ใช้/โมเดล เว้นแต่ขอ kind "other" ตรง ๆ
  if (params.kind === undefined && doc.kind === 'other') return false;
  if (params.collection !== undefined && doc.collection !== params.collection) return false;
  if (params.agency !== undefined && !(doc.agency_guess?.includes(params.agency) ?? false)) {
    return false;
  }
  if (params.meetingNo !== undefined && doc.meeting_no !== params.meetingNo) return false;
  if (params.province !== undefined && doc.province !== params.province) return false;
  if (params.fiscalYear !== undefined && !doc.fiscal_years.includes(params.fiscalYear)) return false;
  if (params.kind !== undefined && doc.kind !== params.kind) return false;
  if (params.hasText !== undefined && doc.extracted !== params.hasText) return false;
  return true;
}

/**
 * ค้นเอกสารต้นทางจาก `sources.json` — ถ้ามี `query` จะจัดอันดับด้วย MiniSearch ก่อน (เรียงตามความ
 * เกี่ยวข้อง) แล้วค่อยกรอง facet อื่นทับ; ถ้าไม่มี `query` กรอง facet ตรง ๆ ตามลำดับเดิมใน sources.json
 */
export async function findDocuments(
  params: FindDocumentsParams = {},
  fetchImpl: typeof fetch = fetch,
): Promise<FindDocumentsResult> {
  const sources = await loadSources(fetchImpl);

  let candidates: SourceDoc[] = sources;
  if (params.query !== undefined && params.query.trim().length > 0) {
    const { mini, byId } = await loadDocSearch(fetchImpl);
    const hits = mini.search(buildIndexQuery(params.query), DEFAULT_CATALOG_SEARCH_OPTIONS);
    candidates = hits
      .map((h) => byId.get(String(h.id)))
      .filter((d): d is SourceDoc => d !== undefined);
  }

  const filtered = candidates.filter((d) => matchesDocFilters(d, params));
  const limit = clampFindDocumentsLimit(params.limit);
  return { docs: filtered.slice(0, limit), total: filtered.length };
}

// ---------------------------------------------------------------------------
// getDoc — อ่านเนื้อหาเอกสาร (chunk) แบบจำกัดจำนวนเสมอ (ห้ามคืนทั้งเอกสาร — ไฟล์ใหญ่สุด 9,439 chunks)
// ---------------------------------------------------------------------------

export interface GetDocOptions {
  page?: number;
  /** ถ้าระบุ จะจัดอันดับ chunk ด้วย `searchDocChunksText` (fold ไทย) แล้วคืนเฉพาะ top chunks */
  query?: string;
  /** ≤ `GET_DOC_MAX_MAX_CHUNKS` ค่าเริ่มต้น `GET_DOC_DEFAULT_MAX_CHUNKS` */
  maxChunks?: number;
}

export interface GetDocResult {
  doc: SourceDoc;
  chunks: DocChunk[] | null;
  note?: string;
  /** T-206 F8 */
  coverageNotes: CoverageNote[];
  /** จำนวน chunk ที่ตรงเงื่อนไข (query/page) ทั้งหมดก่อนตัดด้วย `maxChunks` — 0 เมื่อ `chunks === null` */
  totalChunks: number;
}

export const GET_DOC_DEFAULT_MAX_CHUNKS = 8;
export const GET_DOC_MAX_MAX_CHUNKS = 20;

/** clamp `maxChunks` ให้อยู่ในช่วง `[1, GET_DOC_MAX_MAX_CHUNKS]` */
export function clampMaxChunks(maxChunks: number | undefined): number {
  const requested = maxChunks ?? GET_DOC_DEFAULT_MAX_CHUNKS;
  if (!Number.isFinite(requested)) {
    return GET_DOC_DEFAULT_MAX_CHUNKS;
  }
  return Math.max(1, Math.min(Math.trunc(requested), GET_DOC_MAX_MAX_CHUNKS));
}

/**
 * อ่านเนื้อหาเอกสาร (จำกัดจำนวน chunk เสมอ — CLAUDE.md §7 "ห้ามใส่ข้อมูลดิบทั้งก้อนใน context")
 *
 * - ไม่มี `query`/`page`: คืน chunk แรก ๆ ตามลำดับไฟล์ (สูงสุด `maxChunks`)
 * - มี `page`: กรองเฉพาะ chunk ของหน้านั้นก่อน แล้วค่อยตัด `maxChunks`
 * - มี `query`: จัดอันดับด้วย `searchDocChunksText` (fold ไทยทั้งสองฝั่ง) แล้วคืนเฉพาะ top chunks
 */
export async function getDoc(
  docId: string,
  opts: GetDocOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<GetDocResult> {
  const sources = await loadSources(fetchImpl);
  const doc = sources.find((d) => d.doc_id === docId);
  if (!doc) {
    throw new DocNotFoundError(docId);
  }

  const manifest = await loadManifest(fetchImpl);
  const coverageNotes = collectDocCoverageNotes(manifest, doc);
  const maxChunks = clampMaxChunks(opts.maxChunks);

  if (!doc.extracted) {
    return {
      doc,
      chunks: null,
      totalChunks: 0,
      coverageNotes,
      note: doc.note ?? 'เอกสารนี้เป็นเอกสารสแกน ระบบไม่ได้อ่านเนื้อหา (N4)',
    };
  }
  if (!doc.text_chunks_file) {
    return {
      doc,
      chunks: null,
      totalChunks: 0,
      coverageNotes,
      note: 'ไม่มีไฟล์เนื้อหาที่แยกไว้สำหรับเอกสารนี้',
    };
  }

  const allChunks = await loadJsonGz(doc.text_chunks_file, DocChunksFileSchema, fetchImpl);

  if (opts.query !== undefined && opts.query.trim().length > 0) {
    const matches = searchDocChunksText(allChunks, opts.query);
    return {
      doc,
      chunks: matches.slice(0, maxChunks).map((m) => m.chunk),
      totalChunks: matches.length,
      coverageNotes,
    };
  }

  const filtered = opts.page !== undefined ? allChunks.filter((c) => c.page === opts.page) : allChunks;
  return {
    doc,
    chunks: filtered.slice(0, maxChunks),
    totalChunks: filtered.length,
    coverageNotes,
  };
}
