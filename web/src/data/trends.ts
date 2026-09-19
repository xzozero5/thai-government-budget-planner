/**
 * T-207 — Trend charts: `catalog/trends/{hh}.json.gz` (ราคาต่อรายการ/หน่วยของ catalog item) และ
 * econ series (ตัวชี้วัดเศรษฐกิจ) แปลงเป็นรูปแบบเดียวกันสำหรับ sparkline/line chart
 * (docs/04-ARCHITECTURE.md §D10, docs/05-FEATURES.md F8)
 *
 * ห้าม import React (module boundary — docs/04-ARCHITECTURE.md §3)
 * ห้าม fetch ข้าม origin (N5) — โหลดผ่าน `loadJsonGz`/`dataUrl` ของ `manifest.ts` เท่านั้น
 */
import { getEconSeries } from './econ';
import { roundHalfUp } from './inflation';
import { loadJsonGz } from './manifest';
import { type TrendBasis, type TrendSeries, TrendShardSchema, type TrendShard } from './types';

/** ≤ 10 จุดล่าสุด (04 §D10) */
export const MAX_TREND_POINTS = 10;

/** คืน [จุดแรก, จุดสุดท้าย] ของ array ที่มี ≥ 2 สมาชิก มิฉะนั้น `null` (เลี่ยง non-null assertion) */
function firstAndLast<T>(arr: T[]): [T, T] | null {
  const first = arr[0];
  const last = arr[arr.length - 1];
  if (arr.length < 2 || first === undefined || last === undefined) {
    return null;
  }
  return [first, last];
}

// ---------------------------------------------------------------------------
// catalog/trends/{hh}.json.gz — cache ต่อ shard
// ---------------------------------------------------------------------------

const trendShardCache = new Map<string, Promise<TrendShard>>();

/** ล้าง cache ของ trend shard ทั้งหมด (ไว้ใช้ใน test เท่านั้น) */
export function resetTrendShardCache(): void {
  trendShardCache.clear();
}

function loadTrendShard(hh: string, fetchImpl: typeof fetch): Promise<TrendShard> {
  let cached = trendShardCache.get(hh);
  if (!cached) {
    cached = loadJsonGz(`catalog/trends/${hh}.json.gz`, TrendShardSchema, fetchImpl).catch(
      (err: unknown) => {
        // อย่า cache promise ที่ fail — เรียกซ้ำครั้งถัดไปได้
        trendShardCache.delete(hh);
        throw err;
      },
    );
    trendShardCache.set(hh, cached);
  }
  return cached;
}

// ---------------------------------------------------------------------------
// PriceTrend — catalog item (basis: amount_per_line | unit_price_per_line)
// ---------------------------------------------------------------------------

export interface PriceTrendPoint {
  yearBe: number;
  n: number;
  median: number;
  p25?: number;
  p75?: number;
  note?: string;
}

export type PriceTrendUnitLabel = 'บาท/หน่วย' | 'บาท/รายการ';

export interface TrendChangePct {
  fromYear: number;
  toYear: number;
  pct: number;
}

export interface PriceTrend {
  key: string;
  basis: TrendBasis;
  unitLabel: PriceTrendUnitLabel;
  points: PriceTrendPoint[];
  changePct: TrendChangePct | null;
  caveats: string[];
}

const MIN_N_FOR_CHANGE_PCT = 3;

/** สร้าง point ตาม basis ของ series (ไม่ใช้ exactOptionalPropertyTypes ผิดพลาด — ใส่ key เมื่อมีค่าเท่านั้น) */
function toPriceTrendPoint(
  point: TrendSeries['series'][number],
  basis: TrendBasis,
): PriceTrendPoint {
  const median =
    basis === 'amount_per_line' ? point.median_amount_thb : point.median_unit_price_thb;
  // ยืนยันโดย TrendSeriesSchema.refine ใน types.ts แล้วว่าจุดทุกจุดต้องมี median ที่ตรงกับ basis
  if (median === undefined) {
    throw new Error(`จุดปี พ.ศ. ${String(point.year_be)} ไม่มีค่า median ที่ตรงกับ basis "${basis}"`);
  }
  return {
    yearBe: point.year_be,
    n: point.n,
    median,
    ...(point.p25 !== undefined ? { p25: point.p25 } : {}),
    ...(point.p75 !== undefined ? { p75: point.p75 } : {}),
    ...(point.note !== undefined ? { note: point.note } : {}),
  };
}

/**
 * แปลง `TrendSeries` (รูปแบบไฟล์ดิบ) → `PriceTrend` (รูปแบบสำหรับ UI) — pure function แยกจาก
 * การโหลดไฟล์ เพื่อทดสอบด้วย series ปลอมได้โดยไม่ต้อง mock fetch (เช่น `unit_price_per_line`
 * ที่ยังไม่มีใน fixture จริง)
 */
