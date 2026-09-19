/**
 * T-302 — `get_budget_line`: ดึงแถวเต็มตาม `source_id` สำหรับใช้เป็น citation (05 §3)
 *
 * ต้องใช้ `shardHints` เสมอ (ADR-002/`repo.getLines`) — tool นี้หา shard ของแต่ละ `source_id` จาก
 * `ToolLog` (บันทึกไว้ตอน `query_budget_lines`/`search_catalog` เจอแถวนั้นมาก่อน) `source_id` ที่ไม่
 * เคยผ่าน tool อื่นมาก่อนในบทสนทนานี้จะ "หา shard ไม่เจอ" (ไม่ scan ทุกไฟล์ ตาม ADR-002 — เป็นข้อจำกัด
 * ที่ตั้งใจ ไม่ใช่บั๊ก) → คืน error ต่อรายการนั้นแทนที่จะทำให้ทั้ง call ล้ม
 */
import { z } from 'zod';
import { clampRows, createTool, type ToolContext } from './toolKit';

export const GetBudgetLineInputSchema = z.object({
  source_ids: z
    .array(z.string())
    .min(1)
    .max(20)
    .describe('source_id ที่เคยเห็นจาก search_catalog/query_budget_lines ในบทสนทนานี้เท่านั้น'),
});
export type GetBudgetLineInput = z.infer<typeof GetBudgetLineInputSchema>;

const QUALITY_FLAGS_REQUIRE_MEDIUM = new Set([
  'upstream_ocr',
  'group_total_mismatch',
  'corrupt_row',
  'qty_parsed_low_conf',
  'qty_is_measure',
  'org_tail_uncertain',
]);
const OCR_FLAGS = new Set(['upstream_ocr', 'group_total_mismatch']);

function confidenceNoteFor(flags: readonly string[]): string | undefined {
  const hits = flags.filter((f) => QUALITY_FLAGS_REQUIRE_MEDIUM.has(f));
  if (hits.length === 0) {
    return undefined;
  }
  if (hits.some((f) => OCR_FLAGS.has(f))) {
    return 'ตัวเลขถอดจาก OCR ของต้นทาง โปรดตรวจสอบกับหน้าเอกสารต้นฉบับก่อนใช้ยืนยัน (ADR-005)';
  }
  return `แถวนี้มีข้อบ่งชี้คุณภาพข้อมูลที่ควรตรวจสอบเพิ่มเติม (${hits.join(', ')}) ความมั่นใจสูงสุดคือระดับกลาง`;
}

const BudgetLineFullSchema = z.object({
  source_id: z.string(),
  dataset: z.string(),
  fiscal_year_be: z.number().int(),
  gov_level: z.string(),
  ministry: z.string().nullable(),
  agency: z.string().nullable(),
  province: z.string().nullable(),
  local_gov_name: z.string().nullable(),
  item_name_raw: z.string(),
  item_key: z.string(),
  item_qty: z.number().nullable(),
  item_unit: z.string().nullable(),
  amount_thb: z.number().nullable(),
  unit_price_thb: z.number().nullable(),
  price_basis: z.enum(['unit_price', 'amount_per_line']),
  price_basis_note: z.string().optional(),
  description: z.string().nullable(),
  legal_reference: z.string().nullable(),
  source_path: z.string(),
  source_sheet: z.string(),
  source_row: z.number().int(),
  source_page: z.number().int().nullable(),
  source_doc_id: z.string(),
  quality_flags: z.array(z.string()),
  max_confidence: z.enum(['medium']).optional(),
  confidence_note: z.string().optional(),
});

const NotFoundEntrySchema = z.object({
  source_id: z.string(),
  error: z.string(),
});

export const GetBudgetLineOutputSchema = z.object({
  lines: z.array(BudgetLineFullSchema),
  not_found: z.array(NotFoundEntrySchema),
  total: z.number().int(),
});
export type GetBudgetLineOutput = z.infer<typeof GetBudgetLineOutputSchema>;

