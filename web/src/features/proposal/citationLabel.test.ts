import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { formatFiscalYearBe } from '@/lib/format';
import { citationChipLabel, isWebCitation } from './citationLabel';
import type { Citation } from './types';

describe('citationChipLabel', () => {
  it('budget_line: ใช้ note ถ้ามี มิฉะนั้น fallback เป็น "งบจริง · source_id"', () => {
    const withNote: Citation = { kind: 'budget_line', source_id: 'src_1', note: 'ราคาหมึกพิมพ์' };
    expect(citationChipLabel(withNote)).toBe('ราคาหมึกพิมพ์');

    const withoutNote: Citation = { kind: 'budget_line', source_id: 'src_1' };
    expect(citationChipLabel(withoutNote)).toBe(`${t('citation.types.budget_line_short')} · src_1`);
  });

  it('document: doc_id ดิบ', () => {
    const citation: Citation = { kind: 'document', doc_id: 'doc_1' };
    expect(citationChipLabel(citation)).toBe('doc_1');
  });

  it('econ: indicator ที่รู้จัก → ป้ายไทยสั้น + ปี (ไม่ใช่โค้ดดิบ)', () => {
    const citation: Citation = { kind: 'econ', indicator: 'construction_material_index', year_be: 2566 };
    expect(citationChipLabel(citation)).toBe(
      `${t('citation.econIndicators.construction_material_index')} · ${formatFiscalYearBe(2566, { withEra: true })}`,
    );
    expect(citationChipLabel(citation)).not.toContain('construction_material_index');
  });

  it('econ: indicator ที่ไม่รู้จัก → fallback เป็นโค้ดดิบ (ไม่เดาชื่อ)', () => {
    const citation: Citation = { kind: 'econ', indicator: 'unknown_indicator_code', year_be: 2566 };
    expect(citationChipLabel(citation)).toBe(
      `unknown_indicator_code · ${formatFiscalYearBe(2566, { withEra: true })}`,
    );
  });

  it('web: title ถ้ามี มิฉะนั้น url', () => {
    const withTitle: Citation = { kind: 'web', url: 'https://x', retrieved_at: '2026-09-01', title: 'ชื่อ' };
    expect(citationChipLabel(withTitle)).toBe('ชื่อ');
    const withoutTitle: Citation = { kind: 'web', url: 'https://x', retrieved_at: '2026-09-01' };
    expect(citationChipLabel(withoutTitle)).toBe('https://x');
  });
});

describe('isWebCitation', () => {
  it('true เฉพาะ kind=web', () => {
    expect(isWebCitation({ kind: 'web', url: 'https://x', retrieved_at: '2026-09-01' })).toBe(true);
    expect(isWebCitation({ kind: 'budget_line', source_id: 'src_1' })).toBe(false);
  });
});
