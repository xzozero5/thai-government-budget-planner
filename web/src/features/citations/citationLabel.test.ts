import { describe, expect, it } from 'vitest';
import type { Citation } from '@/ai/tools/proposal';
import { t } from '@/i18n';
import {
  datasetTypeLabel,
  describeQualityFlag,
  formatCitationDate,
  getCitationChipLabel,
  getWebDomain,
  isHttpsUrl,
} from './citationLabel';

describe('isHttpsUrl', () => {
  it('true เฉพาะ https://', () => {
    expect(isHttpsUrl('https://shopee.co.th/a')).toBe(true);
  });
  it('false เมื่อเป็น http:// หรือ scheme อื่น', () => {
    expect(isHttpsUrl('http://shopee.co.th/a')).toBe(false);
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpsUrl('ไม่ใช่ url')).toBe(false);
  });
});

describe('getWebDomain', () => {
  it('ตัด www. ออก', () => {
    expect(getWebDomain('https://www.shopee.co.th/product/1')).toBe('shopee.co.th');
  });
  it('คืนโดเมนเดิมถ้าไม่มี www.', () => {
    expect(getWebDomain('https://lazada.co.th/x')).toBe('lazada.co.th');
  });
  it('คืน null ถ้า parse ไม่ได้', () => {
    expect(getWebDomain('ไม่ใช่ url')).toBeNull();
  });
});

describe('formatCitationDate', () => {
  it('แปลงเป็นวันที่ไทยแบบ พ.ศ.', () => {
    const formatted = formatCitationDate('2026-09-01T00:00:00.000Z');
    expect(formatted).toContain('2569');
  });
  it('คืนค่าดิบถ้า parse ไม่ได้', () => {
    expect(formatCitationDate('ไม่ใช่วันที่')).toBe('ไม่ใช่วันที่');
  });
});

describe('datasetTypeLabel', () => {
  it('pbo_disbursement → งบที่เบิกจ่ายจริง', () => {
    expect(datasetTypeLabel('pbo_disbursement', 2567)).toBe(t('citation.types.budget_line'));
  });
  it('act_2570_draft/act_2570_province → ร่าง พ.ร.บ. พร้อมปี', () => {
    expect(datasetTypeLabel('act_2570_draft', 2570)).toBe(
      t('citation.types.budget_bill', { year: 2570 }),
    );
    expect(datasetTypeLabel('act_2570_province', 2570)).toBe(
      t('citation.types.budget_bill', { year: 2570 }),
    );
  });
  it('local_ordinance_2570/local_subsidy_2570 → ข้อบัญญัติท้องถิ่น', () => {
    expect(datasetTypeLabel('local_ordinance_2570', 2570)).toBe(
      t('citation.types.local_ordinance'),
    );
    expect(datasetTypeLabel('local_subsidy_2570', 2570)).toBe(t('citation.types.local_ordinance'));
  });
  it('committee_table → เอกสารคณะกรรมาธิการ', () => {
    expect(datasetTypeLabel('committee_table', 2567)).toBe(t('citation.types.committee_doc'));
  });
});

describe('describeQualityFlag', () => {
  it('upstream_ocr พร้อม page → ข้อความเต็มมีเลขหน้า', () => {
    const display = describeQualityFlag('upstream_ocr', { page: 42 });
    expect(display.full).toBe(t('citation.flags.upstream_ocr', { page: 42 }));
    expect(display.short).toBe(t('citation.flags.upstream_ocrShort'));
  });
  it('upstream_ocr ไม่มี page → ไม่มี "{page}" ดิบค้างอยู่', () => {
    const display = describeQualityFlag('upstream_ocr');
    expect(display.full).not.toContain('{page}');
  });
  it('source_incomplete / low_specificity / group_total_mismatch มีคำแปล', () => {
    expect(describeQualityFlag('source_incomplete').short).toBe(
      t('citation.flags.source_incompleteShort'),
    );
    expect(describeQualityFlag('low_specificity').full).toBe(t('citation.flags.low_specificity'));
    expect(describeQualityFlag('group_total_mismatch').short).toBe(
      t('citation.flags.group_total_mismatchShort'),
    );
  });
  it('flag ที่ไม่มีคำแปล → fallback เป็นโค้ดดิบ', () => {
    const display = describeQualityFlag('flag_from_future_pipeline');
    expect(display.short).toBe('flag_from_future_pipeline');
    expect(display.full).toBe('flag_from_future_pipeline');
  });

  it('flag ที่มีเฉพาะข้อความสั้น (เช่น ministry_unmapped) → ข้อความไทย ไม่ใช่โค้ดดิบ', () => {
    const display = describeQualityFlag('ministry_unmapped');
    expect(display.code).toBe('ministry_unmapped');
    expect(display.short).not.toBe('ministry_unmapped');
    expect(display.short.length).toBeGreaterThan(5);
  });
});

