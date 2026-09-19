import { beforeEach, describe, expect, it } from 'vitest';
import type { BoqLine, Proposal } from '@/ai/tools/proposal';
import { getCurrentProposalVersion, useProposalStore } from './proposalStore';

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
    boq: [makeLine()],
    totals: { subtotal_thb: 40000, vat_included: false, grand_total_thb: 40000 },
    comparables: [],
    risks: [],
    open_questions: [],
    citations_web: [],
    illustrations: [],
    stat_cards: [],
    ...overrides,
  };
}

beforeEach(() => {
  useProposalStore.getState().reset();
});

describe('proposalStore', () => {
  it('เริ่มต้นไม่มีเวอร์ชัน (currentIndex=-1)', () => {
    expect(useProposalStore.getState().versions).toEqual([]);
    expect(useProposalStore.getState().currentIndex).toBe(-1);
    expect(getCurrentProposalVersion(useProposalStore.getState())).toBeNull();
  });

  it('pushVersion เพิ่มเวอร์ชันใหม่และเลื่อน currentIndex ไปที่เวอร์ชันล่าสุด', () => {
    const proposal = makeProposal();
    const id = useProposalStore.getState().pushVersion(proposal, ['w1'], 'ai');

    const state = useProposalStore.getState();
    expect(state.versions).toHaveLength(1);
    expect(state.currentIndex).toBe(0);
    expect(getCurrentProposalVersion(state)).toMatchObject({ id, proposal, warnings: ['w1'], source: 'ai' });
    expect(getCurrentProposalVersion(state)?.userEditedLineIds).toEqual([]);
  });

  it('selectVersion เปลี่ยน currentIndex ได้เมื่ออยู่ในขอบเขต', () => {
    useProposalStore.getState().pushVersion(makeProposal(), [], 'ai');
    useProposalStore.getState().pushVersion(makeProposal({ title: 'v2' }), [], 'ai');

    useProposalStore.getState().selectVersion(0);
    expect(useProposalStore.getState().currentIndex).toBe(0);
    expect(getCurrentProposalVersion(useProposalStore.getState())?.proposal.title).toBe('ทดสอบ');
  });

  it('selectVersion เพิกเฉยเมื่อ index อยู่นอกขอบเขต', () => {
    useProposalStore.getState().pushVersion(makeProposal(), [], 'ai');
    useProposalStore.getState().selectVersion(99);
    expect(useProposalStore.getState().currentIndex).toBe(0);
    useProposalStore.getState().selectVersion(-1);
    expect(useProposalStore.getState().currentIndex).toBe(0);
  });

  it('updateBoqLine คืน error เมื่อยังไม่มีเวอร์ชันใดเลย', () => {
    const result = useProposalStore.getState().updateBoqLine('line1', { qty: 5 });
    expect(result).toEqual({ ok: false, error: 'ยังไม่มีข้อเสนอให้แก้ไข' });
  });

  it('updateBoqLine คืน error เมื่อไม่พบ lineId', () => {
    useProposalStore.getState().pushVersion(makeProposal(), [], 'ai');
    const result = useProposalStore.getState().updateBoqLine('ไม่มีจริง', { qty: 5 });
    expect(result.ok).toBe(false);
  });

  it('updateBoqLine สร้างเวอร์ชันใหม่ (source=user_edit) ที่คำนวณ total/totals ใหม่ และไม่แก้ basis', () => {
    useProposalStore.getState().pushVersion(makeProposal(), [], 'ai');

    const result = useProposalStore.getState().updateBoqLine('line1', { qty: 4 });

    expect(result).toEqual({ ok: true });
    const state = useProposalStore.getState();
    expect(state.versions).toHaveLength(2);
    expect(state.currentIndex).toBe(1);

    const current = getCurrentProposalVersion(state);
    expect(current?.source).toBe('user_edit');
    expect(current?.userEditedLineIds).toEqual(['line1']);
    const line = current?.proposal.boq.find((l) => l.id === 'line1');
    expect(line?.qty).toBe(4);
    expect(line?.total_thb).toBe(80000);
    expect(line?.basis).toBe('historical'); // ไม่เปลี่ยนเอง
    expect(current?.proposal.totals.subtotal_thb).toBe(80000);
    expect(current?.proposal.totals.grand_total_thb).toBe(80000);

    // เวอร์ชันเดิม (index 0) ยังอยู่ครบ ไม่ถูกแก้ย้อนหลัง (US-3.3)
    expect(state.versions[0]?.proposal.boq[0]?.qty).toBe(2);
  });

  it('updateBoqLine ที่ไม่ผ่านการ validate ไม่สร้างเวอร์ชันใหม่', () => {
    useProposalStore.getState().pushVersion(makeProposal(), [], 'ai');
    const result = useProposalStore.getState().updateBoqLine('line1', { qty: -1 });
    expect(result.ok).toBe(false);
    expect(useProposalStore.getState().versions).toHaveLength(1);
  });

  it('แก้ไขคนละบรรทัดสะสม userEditedLineIds ต่อเนื่องข้ามเวอร์ชัน user_edit', () => {
    useProposalStore.getState().pushVersion(
      makeProposal({ boq: [makeLine({ id: 'a' }), makeLine({ id: 'b' })] }),
      [],
      'ai',
    );
    useProposalStore.getState().updateBoqLine('a', { qty: 3 });
    useProposalStore.getState().updateBoqLine('b', { unitPriceThb: 30000 });

    const current = getCurrentProposalVersion(useProposalStore.getState());
    expect(current?.userEditedLineIds.sort()).toEqual(['a', 'b']);
  });

  it('reset ล้างทุกเวอร์ชัน', () => {
    useProposalStore.getState().pushVersion(makeProposal(), [], 'ai');
    useProposalStore.getState().reset();
    expect(useProposalStore.getState().versions).toEqual([]);
    expect(useProposalStore.getState().currentIndex).toBe(-1);
  });
});
