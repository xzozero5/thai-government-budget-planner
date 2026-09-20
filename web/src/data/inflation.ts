/**
 * T-205 — `adjustForInflation`: ปรับมูลค่าเงินข้ามปีด้วยดัชนีเศรษฐกิจ
 *
 * **Pure/deterministic**: ไม่ fetch เอง — รับ `series` (ผลจาก `getEconSeries()` ใน `econ.ts`) เข้ามา
 * เป็นพารามิเตอร์ตรง ๆ (ตาม docs/BACKLOG.md T-205) เพื่อให้ทดสอบได้โดยไม่ต้อง mock network และเรียก
 * ซ้ำได้โดยไม่มี side effect
 *
 * ห้าม import React (module boundary — docs/04-ARCHITECTURE.md §3)
 *
 * กติกา (จาก task brief):
 * - ต้องใช้จุดที่ unit/ปีฐานเดียวกันทั้งสองปี — รับประกันโดยดีไซน์: `series` เป็น
 *   `EconIndicatorSeries` เดียว (unit เดียวทั้ง series ตาม docs/econ-sources.md) และมีการตรวจซ้ำว่า
 *   `series.indicator === index` ที่ระบุ ก่อนคำนวณ
 * - ปีที่ไม่มีค่า → throw `EconDataMissingError` (ห้ามเดา) พร้อมปีที่ใกล้ที่สุดที่มีค่า
 * - ปีปลายทาง (toYearBe) ที่ยังไม่มีค่า (เช่น 2569/2570 ที่ยังไม่ประกาศ) → ใช้ปีล่าสุดที่มีค่าได้
 *   **เฉพาะเมื่อ** `allowLatestAvailable: true` พร้อมใส่ warning — กติกานี้ใช้กับ `toYearBe` เท่านั้น
 *   (ปีต้นทาง `fromYearBe` ต้องมีค่าจริงเสมอ ไม่มี fallback)
 * - ปัดเศษ: `factor` ปัด 6 ตำแหน่ง, `adjustedThb` ปัดแบบ half-up เป็นบาท integer
 */
import type { EconIndicatorSeries } from './types';

// ---------------------------------------------------------------------------
// Index keys ที่ใช้ปรับเงินเฟ้อได้ (docs/03-DATA-PIPELINE.md §3.5 + docs/econ-sources.md)
// ---------------------------------------------------------------------------

/** หมวดดัชนีราคาวัสดุก่อสร้างรายหมวดของ สนค. (รวม 3 หมวดที่เป็น null เสมอ — ดู docs/econ-sources.md) */
export const CMI_INDEX_KEYS = [
  'cmi_steel',
  'cmi_cement',
  'cmi_concrete',
  'cmi_wood',
  'cmi_tiles',
  'cmi_paint',
  'cmi_sanitary',
  'cmi_electrical_plumbing',
  'cmi_other',
  'cmi_electrical',
  'cmi_plumbing',
  'cmi_asphalt_petroleum',
] as const;
export type CmiIndexKey = (typeof CMI_INDEX_KEYS)[number];

export type InflationIndexKey = 'cpi_headline_index' | 'construction_material_index' | CmiIndexKey;

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface AdjustForInflationInput {
  amountThb: number;
  fromYearBe: number;
  toYearBe: number;
  index: InflationIndexKey;
  /** series ของ `index` เดียวกัน — โหลดด้วย `getEconSeries(index)` จาก `econ.ts` ก่อนเรียกฟังก์ชันนี้ */
  series: EconIndicatorSeries;
  /**
   * อนุญาตให้ใช้ปีล่าสุดที่มีค่าแทน `toYearBe` เมื่อปีนั้นยังไม่มีข้อมูล (เช่นปีงบที่ยังไม่ประกาศ) —
   * ค่าเริ่มต้น false (ต้อง error ถ้าไม่ระบุ)
   */
  allowLatestAvailable?: boolean;
}

export interface AdjustForInflationBasis {
  indicator: string;
  source_name: string;
  source_url: string;
  /** ตาม docs/econ-sources.md: econ series ทุกตัวยัง verified:false เสมอ ณ วันนี้ */
  verified: false;
}

export interface AdjustForInflationResult {
  /** มูลค่าที่ปรับแล้ว (บาท, integer, ปัดแบบ half-up) */
  adjustedThb: number;
  /** อัตราส่วนดัชนีปลายทาง/ต้นทาง ปัด 6 ตำแหน่ง */
  factor: number;
  /** ค่าดัชนีปีต้นทางที่ใช้จริง */
  fromIndex: number;
  /** ค่าดัชนีปีปลายทางที่ใช้จริง (อาจเป็นปีล่าสุดที่มีค่า ถ้า allowLatestAvailable) */
  toIndex: number;
  /** ปีของค่าดัชนีปลายทางที่ใช้จริง (= `toYearBe` เว้นแต่ตกไปใช้ปีล่าสุดที่มีค่าตาม allowLatestAvailable) */
  toYearBeUsed: number;
  indexUnit: string;
  basis: AdjustForInflationBasis;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// EconDataMissingError — ปีที่ไม่มีค่า (ห้ามเดา/ห้าม interpolate ตาม N3)
// ---------------------------------------------------------------------------

export class EconDataMissingError extends Error {
  readonly indicator: string;
  readonly requestedYearBe: number;
  readonly nearestAvailableYearBe: number | null;

