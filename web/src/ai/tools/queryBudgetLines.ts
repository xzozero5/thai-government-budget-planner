/**
 * T-302 — `query_budget_lines`: ค้นบรรทัดงบจริงผ่าน `data.queryLines` (DuckDB-WASM) เท่านั้น
 * **ห้ามให้ AI ส่ง SQL** (05 §3, 09 §3) — ทุก filter ผ่าน parameter ที่กำหนดไว้ตายตัวเท่านั้น
 *
 * **ช่องว่างของ facade ที่พบ (รายงานแล้ว)**:
 * - 05 §3 ระบุ `dataset?: string[]` (หลาย dataset พร้อมกัน) แต่ `repo.QueryLinesParams.dataset`
 *   รับได้ค่าเดียว — tool นี้ใช้แค่ตัวแรกของ array ที่ผู้ใช้ส่งมา (มี warning แจ้ง AI เมื่อส่งมากกว่า 1)
 * - 05 §3 ระบุ `keywords?: string[]` (หลายคำ) แต่ `repo.QueryLinesParams.keyword` รับ string เดียว
 *   (ILIKE '%keyword%') — ใช้แค่ตัวแรกเช่นกัน
 * - (แก้แล้ว) `getCatalogItemByKey` คืน `shardPaths` จริง → tool ส่งต่อเป็นตัวจำกัด shard ให้ `queryLines`
 *   (intersection กับ filter ปี/กระทรวง/จังหวัด) — ลดการสแกนและโอกาสชน `QueryTooBroadError`
 */
import { z } from 'zod';
import type { Dataset, QueryLinesParams } from '@/data';
import { clampRows, createTool, MAX_RESULT_ROWS, type ToolContext } from './toolKit';

const ORDER_BY_VALUES = [
  'amount_desc',
  'amount_asc',
  'unit_price_desc',
  'unit_price_asc',
  'source_id',
] as const;

export const QueryBudgetLinesInputSchema = z.object({
  item_key: z
    .string()
    .max(200)
    .optional()
    .describe(
      'item_key จาก search_catalog — ระบบจะ resolve เป็นทุก variant ที่สะกดต่างแค่ช่องว่างให้อัตโนมัติ',
    ),
  keywords: z
    .array(z.string().max(200))
    .max(5)
    .optional()
    .describe(
      'คำค้นสำรองสำหรับรายการที่ไม่อยู่ใน catalog (ใช้แค่คำแรก) — ต้องระบุปี/กระทรวงร่วมด้วยเสมอ',
    ),
  fiscal_years: z.array(z.number().int()).max(20).optional(),
  ministry_code: z.string().max(50).optional(),
  agency: z.string().max(200).optional().describe('ค้นแบบ substring ในชื่อหน่วยงาน'),
  province: z.string().max(100).optional(),
  dataset: z
    .array(z.string().max(50))
    .max(5)
    .optional()
    .describe(
      'ชื่อ dataset เช่น pbo_disbursement, act_2570_draft (ใช้ได้ทีละ 1 ค่าเท่านั้นในปัจจุบัน)',
    ),
  min_amount: z.number().optional(),
  max_amount: z.number().optional(),
  order_by: z.enum(ORDER_BY_VALUES).optional(),
  limit: z.number().int().min(1).max(MAX_RESULT_ROWS).optional(),
});
export type QueryBudgetLinesInput = z.infer<typeof QueryBudgetLinesInputSchema>;

const QUALITY_FLAGS_REQUIRE_MEDIUM = new Set([
  'upstream_ocr',
  'group_total_mismatch',
  'corrupt_row',
  'qty_parsed_low_conf',
  'qty_is_measure',
  'org_tail_uncertain',
]);

const OCR_FLAGS = new Set(['upstream_ocr', 'group_total_mismatch']);

/** AC4 (T-113/T-302): แถวที่มี flag เหล่านี้ → confidence สูงสุด = medium + หมายเหตุไทย (ADR-005) */
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

