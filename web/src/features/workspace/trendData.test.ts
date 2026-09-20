import { describe, expect, it } from 'vitest';
import type { EconTrend, PriceTrend } from '@/data';
import { toExportTrendData } from './trendData';

function makePriceTrend(overrides: Partial<PriceTrend> = {}): PriceTrend {
  return {
    key: 'เครื่องปรับอากาศ 18,000 บีทียู',
    basis: 'unit_price_per_line',
    unitLabel: 'บาท/หน่วย',
    points: [
      { yearBe: 2566, n: 5, median: 20000, p25: 18000, p75: 22000 },
      { yearBe: 2567, n: 2, median: 21000 },
    ],
    changePct: null,
    caveats: [],
    ...overrides,
  };
}

function makeEconTrend(overrides: Partial<EconTrend> = {}): EconTrend {
  return {
    indicator: 'cpi',
    label_th: 'ดัชนีราคาผู้บริโภค',
    unit: 'จุด',
    points: [
      { yearBe: 2566, value: 108.2 },
      { yearBe: 2567, value: 109.5 },
    ],
    source_name: 'สนค.',
    source_url: 'https://example.gov/cpi',
    verified: false,
    changePct: null,
    caveats: [],
    ...overrides,
  };
}

describe('toExportTrendData (T-504)', () => {
  it('PriceTrend basis unit_price_per_line → basis "unit_price" พร้อม p25/p75/n ตามจุดจริง', () => {
    const exported = toExportTrendData(makePriceTrend());
    expect(exported.title).toBe('เครื่องปรับอากาศ 18,000 บีทียู');
    expect(exported.basis).toBe('unit_price');
    expect(exported.points).toEqual([
      { yearBe: 2566, median: 20000, n: 5, p25: 18000, p75: 22000 },
      { yearBe: 2567, median: 21000, n: 2 },
    ]);
  });

  it('PriceTrend basis amount_per_line → basis "amount_per_line" (ไม่มี p25/p75)', () => {
    const exported = toExportTrendData(
      makePriceTrend({
        basis: 'amount_per_line',
        unitLabel: 'บาท/รายการ',
        points: [{ yearBe: 2567, n: 4, median: 90000 }],
      }),
    );
    expect(exported.basis).toBe('amount_per_line');
    expect(exported.points).toEqual([{ yearBe: 2567, median: 90000, n: 4 }]);
  });

  it('EconTrend → basis "econ" ไม่มี n/p25/p75 ในจุดไหนเลย ใช้ label_th เป็น title', () => {
    const exported = toExportTrendData(makeEconTrend());
    expect(exported.title).toBe('ดัชนีราคาผู้บริโภค');
    expect(exported.basis).toBe('econ');
    expect(exported.points).toEqual([
      { yearBe: 2566, median: 108.2 },
      { yearBe: 2567, median: 109.5 },
    ]);
  });
});