  constructor(indicator: string, requestedYearBe: number, nearestAvailableYearBe: number | null) {
    super(
      nearestAvailableYearBe === null
        ? `ไม่มีข้อมูลตัวชี้วัด "${indicator}" ในปีใดเลย`
        : `ไม่มีข้อมูลตัวชี้วัด "${indicator}" สำหรับปี พ.ศ. ${String(requestedYearBe)} ` +
          `(ปีที่ใกล้ที่สุดที่มีข้อมูล: พ.ศ. ${String(nearestAvailableYearBe)})`,
    );
    this.name = 'EconDataMissingError';
    this.indicator = indicator;
    this.requestedYearBe = requestedYearBe;
    this.nearestAvailableYearBe = nearestAvailableYearBe;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * ปัดเศษแบบ half-up (ปัดออกจากศูนย์เมื่อเลขทศนิยมคือ .5 พอดี) — ต่างจาก `Math.round` ตรงที่ทำงาน
 * ถูกต้องสำหรับค่าลบด้วย (ที่นี่ใช้กับจำนวนบวกเสมอ แต่กันไว้ให้ถูกต้องทั่วไป)
 */
export function roundHalfUp(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return (Math.sign(value) || 1) * Math.round(Math.abs(value) * factor) / factor;
}

function findPoint(
  series: EconIndicatorSeries,
  yearBe: number,
): { year_be: number; value: number } | null {
  return series.points.find((p) => p.year_be === yearBe) ?? null;
}

function nearestAvailableYear(series: EconIndicatorSeries, yearBe: number): number | null {
  const [firstPoint, ...restPoints] = series.points;
  if (!firstPoint) {
    return null;
  }
  let best = firstPoint;
  let bestDiff = Math.abs(best.year_be - yearBe);
  for (const p of restPoints) {
    const diff = Math.abs(p.year_be - yearBe);
    if (diff < bestDiff) {
      best = p;
      bestDiff = diff;
    }
  }
  return best.year_be;
}

function latestPoint(series: EconIndicatorSeries): { year_be: number; value: number } | null {
  if (series.points.length === 0) {
    return null;
  }
  return series.points.reduce((a, b) => (b.year_be > a.year_be ? b : a));
}

// ---------------------------------------------------------------------------
// adjustForInflation
// ---------------------------------------------------------------------------

export function adjustForInflation(input: AdjustForInflationInput): AdjustForInflationResult {
  const { amountThb, fromYearBe, toYearBe, index, series, allowLatestAvailable } = input;

  if (series.indicator !== index) {
    throw new Error(
      `series ที่ส่งมาไม่ตรงกับ index ที่ระบุ: series.indicator="${series.indicator}" แต่ index="${index}"`,
    );
  }

  const warnings: string[] = [];

  const fromPoint = findPoint(series, fromYearBe);
  if (!fromPoint) {
    throw new EconDataMissingError(index, fromYearBe, nearestAvailableYear(series, fromYearBe));
  }

  let toPoint = findPoint(series, toYearBe);
  if (!toPoint) {
    if (allowLatestAvailable === true) {
      const latest = latestPoint(series);
      if (!latest) {
        throw new EconDataMissingError(index, toYearBe, null);
      }
      toPoint = latest;
      warnings.push(
        `ไม่มีข้อมูลตัวชี้วัด "${index}" สำหรับปี พ.ศ. ${String(toYearBe)} — ใช้ปีล่าสุดที่มีข้อมูลแทน ` +
          `(พ.ศ. ${String(toPoint.year_be)})`,
      );
    } else {
      throw new EconDataMissingError(index, toYearBe, nearestAvailableYear(series, toYearBe));
    }
  }

  const factor = roundHalfUp(toPoint.value / fromPoint.value, 6);
  const adjustedThb = roundHalfUp(amountThb * factor, 0);

  return {
    adjustedThb,
    factor,
    fromIndex: fromPoint.value,
    toIndex: toPoint.value,
    toYearBeUsed: toPoint.year_be,
    indexUnit: series.unit,
    basis: {
      indicator: series.indicator,
      source_name: series.source_name,
      source_url: series.source_url,
      verified: false,
    },
    warnings,
  };
}
