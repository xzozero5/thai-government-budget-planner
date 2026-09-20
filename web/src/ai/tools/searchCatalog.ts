/**
 * T-302 — `search_catalog`: ค้นหา item ใน catalog ด้วย MiniSearch fuzzy (05-FEATURES.md §3)
 *
 * **ช่องว่างของ facade ที่พบ (รายงานแล้ว ไม่ได้แก้ `data/**`)**: 05 §3 ระบุ input
 * `gov_level`/`budget_type` แต่ `data/search.ts::searchCatalog` (T-204/T-208) รองรับเฉพาะ
 * `{limit, years, requireUnitPrice}` — จึงไม่รับ 2 ฟิลด์นี้ใน input schema ของ tool (รับมาแล้วกรองเอง
 * ในนี้ก็ทำไม่ได้เพราะ `CatalogItem`/`CatalogItemSlim` ไม่มีคอลัมน์ gov_level/budget_type ให้กรอง)
 */
import { z } from 'zod';
import type { CatalogItem } from '@/data';
import {
  clampRows,
  createTool,
  MAX_COVERAGE_NOTES_PER_CALL,
  truncateString,
  type ToolContext,
} from './toolKit';

export const SearchCatalogInputSchema = z.object({
  query: z.string().min(1).max(200).describe('คำค้นภาษาไทย/อังกฤษ เช่น ชื่อครุภัณฑ์หรือประเภทงาน'),
  fiscal_years: z
    .array(z.number().int())
    .max(20)
    .optional()
    .describe('กรองเฉพาะรายการที่มีข้อมูลในปีงบประมาณ (พ.ศ.) เหล่านี้อย่างน้อยหนึ่งปี'),
  require_unit_price: z
    .boolean()
    .optional()
    .describe('true = เอาเฉพาะรายการที่มีสถิติราคาต่อหน่วยจริง (ไม่ใช่แค่ยอดรวมต่อบรรทัด)'),
  limit: z.number().int().min(1).max(20).optional(),
});
export type SearchCatalogInput = z.infer<typeof SearchCatalogInputSchema>;

const PriceStatsSchema = z.object({
  min: z.number(),
  p25: z.number(),
  median: z.number(),
  p75: z.number(),
  max: z.number(),
  n: z.number().int(),
});

const CatalogItemResultSchema = z.object({
  key: z.string(),
  name: z.string(),
  n_lines: z.number().int(),
  years: z.array(z.number().int()),
  top_agencies: z.array(z.string()),
  /** AC2 (T-113/T-302): ไม่มี unit_price → ป้าย 'amount_per_line' ("ราคาต่อรายการงบ ไม่ใช่ราคาต่อหน่วย") */
  price_basis: z.enum(['unit_price', 'amount_per_line']),
  price_basis_note: z.string().optional(),
  /** AC3: ต้องส่ง p25–p75 + n เสมอ ไม่ใช่ median เดี่ยว — จึงคืนทั้งก้อนสถิติเสมอ (ไม่ใช่ number เดียว) */
  price_stats: PriceStatsSchema.nullable(),
  /** AC2: unit_price.n < 3 → reliability 'low' + คำเตือน */
  reliability: z.enum(['low']).optional(),
  reliability_note: z.string().optional(),
  /** AC3: low_specificity → ต้องถามขนาด/สเปคก่อนใช้เป็น benchmark */
  low_specificity: z.boolean(),
  low_specificity_warning: z.string().optional(),
  sample_source_ids: z.array(z.string()),
});

const CoverageNoteResultSchema = z.object({
  dataset: z.string(),
  fiscal_year_be: z.number().int().optional(),
  status: z.string(),
  note: z.string(),
});

export const SearchCatalogOutputSchema = z.object({
  items: z.array(CatalogItemResultSchema),
  total: z.number().int(),
  coverage_notes: z.array(CoverageNoteResultSchema),
});
export type SearchCatalogOutput = z.infer<typeof SearchCatalogOutputSchema>;

const LOW_SPECIFICITY_WARNING =
  'ชื่อรายการนี้กว้าง/ไม่เจาะจงสเปค (รวมของหลายขนาด/รุ่นเข้าด้วยกัน) — ควรถามขนาด/สเปคผู้ใช้ก่อน แล้วอ้างเป็นช่วง p25–p75 ไม่ใช่ตัวเลขเดียว';
const AMOUNT_PER_LINE_NOTE = 'ราคาต่อรายการงบ ไม่ใช่ราคาต่อหน่วย';

