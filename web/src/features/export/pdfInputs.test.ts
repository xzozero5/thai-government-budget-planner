import { describe, expect, it, vi } from 'vitest';
import type { BoqLine, Proposal } from '@/ai/tools/proposal';
import type { ToolLog } from '@/ai/toolLog';
import type { ProposalPdfTrendImage } from './pdf/types';
import {
  buildBudgetLineDetailsFromToolLog,
  buildRenderInput,
  collectTrendRefs,
  computeExportWarningsInfo,
  DEFAULT_EXPORT_SECTIONS,
  ESTIMATE_HEAVY_THRESHOLD_PERCENT,
  EXPORT_AUTHOR_MAX_LENGTH,
  MAX_TREND_IMAGES,
  sanitizeExportAuthorName,
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

describe('sanitizeExportAuthorName (S13)', () => {
  it('ตัดช่องว่างหัวท้าย', () => {
    expect(sanitizeExportAuthorName('  กองบรรณาธิการ  ')).toBe('กองบรรณาธิการ');
  });

  it('ตัดความยาวไม่เกิน EXPORT_AUTHOR_MAX_LENGTH', () => {
    const long = 'ก'.repeat(200);
    const result = sanitizeExportAuthorName(long);
    expect(result.length).toBe(EXPORT_AUTHOR_MAX_LENGTH);
  });

  it('ค่าว่าง/เว้นวรรคล้วน → คืนสตริงว่าง', () => {
    expect(sanitizeExportAuthorName('   ')).toBe('');
  });
});

describe('collectTrendRefs (T-504)', () => {
  it('รวบจาก boq[].trend_ref + stat_cards[].trend_ref เรียงตามลำดับที่พบ', () => {
    const proposal = makeProposal({
      boq: [
        makeLine({ id: 'l1', trend_ref: { kind: 'item', key: 'เครื่องปรับอากาศ' } }),
        makeLine({ id: 'l2' }), // ไม่มี trend_ref
      ],
      stat_cards: [{ trend_ref: { kind: 'indicator', key: 'cpi' }, headline_th: 'CPI' }],
    });
    const refs = collectTrendRefs(proposal);
    expect(refs).toEqual([
      { kind: 'item', key: 'เครื่องปรับอากาศ' },
      { kind: 'indicator', key: 'cpi' },
    ]);
  });

  it('ตัดรายการซ้ำ (kind+key เดียวกัน)', () => {
    const proposal = makeProposal({
      boq: [
        makeLine({ id: 'l1', trend_ref: { kind: 'item', key: 'x' } }),
        makeLine({ id: 'l2', trend_ref: { kind: 'item', key: 'x' } }),
      ],
    });
    expect(collectTrendRefs(proposal)).toHaveLength(1);
  });

  it('ไม่เกิน MAX_TREND_IMAGES (default) หรือ max ที่ระบุ', () => {
    const boq = Array.from({ length: 10 }, (_unused, i) =>
      makeLine({ id: `l${String(i)}`, trend_ref: { kind: 'item', key: `k${String(i)}` } }),
    );
    const proposal = makeProposal({ boq });
    expect(collectTrendRefs(proposal)).toHaveLength(MAX_TREND_IMAGES);
    expect(collectTrendRefs(proposal, 2)).toHaveLength(2);
  });

  it('ไม่มี trend_ref เลย → คืน []', () => {
    expect(collectTrendRefs(makeProposal())).toEqual([]);
  });
});

describe('buildRenderInput', () => {
  const proposal = makeProposal();

  it('ส่ง warnings ตรง ๆ เสมอ (N3: ปิดไม่ได้ ต่างจาก T-502 เดิม)', () => {
    const input = buildRenderInput({
      proposal,
      warnings: ['เตือนจริง'],
      editedLineIds: [],
      sections: DEFAULT_EXPORT_SECTIONS,
    });
    expect(input.warnings).toEqual(['เตือนจริง']);
  });

  it('sections.illustrations=false → ไม่ส่ง images.overview แม้มี overviewImageDataUrl', () => {
    const input = buildRenderInput({
      proposal,
      warnings: [],
      editedLineIds: [],
      sections: { ...DEFAULT_EXPORT_SECTIONS, illustrations: false },
      overviewImageDataUrl: 'data:image/png;base64,xxx',
    });
    expect(input.images).toBeUndefined();
  });

  it('sections.illustrations=true + มีรูป → ส่ง images.overview', () => {
    const input = buildRenderInput({
      proposal,
      warnings: [],
      editedLineIds: [],
      sections: DEFAULT_EXPORT_SECTIONS,
      overviewImageDataUrl: 'data:image/png;base64,xxx',
    });
    expect(input.images?.overview).toBe('data:image/png;base64,xxx');
  });

  it('overviewImageDataUrl เป็น null (แปลง SVG ไม่สำเร็จ) → ไม่ส่ง images', () => {
    const input = buildRenderInput({
      proposal,
      warnings: [],
      editedLineIds: [],
      sections: DEFAULT_EXPORT_SECTIONS,
      overviewImageDataUrl: null,
    });
    expect(input.images).toBeUndefined();
  });

  it('sections.trends=false → ไม่ส่ง images.trends แม้มี trendImages', () => {
    const trendImages: ProposalPdfTrendImage[] = [{ title: 'ทดสอบ', dataUrl: 'data:image/png;base64,x' }];
    const input = buildRenderInput({
      proposal,
      warnings: [],
      editedLineIds: [],
      sections: { ...DEFAULT_EXPORT_SECTIONS, trends: false },
      trendImages,
    });
    expect(input.images?.trends).toBeUndefined();
  });

  it('sections.trends=true + มีกราฟ → ส่ง images.trends ครบ', () => {
    const trendImages: ProposalPdfTrendImage[] = [{ title: 'ทดสอบ', dataUrl: 'data:image/png;base64,x' }];
    const input = buildRenderInput({
      proposal,
      warnings: [],
      editedLineIds: [],
      sections: DEFAULT_EXPORT_SECTIONS,
      trendImages,
    });
    expect(input.images?.trends).toEqual(trendImages);
  });

  it('images.overview และ images.trends อยู่ในก้อนเดียวกันเมื่อเปิดทั้งคู่', () => {
    const trendImages: ProposalPdfTrendImage[] = [{ title: 'ทดสอบ', dataUrl: 'data:image/png;base64,x' }];
    const input = buildRenderInput({
      proposal,
      warnings: [],
      editedLineIds: [],
      sections: DEFAULT_EXPORT_SECTIONS,
      overviewImageDataUrl: 'data:image/png;base64,overview',
      trendImages,
    });
    expect(input.images).toEqual({
      overview: 'data:image/png;base64,overview',
      trends: trendImages,
    });
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

  it('ส่ง sections ทุกครั้งตรงกับที่รับมา', () => {
    const input = buildRenderInput({
      proposal,
      warnings: [],
      editedLineIds: [],
      sections: { ...DEFAULT_EXPORT_SECTIONS, stats: false, comparables: false },
    });
    expect(input.sections).toEqual({
      stats: false,
      assumptionsRisks: true,
      comparables: false,
      illustrations: true,
      trends: true,
    });
  });

  it('author (S13): trim/ตัดความยาวก่อนส่ง และไม่ส่งเมื่อว่างเปล่า', () => {
    const withAuthor = buildRenderInput({
      proposal,
      warnings: [],
      editedLineIds: [],
      sections: DEFAULT_EXPORT_SECTIONS,
      author: '  กองบรรณาธิการข่าว ก  ',
    });
    expect(withAuthor.author).toBe('กองบรรณาธิการข่าว ก');

    const emptyAuthor = buildRenderInput({
      proposal,
      warnings: [],
      editedLineIds: [],
      sections: DEFAULT_EXPORT_SECTIONS,
      author: '   ',
    });
    expect(emptyAuthor.author).toBeUndefined();

    const noAuthor = buildRenderInput({
      proposal,
      warnings: [],
      editedLineIds: [],
      sections: DEFAULT_EXPORT_SECTIONS,
    });
    expect(noAuthor.author).toBeUndefined();
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
