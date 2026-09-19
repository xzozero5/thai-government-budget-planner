/**
 * T-205 — inflation.ts: adjustForInflation (pure/deterministic)
 *
 * ตัวเลข expected คำนวณมือจากค่าจริงใน `web/tests/fixtures/data/econ/indicators.json`
 * (cpi_headline_index: 2558=90.39, 2567=100.4 — ปีฐาน 2566=100)
 */
import { describe, expect, it } from 'vitest';
import { createFixtureFetch } from '@/data/testFixtures';
import { getEconSeries } from '@/data/econ';
import type { EconIndicatorSeries } from '@/data/types';
import {
  adjustForInflation,
  EconDataMissingError,
  roundHalfUp,
  type AdjustForInflationInput,
} from '@/data/inflation';

const CPI_SERIES: EconIndicatorSeries = {
  indicator: 'cpi_headline_index',
  label_th: 'ดัชนีราคาผู้บริโภคทั่วไป',
  unit: 'index 2566=100 (TPSO CPI ทั่วไปของประเทศ, Type=TG)',
  points: [
    { year_be: 2558, value: 90.39 },
    { year_be: 2559, value: 90.56 },
    { year_be: 2566, value: 100 },
    { year_be: 2567, value: 100.4 },
    { year_be: 2568, value: 100.26 },
  ],
  source_name: 'กระทรวงพาณิชย์ (สนค., TPSO) — ดัชนีราคาผู้บริโภคทั่วไปของประเทศ',
  source_url: 'https://index.tpso.go.th/api/cpig/year',
  verified: false,
};

const CMI_CEMENT_SERIES: EconIndicatorSeries = {
  indicator: 'cmi_cement',
  label_th: 'ดัชนีราคาวัสดุก่อสร้าง หมวดซีเมนต์',
  unit: 'index 2558=100 (TPSO CMI หมวด: ซีเมนต์ (Cement))',
  points: [
    { year_be: 2559, value: 94.94 },
    { year_be: 2568, value: 103.19 },
  ],
  source_name: 'กระทรวงพาณิชย์ (สนค., TPSO) — ดัชนีราคาวัสดุก่อสร้างหมวด ซีเมนต์ (Cement)',
  source_url: 'https://index.tpso.go.th/api/cmi/year',
  verified: false,
};

function baseInput(overrides: Partial<AdjustForInflationInput> = {}): AdjustForInflationInput {
  return {
    amountThb: 1_000_000,
    fromYearBe: 2558,
    toYearBe: 2567,
    index: 'cpi_headline_index',
    series: CPI_SERIES,
    ...overrides,
  };
}

describe('roundHalfUp', () => {
  it('ปัดขึ้นเมื่อเศษพอดี .5 (ใช้ค่าที่ binary floating point แทนได้พอดี)', () => {
    expect(roundHalfUp(2.5, 0)).toBe(3);
    expect(roundHalfUp(1.25, 1)).toBe(1.3);
    expect(roundHalfUp(1.110741, 6)).toBe(1.110741);
  });

  it('รองรับค่าลบ (ปัดออกจากศูนย์)', () => {
    expect(roundHalfUp(-2.5, 0)).toBe(-3);
  });
});

describe('adjustForInflation (T-205) — กรณีปกติ', () => {
  it('คำนวณ factor/adjustedThb ถูกต้อง (cpi_headline_index 2558 → 2567)', () => {
    const result = adjustForInflation(baseInput());
    // มือคำนวณ: 100.4 / 90.39 = 1.110742... ปัด 6 ตำแหน่ง = 1.110742
    expect(result.factor).toBeCloseTo(1.110742, 6);
    // 1,000,000 * 1.110742 = 1,110,742 (ปัด half-up เป็น integer)
    expect(result.adjustedThb).toBe(1_110_742);
    expect(result.fromIndex).toBe(90.39);
    expect(result.toIndex).toBe(100.4);
    expect(result.indexUnit).toBe(CPI_SERIES.unit);
    expect(result.basis).toEqual({
      indicator: 'cpi_headline_index',
      source_name: CPI_SERIES.source_name,
      source_url: CPI_SERIES.source_url,
      verified: false,
    });
    expect(result.warnings).toEqual([]);
    expect(Number.isInteger(result.adjustedThb)).toBe(true);
  });

  it('indicator อื่น (cmi_cement) คำนวณถูกต้องเช่นกัน', () => {
    const result = adjustForInflation({
      amountThb: 500_000,
      fromYearBe: 2559,
      toYearBe: 2568,
      index: 'cmi_cement',
      series: CMI_CEMENT_SERIES,
    });
    // มือคำนวณ: 103.19 / 94.94 = 1.086896... ปัด 6 ตำแหน่ง = 1.086897 (half-up)
    expect(result.factor).toBeCloseTo(1.086897, 6);
    expect(result.adjustedThb).toBe(543_449);
  });

  it('fromYearBe === toYearBe → factor = 1, adjustedThb = amountThb เดิม', () => {
    const result = adjustForInflation(baseInput({ fromYearBe: 2566, toYearBe: 2566 }));
    expect(result.factor).toBe(1);
    expect(result.adjustedThb).toBe(1_000_000);
  });
});

