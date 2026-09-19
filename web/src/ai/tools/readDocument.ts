/**
 * T-302 — `read_document`: อ่านเนื้อหาเอกสาร (chunk) แบบจำกัดจำนวนเสมอ (05 §3)
 *
 * **ช่องว่างของ facade ที่พบ (รายงานแล้ว)**: `data.getDoc` (T-206 item 8) รองรับ `page` เดี่ยว และ
 * เมื่อระบุ `query` จะค้นทั้งเอกสารโดยไม่กรองตามหน้า (สองพารามิเตอร์นี้ใช้ร่วมกันไม่ได้ในตัว facade)
 * — tool นี้จึง: (1) มี `query` → ค้นทั้งเอกสาร ไม่สนใจ `pages` ที่ส่งมาด้วย (มี warning) (2) ไม่มี
 * `query` แต่มี `pages[]` → เรียก `getDoc` แยกทีละหน้า (สูงสุด 5 หน้า) แล้วรวมผลเอง
 *
 * หมายเหตุความยาว: เนื้อหาของ chunk คือสิ่งที่ tool นี้มีไว้ส่งมอบโดยตรง (ต่างจาก tool อื่นที่ข้อความ
 * ยาวเป็นแค่ field รอง) จึงตัดที่ 2,000 ตัวอักษรต่อ chunk แทนเพดานทั่วไป 300 ตัวอักษร — จำนวน chunk
 * ถูกจำกัด ≤ 6 อยู่แล้วจึงยังคุมขนาด context โดยรวมได้
 */
import { z } from 'zod';
import type { DocChunk, GetDocResult } from '@/data';
import {
  clampRows,
  createTool,
  MAX_COVERAGE_NOTES_PER_CALL,
  truncateString,
  type ToolContext,
} from './toolKit';

const MAX_CHUNKS = 6;
const MAX_PAGES_PER_CALL = 5;
const MAX_DOC_CHUNK_TEXT_LENGTH = 2000;

export const ReadDocumentInputSchema = z.object({
  doc_id: z.string().max(200).describe('doc_id จาก find_documents'),
  query: z
    .string()
    .max(200)
    .optional()
    .describe('ถ้าระบุ จะจัดอันดับ chunk ตามความเกี่ยวข้องกับคำนี้ (ไม่กรองตาม pages)'),
  pages: z
    .array(z.number().int())
    .max(MAX_PAGES_PER_CALL)
    .optional()
    .describe('เลขหน้าที่ต้องการ (ใช้ไม่ได้พร้อมกับ query) — สูงสุด 5 หน้าต่อครั้ง'),
  max_chunks: z.number().int().min(1).max(MAX_CHUNKS).optional(),
});
export type ReadDocumentInput = z.infer<typeof ReadDocumentInputSchema>;

const DocTableSchema = z.object({
  page: z.number().int().optional(),
  sheet: z.string().optional(),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
});

const DocChunkResultSchema = z.object({
  doc_id: z.string(),
  page: z.number().int().nullable(),
  chunk_no: z.number().int(),
  text: z.string(),
  tables: z.array(DocTableSchema),
});

const SourceDocLiteSchema = z.object({
  doc_id: z.string(),
  rel_path: z.string(),
  kind: z.string(),
  pages: z.number().int().nullable(),
  has_text_layer: z.boolean().nullable(),
  extracted: z.boolean(),
  title_guess: z.string().nullable(),
  collection: z.string(),
});

const CoverageNoteResultSchema = z.object({
  dataset: z.string(),
  fiscal_year_be: z.number().int().optional(),
  status: z.string(),
  note: z.string(),
});

export const ReadDocumentOutputSchema = z.object({
  doc: SourceDocLiteSchema,
  chunks: z.array(DocChunkResultSchema).nullable(),
  total_chunks: z.number().int(),
  note: z.string().optional(),
  coverage_notes: z.array(CoverageNoteResultSchema),
  warnings: z.array(z.string()),
});
export type ReadDocumentOutput = z.infer<typeof ReadDocumentOutputSchema>;

function toDocLite(doc: GetDocResult['doc']): z.infer<typeof SourceDocLiteSchema> {
  return {
    doc_id: doc.doc_id,
    rel_path: doc.rel_path,
    kind: doc.kind,
    pages: doc.pages,
    has_text_layer: doc.has_text_layer,
    extracted: doc.extracted,
    title_guess: doc.title_guess,
    collection: doc.collection,
  };
}

