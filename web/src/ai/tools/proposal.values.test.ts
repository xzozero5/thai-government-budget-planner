/**
 * T-307 (security review H2) — citation ต้องตรวจ "ค่า" ไม่ใช่แค่ "id เคยปรากฏ" ไฟล์นี้เสริม
 * `proposal.adversarial.test.ts` (ห้ามแก้ไฟล์นั้น) ด้วยเคสที่ source_id/doc_id/(indicator,year) เป็น
 * ของจริง แต่ "ค่า" ที่โมเดลใส่ประกบเข้าไปถูกแต่งขึ้น
 */
import { createDataFacade } from '@/data';
import { describe, expect, it } from 'vitest';
import { createInMemoryIllustrationSink } from '../illustrationSink';
import { createToolLog, type ToolLog } from '../toolLog';
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

describe('emit_proposal — comparables ต้องตรงกับ fingerprint จริง (T-307 H2)', () => {
  it('source_id จริง + amount_thb/agency/item_name ปลอม → แก้ทับด้วยค่าจริง พร้อม warning', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-real-1');
    toolLog.recordSourceFingerprint?.('src-real-1', {
      amountThb: 100_000,
      unitPriceThb: 25_000,
      itemQty: 4,
      itemUnit: 'เครื่อง',
      fiscalYearBe: 2567,
      agency: 'กรมชลประทาน',
      ministry: 'กระทรวงเกษตรและสหกรณ์',
      itemNameRaw: 'เครื่องปรับอากาศ 18000 บีทียู',
      dataset: 'pbo_disbursement',
    });
    const out = await run(
      proposal([line({ citations: [{ kind: 'budget_line', source_id: 'src-real-1' }] })], {
        comparables: [
          {
            source_id: 'src-real-1',
            fiscal_year_be: 2560, // ปลอม (จริง 2567)
            agency: 'กรมสมมติที่แต่งขึ้น', // ปลอม
            item_name: 'ของปลอมที่ไม่เกี่ยวกัน', // ปลอม
            amount_thb: 999_999_999, // ปลอม (จริง 100,000)
            similarity_note: 'เทียบเคียง',
          },
        ],
      }),
      ctx,
    );
    const c = out.proposal.comparables[0];
    expect(c).toBeDefined();
    expect(c?.amount_thb).toBe(100_000);
    expect(c?.fiscal_year_be).toBe(2567);
    expect(c?.agency).toBe('กรมชลประทาน');
    expect(c?.item_name).toBe('เครื่องปรับอากาศ 18000 บีทียู');
    expect(out.warnings.join(' ')).toMatch(/แก้ทับด้วยค่าจริง/);
  });

  it('ค่าตรงกับ fingerprint อยู่แล้ว → ผ่านโดยไม่มี warning เรื่อง comparables', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('src-real-2');
    toolLog.recordSourceFingerprint?.('src-real-2', {
      amountThb: 50_000,
      unitPriceThb: null,
      itemQty: null,
      itemUnit: null,
      fiscalYearBe: 2566,
      agency: 'กรมทางหลวง',
      ministry: null,
      itemNameRaw: 'รถบรรทุก 6 ล้อ',
      dataset: 'pbo_disbursement',
    });
    const out = await run(
      proposal([line({ citations: [{ kind: 'budget_line', source_id: 'src-real-2' }] })], {
        comparables: [
          {
            source_id: 'src-real-2',
            fiscal_year_be: 2566,
            agency: 'กรมทางหลวง',
            item_name: 'รถบรรทุก 6 ล้อ',
            amount_thb: 50_000,
            similarity_note: 'ตรงกัน',
          },
        ],
      }),
      ctx,
    );
    expect(out.proposal.comparables[0]?.amount_thb).toBe(50_000);
    expect(out.warnings.join(' ')).not.toMatch(/comparables.*แก้ทับ/);
  });
});