describe('adjustForInflation — ปีที่ไม่มีค่า (N3: ห้ามเดา)', () => {
  it('fromYearBe ไม่มีข้อมูล → throw EconDataMissingError พร้อมปีที่ใกล้ที่สุด', () => {
    expect(() => adjustForInflation(baseInput({ fromYearBe: 2560 }))).toThrow(
      EconDataMissingError,
    );
    try {
      adjustForInflation(baseInput({ fromYearBe: 2560 }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EconDataMissingError);
      const e = err as EconDataMissingError;
      expect(e.indicator).toBe('cpi_headline_index');
      expect(e.requestedYearBe).toBe(2560);
      // จุดที่มีจริง: 2558, 2559, 2566, 2567, 2568 — ใกล้ 2560 ที่สุดคือ 2559 (ห่าง 1)
      expect(e.nearestAvailableYearBe).toBe(2559);
    }
  });

  it('toYearBe ไม่มีข้อมูลและไม่ได้ตั้ง allowLatestAvailable → throw EconDataMissingError', () => {
    expect(() => adjustForInflation(baseInput({ toYearBe: 2569 }))).toThrow(EconDataMissingError);
  });

  it('toYearBe ในอนาคต + allowLatestAvailable:true → ใช้ปีล่าสุดที่มีค่าแทน พร้อม warning', () => {
    const result = adjustForInflation(
      baseInput({ toYearBe: 2569, allowLatestAvailable: true }),
    );
    // ปีล่าสุดที่มีค่าจริงใน series คือ 2568 (100.26)
    expect(result.toIndex).toBe(100.26);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('2569');
    expect(result.warnings[0]).toContain('2568');
  });

  it('allowLatestAvailable ไม่มีผลกับ fromYearBe (ยังต้อง error เหมือนเดิม)', () => {
    expect(() =>
      adjustForInflation(baseInput({ fromYearBe: 2560, allowLatestAvailable: true })),
    ).toThrow(EconDataMissingError);
  });
});

describe('adjustForInflation — ความสอดคล้องของ series/index', () => {
  it('series.indicator ไม่ตรงกับ index ที่ระบุ → throw Error ชัดเจน', () => {
    expect(() =>
      adjustForInflation(
        baseInput({ index: 'construction_material_index', series: CPI_SERIES }),
      ),
    ).toThrow(/ไม่ตรงกับ index/);
  });
});

describe('adjustForInflation — integration กับ econ.ts (fixture จริง)', () => {
  it('ใช้ series จริงจาก getEconSeries() แล้วคำนวณตรงกับมือคำนวณ', async () => {
    const series = await getEconSeries('cpi_headline_index', createFixtureFetch());
    if (!series) {
      throw new Error('fixture ต้องมี series ของ cpi_headline_index');
    }
    const result = adjustForInflation({
      amountThb: 2_000_000,
      fromYearBe: 2558,
      toYearBe: 2568,
      index: 'cpi_headline_index',
      series,
    });
    // มือคำนวณ: 100.26 / 90.39 = 1.109171... ปัด 6 ตำแหน่ง
    const expectedFactor = Math.round((100.26 / 90.39) * 1e6) / 1e6;
    expect(result.factor).toBeCloseTo(expectedFactor, 6);
    expect(result.adjustedThb).toBe(Math.round(2_000_000 * expectedFactor));
    expect(result.basis.verified).toBe(false);
  });
});
