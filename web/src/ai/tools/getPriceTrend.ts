/**
 * T-309 — `get_price_trend`: series สำหรับ sparkline/line chart (UI วาดเอง — ห้าม AI วาดกราฟ, 04 §D10)
 *
 * basis สองแบบ (ราคาต่อหน่วย vs ราคาต่อรายการ vs ตัวชี้วัดเศรษฐกิจ) **ห้ามปน** — `data/trends.ts`
 * รับประกันแล้วว่าแต่ละ series มี basis เดียว (Zod `.refine` ใน `data/types.ts`) เราแค่ส่งต่อ
 *
 * **ช่องว่างของ facade**: `years_be` (ช่วงปีที่ขอ) ไม่มีพารามิเตอร์รองรับใน
 * `data.getPriceTrend`/`buildPriceTrend`/`getEconTrend` (คืนแค่ ≤10 จุดล่าสุดเสมอ) — tool นี้กรอง
 * ช่วงปีที่ขอ **หลัง** ได้ผลลัพธ์มาแล้วแทน (ไม่กระทบ caveat/แหล่งข้อมูลเดิม)
 *
 * T-604(A) (main thread, รายงานปัญหาจาก eval จริง): `kind:'item'` ที่ `key` ไม่ตรง catalog เป๊ะ (เช่น
 * ลอกมาจาก `item_name_raw`) เดิมคืน `{series:null}` เงียบ ๆ เหมือนกรณี "ไม่มีข้อมูลจริง" ทำให้แยกไม่ออก
 * ว่า key สะกดผิดหรือไม่มีข้อมูลจริง — ใช้ helper เดียวกับ `query_budget_lines`
 * (`ai/tools/catalogKeyLookup.ts`) แนะนำ key ที่ใกล้เคียงใน `warnings[]` เมื่อเป็นกรณี key ไม่ตรง
 */
import { z } from 'zod';
import { itemKeyNotFoundWarning, suggestCatalogKeys } from './catalogKeyLookup';
import { createTool, type ToolContext } from './toolKit';

export const GetPriceTrendInputSchema = z.object({
  kind: z.enum(['item', 'indicator']),
  key: z
    .string()
    .max(200)
    .describe('item: item_key จาก search_catalog; indicator: ชื่อตัวชี้วัด เช่น cpi_headline_index'),
  years_be: z
    .tuple([z.number().int(), z.number().int()])
    .optional()
    .describe('[ปีเริ่ม, ปีสิ้นสุด] พ.ศ. — กรองจากจุดที่มีอยู่แล้ว (ไม่ได้ขยายช่วงข้อมูล)'),
});
export type GetPriceTrendInput = z.infer<typeof GetPriceTrendInputSchema>;

const TrendPointSchema = z.object({
  year_be: z.number().int(),
  value: z.number(),
  n: z.number().int().optional(),
  p25: z.number().optional(),
  p75: z.number().optional(),
  note: z.string().optional(),
});
type TrendPointResult = z.infer<typeof TrendPointSchema>;

export const GetPriceTrendOutputSchema = z.object({
  series: z
    .object({
      kind: z.enum(['item', 'indicator']),
      key: z.string(),
      label_th: z.string(),
      unit_label: z.string(),
      basis: z.enum(['unit_price_per_line', 'amount_per_line', 'econ_indicator']),
      points: z.array(TrendPointSchema),
      source_name: z.string().nullable(),
      source_url: z.string().nullable(),
      verified: z.boolean().nullable(),
      caveats: z.array(z.string()),
    })
    .nullable(),
  summary: z
    .object({
      first: TrendPointSchema.nullable(),
      last: TrendPointSchema.nullable(),
      change_pct: z.number().nullable(),
    })
    .nullable(),
  /** T-604(A): แจ้ง key ที่ใกล้เคียงเมื่อ `kind:'item'` แล้ว `key` ไม่ตรง catalog เป๊ะ ([] ปกติ) */
  warnings: z.array(z.string()),
});
export type GetPriceTrendOutput = z.infer<typeof GetPriceTrendOutputSchema>;