function toChunkResult(chunk: DocChunk): z.infer<typeof DocChunkResultSchema> {
  return {
    doc_id: chunk.doc_id,
    page: chunk.page,
    chunk_no: chunk.chunk_no,
    text: truncateStringLong(chunk.text),
    tables: chunk.tables,
  };
}

function truncateStringLong(value: string): string {
  return value.length > MAX_DOC_CHUNK_TEXT_LENGTH ? `${value.slice(0, MAX_DOC_CHUNK_TEXT_LENGTH)}…` : value;
}

async function handler(input: ReadDocumentInput, ctx: ToolContext): Promise<ReadDocumentOutput> {
  const maxChunks = input.max_chunks ?? MAX_CHUNKS;
  const warnings: string[] = [];

  let result: GetDocResult;
  if (input.query !== undefined && input.query.trim().length > 0) {
    if (input.pages !== undefined && input.pages.length > 0) {
      warnings.push('ระบุ query พร้อมกับ pages — ระบบค้นทั้งเอกสารด้วย query โดยไม่กรองตามหน้า (ข้อจำกัดของระบบ)');
    }
    result = await ctx.data.getDoc(input.doc_id, { query: input.query, maxChunks });
  } else if (input.pages !== undefined && input.pages.length > 0) {
    const pages = input.pages.slice(0, MAX_PAGES_PER_CALL);
    if (input.pages.length > MAX_PAGES_PER_CALL) {
      warnings.push(`รองรับสูงสุด ${String(MAX_PAGES_PER_CALL)} หน้าต่อครั้ง — ใช้หน้าแรก ${String(MAX_PAGES_PER_CALL)} หน้าที่ระบุ`);
    }
    const perPage = await Promise.all(pages.map((page) => ctx.data.getDoc(input.doc_id, { page, maxChunks })));
    const first = perPage[0];
    if (first === undefined) {
      result = await ctx.data.getDoc(input.doc_id, { maxChunks });
    } else {
      const allNull = perPage.every((r) => r.chunks === null);
      const merged = perPage.flatMap((r) => r.chunks ?? []).slice(0, maxChunks);
      const totalChunks = perPage.reduce((sum, r) => sum + r.totalChunks, 0);
      result = {
        doc: first.doc,
        chunks: allNull ? null : merged,
        totalChunks,
        coverageNotes: first.coverageNotes,
        ...(first.note !== undefined ? { note: first.note } : {}),
      };
    }
  } else {
    result = await ctx.data.getDoc(input.doc_id, { maxChunks });
  }

  ctx.toolLog.recordDocId(result.doc.doc_id);

  const chunkResults = result.chunks !== null ? result.chunks.map(toChunkResult) : null;
  if (chunkResults !== null) {
    for (const chunk of chunkResults) {
      // T-307 H2: จำเนื้อหา chunk ที่โมเดลเห็นจริง (หลังตัด 2,000 ตัวอักษร) ไว้เทียบ `quote` ที่
      // `emit_proposal` จะตรวจภายหลัง (ตัด quote ที่ไม่ใช่ substring ของสิ่งที่เคยอ่านจริงทิ้ง)
      ctx.toolLog.recordDocChunkText?.(chunk.doc_id, chunk.page, chunk.text);
    }
  }

  return {
    doc: toDocLite(result.doc),
    chunks: chunkResults,
    total_chunks: result.totalChunks,
    coverage_notes: clampRows(result.coverageNotes, MAX_COVERAGE_NOTES_PER_CALL).map((n) => ({
      dataset: n.dataset,
      ...(n.fiscal_year_be !== undefined ? { fiscal_year_be: n.fiscal_year_be } : {}),
      status: n.status,
      note: truncateString(n.note),
    })),
    warnings,
    ...(result.note !== undefined ? { note: result.note } : {}),
  };
}

export const readDocumentTool = createTool({
  name: 'read_document',
  description:
    'อ่านเนื้อหาเอกสาร (chunk ข้อความ/ตาราง) ของ doc_id ที่ has_text_layer:true เท่านั้น — เอกสารสแกน ' +
    'จะได้ chunks:null พร้อม note อธิบาย (N4) ใช้ query เพื่อค้นส่วนที่เกี่ยวข้องแทนการอ่านทั้งฉบับ',
  inputSchema: ReadDocumentInputSchema,
  outputSchema: ReadDocumentOutputSchema,
  handler,
});
