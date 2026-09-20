import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  basisLabel,
  buildYearRange,
  DEFAULT_TREND_CHART_LABELS,
  TrendChart,
  toChartRows,
  type TrendChartPoint,
} from './TrendChart';

const SAMPLE_POINTS: TrendChartPoint[] = [
  { yearBe: 2564, n: 5, median: 1000 },
  // 2565 หายไป (ช่องว่าง)
  { yearBe: 2566, n: 2, median: 1500, p25: 1200, p75: 1800 }, // n<3 → ข้อมูลน้อย
];

describe('TrendChart — pure helpers', () => {
  it('buildYearRange เติมปีที่ขาดหายให้ต่อเนื่อง', () => {
    expect(buildYearRange(SAMPLE_POINTS)).toEqual([2564, 2565, 2566]);
  });

  it('buildYearRange คืน [] เมื่อไม่มี points', () => {
    expect(buildYearRange([])).toEqual([]);
  });

  it('toChartRows: ปีที่ไม่มีข้อมูล hasData=false, median=null (ช่องว่างไม่ลากเส้นเชื่อม)', () => {
    const rows = toChartRows(SAMPLE_POINTS);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ yearBe: 2565, hasData: false, median: null });
  });

  it('toChartRows: จุด n<3 ได้ lowSample=true, n>=3 ได้ lowSample=false', () => {
    const rows = toChartRows(SAMPLE_POINTS);
    expect(rows[0]).toMatchObject({ yearBe: 2564, n: 5, lowSample: false });
    expect(rows[2]).toMatchObject({ yearBe: 2566, n: 2, lowSample: true });
  });

  it('toChartRows: bandHeight = p75 - p25 เมื่อมีค่า, fallback เป็น median เมื่อไม่มี p25/p75', () => {
    const rows = toChartRows(SAMPLE_POINTS);
    expect(rows[0]).toMatchObject({ p25: 1000, bandHeight: 0 }); // ไม่มี p25/p75 → fallback median ทั้งคู่
    expect(rows[2]).toMatchObject({ p25: 1200, bandHeight: 600 });
  });

  it('basisLabel: unit_price_per_line = "ราคาต่อหน่วย"', () => {
    expect(basisLabel('unit_price_per_line', DEFAULT_TREND_CHART_LABELS)).toBe('ราคาต่อหน่วย');
  });

  it('basisLabel: amount_per_line = ป้ายเตือนว่าไม่ใช่ราคาต่อหน่วย', () => {
    expect(basisLabel('amount_per_line', DEFAULT_TREND_CHART_LABELS)).toContain('ไม่ใช่ราคาต่อหน่วย');
  });
});

describe('TrendChart — render', () => {
  it('empty state เมื่อไม่มี points เลย', () => {
    render(<TrendChart points={[]} basis="amount_per_line" ariaLabel="แนวโน้มราคา X" />);
    const region = screen.getByRole('img', { name: 'แนวโน้มราคา X' });
    expect(region).toHaveTextContent(DEFAULT_TREND_CHART_LABELS.emptyState);
  });

  it('แสดงป้าย basis ที่ถูกต้องตาม prop basis', () => {
    render(<TrendChart points={SAMPLE_POINTS} basis="unit_price_per_line" ariaLabel="แนวโน้มราคา Y" />);
    expect(screen.getByText('ราคาต่อหน่วย')).toBeInTheDocument();
  });

  it('มี <table class="sr-only"> ที่ caption = ariaLabel และมีแถวครบทุกปี (รวมปีว่าง)', () => {
    render(<TrendChart points={SAMPLE_POINTS} basis="amount_per_line" ariaLabel="แนวโน้มราคา Z" />);
    const table = screen.getByTestId('trend-chart-table');
    const rows = within(table).getAllByRole('row');
    // 1 หัวตาราง + 3 ปี (2564, 2565, 2566)
    expect(rows).toHaveLength(4);
    expect(table).toHaveTextContent('แนวโน้มราคา Z');
  });

  it('จุดที่ n<3 มีหมายเหตุ "ข้อมูลน้อย" ในตาราง sr-only', () => {
    render(<TrendChart points={SAMPLE_POINTS} basis="amount_per_line" ariaLabel="แนวโน้มราคา W" />);
    const table = screen.getByTestId('trend-chart-table');
    expect(within(table).getByText(/ข้อมูลน้อย/)).toBeInTheDocument();
  });
});
