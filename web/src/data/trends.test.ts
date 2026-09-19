/**
 * T-207 — trends.ts: getPriceTrend (catalog/trends), getEconTrend (econ series)
 *
 * ใช้ shard/series จริงจาก `web/tests/fixtures/data/catalog/trends/*` และ `econ/indicators.json`
 * เมื่อทำได้ — fixture ตัวอย่างเล็ก (`tgbp sample`) จึงไม่มี series ที่ยาวเกิน 10 จุดหรือ
 * basis=unit_price_per_line เลย (0.05% ของข้อมูลจริงเท่านั้น ตาม docs/03-DATA-PIPELINE.md) → กรณี
 * เหล่านั้นทดสอบด้วย `TrendSeries` ที่สร้างเอง (pure `buildPriceTrend`) ตามที่ task brief กำหนด
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFixtureFetch } from '@/data/testFixtures';
import type { TrendSeries } from '@/data/types';
import {
  buildPriceTrend,
  getEconTrend,
  getPriceTrend,
  MAX_TREND_POINTS,
  resetTrendShardCache,
} from '@/data/trends';

beforeEach(() => {
  resetTrendShardCache();
});

describe('getPriceTrend (T-207) — fixture จริง, basis=amount_per_line', () => {
  it('คำนวณ changePct จากจุดแรก→จุดสุดท้ายที่ n≥3 เท่านั้น และมี caveat ปี 2562 (ADR-004)', async () => {
    const trend = await getPriceTrend(
      { key: 'โครงการติดตั้งระบบสูบน้ำพลังงานแสงอาทิตย์เพื่อการเกษตร', trend: '76' },
      createFixtureFetch(),
    );
    expect(trend).not.toBeNull();
    expect(trend?.basis).toBe('amount_per_line');
    expect(trend?.unitLabel).toBe('บาท/รายการ');
    expect(trend?.points.map((p) => p.yearBe)).toEqual([2561, 2562, 2563]);
    // 2562 มี n=2 (< 3) และ note source_incomplete → ไม่เข้าเกณฑ์คำนวณ changePct
    // มือคำนวณ: (423000 - 465300) / 465300 * 100 = -9.09 (ปัด 2 ตำแหน่ง)
    expect(trend?.changePct).toEqual({ fromYear: 2561, toYear: 2563, pct: -9.09 });
    expect(trend?.caveats).toContain('ราคาต่อรายการงบ ไม่ใช่ราคาต่อหน่วย');
    expect(trend?.caveats).toContain('ข้อมูลปี 2562 ไม่ครบ (ADR-004)');
  });

  it('n < 3 ทุกจุด → changePct เป็น null พร้อม caveat "ตัวอย่างน้อย"', async () => {
    const trend = await getPriceTrend(
      { key: 'ระดับปฐมวัย อาหารเสริม นม', trend: '14' },
      createFixtureFetch(),
    );
    expect(trend).not.toBeNull();
    expect(trend?.points.every((p) => p.n < 3)).toBe(true);
    expect(trend?.changePct).toBeNull();
    expect(trend?.caveats).toContain('ตัวอย่างน้อย');
  });

  it('item ไม่มี trend (ไม่มีฟิลด์ trend เลย) → คืน null ไม่ throw', async () => {
    const trend = await getPriceTrend(
      { key: 'ครุภัณฑ์ทดแทนสำหรับห้องเรียน dltv โรงเรียน stand alone' },
      createFixtureFetch(),
    );
    expect(trend).toBeNull();
  });

  it('มี trend shard แต่ key ไม่อยู่ใน shard นั้น → คืน null ไม่ throw', async () => {
    const trend = await getPriceTrend(
      { key: 'ไม่มีจริงแน่นอน-xyz', trend: '76' },
      createFixtureFetch(),
    );
    expect(trend).toBeNull();
  });

  it('cache ต่อ shard — เรียกซ้ำ shard เดิมไม่ fetch ใหม่', async () => {
    const fetchImpl = vi.fn(createFixtureFetch());
    await getPriceTrend(
      { key: 'โครงการติดตั้งระบบสูบน้ำพลังงานแสงอาทิตย์เพื่อการเกษตร', trend: '76' },
      fetchImpl,
    );
    await getPriceTrend(
      { key: 'โครงการติดตั้งระบบสูบน้ำพลังงานแสงอาทิตย์เพื่อการเกษตร', trend: '76' },
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('buildPriceTrend (pure) — basis=unit_price_per_line (สร้าง series ปลอมเพราะ fixture ไม่มี)', () => {
  const unitPriceSeries: TrendSeries = {
    key: 'เครื่องปรับอากาศ 18000 บีทียู',
    basis: 'unit_price_per_line',
    series: [
      { year_be: 2564, n: 4, median_unit_price_thb: 18000, p25: 17000, p75: 19500 },
      { year_be: 2565, n: 5, median_unit_price_thb: 19200, p25: 18000, p75: 20500 },
      { year_be: 2566, n: 6, median_unit_price_thb: 21000, p25: 19500, p75: 22500 },
    ],
  };

  it('unitLabel เป็น "บาท/หน่วย" และไม่มี caveat "ราคาต่อรายการงบ"', () => {
    const trend = buildPriceTrend(unitPriceSeries.key, unitPriceSeries);
    expect(trend.basis).toBe('unit_price_per_line');
    expect(trend.unitLabel).toBe('บาท/หน่วย');
    expect(trend.caveats).not.toContain('ราคาต่อรายการงบ ไม่ใช่ราคาต่อหน่วย');
    expect(trend.points).toEqual([
      { yearBe: 2564, n: 4, median: 18000, p25: 17000, p75: 19500 },
      { yearBe: 2565, n: 5, median: 19200, p25: 18000, p75: 20500 },
      { yearBe: 2566, n: 6, median: 21000, p25: 19500, p75: 22500 },
    ]);
    // มือคำนวณ: (21000 - 18000) / 18000 * 100 = 16.666... → ปัด 2 ตำแหน่ง = 16.67
    expect(trend.changePct).toEqual({ fromYear: 2564, toYear: 2566, pct: 16.67 });
  });

  it('เกิน 10 จุด → ตัดเหลือ 10 จุดล่าสุด (04 §D10)', () => {
    const manyPoints: TrendSeries = {
      key: 'สินค้าทดสอบจุดเยอะ',
      basis: 'amount_per_line',
      series: Array.from({ length: 14 }, (_, i) => ({
        year_be: 2555 + i,
        n: 5,
        median_amount_thb: 100_000 + i * 1000,
      })),
    };
    const trend = buildPriceTrend(manyPoints.key, manyPoints);
    expect(trend.points).toHaveLength(MAX_TREND_POINTS);
    expect(trend.points[0]?.yearBe).toBe(2559);
    expect(trend.points[trend.points.length - 1]?.yearBe).toBe(2568);
  });

  it('เรียงปีให้ถูกก่อนคำนวณแม้ input ไม่เรียง', () => {
    const unordered: TrendSeries = {
      key: 'ทดสอบไม่เรียง',
      basis: 'amount_per_line',
      series: [
        { year_be: 2566, n: 4, median_amount_thb: 200_000 },
        { year_be: 2564, n: 5, median_amount_thb: 100_000 },
        { year_be: 2565, n: 3, median_amount_thb: 150_000 },
      ],
    };
    const trend = buildPriceTrend(unordered.key, unordered);
    expect(trend.points.map((p) => p.yearBe)).toEqual([2564, 2565, 2566]);
    expect(trend.changePct).toEqual({ fromYear: 2564, toYear: 2566, pct: 100 });
  });
});

describe('getEconTrend (T-207) — econ indicator series', () => {
  it('คืน points/changePct/verified:false จาก series จริง (cpi_headline_index)', async () => {
    const trend = await getEconTrend('cpi_headline_index', createFixtureFetch());
    expect(trend).not.toBeNull();
    expect(trend?.verified).toBe(false);
    expect(trend?.label_th.length).toBeGreaterThan(0);
    // series จริงมี 11 จุด (2558–2568) แต่ ≤ 10 จุดล่าสุด (04 §D10) → ตัด 2558 ทิ้ง เหลือ 2559–2568
    expect(trend?.points).toHaveLength(MAX_TREND_POINTS);
    expect(trend?.points[0]).toEqual({ yearBe: 2559, value: 90.56 });
    // มือคำนวณ: (100.26 - 90.56) / 90.56 * 100 = 10.7128...% ปัด 2 ตำแหน่ง
    const expectedPct = Math.round(((100.26 - 90.56) / 90.56) * 100 * 100) / 100;
    expect(trend?.changePct).toEqual({ fromYear: 2559, toYear: 2568, pct: expectedPct });
  });

  it('ไม่มี series ของ indicator นี้เลย → คืน null ไม่ throw', async () => {
    const trend = await getEconTrend('cmi_asphalt_petroleum', createFixtureFetch());
    expect(trend).toBeNull();
  });

  it('indicator ไม่รู้จักเลย → คืน null ไม่ throw', async () => {
    const trend = await getEconTrend('not_a_real_indicator', createFixtureFetch());
    expect(trend).toBeNull();
  });
});
