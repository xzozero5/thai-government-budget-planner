/**
 * T-302 — `find_documents`: ค้น `sources.json` (metadata เอกสารต้นทาง) ด้วย MiniSearch (05 §3)
 */
import { z } from 'zod';
import type { FindDocumentsParams, SourceDocCollection, SourceDocKind } from '@/data';
import { clampRows, createTool, truncateString, type ToolContext } from './toolKit';

export const FindDocumentsInputSchema = z.object({
  query: z.string().optional().describe('คำค้นในชื่อเรื่อง/หัวข้อ/หน่วยงาน (ว่างได้ถ้าจะกรองด้วย facet อย่างเดียว)'),
  collection: z.string().optional().describe('committee | province_budget | open_sso | pbo'),
  agency: z.string().optional(),
  fiscal_year: z.number().int().optional(),
  kind: z.string().optional().describe('pdf | xlsx | xls | docx | pptx | jpg | other'),
  has_text_only: z.boolean().optional().describe('true = เอาเฉพาะเอกสารที่มี text layer (ระบบอ่านเนื้อหาได้ — N4)'),
  limit: z.number().int().min(1).max(20).optional(),
});
export type FindDocumentsInput = z.infer<typeof FindDocumentsInputSchema>;

const SourceDocLiteSchema = z.object({
  doc_id: z.string(),
  rel_path: z.string(),
  kind: z.string(),
  pages: z.number().int().nullable(),
  has_text_layer: z.boolean().nullable(),
  extracted: z.boolean(),
  title_guess: z.string().nullable(),
  collection: z.string(),
  agency_guess: z.string().nullable(),
  province: z.string().nullable(),
  fiscal_years: z.array(z.number().int()),
  note: z.string().nullable(),
});

const CoverageNoteResultSchema = z.object({
  dataset: z.string(),
  fiscal_year_be: z.number().int().optional(),
  status: z.string(),
  note: z.string(),
});

export const FindDocumentsOutputSchema = z.object({
  docs: z.array(SourceDocLiteSchema),
  total: z.number().int(),
  coverage_notes: z.array(CoverageNoteResultSchema),
});
export type FindDocumentsOutput = z.infer<typeof FindDocumentsOutputSchema>;

async function handler(input: FindDocumentsInput, ctx: ToolContext): Promise<FindDocumentsOutput> {
  const params: FindDocumentsParams = {
    ...(input.query !== undefined ? { query: input.query } : {}),
    // boundary: ค่าที่โมเดลพิมพ์มาเอง (untrusted) เทียบตรงกับ enum จริงใน facade — ไม่ตรงคือกรองไม่เจอ
    // แถวใด ๆ เลย (ไม่ throw) จึงปลอดภัยที่จะ cast โดยไม่ validate ซ้ำที่นี่
    ...(input.collection !== undefined ? { collection: input.collection as SourceDocCollection } : {}),
    ...(input.agency !== undefined ? { agency: input.agency } : {}),
    ...(input.fiscal_year !== undefined ? { fiscalYear: input.fiscal_year } : {}),
    ...(input.kind !== undefined ? { kind: input.kind as SourceDocKind } : {}),
    ...(input.has_text_only !== undefined ? { hasText: input.has_text_only } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  };

  const result = await ctx.data.findDocuments(params);
  const docs = clampRows(result.docs).map((doc) => {
    ctx.toolLog.recordDocId(doc.doc_id);
    return {
      doc_id: doc.doc_id,
      rel_path: doc.rel_path,
      kind: doc.kind,
      pages: doc.pages,
      has_text_layer: doc.has_text_layer,
      extracted: doc.extracted,
      title_guess: doc.title_guess,
      collection: doc.collection,
      agency_guess: doc.agency_guess,
      province: doc.province,
      fiscal_years: doc.fiscal_years,
      note: doc.note !== null ? truncateString(doc.note) : null,
    };
  });

  const facets = await ctx.data.facets();
  return {
    docs,
    total: result.total,
    coverage_notes: facets.coverage_notes.map((n) => ({
      dataset: n.dataset,
      ...(n.fiscal_year_be !== undefined ? { fiscal_year_be: n.fiscal_year_be } : {}),
      status: n.status,
      note: truncateString(n.note),
    })),
  };
}

export const findDocumentsTool = createTool({
  name: 'find_documents',
  description:
    'ค้นเอกสารต้นทาง (รายงานกรรมาธิการ, ข้อบัญญัติ อปท., เอกสาร PBO) จาก metadata (ชื่อเรื่อง/หน่วยงาน) ' +
    'ใช้ก่อน read_document เสมอเพื่อหา doc_id — เอกสารที่ has_text_layer:false เป็นสแกนที่ระบบอ่านไม่ได้ (N4)',
  inputSchema: FindDocumentsInputSchema,
  outputSchema: FindDocumentsOutputSchema,
  handler,
});
