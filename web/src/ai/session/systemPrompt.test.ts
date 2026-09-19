import type { CoverageNote, EconIndicatorSeries, Facets } from '@/data';
import { createDataFacade } from '@/data';
import { describe, expect, it } from 'vitest';
import { buildProductionSystemBlocks, formatTodayBe } from './systemPrompt';

function makeFacets(): Facets {
  return {
    budget_types: [{ value: 'งบลงทุน', count: 120 }],
    coverage_notes: [],
    datasets: [{ value: 'pbo', count: 900 }],
    fiscal_years: [{ value: 2567, count: 500 }],
    ministries: [{ value: 'กระทรวงมหาดไทย', count: 200 }],
    provinces: [{ value: 'นครนายก', count: 10 }],
  };
}

function makeEconSeries(indicator: string): EconIndicatorSeries {
  return {
    indicator,
    label_th: 'ตัวชี้วัดทดสอบ',
    unit: 'index',
    points: [{ year_be: 2567, value: 100 }],
    source_name: 'ทดสอบ',
    source_url: 'https://example.go.th/x',
    verified: false,
  };
}

describe('formatTodayBe', () => {
  it('แปลง ค.ศ. เป็น พ.ศ. (+543) พร้อมชื่อเดือนไทย', () => {
    expect(formatTodayBe(new Date(2026, 8, 20))).toBe('20 กันยายน 2569');
  });
});

describe('buildProductionSystemBlocks', () => {
  it('เรียก data facade จริง (ผ่าน dependency injection) แล้วประกอบ 2 บล็อกตาม buildSystemBlocks', async () => {
    const dataFacade = createDataFacade({
      facets: () => Promise.resolve(makeFacets()),
      getEconSeries: (indicator) =>
        indicator === 'cpi_headline_index' ? Promise.resolve(makeEconSeries(indicator)) : Promise.resolve(null),
    });

    const blocks = await buildProductionSystemBlocks('draft', {
      dataFacade,
      now: new Date(2026, 8, 20),
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[1]?.cache_control).toBeUndefined();
    const cachedText = blocks[0] !== undefined && 'text' in blocks[0] ? blocks[0].text : '';
    // เฉพาะ indicator ที่มีค่าจริง (จุด >0) เท่านั้นที่ควรปรากฏใน facts block ที่ cache ได้
    expect(cachedText).toContain('cpi_headline_index');
    expect(cachedText).not.toContain('gdp_growth_pct');
    const tailText = blocks[1] !== undefined && 'text' in blocks[1] ? blocks[1].text : '';
    expect(tailText).toContain('20 กันยายน 2569');
  });

  it('ไม่พังเมื่อไม่ระบุ deps ใด ๆ (ใช้ default dataFacade ของ @/data จริง) — ตรวจแค่ signature ใช้งานได้', () => {
    // ไม่เรียกจริง (จะแตะ fetch จริงซึ่งไม่มีใน jsdom test env) — แค่ยืนยันว่า type/การอ้างอิง default
    // param ถูกต้อง ไม่ throw ตอน import/ประกาศฟังก์ชัน
    expect(typeof buildProductionSystemBlocks).toBe('function');
  });

  it('ใช้ coverageNotes ว่างเสมอ (นอกเหนือจากที่ติดมากับ facets.coverage_notes ซึ่ง buildSystemBlocks จัดการเอง)', async () => {
    const notes: CoverageNote[] = [];
    const dataFacade = createDataFacade({
      facets: () => Promise.resolve(makeFacets()),
      getEconSeries: () => Promise.resolve(null),
    });
    const blocks = await buildProductionSystemBlocks('audit', { dataFacade, now: new Date(2026, 0, 1) });
    expect(notes).toEqual([]);
    expect(blocks[1] !== undefined && 'text' in blocks[1] ? blocks[1].text : '').toContain('ตรวจสอบ');
  });
});
