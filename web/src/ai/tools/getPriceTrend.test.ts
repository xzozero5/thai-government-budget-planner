import { createDataFacade, type EconTrend, type PriceTrend } from '@/data';
import { describe, expect, it, vi } from 'vitest';
import { createInMemoryIllustrationSink } from '../illustrationSink';
import { createToolLog } from '../toolLog';
import { getPriceTrendTool } from './getPriceTrend';
import type { ToolContext } from './toolKit';

describe('getPriceTrendTool', () => {
  it('AC5: ไม่มีข้อมูล → {series:null} (ห้ามประดิษฐ์)', async () => {
    const ctx: ToolContext = {
      data: createDataFacade({ getPriceTrend: vi.fn().mockResolvedValue(null) }),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await getPriceTrendTool.run({ kind: 'item', key: 'x' }, ctx);
    expect(result.isError).toBe(false);
    if (!result.isError) {
      expect(result.output.series).toBeNull();
      expect(result.output.summary).toBeNull();
    }
  });

  it('item trend (unit_price_per_line): บันทึก trend_ref และคืน caveats/points', async () => {
    const toolLog = createToolLog();
    const trend: PriceTrend = {
      key: 'เครื่องปรับอากาศ',
      basis: 'unit_price_per_line',
      unitLabel: 'บาท/หน่วย',
      points: [
        { yearBe: 2566, n: 5, median: 15000, p25: 14000, p75: 16000 },
        { yearBe: 2567, n: 6, median: 16000, p25: 15000, p75: 17000 },
      ],
      changePct: { fromYear: 2566, toYear: 2567, pct: 6.67 },
      caveats: ['ตัวอย่างน้อย'],
    };
    const ctx: ToolContext = {
      data: createDataFacade({ getPriceTrend: vi.fn().mockResolvedValue(trend) }),
      toolLog,
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await getPriceTrendTool.run({ kind: 'item', key: 'เครื่องปรับอากาศ' }, ctx);
    expect(result.isError).toBe(false);
    if (!result.isError) {
      expect(result.output.series?.basis).toBe('unit_price_per_line');
      expect(result.output.series?.points).toHaveLength(2);
      expect(result.output.summary?.change_pct).toBe(6.67);
      expect(result.output.series?.caveats).toContain('ตัวอย่างน้อย');
    }
    expect(toolLog.hasTrendRef({ kind: 'item', key: 'เครื่องปรับอากาศ' })).toBe(true);
  });

  it('indicator trend (econ): basis="econ_indicator" และไม่ปนกับ unit_price', async () => {
    const trend: EconTrend = {
      indicator: 'cpi_headline_index',
      label_th: 'ดัชนีราคาผู้บริโภค',
      unit: 'index',
      points: [
        { yearBe: 2566, value: 100 },
        { yearBe: 2567, value: 102 },
      ],
      source_name: 'สนค.',
      source_url: 'https://x',
      verified: false,
      changePct: { fromYear: 2566, toYear: 2567, pct: 2 },
      caveats: [],
    };
    const ctx: ToolContext = {
      data: createDataFacade({ getPriceTrend: vi.fn().mockResolvedValue(trend) }),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await getPriceTrendTool.run({ kind: 'indicator', key: 'cpi_headline_index' }, ctx);
    if (!result.isError) {
      expect(result.output.series?.basis).toBe('econ_indicator');
      expect(result.output.series?.verified).toBe(false);
      expect(result.output.series?.points[0]?.n).toBeUndefined();
    } else {
      throw new Error('expected success');
    }
  });

  it('years_be กรองจุดที่มีอยู่แล้ว (ไม่ขยายช่วงข้อมูล)', async () => {
    const trend: PriceTrend = {
      key: 'x',
      basis: 'amount_per_line',
      unitLabel: 'บาท/รายการ',
      points: [
        { yearBe: 2564, n: 1, median: 1000 },
        { yearBe: 2565, n: 1, median: 2000 },
        { yearBe: 2566, n: 1, median: 3000 },
      ],
      changePct: null,
      caveats: [],
    };
    const ctx: ToolContext = {
      data: createDataFacade({ getPriceTrend: vi.fn().mockResolvedValue(trend) }),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await getPriceTrendTool.run({ kind: 'item', key: 'x', years_be: [2565, 2566] }, ctx);
    if (!result.isError) {
      expect(result.output.series?.points.map((p) => p.year_be)).toEqual([2565, 2566]);
    } else {
      throw new Error('expected success');
    }
  });
});