describe('emit_proposal — trace unit_price_thb ของ basis=historical (T-307 H2)', () => {
  function recordRow(toolLog: ToolLog, sourceId: string, unitPriceThb: number, fiscalYearBe = 2567): void {
    toolLog.recordSourceId(sourceId);
    toolLog.recordSourceFingerprint?.(sourceId, {
      amountThb: unitPriceThb * 2,
      unitPriceThb,
      itemQty: 2,
      itemUnit: 'เครื่อง',
      fiscalYearBe,
      agency: 'กรมทดสอบ',
      ministry: null,
      itemNameRaw: 'เครื่องปรับอากาศ 18000 บีทียู',
      dataset: 'pbo_disbursement',
    });
  }

  it('unit_price_thb อยู่ในช่วง ±2% ของแถวที่ cite → ผ่าน ไม่มี warning price_not_traceable', async () => {
    const { ctx, toolLog } = makeCtx();
    recordRow(toolLog, 'seen-1', 28_000);
    const out = await run(proposal([line({ unit_price_thb: 28_400, total_thb: 56_800 })]), ctx);
    expect(out.proposal.boq[0]?.basis).toBe('historical');
    expect(out.warnings.join(' ')).not.toContain('price_not_traceable');
  });

  it('unit_price_thb ปลอมสูงกว่าแถวที่ cite 10 เท่า → ลดเป็น basis=estimate, confidence=low', async () => {
    const { ctx, toolLog } = makeCtx();
    recordRow(toolLog, 'seen-1', 28_000);
    const out = await run(
      proposal([line({ unit_price_thb: 300_000, total_thb: 600_000 })]),
      ctx,
    );
    const l = out.proposal.boq[0];
    expect(l?.basis).toBe('estimate');
    expect(l?.confidence).toBe('low');
    expect(out.warnings.join(' ')).toContain('price_not_traceable');
  });

  it('unit_price_thb ห่างจากแถวที่ cite แต่ไม่ถึง 10 เท่า → ยังเป็น historical แต่ confidence ถูกจำกัดเป็น low', async () => {
    const { ctx, toolLog } = makeCtx();
    recordRow(toolLog, 'seen-1', 28_000);
    const out = await run(proposal([line({ unit_price_thb: 60_000, total_thb: 120_000 })]), ctx);
    const l = out.proposal.boq[0];
    expect(l?.basis).toBe('historical');
    expect(l?.confidence).toBe('low');
    expect(out.warnings.join(' ')).toContain('price_not_traceable');
  });

  it('unit_price_thb ตรงกับผล adjust_for_inflation ที่ log ไว้จริง (from_amount_thb ตรงกับแถวที่ cite) → ผ่าน', async () => {
    const { ctx, toolLog } = makeCtx();
    recordRow(toolLog, 'seen-1', 28_000, 2559);
    toolLog.recordInflationAdjustment({
      fromAmountThb: 28_000,
      fromYearBe: 2559,
      toYearBe: 2568,
      indicator: 'cpi_headline_index',
      factor: 1.5,
      adjustedThb: 42_000,
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
    const l = out.proposal.boq[0];
    expect(l?.basis).toBe('historical');
    expect(out.warnings.join(' ')).not.toContain('price_not_traceable');
  });

  it('price_derivation อ้าง from_amount_thb ที่ไม่ตรงกับแถวใดที่ cite เลย (แม้ log ไว้จริง) → ยังถือว่า trace ไม่ได้', async () => {
    const { ctx, toolLog } = makeCtx();
    recordRow(toolLog, 'seen-1', 28_000, 2559);
    // inflation adjustment ของ "อีกรายการหนึ่ง" ที่ไม่เกี่ยวกับแถวที่ cite ในบรรทัดนี้เลย
    toolLog.recordInflationAdjustment({
      fromAmountThb: 999_000,
      fromYearBe: 2559,
      toYearBe: 2568,
      indicator: 'cpi_headline_index',
      factor: 1.5,
      adjustedThb: 1_498_500,
    });
    const out = await run(
      proposal([
        line({
          unit_price_thb: 1_498_500,
          total_thb: 2_997_000,
          price_derivation: {
            from_amount_thb: 999_000,
            from_year_be: 2559,
            to_year_be: 2568,
            indicator: 'cpi_headline_index',
            factor: 1.5,
          },
        }),
      ]),
      ctx,
    );
    expect(out.warnings.join(' ')).toContain('price_not_traceable');
  });
});

describe('emit_proposal — quote/page ของ citation เอกสารต้อง trace ได้ (T-307 H2)', () => {
  it('quote ที่ไม่เคยปรากฏในเนื้อหาที่อ่านจริง → ตัด quote ทิ้ง แต่คง citation ระดับเอกสารไว้', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('seen-1');
    toolLog.recordDocId('doc-1');
    toolLog.recordDocChunkText?.('doc-1', 1, 'งบประมาณรายจ่ายประจำปีของสำนักงานปลัดกระทรวง');
    const out = await run(
      proposal([
        line({
          citations: [
            {
              kind: 'document',
              doc_id: 'doc-1',
              page: 1,
              quote: 'ข้อความที่แต่งขึ้นเองไม่มีอยู่ในเอกสารจริง',
            },
          ],
        }),
      ]),
      ctx,
    );
    const c = out.proposal.boq[0]?.citations[0];
    expect(c?.kind).toBe('document');
    expect(c && 'quote' in c ? c.quote : undefined).toBeUndefined();
    expect(c && 'doc_id' in c ? c.doc_id : undefined).toBe('doc-1');
    expect(out.warnings.join(' ')).toContain('ตัด quote');
  });

  it('quote จริงแต่ whitespace ต่างจากต้นฉบับ (OCR หลุด "ส านักงาน" vs "สำนักงาน") → ยังผ่าน', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('seen-1');
    toolLog.recordDocId('doc-1');
    toolLog.recordDocChunkText?.('doc-1', 1, 'งบประมาณของสำนักงานปลัดกระทรวงประจำปี 2567');
    const out = await run(
      proposal([
        line({
          citations: [
            { kind: 'document', doc_id: 'doc-1', page: 1, quote: 'ของส านักงานปลัดกระทรวง' },
          ],
        }),
      ]),
      ctx,
    );
    const c = out.proposal.boq[0]?.citations[0];
    expect(c && 'quote' in c ? c.quote : undefined).toBe('ของส านักงานปลัดกระทรวง');
    expect(out.warnings.join(' ')).not.toContain('ตัด quote');
  });

  it('page ที่ไม่เคยอ่านผ่าน read_document (แม้ doc_id เคยอ่านหน้าอื่น) → ตัด page ทิ้ง', async () => {
    const { ctx, toolLog } = makeCtx();
    toolLog.recordSourceId('seen-1');
    toolLog.recordDocId('doc-1');
    toolLog.recordDocChunkText?.('doc-1', 1, 'เนื้อหาหน้า 1');
    const out = await run(
      proposal([
        line({ citations: [{ kind: 'document', doc_id: 'doc-1', page: 99 }] }),
      ]),
      ctx,
    );
    const c = out.proposal.boq[0]?.citations[0];
    expect(c && 'page' in c ? c.page : undefined).toBeUndefined();
    expect(c && 'doc_id' in c ? c.doc_id : undefined).toBe('doc-1');
    expect(out.warnings.join(' ')).toContain('ไม่เคยถูกอ่าน');
  });
});

describe('emit_proposal — econ citation ที่ค่าเป็น null ไม่นับว่าเคยเห็น (T-307 H2)', () => {
  it('recordEconValue ไม่เคยถูกเรียกสำหรับ (indicator, year) ที่ค่าเป็น null → citation ถูกตัด', async () => {
    const { ctx } = makeCtx();
    // จำลองพฤติกรรมจริงของ `tools/getEconIndicator.ts`: ไม่เรียก recordEconValue เมื่อผลเป็น null
    const out = await run(
      proposal([line({ basis: 'estimate', confidence: 'low', citations: [] })], {
        audit_findings: [
          {
            text: 'ตรวจสอบ CPI',
            severity: 'info',
            citations: [{ kind: 'econ', indicator: 'cpi_headline_index', year_be: 2599 }],
          },
        ],
      }),
      ctx,
    );
    expect(out.proposal.audit_findings?.[0]?.citations).toHaveLength(0);
    expect(out.warnings.join(' ')).toContain('econ:cpi_headline_index@2599');
  });
});
