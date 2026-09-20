import { describe, expect, it } from 'vitest';
import type { Proposal } from '@/ai/tools/proposal';
import {
  InvalidLineEditError,
  QTY_MAX,
  UNIT_PRICE_MAX_THB,
  applyLineEdit,
  isValidLineEditValue,
  recomputeTotals,
} from './recompute';

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    version: 1,
    title: 'ทดสอบ',
    summary: 'สรุปทดสอบ',
    mode: 'draft',
    requester_context: { fiscal_year_be: 2569 },
    objectives: [],
    scope_and_specs: [],
    assumptions: [],
    boq: [
      {
        id: 'L1',
        category: 'หมวด ก',
        item: 'รายการ A',
        qty: 4,
        unit: 'เครื่อง',
        unit_price_thb: 1000,
        total_thb: 4000,
        basis: 'historical',
        confidence: 'high',
        rationale: 'เหตุผล A',
        citations: [],
      },
      {
        id: 'L2',
        category: 'หมวด ก',
        item: 'รายการ B',
        qty: 2,
        unit: 'ชิ้น',
        unit_price_thb: 500,
        total_thb: 1000,
        basis: 'market',
        confidence: 'medium',
        rationale: 'เหตุผล B',
        citations: [],
      },
    ],
    totals: { subtotal_thb: 5000, vat_included: false, grand_total_thb: 5000 },
    comparables: [],
    risks: [],
    open_questions: [],
    citations_web: [],
    illustrations: [],
    stat_cards: [],
    ...overrides,
  };
}

describe('isValidLineEditValue', () => {
  it('ยอมรับค่าบวกที่ไม่เกินเพดาน', () => {
    expect(isValidLineEditValue(1, 100)).toBe(true);
    expect(isValidLineEditValue(0.5, 100)).toBe(true);
    expect(isValidLineEditValue(100, 100)).toBe(true);
  });

  it('ปฏิเสธ 0, ค่าติดลบ, NaN, Infinity และค่าที่เกินเพดาน', () => {
    expect(isValidLineEditValue(0, 100)).toBe(false);
    expect(isValidLineEditValue(-5, 100)).toBe(false);
    expect(isValidLineEditValue(Number.NaN, 100)).toBe(false);
    expect(isValidLineEditValue(Number.POSITIVE_INFINITY, 100)).toBe(false);
    expect(isValidLineEditValue(100.01, 100)).toBe(false);
  });
});

describe('recomputeTotals', () => {
  it('รวม total_thb ของทุกบรรทัดเป็น subtotal เมื่อไม่มี contingency', () => {
    const proposal = makeProposal();
    const totals = recomputeTotals(proposal.boq, proposal.totals);
    expect(totals.subtotal_thb).toBe(5000);
    expect(totals.grand_total_thb).toBe(5000);
  });

  it('ใช้ contingency_thb คงที่ก่อนเสมอถ้ามี (ไม่คำนวณจาก pct)', () => {
    const proposal = makeProposal({
      totals: {
        subtotal_thb: 5000,
        contingency_pct: 50,
        contingency_thb: 100,
        vat_included: false,
        grand_total_thb: 5100,
      },
    });
    const totals = recomputeTotals(proposal.boq, proposal.totals);
    expect(totals.subtotal_thb).toBe(5000);
    expect(totals.contingency_thb).toBe(100);
    expect(totals.grand_total_thb).toBe(5100);
  });

  it('คำนวณจาก contingency_pct เมื่อไม่มี contingency_thb', () => {
    const proposal = makeProposal({
      totals: {
        subtotal_thb: 5000,
        contingency_pct: 10,
        vat_included: false,
        grand_total_thb: 5500,
      },
    });
    const totals = recomputeTotals(proposal.boq, proposal.totals);
    expect(totals.grand_total_thb).toBe(5500);
  });
});