function buildPricePoint(p: {
  yearBe: number;
  n: number;
  median: number;
  p25?: number;
  p75?: number;
  note?: string;
}): TrendPointResult {
  return {
    year_be: p.yearBe,
    value: p.median,
    n: p.n,
    ...(p.p25 !== undefined ? { p25: p.p25 } : {}),
    ...(p.p75 !== undefined ? { p75: p.p75 } : {}),
    ...(p.note !== undefined ? { note: p.note } : {}),
  };
}

async function handler(input: GetPriceTrendInput, ctx: ToolContext): Promise<GetPriceTrendOutput> {
  const trend = await ctx.data.getPriceTrend({ kind: input.kind, key: input.key });
  if (trend === null) {
    // AC5: ไม่มีค่า → {series: null} — ห้ามประดิษฐ์ (04 §D10/US-8.1)
    // T-604(A): เฉพาะ kind='item' ที่ key ไม่ตรง catalog เป๊ะเลย (ต่างจาก item ที่มีจริงแต่ยังไม่มี
    // trend series สะสมพอ — เช่นน้อยกว่า 3 ปี — กรณีนั้น series:null เป็นคำตอบที่ถูกต้องอยู่แล้ว ไม่ใช่
    // บั๊ก จึงต้องเช็ค catalog แยกก่อนสรุปว่า "key ไม่ตรง" กันข้อความเตือนที่เข้าใจผิด)
    const warnings: string[] = [];
    if (input.kind === 'item') {
      // best-effort: ตรวจ/แนะนำ key ล้มเหลว (เช่นเครือข่ายขัดข้อง) ต้องไม่ทำให้ผลลัพธ์ที่ถูกต้องอยู่แล้ว
      // (series:null ตาม AC5) กลายเป็น error ทั้ง call
      try {
        const item = await ctx.data.getCatalogItemByKey(input.key);
        if (item === null) {
          warnings.push(itemKeyNotFoundWarning(input.key, await suggestCatalogKeys(ctx, input.key)));
        }
      } catch {
        // ปล่อยผ่าน — ไม่มีคำแนะนำเพิ่มเติม
      }
    }
    return { series: null, summary: null, warnings };
  }

  ctx.toolLog.recordTrendRef({ kind: input.kind, key: input.key });

  const isEcon = 'indicator' in trend;
  let points: TrendPointResult[];
  let basis: 'unit_price_per_line' | 'amount_per_line' | 'econ_indicator';
  let labelTh: string;
  let unitLabel: string;
  let sourceName: string | null;
  let sourceUrl: string | null;
  let verified: boolean | null;

  if (isEcon) {
    points = trend.points.map((p) => ({ year_be: p.yearBe, value: p.value }));
    basis = 'econ_indicator';
    labelTh = trend.label_th;
    unitLabel = trend.unit;
    sourceName = trend.source_name;
    sourceUrl = trend.source_url;
    verified = trend.verified;
  } else {
    points = trend.points.map(buildPricePoint);
    basis = trend.basis;
    labelTh = trend.key;
    unitLabel = trend.unitLabel;
    sourceName = null;
    sourceUrl = null;
    verified = null;
  }

  if (input.years_be !== undefined) {
    const [fromYear, toYear] = input.years_be;
    points = points.filter((p) => p.year_be >= fromYear && p.year_be <= toYear);
  }

  const first = points[0] ?? null;
  const last = points[points.length - 1] ?? null;

  return {
    series: {
      kind: input.kind,
      key: input.key,
      label_th: labelTh,
      unit_label: unitLabel,
      basis,
      points,
      source_name: sourceName,
      source_url: sourceUrl,
      verified,
      caveats: trend.caveats,
    },
    summary: {
      first,
      last,
      change_pct: trend.changePct?.pct ?? null,
    },
    warnings: [],
  };
}

export const getPriceTrendTool = createTool({
  name: 'get_price_trend',
  description:
    'ดึง series ราคาต่อหน่วย/ต่อรายการย้อนหลัง (item) หรือตัวชี้วัดเศรษฐกิจ (indicator) สำหรับให้ UI ' +
    'วาดกราฟ — ห้ามบรรยายตัวเลขรายปีเองในข้อความ ให้อ้าง trend_ref แทน ไม่มีข้อมูล → series:null (ห้ามประดิษฐ์)',
  inputSchema: GetPriceTrendInputSchema,
  outputSchema: GetPriceTrendOutputSchema,
  handler,
});
