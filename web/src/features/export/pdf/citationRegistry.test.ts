import { describe, expect, it } from 'vitest';
import type { BoqLine, Citation, Proposal } from '@/ai/tools/proposal';
import {
  boqLineNeedsCitationWarning,
  buildCitationRegistry,
  citationDedupeKey,
  citationIndexesFor,
  toCitationIndexLookup,
} from './citationRegistry';

function boqLine(overrides: Partial<BoqLine> & Pick<BoqLine, 'id' | 'citations'>): BoqLine {
  return {
    category: 'หมวด',
    item: 'รายการ',
    qty: 1,
    unit: 'ชิ้น',
    unit_price_thb: 100,
    total_thb: 100,
    basis: 'historical',
    confidence: 'medium',
    rationale: 'เหตุผล',
    ...overrides,
  };
}

const budgetLineCitation: Citation = { kind: 'budget_line', source_id: 'src-1' };
const webCitation: Citation = {
  kind: 'web',
  url: 'https://shopee.co.th/x',
  retrieved_at: '2569-09-20',
};

type MinimalProposal = Pick<Proposal, 'citations_web' | 'boq' | 'audit_findings'>;

function minimalProposal(overrides: Partial<MinimalProposal> = {}): MinimalProposal {
  return {
    citations_web: [],
    boq: [],
    ...overrides,
  };
}

describe('citationDedupeKey', () => {
  it('citation ประเภทเดียวกันที่ชี้ข้อมูลเดียวกันได้คีย์เดียวกัน', () => {
    const a: Citation = { kind: 'budget_line', source_id: 'abc' };
    const b: Citation = { kind: 'budget_line', source_id: 'abc', note: 'ข้อความต่างกัน' };
    expect(citationDedupeKey(a)).toBe(citationDedupeKey(b));
  });

  it('document citation ต่างหน้าได้คีย์ต่างกัน', () => {
    const a: Citation = { kind: 'document', doc_id: 'd1', page: 1 };
    const b: Citation = { kind: 'document', doc_id: 'd1', page: 2 };
    expect(citationDedupeKey(a)).not.toBe(citationDedupeKey(b));
  });
});

describe('buildCitationRegistry', () => {
  it('citations_web ระดับ proposal ได้เลขก่อนเสมอ แม้ BOQ จะมาก่อนใน array', () => {
    const proposal = minimalProposal({
      citations_web: [{ url: 'https://a.co/x', retrieved_at: '2569-01-01' }],
      boq: [boqLine({ id: 'L1', citations: [budgetLineCitation] })],
    });
    const registry = buildCitationRegistry(proposal);
    expect(registry).toHaveLength(2);
    expect(registry[0]?.citation).toMatchObject({ kind: 'web', url: 'https://a.co/x' });
    expect(registry[0]?.index).toBe(1);
    expect(registry[1]?.citation).toMatchObject({ kind: 'budget_line', source_id: 'src-1' });
    expect(registry[1]?.index).toBe(2);
  });

  it('citation ซ้ำกันข้ามหลายบรรทัด BOQ ได้เลขเดียวกัน (dedupe)', () => {
    const proposal = minimalProposal({
      boq: [
        boqLine({ id: 'L1', citations: [budgetLineCitation] }),
        boqLine({ id: 'L2', citations: [budgetLineCitation, webCitation] }),
      ],
    });
    const registry = buildCitationRegistry(proposal);
    expect(registry).toHaveLength(2);
    const lookup = toCitationIndexLookup(registry);
    const l1Indexes = citationIndexesFor([budgetLineCitation], lookup);
    const l2Indexes = citationIndexesFor([budgetLineCitation, webCitation], lookup);
    expect(l1Indexes).toEqual([l2Indexes[0]]);
  });

  it('รวม citation จาก audit_findings ด้วย', () => {
    const proposal = minimalProposal({
      audit_findings: [{ text: 'พบว่าแพงผิดปกติ', severity: 'high', citations: [webCitation] }],
    });
    const registry = buildCitationRegistry(proposal);
    expect(registry).toHaveLength(1);
    expect(registry[0]?.citation.kind).toBe('web');
  });
});

describe('citationIndexesFor', () => {
  it('คืน [] เมื่อ citation ไม่พบใน registry (ป้องกัน crash ไม่ใช่ throw)', () => {
    const lookup = toCitationIndexLookup([]);
    expect(citationIndexesFor([budgetLineCitation], lookup)).toEqual([]);
  });
});

describe('boqLineNeedsCitationWarning (N3)', () => {
  it('basis != estimate แต่ไม่มี citation เลย ต้องเตือน', () => {
    expect(boqLineNeedsCitationWarning({ basis: 'historical', citations: [] })).toBe(true);
    expect(boqLineNeedsCitationWarning({ basis: 'market', citations: [] })).toBe(true);
  });

  it('basis=estimate ไม่ต้องมี citation ก็ไม่เตือน', () => {
    expect(boqLineNeedsCitationWarning({ basis: 'estimate', citations: [] })).toBe(false);
  });

  it('มี citation แล้วไม่ต้องเตือน', () => {
    expect(
      boqLineNeedsCitationWarning({ basis: 'historical', citations: [budgetLineCitation] }),
    ).toBe(false);
  });
});