function toCatalogItemResult(full: CatalogItem): z.infer<typeof CatalogItemResultSchema> {
  const priceBasis: 'unit_price' | 'amount_per_line' = full.unit_price !== undefined ? 'unit_price' : 'amount_per_line';
  const stats = full.unit_price ?? full.amount ?? null;
  const reliabilityLow = stats !== null && stats.n < 3;

  return {
    key: full.key,
    // 05 §3: ตัด string ยาว > 300 ตัวอักษร แต่ "คงชื่อรายการเต็มไว้" — ห้ามตัด name
    name: full.name,
    n_lines: full.n_lines,
    years: full.years,
    top_agencies: full.top_agencies,
    price_basis: priceBasis,
    price_stats: stats,
    low_specificity: full.low_specificity ?? false,
    sample_source_ids: full.sample_source_ids,
    ...(priceBasis === 'amount_per_line' ? { price_basis_note: AMOUNT_PER_LINE_NOTE } : {}),
    ...(reliabilityLow
      ? {
          reliability: 'low' as const,
          reliability_note: `มีตัวอย่างราคาเพียง ${String(stats.n)} รายการ ไม่ควรใช้เป็นราคาอ้างอิงย้อนหลังที่มั่นใจสูง`,
        }
      : {}),
    ...(full.low_specificity === true ? { low_specificity_warning: LOW_SPECIFICITY_WARNING } : {}),
  };
}

async function handler(input: SearchCatalogInput, ctx: ToolContext): Promise<SearchCatalogOutput> {
  const searchResult = await ctx.data.searchCatalog(input.query, {
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.fiscal_years !== undefined ? { years: input.fiscal_years } : {}),
    ...(input.require_unit_price !== undefined ? { requireUnitPrice: input.require_unit_price } : {}),
  });

  const matches = clampRows(searchResult.matches);
  const items: z.infer<typeof CatalogItemResultSchema>[] = [];
  for (const match of matches) {
    const full = await ctx.data.getCatalogItem(match.item.i);
    ctx.toolLog.recordSourceIds(full.sample_source_ids);
    // T-604(B): sample_source_ids ยืนยันแล้วว่าอยู่ใน "หนึ่งใน" shard ของ item นี้เสมอ
    // (`catalogIntegrity.test.ts`) แต่ไม่รู้ว่าไฟล์ไหนแน่ — จำไว้เป็น candidate ให้ get_budget_line/
    // citation drawer ไล่ค้นเป็นชุด ๆ แทนที่จะ "หา shard ไม่เจอ" ทั้งที่เป็น id จริงจากการค้นนี้เอง
    if (full.shardPaths.length > 0) {
      for (const sourceId of full.sample_source_ids) {
        ctx.toolLog.recordSourceShardCandidates?.(sourceId, full.shardPaths);
      }
    }
    const stats = full.unit_price ?? full.amount ?? null;
    if (stats !== null && stats.n < 3) {
      // AC2: อ้างรายการที่มีตัวอย่างน้อย (n<3) ต้องไม่ได้ confidence สูงสุด — cap ทุก sample source_id
      // ของ item นี้ไว้ที่ medium (ดูคอมเมนต์ที่ toolLog.ts)
      for (const sourceId of full.sample_source_ids) {
        ctx.toolLog.recordConfidenceCeiling(sourceId, 'medium');
      }
    }
    items.push(toCatalogItemResult(full));
  }

  const facets = await ctx.data.facets();

  return {
    items,
    total: searchResult.total,
    coverage_notes: clampRows(facets.coverage_notes, MAX_COVERAGE_NOTES_PER_CALL).map((n) => ({
      dataset: n.dataset,
      ...(n.fiscal_year_be !== undefined ? { fiscal_year_be: n.fiscal_year_be } : {}),
      status: n.status,
      note: truncateString(n.note),
    })),
  };
}

export const searchCatalogTool = createTool({
  name: 'search_catalog',
  description:
    'ค้นหารายการครุภัณฑ์/งานในอดีต (item_key) ด้วยคำค้นแบบ fuzzy ภาษาไทย คืนสถิติราคาต่อหน่วย/ต่อรายการรายปี ' +
    'ใช้เป็นก้าวแรกเสมอก่อน query_budget_lines เพื่อหา item_key ที่ถูกต้อง — ไม่รับ SQL หรือ filter ' +
    'gov_level/budget_type (ยังไม่มีใน catalog) หากไม่พบผลลัพธ์ที่ตรง อย่าสรุปว่า "ไม่เคยมีการตั้งงบ" ' +
    'ให้ลอง query_budget_lines ด้วย keyword ต่อ (รายการหางยาวหลายรายการไม่อยู่ใน catalog)',
  inputSchema: SearchCatalogInputSchema,
  outputSchema: SearchCatalogOutputSchema,
  handler,
});
