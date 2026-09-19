import { describe, expect, it } from 'vitest';
import { computeImpliedUnitPriceHint } from './impliedUnitPrice';

describe('computeImpliedUnitPriceHint', () => {
  it('เคสจริง — แอร์ 18000 บีทียู กลุ่ม 27,900 บาท/เครื่อง (10/8/5 เครื่อง)', () => {
    const hint = computeImpliedUnitPriceHint([279000, 223200, 139500]);
    expect(hint).not.toBeNull();
    expect(hint?.value_thb).toBe(27900);
    expect(hint?.support_rows).toBe(3);
    expect(hint?.total_rows).toBe(3);
    expect(hint?.label).toBe('estimate');
    expect(hint?.method_th.length).toBeGreaterThan(0);
  });

  it('เคสจริง — กลุ่ม 33,500 บาท/หน่วย (10/4/3/2/1 หน่วย)', () => {
    const hint = computeImpliedUnitPriceHint([335000, 134000, 100500, 67000, 33500]);
    expect(hint).not.toBeNull();
    expect(hint?.value_thb).toBe(33500);
    expect(hint?.support_rows).toBe(5);
    expect(hint?.total_rows).toBe(5);
  });

  it('แถวเดียว → null (พิสูจน์ฐานร่วมไม่ได้)', () => {
    expect(computeImpliedUnitPriceHint([27900])).toBeNull();
  });

  it('2 แถว → null (ยังไม่พอจะพิสูจน์ว่าเป็นฐานร่วมจริง)', () => {
    expect(computeImpliedUnitPriceHint([27900, 55800])).toBeNull();
  });

  it('ยอดสุ่มไม่มีฐานร่วม (เลขติดกัน — GCD=1 เสมอ) → null', () => {
    expect(computeImpliedUnitPriceHint([500001, 500002, 500003, 500004])).toBeNull();
  });

  it('ยอดกลม ๆ 100,000/200,000/500,000 → null (ฐานร่วมกลมเกินไป ไม่น่าเชื่อว่าเป็นราคาต่อหน่วยจริง)', () => {
    expect(computeImpliedUnitPriceHint([100000, 200000, 500000])).toBeNull();
  });

  it('null/undefined ปนอยู่ในชุด → กรองออกก่อนคำนวณ (ไม่ throw)', () => {
    const hint = computeImpliedUnitPriceHint([279000, null, 223200, undefined, 139500]);
    expect(hint?.value_thb).toBe(27900);
    expect(hint?.total_rows).toBe(3);
  });

  it('มี 1 แถวนอกกลุ่ม (outlier) ปนอยู่ — ยังหาฐานร่วมของ 3 ใน 4 แถวได้ (≥60%)', () => {
    const hint = computeImpliedUnitPriceHint([279000, 223200, 139500, 999999]);
    expect(hint).not.toBeNull();
    expect(hint?.value_thb).toBe(27900);
    expect(hint?.support_rows).toBe(3);
    expect(hint?.total_rows).toBe(4);
  });

  it('outlier มากเกิน 40% ของแถว → support ไม่ถึงเกณฑ์ 60% จึง null', () => {
    // 2 ใน 5 แถวเข้าพวก (40%) < 60% — ตัดออกได้สูงสุด MAX_DROPPED_ROWS=3 แถว แต่ support ที่เหลือ (2)
    // ไม่ถึง minSupport ของชุด 5 แถว (ceil(5*0.6)=3) จึงไม่ควรเจอฐานร่วม
    const hint = computeImpliedUnitPriceHint([279000, 223200, 111111, 222223, 350009]);
    expect(hint).toBeNull();
  });

  it('ทุกแถวยอดเท่ากันหมด (ตัวคูณเดียว) → null (ไม่มีหลักฐานว่าเป็นตัวคูณจริง แยกจากกฎ "กลมเกินไป")', () => {
    // 27900 ไม่ใช่เลขกลม (เลขนัยสำคัญ 3 หลัก) — ทดสอบเฉพาะกฎ "ต้องมีตัวคูณต่างกัน ≥2 ค่า" ล้วน ๆ
    expect(computeImpliedUnitPriceHint([27900, 27900, 27900])).toBeNull();
  });

  it('main thread: ฐานร่วมที่มีหลักฐานแค่ 2 แถว → null (เคยได้ 55,800 ผิดจากฐานจริง 27,900)', () => {
    expect(computeImpliedUnitPriceHint([279000, 223200, 139499])).toBeNull();
  });

  it('main thread: ยอดมีเศษสตางค์/ตัวคูณเกิน 200 → null', () => {
    expect(computeImpliedUnitPriceHint([27900.5, 55801, 83701.5])).toBeNull();
    expect(computeImpliedUnitPriceHint([27900, 27900 * 150, 27900 * 250])).toBeNull();
  });
});
