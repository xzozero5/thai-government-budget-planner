/**
 * T-302 — `adjust_for_inflation`: ปรับมูลค่าเงินข้ามปีด้วยดัชนีเศรษฐกิจ (deterministic, 05 §3)
 *
 * ให้ AI ใช้แทนคำนวณเอง (system prompt บังคับ) — ผลลัพธ์ถูกบันทึกใน ToolLog เพื่อให้ `emit_proposal`
 * (T-303) ตรวจว่า `price_derivation` ที่ AI ประกาศใน BOQ ตรงกับผลจริงของ tool นี้หรือไม่
 */
import { z } from 'zod';
import type { AdjustForInflationInput } from '@/data';
import { createTool, type ToolContext } from './toolKit';

const INFLATION_INDEX_VALUES = [
  'cpi_headline_index',
  'construction_material_index',
  'cmi_steel',
  'cmi_cement',
  'cmi_concrete',
  'cmi_wood',
  'cmi_tiles',
  'cmi_paint',
  'cmi_sanitary',
  'cmi_electrical_plumbing',
  'cmi_other',
  'cmi_electrical',
  'cmi_plumbing',
  'cmi_asphalt_petroleum',
] as const;

export const AdjustForInflationInputSchema = z.object({
  amount_thb: z.number().describe('มูลค่าเงินต้นทาง (บาท)'),
  from_year_be: z.number().int().describe('ปีฐาน พ.ศ. ของ amount_thb'),
  to_year_be: z.number().int().describe('ปีที่ต้องการปรับไปถึง พ.ศ.'),
  indicator: z.enum(INFLATION_INDEX_VALUES).optional().describe('ค่าเริ่มต้น cpi_headline_index'),
  allow_latest_available: z
    .boolean()
    .optional()
    .describe('true = ถ้า to_year_be ยังไม่มีข้อมูล ใช้ปีล่าสุดที่มีแทน (มี warning)'),
});
export type AdjustForInflationToolInput = z.infer<typeof AdjustForInflationInputSchema>;

export const AdjustForInflationOutputSchema = z.object({
  adjusted_thb: z.number(),
  factor: z.number(),
  from_value: z.number(),
  to_value: z.number(),
  /** ปีของ to_value ที่ใช้จริง (ต่างจาก to_year_be เมื่อใช้ปีล่าสุดที่มีข้อมูลแทน) — ใช้ปีนี้เมื่ออ้าง citation econ */
  to_year_be_used: z.number().int(),
  index_unit: z.string(),
  indicator: z.string(),
  source: z.object({
    source_name: z.string(),
    source_url: z.string(),
    verified: z.literal(false),
  }),
  warnings: z.array(z.string()),
});
export type AdjustForInflationOutput = z.infer<typeof AdjustForInflationOutputSchema>;

async function handler(
  input: AdjustForInflationToolInput,
  ctx: ToolContext,
): Promise<AdjustForInflationOutput> {
  const indicator = input.indicator ?? 'cpi_headline_index';
  const facadeInput: Omit<AdjustForInflationInput, 'series'> = {
    amountThb: input.amount_thb,
    fromYearBe: input.from_year_be,
    toYearBe: input.to_year_be,
    index: indicator,
    ...(input.allow_latest_available !== undefined
      ? { allowLatestAvailable: input.allow_latest_available }
      : {}),
  };
  const result = await ctx.data.adjustForInflation(facadeInput);

  // T-604 (eval จริง เคส equip-aircon-18000btu): ค่าดัชนีปีต้นทาง/ปลายทางที่ tool นี้อ่านจากข้อมูลจริงและ
  // ส่งกลับให้โมเดลเห็น (from_value/to_value) ต้องอ้างเป็น citation kind=econ ได้ — เดิมบันทึกเฉพาะ
  // get_econ_indicator ทำให้ citation ที่ถูกต้องของโมเดลถูก validator ตัดทิ้ง (การปรับเงินเฟ้อดูไร้หลักฐาน)
  ctx.toolLog.recordEconValue(indicator, input.from_year_be);
  ctx.toolLog.recordEconValue(indicator, result.toYearBeUsed);

  ctx.toolLog.recordInflationAdjustment({
    fromAmountThb: input.amount_thb,
    fromYearBe: input.from_year_be,
    toYearBe: input.to_year_be,
    indicator,
    factor: result.factor,
    adjustedThb: result.adjustedThb,
  });

  return {
    adjusted_thb: result.adjustedThb,
    factor: result.factor,
    from_value: result.fromIndex,
    to_value: result.toIndex,
    to_year_be_used: result.toYearBeUsed,
    index_unit: result.indexUnit,
    indicator,
    source: {
      source_name: result.basis.source_name,
      source_url: result.basis.source_url,
      verified: false,
    },
    warnings: result.warnings,
  };
}

export const adjustForInflationTool = createTool({
  name: 'adjust_for_inflation',
  description:
    'ปรับมูลค่าเงินข้ามปีงบด้วยดัชนีเศรษฐกิจ (CPI/ดัชนีวัสดุก่อสร้าง) แบบ deterministic — ' +
    'ต้องใช้ tool นี้เสมอเมื่อเทียบราคาข้ามปี ห้ามคำนวณเอง ปีที่ไม่มีข้อมูลจะ error (ไม่ประมาณ/เดา)',
  inputSchema: AdjustForInflationInputSchema,
  outputSchema: AdjustForInflationOutputSchema,
  handler,
});