const BudgetLineLiteSchema = z.object({
  source_id: z.string(),
  dataset: z.string(),
  fiscal_year_be: z.number().int(),
  gov_level: z.string(),
  ministry: z.string().nullable(),
  agency: z.string().nullable(),
  province: z.string().nullable(),
  item_name_raw: z.string(),
  item_key: z.string(),
  item_qty: z.number().nullable(),
  item_unit: z.string().nullable(),
  amount_thb: z.number().nullable(),
  unit_price_thb: z.number().nullable(),
  /** AC2: ไม่มี unit_price → 'amount_per_line' ("ราคาต่อรายการงบ ไม่ใช่ราคาต่อหน่วย") */
  price_basis: z.enum(['unit_price', 'amount_per_line']),
  price_basis_note: z.string().optional(),
  quality_flags: z.array(z.string()),
  max_confidence: z.enum(['medium']).optional(),
  confidence_note: z.string().optional(),
  source_doc_id: z.string(),
});

const CoverageNoteResultSchema = z.object({
  dataset: z.string(),
  fiscal_year_be: z.number().int().optional(),
  status: z.string(),
  note: z.string(),
});

export const QueryBudgetLinesOutputSchema = z.object({
  rows: z.array(BudgetLineLiteSchema),
  total: z.number().int(),
  truncated: z.boolean(),
  shards_loaded: z.array(z.string()),
  coverage_notes: z.array(CoverageNoteResultSchema),
  warnings: z.array(z.string()),
});
export type QueryBudgetLinesOutput = z.infer<typeof QueryBudgetLinesOutputSchema>;

interface ResolvedItem {
  itemKeys: string[];
  /** shard ที่ catalog บอกว่ามี item นี้ — undefined เมื่อ resolve ไม่เจอ (ปล่อยให้ queryLines เลือกเอง) */
  shardPaths?: string[];
}

async function resolveItem(
  itemKey: string | undefined,
  ctx: ToolContext,
): Promise<ResolvedItem | undefined> {
  if (itemKey === undefined) {
    return undefined;
  }
  const item = await ctx.data.getCatalogItemByKey(itemKey);
  if (item === null) {
    // resolve ไม่เจอไม่ได้แปลว่าไม่มีข้อมูล — ส่ง key เดิมตรง ๆ ต่อให้ queryLines เผื่อ match เป๊ะ
    return { itemKeys: [itemKey] };
  }
  return {
    itemKeys: item.keys !== undefined && item.keys.length > 0 ? item.keys : [item.key],
    ...(item.shardPaths.length > 0 ? { shardPaths: item.shardPaths } : {}),
  };
}

