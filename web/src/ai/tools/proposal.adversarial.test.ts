/**
 * main thread (review ของ T-303): โจมตี `emit_proposal` ด้วยข้อเสนอที่ "โมเดลแต่งขึ้น" — หัวใจของ N3
 * หลัก: ตัวเลขที่อ้างว่ามาจากข้อมูลจริงต้อง resolve ได้กับ ToolLog ของ session เท่านั้น มิฉะนั้นต้องถูก
 * ลดระดับเป็น estimate/low และมี warning (04 §D4, 05 §5)
 */
import { createDataFacade } from '@/data';
import { describe, expect, it } from 'vitest';
import { createInMemoryIllustrationSink } from '../illustrationSink';
import { createToolLog, type SourceFingerprint, type ToolLog } from '../toolLog';
import { emitProposalTool, type Proposal } from './proposal';
import type { ToolContext } from './toolKit';

type BoqLine = Proposal['boq'][number];

function line(overrides: Partial<BoqLine> = {}): BoqLine {
  return {
    id: 'b1',
    category: 'ครุภัณฑ์',
    item: 'เครื่องปรับอากาศ 18000 บีทียู',
    qty: 2,
    unit: 'เครื่อง',
    unit_price_thb: 28_000,
    total_thb: 56_000,
    basis: 'historical',
    confidence: 'high',
    rationale: 'อ้างอิงราคาที่รัฐเคยตั้ง',
    citations: [{ kind: 'budget_line', source_id: 'seen-1' }],
    ...overrides,
  };
}

function proposal(boq: BoqLine[], overrides: Partial<Proposal> = {}): Proposal {
  const subtotal = boq.reduce((sum, l) => sum + l.total_thb, 0);
  return {
    version: 1,
    title: 'ทดสอบ',
    summary: 'สรุปโครงการทดสอบสำหรับการตรวจความถูกต้องของตัวตรวจข้อเสนอ',
    mode: 'draft',
    requester_context: { fiscal_year_be: 2570 },
    objectives: ['ทดสอบ'],
    scope_and_specs: [{ section: 'ทั่วไป', items: ['รายการ'] }],
    assumptions: [],
    boq,
    totals: { subtotal_thb: subtotal, vat_included: false, grand_total_thb: subtotal },
    comparables: [],
    risks: [],
    open_questions: [],
    citations_web: [],
    illustrations: [],
    stat_cards: [],
    ...overrides,
  };
}

function fingerprint(overrides: Partial<SourceFingerprint> = {}): SourceFingerprint {
  return {
    amountThb: 56_000,
    unitPriceThb: 28_000,
    itemQty: 2,
    itemUnit: 'เครื่อง',
    fiscalYearBe: 2566,
    agency: 'กรมทดสอบ',
    ministry: null,
    itemNameRaw: 'เครื่องปรับอากาศ ขนาด 18000 บีทียู',
    dataset: 'pbo_disbursement',
    ...overrides,
  };
}

function makeCtx(): { ctx: ToolContext; toolLog: ToolLog } {
  const toolLog = createToolLog();
  return {
    ctx: { data: createDataFacade(), toolLog, illustrationSink: createInMemoryIllustrationSink() },
    toolLog,
  };
}

async function run(p: Proposal, ctx: ToolContext) {
  const result = await emitProposalTool.run(p, ctx);
  if (result.isError) throw new Error(`คาดว่า emit_proposal ไม่ error: ${JSON.stringify(result)}`);
  return result.output;
}

