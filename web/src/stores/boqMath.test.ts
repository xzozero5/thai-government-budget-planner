import { describe, expect, it } from 'vitest';
import type { BoqLine, Totals } from '@/ai/tools/proposal';
import { recomputeBoqLine, recomputeTotals } from './boqMath';

function makeLine(overrides: Partial<BoqLine> = {}): BoqLine {
  return {
    id: 'line1',
    category: 'ครุภัณฑ์',
    item: 'เครื่องปรับอากาศ',
    qty: 2,
    unit: 'เครื่อง',
    unit_price_thb: 20000,
    total_thb: 40000,
    basis: 'historical',
    confidence: 'high',
    rationale: 'อ้างอิงราคาจากงบปี 2567',
    citations: [{ kind: 'budget_line', source_id: 'src_1' }],
    ...overrides,
  };
}

describe('recomputeBoqLine', () => {
  it('แก้ qty อย่างเดียว → total_thb คำนวณใหม่ตาม unit_price_thb เดิม', () => {
    const result = recomputeBoqLine(makeLine(), { qty: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.line.qty).toBe(5);
      expect(result.line.unit_price_thb).toBe(20000);
      expect(result.line.total_thb).toBe(100000);
    }
  });

  it('แก้ unit_price_thb อย่างเดียว → total_thb คำนวณใหม่ตาม qty เดิม', () => {
    const result = recomputeBoqLine(makeLine(), { unitPriceThb: 25000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.line.total_thb).toBe(50000);
    }
  });

  it('แก้ทั้ง qty และ unit_price_thb พร้อมกัน', () => {
    const result = recomputeBoqLine(makeLine(), { qty: 3, unitPriceThb: 15000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.line.total_thb).toBe(45000);
    }
  });

  it('ไม่แก้ basis/confidence/citations/rationale โดยอัตโนมัติ (spec: "basis ไม่เปลี่ยนเอง")', () => {
    const original = makeLine();
    const result = recomputeBoqLine(original, { qty: 10 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.line.basis).toBe(original.basis);
      expect(result.line.confidence).toBe(original.confidence);
      expect(result.line.citations).toEqual(original.citations);
      expect(result.line.rationale).toBe(original.rationale);
      expect(result.line.id).toBe(original.id);
    }
  });

  it('qty <= 0 → ปฏิเสธ (BoqLineSchema.qty ต้อง positive)', () => {
    const result = recomputeBoqLine(makeLine(), { qty: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('ไม่ถูกต้อง');
    }
  });

  it('qty ติดลบ → ปฏิเสธ', () => {
    const result = recomputeBoqLine(makeLine(), { qty: -3 });
    expect(result.ok).toBe(false);
  });

  it('unit_price_thb ติดลบ → ปฏิเสธ (BoqLineSchema.unit_price_thb ต้อง nonnegative)', () => {
    const result = recomputeBoqLine(makeLine(), { unitPriceThb: -1 });
    expect(result.ok).toBe(false);
  });

  it('ไม่ระบุ edit ใด ๆ → คืนค่าเดิมทุกฟิลด์ (no-op)', () => {
    const original = makeLine();
    const result = recomputeBoqLine(original, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.line).toEqual(original);
    }
  });
});

describe('recomputeTotals', () => {
  const boq = [makeLine({ id: 'a', total_thb: 100 }), makeLine({ id: 'b', total_thb: 200 })];

  it('ไม่มี contingency → grand_total = subtotal', () => {
    const totals: Totals = { subtotal_thb: 999, vat_included: false, grand_total_thb: 999 };
    const result = recomputeTotals(boq, totals);
    expect(result.subtotal_thb).toBe(300);
    expect(result.grand_total_thb).toBe(300);
  });

  it('contingency_pct → คำนวณ contingency ใหม่ตาม subtotal ใหม่ (ไม่แก้ค่า pct เอง)', () => {
    const totals: Totals = {
      subtotal_thb: 999,
      contingency_pct: 10,
      vat_included: false,
      grand_total_thb: 1098.9,
    };
    const result = recomputeTotals(boq, totals);
    expect(result.subtotal_thb).toBe(300);
    expect(result.contingency_pct).toBe(10);
    expect(result.grand_total_thb).toBeCloseTo(330);
  });

  it('contingency_thb (ค่าคงที่) มาก่อน contingency_pct เสมอ และไม่ถูกคำนวณใหม่ตาม subtotal', () => {
    const totals: Totals = {
      subtotal_thb: 999,
      contingency_pct: 50,
      contingency_thb: 999999,
      vat_included: false,
      grand_total_thb: 1,
    };
    const result = recomputeTotals(boq, totals);
    expect(result.contingency_thb).toBe(999999);
    expect(result.grand_total_thb).toBe(300 + 999999);
  });

  it('boq ว่าง → subtotal/grand_total = 0 (บวก contingency ถ้ามี)', () => {
    const totals: Totals = { subtotal_thb: 1, vat_included: true, grand_total_thb: 1 };
    const result = recomputeTotals([], totals);
    expect(result.subtotal_thb).toBe(0);
    expect(result.grand_total_thb).toBe(0);
  });
});