async function handler(input: GetBudgetLineInput, ctx: ToolContext): Promise<GetBudgetLineOutput> {
  const requested = clampRows(input.source_ids, 20);

  const resolvable: string[] = [];
  const notFound: z.infer<typeof NotFoundEntrySchema>[] = [];
  const shardSet = new Set<string>();
  for (const sourceId of requested) {
    const shard = ctx.toolLog.getSourceShard(sourceId);
    if (shard === undefined) {
      notFound.push({
        source_id: sourceId,
        error:
          'ไม่พบ source_id นี้ในประวัติการค้นของบทสนทนานี้ — โปรดเรียก search_catalog หรือ ' +
          'query_budget_lines เพื่อค้นหาก่อน (ระบบไม่สแกนทุกไฟล์เพื่อป้องกันการโหลดข้อมูลเกินความจำเป็น)',
      });
      continue;
    }
    resolvable.push(sourceId);
    shardSet.add(shard);
  }

  if (resolvable.length === 0) {
    return { lines: [], not_found: notFound, total: 0 };
  }

  const result = await ctx.data.getLines(resolvable, [...shardSet]);

  const lines = result.rows.map((line) => {
    const priceBasis: 'unit_price' | 'amount_per_line' = line.unit_price_thb !== null ? 'unit_price' : 'amount_per_line';
    const confidenceNote = confidenceNoteFor(line.quality_flags);
    ctx.toolLog.recordSourceId(line.source_id);
    ctx.toolLog.recordDocId(line.source_doc_id);
    if (confidenceNote !== undefined) {
      ctx.toolLog.recordConfidenceCeiling(line.source_id, 'medium');
    }
    return {
      source_id: line.source_id,
      dataset: line.dataset,
      fiscal_year_be: line.fiscal_year_be,
      gov_level: line.gov_level,
      ministry: line.ministry,
      agency: line.agency,
      province: line.province,
      local_gov_name: line.local_gov_name,
      item_name_raw: line.item_name_raw,
      item_key: line.item_key,
      item_qty: line.item_qty,
      item_unit: line.item_unit,
      amount_thb: line.amount_thb,
      unit_price_thb: line.unit_price_thb,
      price_basis: priceBasis,
      description: line.description,
      legal_reference: line.legal_reference,
      source_path: line.source_path,
      source_sheet: line.source_sheet,
      source_row: line.source_row,
      source_page: line.source_page,
      source_doc_id: line.source_doc_id,
      quality_flags: line.quality_flags,
      ...(priceBasis === 'amount_per_line' ? { price_basis_note: 'ราคาต่อรายการงบ ไม่ใช่ราคาต่อหน่วย' } : {}),
      ...(confidenceNote !== undefined ? { max_confidence: 'medium' as const, confidence_note: confidenceNote } : {}),
    };
  });

  const foundIds = new Set(lines.map((l) => l.source_id));
  for (const sourceId of resolvable) {
    if (!foundIds.has(sourceId)) {
      notFound.push({ source_id: sourceId, error: 'ไม่พบแถวนี้ในไฟล์ shard ที่บันทึกไว้ (ข้อมูลอาจถูกอัปเดต)' });
    }
  }

  return { lines, not_found: notFound, total: lines.length };
}

export const getBudgetLineTool = createTool({
  name: 'get_budget_line',
  description:
    'ดึงแถวงบประมาณเต็ม (ทุกคอลัมน์รวมไฟล์/ชีต/แถวต้นทาง) สำหรับใช้อ้างอิง (citation) — รับเฉพาะ ' +
    'source_id ที่เคยปรากฏจาก search_catalog/query_budget_lines ในบทสนทนานี้เท่านั้น (สูงสุด 20 รายการ)',
  inputSchema: GetBudgetLineInputSchema,
  outputSchema: GetBudgetLineOutputSchema,
  handler,
});