describe('applyLineEdit', () => {
  it('คำนวณ total_thb ใหม่จาก qty × unit_price_thb และไม่แตะบรรทัดอื่น', () => {
    const proposal = makeProposal();
    const next = applyLineEdit(proposal, 'L1', { qty: 5 });
    const line1 = next.boq.find((l) => l.id === 'L1');
    const line2 = next.boq.find((l) => l.id === 'L2');
    expect(line1?.qty).toBe(5);
    expect(line1?.total_thb).toBe(5000);
    expect(line2).toEqual(proposal.boq[1]);
  });

  it('แก้ทั้ง qty และ unit_price_thb พร้อมกันได้ (หลายฟิลด์)', () => {
    const proposal = makeProposal();
    const next = applyLineEdit(proposal, 'L2', { qty: 4, unit_price_thb: 750 });
    const line2 = next.boq.find((l) => l.id === 'L2');
    expect(line2?.total_thb).toBe(3000);
  });

  it('อัปเดต totals.subtotal_thb/grand_total_thb ตามผลรวมใหม่ (หลายแถว)', () => {
    const proposal = makeProposal();
    const next = applyLineEdit(proposal, 'L1', { qty: 10 });
    // L1: 10*1000=10000, L2: 1000 (ไม่เปลี่ยน) → subtotal 11000
    expect(next.totals.subtotal_thb).toBe(11000);
    expect(next.totals.grand_total_thb).toBe(11000);
  });

  it('รองรับค่าทศนิยม (เช่น qty เป็นตัน)', () => {
    const proposal = makeProposal();
    const next = applyLineEdit(proposal, 'L1', { qty: 4.2, unit_price_thb: 24900.5 });
    const line1 = next.boq.find((l) => l.id === 'L1');
    expect(line1?.total_thb).toBeCloseTo(4.2 * 24900.5, 6);
  });

  it('ไม่แตะ basis/confidence/citations/rationale ของบรรทัดที่แก้', () => {
    const proposal = makeProposal();
    const next = applyLineEdit(proposal, 'L1', { qty: 9 });
    const line1 = next.boq.find((l) => l.id === 'L1');
    expect(line1?.basis).toBe('historical');
    expect(line1?.confidence).toBe('high');
    expect(line1?.rationale).toBe('เหตุผล A');
    expect(line1?.citations).toEqual([]);
  });

  it('ไม่ mutate proposal เดิม', () => {
    const proposal = makeProposal();
    const snapshotBoq = JSON.parse(JSON.stringify(proposal.boq)) as unknown;
    applyLineEdit(proposal, 'L1', { qty: 99 });
    expect(proposal.boq).toEqual(snapshotBoq);
  });

  it('lineId ที่ไม่พบ → คืน proposal เดิม (reference เท่าเดิม)', () => {
    const proposal = makeProposal();
    const next = applyLineEdit(proposal, 'ไม่มีจริง', { qty: 1 });
    expect(next).toBe(proposal);
  });

  it('ปฏิเสธค่า 0 (qty)', () => {
    const proposal = makeProposal();
    expect(() => applyLineEdit(proposal, 'L1', { qty: 0 })).toThrow(InvalidLineEditError);
  });

  it('ปฏิเสธค่า 0 (unit_price_thb)', () => {
    const proposal = makeProposal();
    expect(() => applyLineEdit(proposal, 'L1', { unit_price_thb: 0 })).toThrow(
      InvalidLineEditError,
    );
  });

  it('ปฏิเสธค่าติดลบ', () => {
    const proposal = makeProposal();
    expect(() => applyLineEdit(proposal, 'L1', { qty: -1 })).toThrow(InvalidLineEditError);
  });

  it('ปฏิเสธค่าที่เกินเพดานของ schema', () => {
    const proposal = makeProposal();
    expect(() => applyLineEdit(proposal, 'L1', { qty: QTY_MAX + 1 })).toThrow(InvalidLineEditError);
    expect(() => applyLineEdit(proposal, 'L1', { unit_price_thb: UNIT_PRICE_MAX_THB + 1 })).toThrow(
      InvalidLineEditError,
    );
  });
});
