/**
 * T-302 — `get_econ_indicator`: ค่าตัวชี้วัดเศรษฐกิจรายปี (05 §3)
 *
 * AC5 (T-113/T-302): ไม่มีค่า → `{value:null, note}` เสมอ — **ห้ามประมาณ/interpolate เอง**
 * (`data/econ.ts` บังคับ `verified:false` เสมออยู่แล้ว — ดูคอมเมนต์ใน `EconValueResult`)
 */
import { z } from 'zod';
import { createTool, type ToolContext } from './toolKit';

export const GetEconIndicatorInputSchema = z.object({
  indicators: z
    .array(z.string().max(100))
    .min(1)
    .max(10)
    .describe('เช่น cpi_headline_index, construction_material_index, cmi_steel'),
  years_be: z.array(z.number().int()).min(1).max(15).describe('ปี พ.ศ.'),
});
export type GetEconIndicatorInput = z.infer<typeof GetEconIndicatorInputSchema>;

const EconIndicatorValueSchema = z.object({
  indicator: z.string(),
  year_be: z.number().int(),
  value: z.number().nullable(),
  unit: z.string().nullable(),
  source_name: z.string().nullable(),
  source_url: z.string().nullable(),
  /** `data/econ.ts`: ค่าทุกตัวยัง verified:false เสมอ ณ วันนี้ (docs/econ-sources.md) */
  verified: z.literal(false).nullable(),
  note: z.string(),
});

export const GetEconIndicatorOutputSchema = z.object({
  values: z.array(EconIndicatorValueSchema),
  total: z.number().int(),
});
export type GetEconIndicatorOutput = z.infer<typeof GetEconIndicatorOutputSchema>;

async function handler(input: GetEconIndicatorInput, ctx: ToolContext): Promise<GetEconIndicatorOutput> {
  const values: z.infer<typeof EconIndicatorValueSchema>[] = [];
  for (const indicator of input.indicators) {
    for (const yearBe of input.years_be) {
      const result = await ctx.data.getEconValue(indicator, yearBe);
      if (result === null) {
        values.push({
          indicator,
          year_be: yearBe,
          value: null,
          unit: null,
          source_name: null,
          source_url: null,
          verified: null,
          note: `ไม่มีข้อมูลตัวชี้วัด "${indicator}" สำหรับปี พ.ศ. ${String(yearBe)} ในชุดข้อมูล — ห้ามประมาณ ให้ลองใช้ web_search แทนถ้าจำเป็น`,
        });
        continue;
      }
      ctx.toolLog.recordEconValue(indicator, yearBe);
      values.push({
        indicator,
        year_be: yearBe,
        value: result.value,
        unit: result.unit,
        source_name: result.source_name,
        source_url: result.source_url,
        verified: result.verified,
        note: result.note,
      });
    }
  }
  return { values, total: values.length };
}

export const getEconIndicatorTool = createTool({
  name: 'get_econ_indicator',
  description:
    'ดึงค่าตัวชี้วัดเศรษฐกิจ (CPI, ดัชนีราคาวัสดุก่อสร้าง ฯลฯ) รายปี พ.ศ. — ทุกค่ายัง verified:false ' +
    '(ยังไม่มีใครตรวจสอบซ้ำ) ไม่มีค่า → value:null พร้อมเหตุผล ห้ามเดา/ประมาณค่าที่ไม่มีเอง',
  inputSchema: GetEconIndicatorInputSchema,
  outputSchema: GetEconIndicatorOutputSchema,
  handler,
});
