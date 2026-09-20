import { describe, expect, it, vi } from 'vitest';
import type { BoqLine, Proposal } from '@/ai/tools/proposal';
import type { ToolLog } from '@/ai/toolLog';
import {
  buildBudgetLineDetailsFromToolLog,
  buildRenderInput,
  computeExportWarningsInfo,
  DEFAULT_EXPORT_SECTIONS,
  ESTIMATE_HEAVY_THRESHOLD_PERCENT,
} from './pdfInputs';

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

describe('computeExportWarningsInfo', () => {
  it('ไม่มี estimate/ไม่มีบรรทัดขาด citation → ไม่ heavy, ไม่มีบรรทัดขาด citation', () => {
    const proposal = makeProposal({ boq: [makeLine({ basis: 'historical' })] });
    const info = computeExportWarningsInfo(proposal, []);
    expect(info.isEstimateHeavy).toBe(false);
    expect(info.missingCitationCount).toBe(0);
    expect(info.validatorWarningCount).toBe(0);
  });

  it('boq ทั้งหมดเป็น estimate → estimatePercent 100 และ isEstimateHeavy true', () => {
    const proposal = makeProposal({
      boq: [makeLine({ basis: 'estimate', citations: [] })],
    });
    const info = computeExportWarningsInfo(proposal, ['คำเตือนจาก validator']);
    expect(info.estimatePercent).toBe(100);
    expect(info.isEstimateHeavy).toBe(true);
    expect(info.validatorWarningCount).toBe(1);
  });

  it('เกณฑ์ heavy คือ >= ESTIMATE_HEAVY_THRESHOLD_PERCENT', () => {
    expect(ESTIMATE_HEAVY_THRESHOLD_PERCENT).toBeGreaterThan(0);
  });

  it('basis != estimate และไม่มี citation → นับเป็น missingCitationCount (N3)', () => {
    const proposal = makeProposal({
      boq: [makeLine({ basis: 'historical', citations: [] })],
    });
    const info = computeExportWarningsInfo(proposal, []);
    expect(info.missingCitationCount).toBe(1);
  });
});

describe('buildRenderInput', () => {
  const proposal = makeProposal();

  it('sections.warnings=false → ส่ง warnings เป็น [] แม้ของจริงมีอยู่', () => {
    const input = buildRenderInput({
      proposal,
      warnings: ['เตือนจริง'],
      editedLineIds: [],
      sections: { ...DEFAULT_EXPORT_SECTIONS, warnings: false },
    });
    expect(input.warnings).toEqual([]);
  });

  it('sections.warnings=true → ส่ง warnings ของจริง', () => {
    const input = buildRenderInput({
      proposal,
      warnings: ['เตือนจริง'],
      editedLineIds: [],
      sections: { ...DEFAULT_EXPORT_SECTIONS, warnings: true },
    });
    expect(input.warnings).toEqual(['เตือนจริง']);
  });

  it('sections.illustrations=false → ไม่ส่ง images แม้มี overviewImageDataUrl', () => {
    const input = buildRenderInput({
      proposal,
      warnings: [],
      editedLineIds: [],
      sections: { illustrations: false, warnings: true },
      overviewImageDataUrl: 'data:image/png;base64,xxx',
    });
    expect(input.images).toBeUndefined();
  });

  it('sections.illustrations=true + มีรูป → ส่ง images.overview', () => {
    const input = buildRenderInput({
      proposal,
      warnings: [],
      editedLineIds: [],
      sections: { illustrations: true, warnings: true },
      overviewImageDataUrl: 'data:image/png;base64,xxx',
    });
    expect(input.images?.overview).toBe('data:image/png;base64,xxx');
  });

  it('overviewImageDataUrl เป็น null (แปลง SVG ไม่สำเร็จ) → ไม่ส่ง images', () => {
    const input = buildRenderInput({
      proposal,
      warnings: [],
      editedLineIds: [],
      sections: { illustrations: true, warnings: true },
      overviewImageDataUrl: null,
    });
    expect(input.images).toBeUndefined();
  });

  it('ไม่ส่ง dataVersion → ไม่มี key นี้ใน input', () => {
    const input = buildRenderInput({
      proposal,
      warnings: [],
      editedLineIds: [],
      sections: DEFAULT_EXPORT_SECTIONS,
    });
    expect(input.dataVersion).toBeUndefined();
  });
});

describe('buildBudgetLineDetailsFromToolLog', () => {
  const proposal = makeProposal({
    boq: [makeLine({ id: 'l1', citations: [{ kind: 'budget_line', source_id: 'src_1' }] })],
  });

  it('toolLog เป็น null → คืน {} เสมอ (โหมด /load ไม่มี ToolLog)', () => {
    expect(buildBudgetLineDetailsFromToolLog(proposal, null)).toEqual({});
  });

  it('toolLog ไม่มี getSourceFingerprint (backward-compat) → คืน {}', () => {
    const fakeToolLog = {} as Pick<ToolLog, 'getSourceFingerprint'>;
    expect(buildBudgetLineDetailsFromToolLog(proposal, fakeToolLog)).toEqual({});
  });

  it('toolLog มี fingerprint ของ source_id ที่ถูกอ้างถึง → เติมรายละเอียด', () => {
    const getSourceFingerprint = vi.fn().mockReturnValue({
      amountThb: 40000,
      unitPriceThb: 20000,
      itemQty: 2,
      itemUnit: 'เครื่อง',
      fiscalYearBe: 2567,
      agency: 'อบต. ทดสอบ',
      ministry: null,
      itemNameRaw: 'เครื่องปรับอากาศ 18000 BTU',
      dataset: 'pbo',
    });
    const details = buildBudgetLineDetailsFromToolLog(proposal, { getSourceFingerprint });
    expect(getSourceFingerprint).toHaveBeenCalledWith('src_1');
    expect(details['src_1']).toEqual({
      dataset: 'pbo',
      fiscalYearBe: 2567,
      itemNameRaw: 'เครื่องปรับอากาศ 18000 BTU',
      agency: 'อบต. ทดสอบ',
      amountThb: 40000,
    });
  });
});
