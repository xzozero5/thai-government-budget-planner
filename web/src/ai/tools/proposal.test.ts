import { createDataFacade } from '@/data';
import { describe, expect, it } from 'vitest';
import { createInMemoryIllustrationSink } from '../illustrationSink';
import { createToolLog, type ToolLog } from '../toolLog';
import { emitProposalTool, type Proposal } from './proposal';
import type { ToolContext } from './toolKit';

function baseProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    version: 1,
    title: 'ฝายชะลอน้ำบ้านทดสอบ',
    summary: 'สรุปโครงการทดสอบ 3 ประโยคขึ้นไปตามที่ระบบต้องการให้เพียงพอ',
    mode: 'draft',
    requester_context: { fiscal_year_be: 2570 },
    objectives: ['ลดปัญหาน้ำท่วม'],
    scope_and_specs: [{ section: 'งานโครงสร้าง', items: ['ฝาย คสล.'] }],
    assumptions: [],
    boq: [
      {
        id: 'b1',
        category: 'งานก่อสร้าง',
        item: 'ฝาย คสล.',
        qty: 1,
        unit: 'แห่ง',
        unit_price_thb: 500_000,
        total_thb: 500_000,
        basis: 'historical',
        confidence: 'high',
        rationale: 'อ้างอิงจากโครงการคล้ายกันในอดีต',
        citations: [{ kind: 'budget_line', source_id: 'src-1' }],
      },
    ],
    totals: { subtotal_thb: 500_000, vat_included: false, grand_total_thb: 500_000 },
    comparables: [],
    risks: [],
    open_questions: [],
    citations_web: [],
    illustrations: [],
    stat_cards: [],
    ...overrides,
  };
}

function baseBoqLine(): Proposal['boq'][number] {
  const line = baseProposal().boq[0];
  if (!line) {
    throw new Error('baseProposal() ต้องมี boq อย่างน้อย 1 บรรทัดเสมอ');
  }
  return line;
}

function makeCtx(): { ctx: ToolContext; toolLog: ToolLog } {
  const toolLog = createToolLog();
  return {
    ctx: { data: createDataFacade(), toolLog, illustrationSink: createInMemoryIllustrationSink() },
    toolLog,
  };
}

