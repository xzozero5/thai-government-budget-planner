import type { CoverageNote, EconIndicatorSeries, Facets } from '@/data';
import { describe, expect, it } from 'vitest';
import { MODEL_LIST } from './models';
import { buildSystemBlocks, type BuildSystemBlocksInput } from './systemPrompt';

function makeFacets(): Facets {
  return {
    budget_types: [
      { value: 'งบลงทุน', count: 120 },
      { value: 'งบดำเนินงาน', count: 300 },
    ],
    coverage_notes: [
      {
        dataset: 'pbo',
        status: 'pass',
        note: 'ครบถ้วน',
        decision_ref: 'V1',
      },
    ],
    datasets: [
      { value: 'pbo', count: 900 },
      { value: 'act_2570_draft', count: 400 },
    ],
    fiscal_years: [
      { value: 2567, count: 500 },
      { value: 2566, count: 480 },
    ],
    ministries: [{ value: 'กระทรวงมหาดไทย', count: 200 }],
    provinces: [{ value: 'นครนายก', count: 10 }],
  };
}

function makeEcon(): EconIndicatorSeries[] {
  return [
    {
      indicator: 'cpi_headline_index',
      label_th: 'ดัชนีราคาผู้บริโภคทั่วไป',
      unit: 'index',
      points: [
        { year_be: 2566, value: 107.2 },
        { year_be: 2567, value: 109.1 },
      ],
      source_name: 'สนค.',
      source_url: 'https://example.go.th/cpi',
      verified: false,
    },
  ];
}

function makeCoverageNotes(): CoverageNote[] {
  return [
    { dataset: 'ratchathewa', status: 'partial', note: 'OCR ต้นทาง', decision_ref: 'ADR-005' },
  ];
}

function baseInput(overrides: Partial<BuildSystemBlocksInput> = {}): BuildSystemBlocksInput {
  return {
    facets: makeFacets(),
    econIndicators: makeEcon(),
    datasetNotes: ['PDF ที่ไม่มี text layer ระบบอ่านเนื้อหาไม่ได้'],
    coverageNotes: makeCoverageNotes(),
    mode: 'draft',
    todayBe: '20 กันยายน 2569',
    ...overrides,
  };
}

describe('buildSystemBlocks', () => {
  it('บล็อกคงที่ byte-identical เมื่อเรียกซ้ำด้วย input เดิม', () => {
    const a = buildSystemBlocks(baseInput());
    const b = buildSystemBlocks(baseInput());
    expect(a[0]?.text).toBe(b[0]?.text);
  });

  it('บล็อกคงที่ byte-identical แม้ลำดับ key ของ facets object ต่างกัน', () => {
    const facetsA = makeFacets();
    const facetsB: Facets = {} as Facets;
    // จงใจใส่ key ย้อนลำดับ (insertion order ต่างจาก facetsA)
    facetsB.provinces = facetsA.provinces;
    facetsB.ministries = facetsA.ministries;
    facetsB.fiscal_years = facetsA.fiscal_years;
    facetsB.datasets = facetsA.datasets;
    facetsB.coverage_notes = facetsA.coverage_notes;
    facetsB.budget_types = facetsA.budget_types;

    const a = buildSystemBlocks(baseInput({ facets: facetsA }));
    const b = buildSystemBlocks(baseInput({ facets: facetsB }));
    expect(a[0]?.text).toBe(b[0]?.text);
  });

  it('ไม่มีวันที่ปัจจุบันหลุดเข้าบล็อกคงที่', () => {
    const [cached, tail] = buildSystemBlocks(baseInput({ todayBe: '20 กันยายน 2569' }));
    expect(cached?.text.includes('20 กันยายน 2569')).toBe(false);
    expect(tail?.text).toContain('20 กันยายน 2569');
  });

  it('โหมดเปลี่ยนเฉพาะบล็อกท้าย — บล็อกคงที่เหมือนเดิม', () => {
    const draft = buildSystemBlocks(baseInput({ mode: 'draft' }));
    const audit = buildSystemBlocks(baseInput({ mode: 'audit' }));
    expect(draft[0]?.text).toBe(audit[0]?.text);
    expect(draft[1]?.text).not.toBe(audit[1]?.text);
  });

  it('บล็อกคงที่มี cache_control ephemeral, บล็อกท้ายไม่มี', () => {
    const [cached, tail] = buildSystemBlocks(baseInput());
    expect(cached?.cache_control).toEqual({ type: 'ephemeral' });
    expect(tail && 'cache_control' in tail ? tail.cache_control : undefined).toBeUndefined();
  });

  it('มีข้อความบังคับตาม AC ของ T-305 ครบทุกข้อ', () => {
    const [cached] = buildSystemBlocks(baseInput());
    const text = cached?.text ?? '';
    expect(text).toContain('ปี 2562');
    expect(text).toContain('query_budget_lines');
    expect(text).toContain('ราชาเทวะ');
    expect(text).toContain('OCR');
    expect(text).toContain('low_specificity');
    expect(text).toContain('p25');
    expect(text).toContain('p75');
    expect(text).toContain('ราคาต่อรายการงบ');
    expect(text).toContain('web_search');
    expect(text).toContain('verified');
    expect(text).toContain('ข้อมูล');
    expect(text).toContain('ระเบียบจัดซื้อ');
    expect(text).toContain('emit_illustration');
    expect(text).toContain('get_price_trend');
  });

  it('แนบ econ indicator ที่ส่งเข้ามาไว้ในบล็อกคงที่ (JSON)', () => {
    const [cached] = buildSystemBlocks(baseInput());
    expect(cached?.text).toContain('cpi_headline_index');
  });

  it('ไม่มี palette → ยังคงมีคำแนะนำเรื่องสีอยู่ (ไม่ error, ไม่ข้ามเรื่องสีไปเฉย ๆ)', () => {
    const [cached] = buildSystemBlocks(baseInput());
    expect(cached?.text).toContain('palette');
  });

  it('มี palette → ปรากฏในบล็อกคงที่', () => {
    const [cached] = buildSystemBlocks(baseInput({ palette: ['#0b5ea8', '#ffffff'] }));
    expect(cached?.text).toContain('#0b5ea8');
  });

  it('รายงานขนาดโดยประมาณเทียบขั้นต่ำ cache ของแต่ละรุ่น (ข้อมูล ไม่ fail หนัก)', () => {
    const [cached] = buildSystemBlocks(baseInput());
    const charCount = cached?.text.length ?? 0;
    // ประมาณการแบบระมัดระวัง (คำไทยกินหลาย byte/token กว่าอังกฤษ) — ใช้ 2 ตัวอักษร/token เป็นเพดานบน
    const estimatedTokens = Math.ceil(charCount / 2);
    for (const model of MODEL_LIST) {
      const meetsMinimum = estimatedTokens >= model.minCacheablePrefixTokens;
      console.log(
        `[systemPrompt size] ${model.id}: ~${String(estimatedTokens)} tokens estimated (chars=${String(charCount)}) vs minCacheablePrefixTokens=${String(model.minCacheablePrefixTokens)} → ${meetsMinimum ? 'OK' : 'BELOW MINIMUM'}`,
      );
    }
    expect(charCount).toBeGreaterThan(0);
  });
});
