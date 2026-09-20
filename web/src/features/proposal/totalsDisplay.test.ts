import { describe, expect, it } from 'vitest';
import type { Totals } from './types';
import { computeContingencyDisplay } from './totalsDisplay';

function totals(overrides: Partial<Totals> = {}): Totals {
  return {
    subtotal_thb: 389330,
    vat_included: false,
    grand_total_thb: 389330,
    ...overrides,
  };
}

describe('computeContingencyDisplay', () => {
  it('ไม่มีทั้ง contingency_pct/contingency_thb → null', () => {
    expect(computeContingencyDisplay(totals())).toBeNull();
  });

  it('มีทั้ง pct และ thb → ใช้ contingency_thb ตรง ๆ เป็นจำนวนเงิน, pct เป็นค่าที่ระบุ', () => {
    const result = computeContingencyDisplay(
      totals({ contingency_pct: 5, contingency_thb: 19466.5 }),
    );
    expect(result).toEqual({ pct: 5, amountThb: 19466.5 });
  });

  it('มีแค่ pct → คำนวณจำนวนเงินจาก subtotal × pct / 100', () => {
    const result = computeContingencyDisplay(totals({ contingency_pct: 10 }));
    expect(result).toEqual({ pct: 10, amountThb: 38933 });
  });

  it('มีแค่ thb (ไม่มี pct) → pct เป็น null', () => {
    const result = computeContingencyDisplay(totals({ contingency_thb: 20000 }));
    expect(result).toEqual({ pct: null, amountThb: 20000 });
  });
});