describe('emitProposalTool', () => {
  it('input ผิด schema (ขาด boq) → is_error', async () => {
    const { ctx } = makeCtx();
    const result = await emitProposalTool.run({ ...baseProposal(), boq: [] }, ctx);
    expect(result.isError).toBe(true);
  });

  it('citation ที่เคยเห็นจริง → ผ่านโดยไม่มี warning เรื่อง citation', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    const result = await emitProposalTool.run(baseProposal(), ctx);
    expect(result.isError).toBe(false);
    if (!result.isError) {
      expect(result.output.ok).toBe(true);
      expect(result.output.proposal.boq[0]?.basis).toBe('historical');
      expect(result.output.warnings.some((w) => w.includes('citation'))).toBe(false);
    }
  });

  it('citation source_id ไม่เคยเห็น → ตัด citation + ลดระดับเป็น estimate/low พร้อม warning', async () => {
    const { ctx } = makeCtx(); // ไม่ได้ record 'src-1'
    const result = await emitProposalTool.run(baseProposal(), ctx);
    expect(result.isError).toBe(false);
    if (!result.isError) {
      const line = result.output.proposal.boq[0];
      expect(line?.citations).toHaveLength(0);
      expect(line?.basis).toBe('estimate');
      expect(line?.confidence).toBe('low');
      expect(result.output.warnings.length).toBeGreaterThan(0);
    }
  });

  it('basis=historical ไม่มี citation ชนิด budget_line/document เลย → ลดระดับเป็น estimate', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordWebUrl('https://shopee.co.th/x');
    const proposal = baseProposal({
      boq: [
        {
          id: 'b1',
          category: 'c',
          item: 'i',
          qty: 1,
          unit: 'u',
          unit_price_thb: 100,
          total_thb: 100,
          basis: 'historical',
          confidence: 'high',
          rationale: 'r',
          citations: [{ kind: 'web', url: 'https://shopee.co.th/x', retrieved_at: '2569-09-20' }],
        },
      ],
      totals: { subtotal_thb: 100, vat_included: false, grand_total_thb: 100 },
    });
    const result = await emitProposalTool.run(proposal, ctx);
    if (!result.isError) {
      expect(result.output.proposal.boq[0]?.basis).toBe('estimate');
    } else {
      throw new Error('expected success');
    }
  });

  it('basis=market ไม่มี citation ชนิด web → ลดระดับเป็น estimate', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    const proposal = baseProposal({
      boq: [
        {
          id: 'b1',
          category: 'c',
          item: 'i',
          qty: 1,
          unit: 'u',
          unit_price_thb: 100,
          total_thb: 100,
          basis: 'market',
          confidence: 'high',
          rationale: 'r',
          citations: [{ kind: 'budget_line', source_id: 'src-1' }],
        },
      ],
      totals: { subtotal_thb: 100, vat_included: false, grand_total_thb: 100 },
    });
    const result = await emitProposalTool.run(proposal, ctx);
    if (!result.isError) {
      expect(result.output.proposal.boq[0]?.basis).toBe('estimate');
    } else {
      throw new Error('expected success');
    }
  });

  it('web citation ที่ไม่ใช่ https → ถูกตัด (ตรวจว่า market ไม่มี web ที่ผ่าน จึงลดระดับด้วย)', async () => {
    const { ctx } = makeCtx();
    const proposal = baseProposal({
      boq: [
        {
          id: 'b1',
          category: 'c',
          item: 'i',
          qty: 1,
          unit: 'u',
          unit_price_thb: 100,
          total_thb: 100,
          basis: 'market',
          confidence: 'high',
          rationale: 'r',
          citations: [{ kind: 'web', url: 'http://shopee.co.th/x', retrieved_at: '2569-09-20' }],
        },
      ],
      totals: { subtotal_thb: 100, vat_included: false, grand_total_thb: 100 },
    });
    const result = await emitProposalTool.run(proposal, ctx);
    if (!result.isError) {
      expect(result.output.proposal.boq[0]?.citations).toHaveLength(0);
      expect(result.output.proposal.boq[0]?.basis).toBe('estimate');
    } else {
      throw new Error('expected success');
    }
  });

  it('AC 2/4: confidence ceiling จาก ToolLog จำกัด high → medium', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    // ต้องมีค่าจริงของแถว (เหมือนที่ query_budget_lines/get_budget_line บันทึก) มิฉะนั้นจะถูกจำกัดเป็น low
    // จากกติกา price_not_verifiable ก่อน — baseProposal ใช้ unit_price 500,000
    toolLog.recordSourceFingerprint?.('src-1', {
      amountThb: 500_000,
      unitPriceThb: 500_000,
      itemQty: 1,
      itemUnit: 'แห่ง',
      fiscalYearBe: 2566,
      agency: 'กรมทดสอบ',
      ministry: null,
      itemNameRaw: 'ฝาย คสล.',
      dataset: 'pbo_disbursement',
    });
    toolLog.recordConfidenceCeiling('src-1', 'medium');
    const result = await emitProposalTool.run(baseProposal(), ctx);
    if (!result.isError) {
      expect(result.output.proposal.boq[0]?.confidence).toBe('medium');
      expect(result.output.warnings.some((w) => w.includes('confidence'))).toBe(true);
    } else {
      throw new Error('expected success');
    }
  });

  it('price_derivation ที่ตรงกับ ToolLog → คงไว้', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    toolLog.recordInflationAdjustment({
      fromAmountThb: 400_000,
      fromYearBe: 2565,
      toYearBe: 2570,
      indicator: 'cpi_headline_index',
      factor: 1.25,
      adjustedThb: 500_000,
    });
    const proposal = baseProposal({
      boq: [
        {
          ...baseBoqLine(),
          price_derivation: {
            from_amount_thb: 400_000,
            from_year_be: 2565,
            to_year_be: 2570,
            indicator: 'cpi_headline_index',
            factor: 1.25,
          },
        },
      ],
    });
    const result = await emitProposalTool.run(proposal, ctx);
    if (!result.isError) {
      expect(result.output.proposal.boq[0]?.price_derivation?.factor).toBe(1.25);
    } else {
      throw new Error('expected success');
    }
  });

  it('price_derivation ที่ไม่ตรงกับผลจริงของ adjust_for_inflation → ตัดออก + warning', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    const proposal = baseProposal({
      boq: [
        {
          ...baseBoqLine(),
          price_derivation: {
            from_amount_thb: 400_000,
            from_year_be: 2565,
            to_year_be: 2570,
            indicator: 'cpi_headline_index',
            factor: 999, // ไม่เคยเรียก adjust_for_inflation เลย
          },
        },
      ],
    });
    const result = await emitProposalTool.run(proposal, ctx);
    if (!result.isError) {
      expect(result.output.proposal.boq[0]?.price_derivation).toBeUndefined();
      expect(result.output.warnings.some((w) => w.includes('price_derivation'))).toBe(true);
    } else {
      throw new Error('expected success');
    }
  });

  it('trend_ref/illustration_id/stat_cards ที่ไม่เคยผ่าน tool → ตัดทิ้ง + warning', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    const proposal = baseProposal({
      boq: [{ ...baseBoqLine(), trend_ref: { kind: 'item', key: 'ไม่เคยเรียก' } }],
      illustrations: [{ illustration_id: 'illus-ไม่มี', title: 't', caption: 'c', kind: 'map' }],
      stat_cards: [{ trend_ref: { kind: 'indicator', key: 'ไม่เคยเรียก' }, headline_th: 'h' }],
    });
    const result = await emitProposalTool.run(proposal, ctx);
    if (!result.isError) {
      expect(result.output.proposal.boq[0]?.trend_ref).toBeUndefined();
      expect(result.output.proposal.illustrations).toHaveLength(0);
      expect(result.output.proposal.stat_cards).toHaveLength(0);
      expect(result.output.warnings.length).toBeGreaterThanOrEqual(3);
    } else {
      throw new Error('expected success');
    }
  });

  it('comparables ที่ source_id ไม่เคยเห็น → ตัดออก', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    const proposal = baseProposal({
      comparables: [
        {
          source_id: 'src-ไม่มี',
          fiscal_year_be: 2567,
          agency: 'x',
          item_name: 'x',
          amount_thb: 1,
          similarity_note: 'x',
        },
      ],
    });
    const result = await emitProposalTool.run(proposal, ctx);
    if (!result.isError) {
      expect(result.output.proposal.comparables).toHaveLength(0);
    } else {
      throw new Error('expected success');
    }
  });

  it('totals mismatch → คำนวณ subtotal_thb/grand_total_thb ใหม่จากผลรวม boq ให้อัตโนมัติ พร้อม warning (หลัง demo จริง 2569-09-20 — ลด reject รอบแรกของ emit_proposal)', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    const proposal = baseProposal({
      totals: { subtotal_thb: 999_999, vat_included: false, grand_total_thb: 1_000_000 },
    });
    const result = await emitProposalTool.run(proposal, ctx);
    if (!result.isError) {
      // baseProposal มี boq บรรทัดเดียว total_thb=500,000 (ไม่มี contingency) — ทั้ง subtotal/grand_total
      // ถูกคำนวณใหม่ให้ตรงกับผลรวมจริงโดยอัตโนมัติ (ไม่ใช่การประมาณ — เป็นเลขคณิตจากค่าที่ตรวจแล้ว)
      expect(result.output.proposal.totals.subtotal_thb).toBe(500_000);
      expect(result.output.proposal.totals.grand_total_thb).toBe(500_000);
      expect(result.output.warnings.some((w) => w.includes('subtotal_thb'))).toBe(true);
      expect(result.output.warnings.some((w) => w.includes('grand_total_thb'))).toBe(true);
    } else {
      throw new Error('expected success');
    }
  });

  it('grand_total ที่สอดคล้องกับ contingency_pct ผ่านโดยไม่มี warning เรื่อง grand_total', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    const proposal = baseProposal({
      totals: {
        subtotal_thb: 500_000,
        contingency_pct: 10,
        vat_included: false,
        grand_total_thb: 550_000,
      },
    });
    const result = await emitProposalTool.run(proposal, ctx);
    if (!result.isError) {
      expect(result.output.warnings.some((w) => w.includes('grand_total_thb'))).toBe(false);
    } else {
      throw new Error('expected success');
    }
  });

  it('นับรอบแก้ (attempt) และเตือนเมื่อเกิน 2 รอบ', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    const r1 = await emitProposalTool.run(baseProposal(), ctx);
    const r2 = await emitProposalTool.run(baseProposal(), ctx);
    const r3 = await emitProposalTool.run(baseProposal(), ctx);
    if (r1.isError || r2.isError || r3.isError) throw new Error('expected success');
    expect(r1.output.attempt).toBe(1);
    expect(r2.output.attempt).toBe(2);
    expect(r3.output.attempt).toBe(3);
    expect(r3.output.warnings.some((w) => w.includes('รอบแก้ไข'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T-410 ข้อ 2 (หลัง demo จริง 2569-09-20, docs/api-budget.md "0.52 USD/ข้อเสนอ ชนเพดาน 8 รอบ") — repair
// layer ที่รันก่อน Zod parse เพื่อลด reject รอบแรกของ emit_proposal (ก้อนที่แพงที่สุด ~7k output tokens)
// ---------------------------------------------------------------------------
describe('emit_proposal — repair layer ก่อน Zod parse (ซ่อมสิ่งที่ปลอดภัยแทนการ reject ทั้งก้อน)', () => {
  it('string เกินเพดาน (title) → ตัดส่วนเกิน + "…" พร้อม warning แทนการ reject ทั้งก้อน', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    const longTitle = 'ก'.repeat(400); // เกินเพดาน title (300 ตัวอักษร)
    const result = await emitProposalTool.run({ ...baseProposal(), title: longTitle }, ctx);
    if (result.isError) throw new Error('expected success — string เกินเพดานต้องซ่อมได้ ไม่ reject');
    expect(result.output.proposal.title.length).toBeLessThanOrEqual(300);
    expect(result.output.proposal.title.endsWith('…')).toBe(true);
    expect(result.output.warnings.some((w) => w.includes('title'))).toBe(true);
  });

  it('enum ตัวพิมพ์ใหญ่/มีช่องว่างส่วนเกิน (mode) → normalize แทนการ reject', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    const result = await emitProposalTool.run({ ...baseProposal(), mode: ' DRAFT ' }, ctx);
    if (result.isError) throw new Error('expected success — enum พิมพ์ใหญ่/เว้นวรรคต้อง normalize ได้');
    expect(result.output.proposal.mode).toBe('draft');
    expect(result.output.warnings.some((w) => w.includes('mode'))).toBe(true);
  });

  it('field optional เป็น null (boq[].spec) → ถือเป็นไม่มี field นี้ แทนการ reject', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    // จงใจไม่ผ่าน baseProposal()/typed helper (type ของ Proposal ไม่ยอมรับ `null` สำหรับ field
    // optional) — `rawInput` ของ `run()` เป็น `unknown` เพราะโมเดลจริงส่ง JSON ที่ TS ตรวจไม่ได้ล่วงหน้า
    const rawProposal: unknown = { ...baseProposal(), boq: [{ ...baseBoqLine(), spec: null }] };
    const result = await emitProposalTool.run(rawProposal, ctx);
    if (result.isError) throw new Error('expected success — spec:null ต้องถือเป็นไม่มี field นี้');
    expect(result.output.proposal.boq[0]?.spec).toBeUndefined();
  });

  it('array เกินเพดาน (objectives) → ตัดรายการส่วนเกินท้ายออกพร้อม warning แทนการ reject', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    const manyObjectives = Array.from({ length: 60 }, (_, i) => `เป้าหมายที่ ${String(i)}`); // เกินเพดาน 50
    const result = await emitProposalTool.run({ ...baseProposal(), objectives: manyObjectives }, ctx);
    if (result.isError) throw new Error('expected success — array เกินเพดานต้องตัดท้ายได้ ไม่ reject');
    expect(result.output.proposal.objectives).toHaveLength(50);
    expect(result.output.warnings.some((w) => w.includes('objectives'))).toBe(true);
  });

  it('total_thb ไม่ตรง qty×unit_price_thb → คำนวณใหม่จาก qty×unit_price_thb (ไม่แก้ qty/unit_price)', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    const badTotalLine = { ...baseBoqLine(), qty: 2, unit_price_thb: 500_000, total_thb: 1 };
    const result = await emitProposalTool.run(
      baseProposal({
        boq: [badTotalLine],
        totals: { subtotal_thb: 1, vat_included: false, grand_total_thb: 1 },
      }),
      ctx,
    );
    if (result.isError) throw new Error('expected success');
    expect(result.output.proposal.boq[0]?.total_thb).toBe(1_000_000);
    expect(result.output.proposal.boq[0]?.qty).toBe(2);
    expect(result.output.proposal.boq[0]?.unit_price_thb).toBe(500_000);
    expect(result.output.proposal.totals.subtotal_thb).toBe(1_000_000);
    expect(result.output.proposal.totals.grand_total_thb).toBe(1_000_000);
  });

  // T-604 (eval จริง เคส unit-price-n1-total-station): รูปผิด 2 แบบนี้ทำให้ไม่ได้ข้อเสนอเลยทั้งที่เนื้อหาครบ
  it('open_questions เป็น [{text}] → แกะเป็น string เงียบ ๆ (ไม่เปลี่ยนเนื้อหา ไม่ต้องมี warning)', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    const raw: unknown = { ...baseProposal(), open_questions: [{ text: 'สเปครุ่นไหน' }, 'ตั้งที่จังหวัดใด'] };
    const result = await emitProposalTool.run(raw, ctx);
    if (result.isError) throw new Error('expected success — [{text}] ต้องแกะเป็น string ได้');
    expect(result.output.proposal.open_questions).toEqual(['สเปครุ่นไหน', 'ตั้งที่จังหวัดใด']);
    expect(result.output.warnings.some((w) => w.includes('open_questions'))).toBe(false);
  });

  it('open_questions เป็น object ที่มี field อื่นปน → ไม่เดา ยังคงถูกปฏิเสธ', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    const raw: unknown = { ...baseProposal(), open_questions: [{ text: 'ก', priority: 'high' }] };
    const result = await emitProposalTool.run(raw, ctx);
    expect(result.isError).toBe(true);
  });

  it('assumptions เป็น string ล้วน → ห่อเป็น {text, impact:"medium"} พร้อม warning ว่าระบบตั้ง impact ให้เอง', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    const raw: unknown = { ...baseProposal(), assumptions: ['ใช้ CPI ทั่วไปแทนดัชนีเฉพาะ'] };
    const result = await emitProposalTool.run(raw, ctx);
    if (result.isError) throw new Error('expected success — assumptions เป็น string ต้องซ่อมได้');
    expect(result.output.proposal.assumptions).toEqual([{ text: 'ใช้ CPI ทั่วไปแทนดัชนีเฉพาะ', impact: 'medium' }]);
    expect(result.output.warnings.some((w) => w.includes('assumptions[0]') && w.includes('ปานกลาง'))).toBe(true);
  });

  it('risks เป็น string ล้วน → ห่อเป็น {text}', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    const raw: unknown = { ...baseProposal(), risks: ['ราคาอาจเปลี่ยน'] };
    const result = await emitProposalTool.run(raw, ctx);
    if (result.isError) throw new Error('expected success — risks เป็น string ต้องซ่อมได้');
    expect(result.output.proposal.risks).toEqual([{ text: 'ราคาอาจเปลี่ยน' }]);
  });

  it('จำนวนติดลบยังคงถูกปฏิเสธ — repair layer ไม่ทำให้เกณฑ์ความปลอดภัยเดิมหลวมลง', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    const negativeQtyLine = { ...baseBoqLine(), qty: -5 };
    const result = await emitProposalTool.run(baseProposal({ boq: [negativeQtyLine] }), ctx);
    expect(result.isError).toBe(true);
  });

  it('enum ที่ไม่ตรงรูปแบบจริงแม้ normalize แล้ว (mode="maybe") → ยังคงถูกปฏิเสธ ไม่ใช่เดาความหมาย', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    const result = await emitProposalTool.run({ ...baseProposal(), mode: 'maybe' }, ctx);
    expect(result.isError).toBe(true);
  });
});

