import { describe, expect, it } from 'vitest';
import type { Comparable } from './types';
import { shouldShowComparableUnitPrice } from './comparablesDisplay';

function comparable(overrides: Partial<Comparable> = {}): Comparable {
  return {
    source_id: 'src-1',
    fiscal_year_be: 2568,
    agency: 'กรมชลประทาน',
    item_name: 'คอนกรีต 240 ksc',
    amount_thb: 199750,
    similarity_note: 'สเปคตรงกัน',
    ...overrides,
  };
}

describe('shouldShowComparableUnitPrice', () => {
  it('ไม่มี unit_price_thb → ไม่แสดง', () => {
    expect(shouldShowComparableUnitPrice(comparable())).toBe(false);
  });

  it('unit_price_thb ต่างจาก amount_thb → แสดง', () => {
    expect(shouldShowComparableUnitPrice(comparable({ unit_price_thb: 2350 }))).toBe(true);
  });

  it('unit_price_thb เท่ากับ amount_thb เป๊ะ (qty=1) → ไม่แสดง (ไม่รู้ว่าเป็นราคาต่อหน่วยจริงหรือยอดรวม)', () => {
    expect(
      shouldShowComparableUnitPrice(comparable({ amount_thb: 279000, unit_price_thb: 279000 })),
    ).toBe(false);
  });
});
