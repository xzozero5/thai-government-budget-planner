import { createDataFacade, type Facets, type FindDocumentsResult, type SourceDoc } from '@/data';
import { describe, expect, it, vi } from 'vitest';
import { createInMemoryIllustrationSink } from '../illustrationSink';
import { createToolLog } from '../toolLog';
import { findDocumentsTool } from './findDocuments';
import type { ToolContext } from './toolKit';

function makeDoc(overrides: Partial<SourceDoc> = {}): SourceDoc {
  return {
    doc_id: 'doc-1',
    rel_path: 'committee/x.pdf',
    kind: 'pdf',
    bytes: 1000,
    sha1: 'abc',
    pages: 10,
    has_text_layer: true,
    extracted: true,
    title_guess: 'รายงานการประชุม',
    collection: 'committee',
    meeting_no: null,
    meeting_date: null,
    topic: null,
    agency_guess: null,
    province: null,
    gov_level: null,
    level: null,
    fiscal_years: [2567],
    text_chunks_file: 'docs/doc-1.json.gz',
    n_chunks: 5,
    note: null,
    duplicates: null,
    ...overrides,
  };
}

function emptyFacets(): Facets {
  return { budget_types: [], coverage_notes: [], datasets: [], fiscal_years: [], ministries: [], provinces: [] };
}

describe('findDocumentsTool', () => {
  it('เส้นทางปกติ: บันทึก doc_id ลง ToolLog', async () => {
    const toolLog = createToolLog();
    const findResult: FindDocumentsResult = { docs: [makeDoc()], total: 1 };
    const ctx: ToolContext = {
      data: createDataFacade({
        findDocuments: vi.fn().mockResolvedValue(findResult),
        facets: vi.fn().mockResolvedValue(emptyFacets()),
      }),
      toolLog,
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await findDocumentsTool.run({ query: 'รายงาน' }, ctx);
    expect(result.isError).toBe(false);
    if (!result.isError) {
      expect(result.output.docs).toHaveLength(1);
      expect(result.output.docs[0]?.doc_id).toBe('doc-1');
    }
    expect(toolLog.hasDocId('doc-1')).toBe(true);
  });

  it('input ผิด schema → is_error', async () => {
    const ctx: ToolContext = {
      data: createDataFacade(),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await findDocumentsTool.run({ fiscal_year: 'ผิด' }, ctx);
    expect(result.isError).toBe(true);
  });
});