describe('emit_proposal — trend_ref kind=indicator ที่เคยผ่าน get_econ_indicator (T-410 ข้อ 3, หลัง demo จริง)', () => {
  it('เคยเรียก get_econ_indicator ของตัวชี้วัดนี้ (มีค่าจริง) → trend_ref ใช้ได้แม้ไม่เคยเรียก get_price_trend', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    toolLog.recordEconValue('cmi_steel', 2567);
    const proposal = baseProposal({
      stat_cards: [{ trend_ref: { kind: 'indicator', key: 'cmi_steel' }, headline_th: 'เหล็กขึ้นราคา' }],
    });
    const result = await emitProposalTool.run(proposal, ctx);
    if (result.isError) throw new Error('expected success');
    expect(result.output.proposal.stat_cards).toHaveLength(1);
    expect(result.output.warnings.some((w) => w.includes('trend_ref'))).toBe(false);
  });

  it('ยังไม่เคยเรียก get_econ_indicator/get_price_trend เลย → trend_ref ยังถูกตัดตามเดิม', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-1');
    const proposal = baseProposal({
      stat_cards: [{ trend_ref: { kind: 'indicator', key: 'cmi_steel' }, headline_th: 'เหล็กขึ้นราคา' }],
    });
    const result = await emitProposalTool.run(proposal, ctx);
    if (result.isError) throw new Error('expected success');
    expect(result.output.proposal.stat_cards).toHaveLength(0);
  });
});
