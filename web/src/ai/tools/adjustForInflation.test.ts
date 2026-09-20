import { createDataFacade, EconDataMissingError, type AdjustForInflationResult } from '@/data';
import { describe, expect, it, vi } from 'vitest';
import { createInMemoryIllustrationSink } from '../illustrationSink';
import { createToolLog } from '../toolLog';
import { adjustForInflationTool } from './adjustForInflation';
import type { ToolContext } from './toolKit';

describe('adjustForInflationTool', () => {
  it('เส้นทางปกติ: บันทึกผลลัพธ์ลง ToolLog สำหรับตรวจ price_derivation ทีหลัง', async () => {
    const toolLog = createToolLog();
    const adjustResult: AdjustForInflationResult = {
      adjustedThb: 110_000,
      factor: 1.1,
      fromIndex: 100,
      toIndex: 110,
      toYearBeUsed: 2568,
      indexUnit: 'index',
      basis: { indicator: 'cpi_headline_index', source_name: 'สนค.', source_url: 'https://x', verified: false },
      warnings: [],
    };
    const ctx: ToolContext = {
      data: createDataFacade({ adjustForInflation: vi.fn().mockResolvedValue(adjustResult) }),
      toolLog,
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await adjustForInflationTool.run(
      { amount_thb: 100_000, from_year_be: 2565, to_year_be: 2570 },
      ctx,
    );
    expect(result.isError).toBe(false);
    if (!result.isError) {
      expect(result.output.adjusted_thb).toBe(110_000);
      expect(result.output.factor).toBe(1.1);
    }
    const found = toolLog.findInflationAdjustment({
      fromAmountThb: 100_000,
      fromYearBe: 2565,
      toYearBe: 2570,
      indicator: 'cpi_headline_index',
    });
    expect(found?.factor).toBe(1.1);
    // T-604: ค่าดัชนีที่ tool นี้อ่านจริงต้องอ้างเป็น citation econ ได้ — ปีปลายทางใช้ "ปีที่ใช้จริง" (2568)
    // ไม่ใช่ปีที่ขอ (2570) เพราะค่าของปี 2570 ไม่เคยถูกอ่าน
    expect(toolLog.hasEconValue('cpi_headline_index', 2565)).toBe(true);
    expect(toolLog.hasEconValue('cpi_headline_index', 2568)).toBe(true);
    expect(toolLog.hasEconValue('cpi_headline_index', 2570)).toBe(false);
    if (!result.isError) {
      expect(result.output.to_year_be_used).toBe(2568);
    }
  });

  it('ปีที่ไม่มีข้อมูล → is_error (ห้ามเดา)', async () => {
    const ctx: ToolContext = {
      data: createDataFacade({
        adjustForInflation: vi.fn().mockRejectedValue(new EconDataMissingError('cpi_headline_index', 2540, 2555)),
      }),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await adjustForInflationTool.run(
      { amount_thb: 1000, from_year_be: 2540, to_year_be: 2570 },
      ctx,
    );
    expect(result.isError).toBe(true);
  });

  it('input ผิด schema → is_error', async () => {
    const ctx: ToolContext = {
      data: createDataFacade(),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await adjustForInflationTool.run({ amount_thb: 'abc' }, ctx);
    expect(result.isError).toBe(true);
  });
});