async function handler(
  input: QueryBudgetLinesInput,
  ctx: ToolContext,
): Promise<QueryBudgetLinesOutput> {
  const warnings: string[] = [];
  if ((input.dataset?.length ?? 0) > 1) {
    warnings.push('รองรับ dataset ได้ทีละ 1 ค่าเท่านั้นในตอนนี้ — ใช้ค่าแรกที่ระบุ');
  }
  if ((input.keywords?.length ?? 0) > 1) {
    warnings.push('รองรับ keyword ได้ทีละ 1 คำเท่านั้นในตอนนี้ — ใช้คำแรกที่ระบุ');
  }

  const resolved = await resolveItem(input.item_key, ctx);
  const itemKeys = resolved?.itemKeys;
  const firstKeyword = input.keywords?.[0];
  const firstDataset = input.dataset?.[0];

  const params: QueryLinesParams = {
    ...(itemKeys !== undefined ? { itemKeys } : {}),
    ...(resolved?.shardPaths !== undefined ? { shardPaths: resolved.shardPaths } : {}),
    ...(firstKeyword !== undefined ? { keyword: firstKeyword } : {}),
    ...(input.fiscal_years !== undefined ? { fiscalYears: input.fiscal_years } : {}),
    ...(input.ministry_code !== undefined ? { ministryCodes: [input.ministry_code] } : {}),
    ...(input.agency !== undefined ? { agencyContains: input.agency } : {}),
    ...(input.province !== undefined ? { province: input.province } : {}),
    // boundary: dataset เป็นคำที่โมเดลพิมพ์มาเอง (untrusted) — ถ้าไม่ตรง enum จริงของ parquet, DuckDB
    // แค่ไม่เจอแถว (WHERE dataset = ?) ไม่ throw จึงปลอดภัยที่จะ cast โดยไม่ validate ซ้ำที่นี่
    ...(firstDataset !== undefined ? { dataset: firstDataset as Dataset } : {}),
    ...(input.min_amount !== undefined ? { minAmount: input.min_amount } : {}),
    ...(input.max_amount !== undefined ? { maxAmount: input.max_amount } : {}),
    ...(input.order_by !== undefined ? { orderBy: input.order_by } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  };

  const result = await ctx.data.queryLines(params);

  const rows = clampRows(result.rows).map((line) => {
    const priceBasis: 'unit_price' | 'amount_per_line' =
      line.unit_price_thb !== null ? 'unit_price' : 'amount_per_line';
    const confidenceNote = confidenceNoteFor(line.quality_flags);
    ctx.toolLog.recordSourceId(line.source_id);
    ctx.toolLog.recordDocId(line.source_doc_id);
    // T-307 H2: จำค่าจริงของแถวนี้ไว้เทียบกับ comparables/BOQ ที่ `emit_proposal` จะตรวจภายหลัง
    ctx.toolLog.recordSourceFingerprint?.(line.source_id, {
      amountThb: line.amount_thb,
      unitPriceThb: line.unit_price_thb,
      itemQty: line.item_qty,
      itemUnit: line.item_unit,
      fiscalYearBe: line.fiscal_year_be,
      agency: line.agency,
      ministry: line.ministry,
      itemNameRaw: line.item_name_raw,
      dataset: line.dataset,
    });
    const shard = result.rowShards[line.source_id];
    if (shard !== undefined) {
      ctx.toolLog.recordSourceShard(line.source_id, shard);
    }
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
      item_name_raw: line.item_name_raw,
      item_key: line.item_key,
      item_qty: line.item_qty,
      item_unit: line.item_unit,
      amount_thb: line.amount_thb,
      unit_price_thb: line.unit_price_thb,
      price_basis: priceBasis,
      quality_flags: line.quality_flags,
      source_doc_id: line.source_doc_id,
      ...(priceBasis === 'amount_per_line'
        ? { price_basis_note: 'ราคาต่อรายการงบ ไม่ใช่ราคาต่อหน่วย' }
        : {}),
      ...(confidenceNote !== undefined
        ? { max_confidence: 'medium' as const, confidence_note: confidenceNote }
        : {}),
    };
  });

  return {
    rows,
    total: result.totalMatched,
    truncated: result.truncated,
    shards_loaded: result.shardPaths,
    coverage_notes: result.coverageNotes.map((n) => ({
      dataset: n.dataset,
      ...(n.fiscal_year_be !== undefined ? { fiscal_year_be: n.fiscal_year_be } : {}),
      status: n.status,
      note: n.note,
    })),
    warnings: [...warnings, ...result.warnings],
  };
}

export const queryBudgetLinesTool = createTool({
  name: 'query_budget_lines',
  description:
    'ค้นบรรทัดงบประมาณจริงจากข้อมูลในอดีต (ผ่าน DuckDB — ไม่รับ SQL) ต้องระบุ item_key (จาก ' +
    'search_catalog) หรือ keyword+ปี/กระทรวงเสมอ มิฉะนั้นจะกว้างเกินไปและถูกปฏิเสธ (is_error พร้อม ' +
    'คำแนะนำให้ใส่ปี/กระทรวงให้แคบลง) ผลลัพธ์ ≤ 50 แถว มี coverage_notes/quality_flags ที่ต้องอ่าน ' +
    'ก่อนสรุปว่า "ไม่พบ" (ปี 2562 ข้อมูลไม่ครบ — ไม่ใช่ไม่มีงบ, ADR-004)',
  inputSchema: QueryBudgetLinesInputSchema,
  outputSchema: QueryBudgetLinesOutputSchema,
  handler,
});
