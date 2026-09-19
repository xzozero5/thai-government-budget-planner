import { createDataFacade, type DocChunk, type GetDocResult, type SourceDoc } from '@/data';
import { describe, expect, it, vi } from 'vitest';
import { createInMemoryIllustrationSink } from '../illustrationSink';
import { createToolLog } from '../toolLog';
import { readDocumentTool } from './readDocument';
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

function makeChunk(overrides: Partial<DocChunk> = {}): DocChunk {
  return { doc_id: 'doc-1', page: 1, chunk_no: 0, text: 'เนื้อหาเอกสาร', tables: [], ...overrides };
}

describe('readDocumentTool', () => {
  it('เส้นทางปกติ (ไม่มี query/pages): บันทึก doc_id และคืน chunks', async () => {
    const toolLog = createToolLog();
    const docResult: GetDocResult = {
      doc: makeDoc(),
      chunks: [makeChunk()],
      totalChunks: 1,
      coverageNotes: [],
    };
    const ctx: ToolContext = {
      data: createDataFacade({ getDoc: vi.fn().mockResolvedValue(docResult) }),
      toolLog,
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await readDocumentTool.run({ doc_id: 'doc-1' }, ctx);
    expect(result.isError).toBe(false);
    if (!result.isError) {
      expect(result.output.chunks).toHaveLength(1);
    }
    expect(toolLog.hasDocId('doc-1')).toBe(true);
  });

  it('เอกสารสแกน (extracted:false) → chunks:null พร้อม note (N4)', async () => {
    const docResult: GetDocResult = {
      doc: makeDoc({ extracted: false, has_text_layer: false }),
      chunks: null,
      totalChunks: 0,
      coverageNotes: [],
      note: 'เอกสารนี้เป็นเอกสารสแกน ระบบไม่ได้อ่านเนื้อหา (N4)',
    };
    const ctx: ToolContext = {
      data: createDataFacade({ getDoc: vi.fn().mockResolvedValue(docResult) }),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await readDocumentTool.run({ doc_id: 'doc-1' }, ctx);
    if (!result.isError) {
      expect(result.output.chunks).toBeNull();
      expect(result.output.note).toContain('สแกน');
    } else {
      throw new Error('expected success');
    }
  });

  it('pages[] หลายหน้า: เรียก getDoc แยกทีละหน้าแล้วรวมผล', async () => {
    const getDoc = vi
      .fn<(docId: string, opts?: { page?: number }) => Promise<GetDocResult>>()
      .mockImplementation((_docId, opts) => {
        const page = opts?.page ?? 1;
        return Promise.resolve({
          doc: makeDoc(),
          chunks: [makeChunk({ page, chunk_no: page })],
          totalChunks: 1,
          coverageNotes: [],
        });
      });
    const ctx: ToolContext = {
      data: createDataFacade({ getDoc }),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await readDocumentTool.run({ doc_id: 'doc-1', pages: [1, 2] }, ctx);
    expect(getDoc).toHaveBeenCalledTimes(2);
    if (!result.isError) {
      expect(result.output.chunks).toHaveLength(2);
      expect(result.output.total_chunks).toBe(2);
    } else {
      throw new Error('expected success');
    }
  });

  it('query พร้อม pages: ใช้ query อย่างเดียว + มี warning', async () => {
    const getDoc = vi.fn().mockResolvedValue({
      doc: makeDoc(),
      chunks: [makeChunk()],
      totalChunks: 1,
      coverageNotes: [],
    });
    const ctx: ToolContext = {
      data: createDataFacade({ getDoc }),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await readDocumentTool.run({ doc_id: 'doc-1', query: 'คำค้น', pages: [1] }, ctx);
    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(getDoc).toHaveBeenCalledWith('doc-1', { query: 'คำค้น', maxChunks: 6 });
    if (!result.isError) {
      expect(result.output.warnings.some((w) => w.includes('query'))).toBe(true);
    } else {
      throw new Error('expected success');
    }
  });

  it('ตัดข้อความ chunk ที่ยาวเกิน 2000 ตัวอักษร', async () => {
    const longText = 'ก'.repeat(3000);
    const ctx: ToolContext = {
      data: createDataFacade({
        getDoc: vi.fn().mockResolvedValue({
          doc: makeDoc(),
          chunks: [makeChunk({ text: longText })],
          totalChunks: 1,
          coverageNotes: [],
        }),
      }),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await readDocumentTool.run({ doc_id: 'doc-1' }, ctx);
    if (!result.isError) {
      expect(result.output.chunks?.[0]?.text.length).toBeLessThanOrEqual(2001);
    } else {
      throw new Error('expected success');
    }
  });
});