describe('getCitationChipLabel', () => {
  it('budget_line ไม่มี hint → fallback source_id ย่อ', () => {
    const citation: Citation = { kind: 'budget_line', source_id: 'bl_abcdef1234567890' };
    expect(getCitationChipLabel(citation)).toBe(
      `${t('citation.types.budget_line_short')} · 34567890`,
    );
  });
  it('budget_line มี hint → ใช้ template citation.budgetLine.chip', () => {
    const citation: Citation = { kind: 'budget_line', source_id: 'bl_1' };
    const label = getCitationChipLabel(citation, {
      budgetLine: { datasetLabel: 'PBO', fiscalYearBe: 2568, agency: 'กรมชลประทาน', ministry: null },
    });
    expect(label).toBe(t('citation.budgetLine.chip', { source: 'PBO', year: 2568, agency: 'กรมชลประทาน' }));
  });
  it('budget_line hint ไม่มี agency ใช้ ministry แทน, ไม่มีทั้งคู่ใช้ common.unknown', () => {
    const citation: Citation = { kind: 'budget_line', source_id: 'bl_1' };
    const withMinistry = getCitationChipLabel(citation, {
      budgetLine: { datasetLabel: 'PBO', fiscalYearBe: 2568, agency: null, ministry: 'กระทรวงเกษตรฯ' },
    });
    expect(withMinistry).toContain('กระทรวงเกษตรฯ');
    const withNeither = getCitationChipLabel(citation, {
      budgetLine: { datasetLabel: 'PBO', fiscalYearBe: 2568, agency: null, ministry: null },
    });
    expect(withNeither).toContain(t('common.unknown'));
  });
  it('document → "เอกสาร · หน้า {page}"', () => {
    const citation: Citation = { kind: 'document', doc_id: 'doc-1', page: 12 };
    expect(getCitationChipLabel(citation)).toBe(
      `${t('citation.types.document')} · ${t('citation.page', { page: 12 })}`,
    );
  });
  it('document ไม่มี page → common.unknown', () => {
    const citation: Citation = { kind: 'document', doc_id: 'doc-1' };
    expect(getCitationChipLabel(citation)).toContain(t('common.unknown'));
  });
  it('econ ไม่มี hint → indicator ตัวพิมพ์ใหญ่ + ปี', () => {
    const citation: Citation = { kind: 'econ', indicator: 'cpi', year_be: 2567 };
    expect(getCitationChipLabel(citation)).toBe('CPI 2567');
  });
  it('econ มี econLabel → ใช้ label ที่ส่งมา', () => {
    const citation: Citation = { kind: 'econ', indicator: 'cpi', year_be: 2567 };
    expect(getCitationChipLabel(citation, { econLabel: 'ดัชนีราคาผู้บริโภค' })).toBe(
      'ดัชนีราคาผู้บริโภค 2567',
    );
  });
  it('web → โดเมนของ url', () => {
    const citation: Citation = {
      kind: 'web',
      url: 'https://www.shopee.co.th/x',
      retrieved_at: '2026-09-01',
    };
    expect(getCitationChipLabel(citation)).toBe('shopee.co.th');
  });
  it('web url parse ไม่ได้ → คืน url ดิบ', () => {
    const citation: Citation = { kind: 'web', url: 'ไม่ใช่ url', retrieved_at: '2026-09-01' };
    expect(getCitationChipLabel(citation)).toBe('ไม่ใช่ url');
  });
});