describe('emit_proposal — citation ที่แต่งขึ้นต้องไม่รอด (N3)', () => {
  it('source_id ที่ไม่เคยปรากฏใน ToolLog → basis=estimate, confidence=low, มี warning, citation ปลอมถูกตัด', async () => {
    const { ctx } = makeCtx();
    const out = await run(
      proposal([line({ citations: [{ kind: 'budget_line', source_id: 'deadbeefdeadbeef' }] })]),
      ctx,
    );
    const l = out.proposal.boq[0];
    expect(l?.basis).toBe('estimate');
    expect(l?.confidence).toBe('low');
    expect(JSON.stringify(l?.citations)).not.toContain('deadbeefdeadbeef');
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it('ผสม citation จริง + ปลอม → ตัดเฉพาะตัวปลอม และยังเป็น historical ได้', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('seen-1');
    const out = await run(
      proposal([
        line({
          citations: [
            { kind: 'budget_line', source_id: 'seen-1' },
            { kind: 'budget_line', source_id: 'fabricated-0001' },
          ],
        }),
      ]),
      ctx,
    );
    const l = out.proposal.boq[0];
    expect(l?.basis).toBe('historical');
    expect(JSON.stringify(l?.citations)).toContain('seen-1');
    expect(JSON.stringify(l?.citations)).not.toContain('fabricated-0001');
    expect(out.warnings.join(' ')).toContain('fabricated-0001');
  });

  it('basis=historical แต่อ้างแค่ web → ไม่ถือเป็น historical', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordWebUrl('https://shop.example.com/ac-18000');
    const out = await run(
      proposal([
        line({
          citations: [
            { kind: 'web', url: 'https://shop.example.com/ac-18000', retrieved_at: '2026-09-20' },
          ],
        }),
      ]),
      ctx,
    );
    expect(out.proposal.boq[0]?.basis).not.toBe('historical');
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it('basis=market: URL ที่ไม่เคยมาจาก web_search ใน session → ลดระดับ', async () => {
    const { ctx } = makeCtx();
    const out = await run(
      proposal([
        line({
          basis: 'market',
          citations: [
            { kind: 'web', url: 'https://made-up.example.com/p/1', retrieved_at: '2026-09-20' },
          ],
        }),
      ]),
      ctx,
    );
    expect(out.proposal.boq[0]?.basis).toBe('estimate');
    expect(JSON.stringify(out.proposal)).not.toContain('made-up.example.com');
  });

  it.each([
    'http://shop.example.com/p/1',
    'javascript:alert(1)',
    'data:text/html,<script>1</script>',
  ])('URL ที่ไม่ใช่ https (%s) ต้องไม่หลุดเข้า proposal แม้เคยอยู่ใน ToolLog', async (url) => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordWebUrl(url);
    const result = await emitProposalTool.run(
      proposal(
        [line({ basis: 'market', citations: [{ kind: 'web', url, retrieved_at: '2026-09-20' }] })],
        {
          citations_web: [{ url, retrieved_at: '2026-09-20' }],
        },
      ),
      ctx,
    );
    if (result.isError) return; // ปฏิเสธทั้ง input = ปลอดภัย
    expect(JSON.stringify(result.output.proposal)).not.toContain(url);
  });

  it('แถวที่ถูกจำกัด confidence ≤ medium (quality flag / n<3) → high ถูกลดเป็น medium', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('seen-ocr');
    toolLog.recordSourceFingerprint?.('seen-ocr', fingerprint({ unitPriceThb: 28_000 }));
    toolLog.recordConfidenceCeiling('seen-ocr', 'medium');
    const out = await run(
      proposal([line({ citations: [{ kind: 'budget_line', source_id: 'seen-ocr' }] })]),
      ctx,
    );
    expect(out.proposal.boq[0]?.confidence).toBe('medium');
  });

  it('price_derivation ที่ factor ไม่ตรงกับผล adjust_for_inflation จริง → warning (ห้ามโมเดลคิดเงินเฟ้อเอง)', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('seen-1');
    toolLog.recordInflationAdjustment({
      fromAmountThb: 28_000,
      fromYearBe: 2559,
      toYearBe: 2568,
      indicator: 'cpi_headline_index',
      factor: 1.1,
      adjustedThb: 30_800,
    });
    const out = await run(
      proposal([
        line({
          unit_price_thb: 42_000,
          total_thb: 84_000,
          price_derivation: {
            from_amount_thb: 28_000,
            from_year_be: 2559,
            to_year_be: 2568,
            indicator: 'cpi_headline_index',
            factor: 1.5,
          },
        }),
      ]),
      ctx,
    );
    expect(out.warnings.join(' ')).toMatch(/factor|เงินเฟ้อ|adjust_for_inflation/);
  });

  it('price_derivation ที่ไม่เคยเรียก adjust_for_inflation เลย → warning', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('seen-1');
    const out = await run(
      proposal([
        line({
          price_derivation: {
            from_amount_thb: 20_000,
            from_year_be: 2559,
            to_year_be: 2568,
            indicator: 'cpi_headline_index',
            factor: 1.4,
          },
        }),
      ]),
      ctx,
    );
    expect(out.warnings.join(' ')).toMatch(/adjust_for_inflation|เงินเฟ้อ/);
  });

  it('ยอดรวมบรรทัด/ยอดรวมทั้งหมดไม่ตรง → warning ระบุบรรทัด', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('seen-1');
    const out = await run(
      proposal([line({ total_thb: 99_999 })], {
        totals: { subtotal_thb: 1, vat_included: false, grand_total_thb: 5_000_000 },
      }),
      ctx,
    );
    expect(out.warnings.join(' ')).toContain('b1');
    expect(out.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('comparables / trend_ref / illustration ที่ไม่เคยผ่าน tool → ถูกตัดทิ้ง', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('seen-1');
    const out = await run(
      proposal([line({ trend_ref: { kind: 'item', key: 'ของที่ไม่เคยเรียก get_price_trend' } })], {
        comparables: [
          {
            source_id: 'never-seen',
            fiscal_year_be: 2566,
            agency: 'กรมสมมติ',
            item_name: 'รายการสมมติ',
            amount_thb: 123,
            similarity_note: 'แต่งขึ้น',
          },
        ],
        illustrations: [{ illustration_id: 'ill-fake', title: 't', caption: 'c', kind: 'diagram' }],
        stat_cards: [
          { trend_ref: { kind: 'indicator', key: 'cmi_steel' }, headline_th: 'เหล็กขึ้น' },
        ],
      }),
      ctx,
    );
    expect(out.proposal.comparables).toHaveLength(0);
    expect(out.proposal.illustrations).toHaveLength(0);
    expect(out.proposal.stat_cards).toHaveLength(0);
    expect(out.proposal.boq[0]?.trend_ref).toBeUndefined();
  });

  it('อ้าง source_id ที่เห็นแค่ id (เช่นจาก sample_source_ids ของ search_catalog) พร้อมราคาแต่งขึ้น → confidence ≤ low + บอกให้เรียก get_budget_line', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('seen-id-only');
    const out = await run(
      proposal([
        line({
          unit_price_thb: 999_999,
          total_thb: 1_999_998,
          citations: [{ kind: 'budget_line', source_id: 'seen-id-only' }],
        }),
      ]),
      ctx,
    );
    expect(out.proposal.boq[0]?.confidence).toBe('low');
    expect(out.warnings.join(' ')).toMatch(/get_budget_line/);
  });

  it('อ้าง source_id จริงที่มีค่า แต่ใส่ราคาห่างจากค่าจริงเกิน 10 เท่า → basis=estimate', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('seen-1');
    toolLog.recordSourceFingerprint?.('seen-1', fingerprint({ unitPriceThb: 28_000 }));
    const out = await run(proposal([line({ unit_price_thb: 900_000, total_thb: 1_800_000 })]), ctx);
    expect(out.proposal.boq[0]?.basis).toBe('estimate');
    expect(out.proposal.boq[0]?.confidence).toBe('low');
  });

  it('อ้าง source_id จริงและราคาตรงค่าจริง (±2 %) → คง historical/high', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('seen-1');
    toolLog.recordSourceFingerprint?.('seen-1', fingerprint({ unitPriceThb: 28_000 }));
    const out = await run(proposal([line({ unit_price_thb: 28_300, total_thb: 56_600 })]), ctx);
    expect(out.proposal.boq[0]?.basis).toBe('historical');
    expect(out.proposal.boq[0]?.confidence).toBe('high');
  });

  it('comparables: source_id จริงแต่ตัวเลข/หน่วยงานแต่งขึ้น → ถูกเขียนทับด้วยค่าจริง', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('seen-1');
    toolLog.recordSourceFingerprint?.('seen-1', fingerprint());
    const out = await run(
      proposal([line({ citations: [{ kind: 'budget_line', source_id: 'seen-1' }] })], {
        comparables: [
          {
            source_id: 'seen-1',
            fiscal_year_be: 2540,
            agency: 'กรมที่แต่งขึ้น',
            item_name: 'ชื่อที่แต่งขึ้น',
            amount_thb: 1,
            similarity_note: 'ทดสอบ',
          },
        ],
      }),
      ctx,
    );
    const c = out.proposal.comparables[0];
    expect(c?.amount_thb).toBe(56_000);
    expect(c?.fiscal_year_be).toBe(2566);
    expect(c?.agency).toBe('กรมทดสอบ');
    expect(JSON.stringify(out.proposal.comparables)).not.toContain('แต่งขึ้น');
  });

  it('จำนวน/ราคาติดลบ, NaN, Infinity, หรือ qty = 0 → input ถูกปฏิเสธ หรือมี warning (ห้ามผ่านเงียบ)', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('seen-1');
    for (const bad of [
      line({ qty: -2, total_thb: -56_000 }),
      line({ unit_price_thb: Number.NaN }),
      line({ total_thb: Number.POSITIVE_INFINITY }),
      line({ qty: 0, total_thb: 0 }),
    ]) {
      const result = await emitProposalTool.run(proposal([bad]), ctx);
      if (result.isError) continue;
      expect(result.output.warnings.length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });
});
