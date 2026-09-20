/**
 * T-302 — `get_budget_line`: ดึงแถวเต็มตาม `source_id` สำหรับใช้เป็น citation (05 §3)
 *
 * ต้องใช้ `shardHints` เสมอ (ADR-002/`repo.getLines`) — tool นี้หา shard ของแต่ละ `source_id` จาก
 * `ToolLog` (บันทึกไว้ตอน `query_budget_lines`/`search_catalog` เจอแถวนั้นมาก่อน) `source_id` ที่ไม่
 * เคยผ่าน tool อื่นมาก่อนในบทสนทนานี้จะ "หา shard ไม่เจอ" (ไม่ scan ทุกไฟล์ ตาม ADR-002 — เป็นข้อจำกัด
 * ที่ตั้งใจ ไม่ใช่บั๊ก) → คืน error ต่อรายการนั้นแทนที่จะทำให้ทั้ง call ล้ม
 *
 * T-604(B) (main thread, รายงานปัญหาจาก eval จริง): `search_catalog` เคยบันทึกแค่ "id เคยปรากฏ"
 * (`recordSourceIds`) ของ `sample_source_ids` โดยไม่รู้ shard จริง (มีแค่ "candidate" — ดู
 * `ai/toolLog.ts#recordSourceShardCandidates`) ทำให้ `get_budget_line` ตอบ not_found กับ id ที่จริง ๆ
 * ค้นเจอมาแล้ว — ก่อนยอมแพ้ ให้ไล่ค้น candidate shard เป็นชุด ๆ ละ ≤ `MAX_SHARDS_TO_SCAN` (จำกัดจำนวน
 * ชุดที่ไล่ด้วย `MAX_CANDIDATE_SHARD_BATCHES` กันรายการที่มี candidate มากผิดปกติกินเวลา/แบนด์วิดท์เกินไป)
 * แล้วบันทึก shard จริงที่เจอด้วย `recordSourceShard` ให้ครั้งถัดไปไม่ต้องไล่ซ้ำ
 */
import { z } from 'zod';
import { MAX_SHARDS_TO_SCAN } from '@/data';
import { clampRows, createTool, type ToolContext } from './toolKit';

/** เพดานจำนวนชุด (แต่ละชุด ≤ `MAX_SHARDS_TO_SCAN` shard) ที่ไล่ค้นหา candidate ต่อการเรียก 1 ครั้ง —
 * กัน item ที่มี shard ผิดปกติเยอะ (เช่น ครุภัณฑ์ที่ปรากฏแทบทุกกระทรวง/ปี) ไล่ค้นไม่รู้จบ (60 ไฟล์รวม
 * ต่อการเรียก 1 ครั้งถือว่าเพียงพอกับกรณีทั่วไป — ถ้าไม่เจอในนี้ค่อยแจ้ง not_found ตามพฤติกรรมเดิม) */
const MAX_CANDIDATE_SHARD_BATCHES = 5;

/**
 * ไล่หา shard จริงของ `sourceIds` ที่ยังไม่รู้ shard (ผ่าน `ToolLog.getSourceShard`) แต่มี candidate
 * shard ที่ `search_catalog` บันทึกไว้ (`getSourceShardCandidates`) — รวม candidate ของทุก id ที่ค้าง
 * เป็นชุดเดียว (ประหยัดรอบ `getLines` กว่าไล่ทีละ id) แล้วยิงเป็นชุด ๆ ละ ≤ `MAX_SHARDS_TO_SCAN` จนกว่า
 * จะเจอครบหรือครบเพดานจำนวนชุด — เจอ id ไหนแล้วบันทึก shard จริงด้วย `recordSourceShard` ทันที (ครั้ง
 * ถัดไปในบทสนทนานี้ไม่ต้องไล่ซ้ำ) ไม่ throw แม้หาไม่เจอเลย (ปล่อยให้ logic เดิมรายงาน not_found ต่อ)
 */
async function resolveShardsViaCandidates(sourceIds: readonly string[], ctx: ToolContext): Promise<void> {
  const pending = new Set(sourceIds.filter((id) => ctx.toolLog.getSourceShard(id) === undefined));
  if (pending.size === 0) {
    return;
  }

  const candidateShards: string[] = [];
  const seen = new Set<string>();
  for (const id of pending) {
    for (const path of ctx.toolLog.getSourceShardCandidates?.(id) ?? []) {
      if (!seen.has(path)) {
        seen.add(path);
        candidateShards.push(path);
      }
    }
  }
  if (candidateShards.length === 0) {
    return;
  }

  const maxShardsToTry = MAX_SHARDS_TO_SCAN * MAX_CANDIDATE_SHARD_BATCHES;
  for (
    let offset = 0;
    offset < candidateShards.length && offset < maxShardsToTry && pending.size > 0;
    offset += MAX_SHARDS_TO_SCAN
  ) {
    const batch = candidateShards.slice(offset, offset + MAX_SHARDS_TO_SCAN);
    try {
      const result = await ctx.data.getLines([...pending], batch);
      for (const [sourceId, shardPath] of Object.entries(result.rowShards)) {
        ctx.toolLog.recordSourceShard(sourceId, shardPath);
        pending.delete(sourceId);
      }
    } catch {
      // best-effort: ชุดนี้ล้มเหลว (เช่น เครือข่ายขัดข้อง) — ปล่อยผ่านไปชุดถัดไป/จบแล้วให้ logic เดิม
      // รายงาน not_found ตามปกติ ไม่ทำให้ทั้ง call ล้มเพราะ candidate ที่หวังว่าจะช่วยแต่พลาด
    }
  }
}

export const GetBudgetLineInputSchema = z.object({
  source_ids: z
    .array(z.string().max(200))
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

  // T-604(B): ไล่หา shard จริงจาก candidate ของ search_catalog ก่อน (ถ้ามี) — ต้องทำก่อนอ่าน
  // `getSourceShard` ด้านล่าง เพราะเมธอดนี้ resolve เจอแล้วจะ `recordSourceShard` ให้ทันที
  await resolveShardsViaCandidates(requested, ctx);

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