export function buildPriceTrend(key: string, series: TrendSeries): PriceTrend {
  const sorted = [...series.series].sort((a, b) => a.year_be - b.year_be);
  const limited = sorted.slice(-MAX_TREND_POINTS);
  const points = limited.map((p) => toPriceTrendPoint(p, series.basis));

  const caveats: string[] = [];
  if (series.basis === 'amount_per_line') {
    caveats.push('ราคาต่อรายการงบ ไม่ใช่ราคาต่อหน่วย');
  }
  if (points.some((p) => p.note === 'source_incomplete')) {
    caveats.push('ข้อมูลปี 2562 ไม่ครบ (ADR-004)');
  }

  const eligible = points.filter((p) => p.n >= MIN_N_FOR_CHANGE_PCT);
  const eligibleEnds = firstAndLast(eligible);
  let changePct: TrendChangePct | null = null;
  if (eligibleEnds) {
    const [first, last] = eligibleEnds;
    if (first.median !== 0) {
      changePct = {
        fromYear: first.yearBe,
        toYear: last.yearBe,
        pct: roundHalfUp(((last.median - first.median) / first.median) * 100, 2),
      };
    }
  }
  if (!changePct) {
    caveats.push('ตัวอย่างน้อย');
  }

  return {
    key,
    basis: series.basis,
    unitLabel: series.basis === 'amount_per_line' ? 'บาท/รายการ' : 'บาท/หน่วย',
    points,
    changePct,
    caveats,
  };
}

export interface PriceTrendItemInput {
  key: string;
  /** ชื่อ shard ใน `catalog/trends/{hh}.json.gz` — ไม่มี = item นี้ไม่มี trend (ข้อมูล < 3 ปี) */
  trend?: string;
}

/**
 * โหลด trend ของ catalog item หนึ่งตัว — คืน `null` เมื่อ item ไม่มี trend เลย (ไม่ throw ตาม spec);
 * ถ้าโหลด shard ไม่สำเร็จ (เครือข่าย/schema) จะ throw ต่อ (ไม่ใช่กรณี "ไม่มี trend")
 */
export async function getPriceTrend(
  item: PriceTrendItemInput,
  fetchImpl: typeof fetch = fetch,
): Promise<PriceTrend | null> {
  if (item.trend === undefined) {
    return null;
  }
  const shard = await loadTrendShard(item.trend, fetchImpl);
  const series = shard[item.key];
  if (!series) {
    return null;
  }
  return buildPriceTrend(item.key, series);
}

// ---------------------------------------------------------------------------
// EconTrend — ตัวชี้วัดเศรษฐกิจ (econ/indicators.json series)
// ---------------------------------------------------------------------------

export interface EconTrendPoint {
  yearBe: number;
  value: number;
}

export interface EconTrend {
  indicator: string;
  label_th: string;
  unit: string;
  points: EconTrendPoint[];
  source_name: string;
  source_url: string;
  /** ตาม docs/econ-sources.md: econ series ทุกตัวยัง verified:false เสมอ ณ วันนี้ */
  verified: false;
  changePct: TrendChangePct | null;
  caveats: string[];
}

/**
 * โหลด trend ของตัวชี้วัดเศรษฐกิจหนึ่งตัว — คืน `null` เมื่อไม่มี series (ไม่ throw ตาม spec)
 */
export async function getEconTrend(
  indicator: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EconTrend | null> {
  const series = await getEconSeries(indicator, fetchImpl);
  if (!series) {
    return null;
  }
  const sorted = [...series.points].sort((a, b) => a.year_be - b.year_be);
  const limited = sorted.slice(-MAX_TREND_POINTS);
  if (limited.length === 0) {
    return null;
  }
  const points: EconTrendPoint[] = limited.map((p) => ({ yearBe: p.year_be, value: p.value }));

  const caveats: string[] = [];
  const pointEnds = firstAndLast(points);
  let changePct: TrendChangePct | null = null;
  if (pointEnds) {
    const [first, last] = pointEnds;
    if (first.value !== 0) {
      changePct = {
        fromYear: first.yearBe,
        toYear: last.yearBe,
        pct: roundHalfUp(((last.value - first.value) / first.value) * 100, 2),
      };
    }
  }
  if (!changePct) {
    caveats.push('ตัวอย่างน้อย');
  }

  return {
    indicator: series.indicator,
    label_th: series.label_th,
    unit: series.unit,
    points,
    source_name: series.source_name,
    source_url: series.source_url,
    verified: false,
    changePct,
    caveats,
  };
}
