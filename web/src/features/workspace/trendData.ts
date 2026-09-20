/**
 * T-405 (ต่อสาย) — โหลด `PriceTrend`/`EconTrend` ผ่าน facade `@/data` (`data.getPriceTrend`) พร้อม
 * cache ต่อ key ใน memory (module scope) ระหว่าง session — ใช้ร่วมกันโดย `BoqTrendCell`/`ProposalStatCard`
 * (`vizRenderers.tsx`) เพื่อไม่ต้องยิงซ้ำเมื่อ trend_ref เดียวกันปรากฏหลายจุด (เช่น BOQ หลายบรรทัดอ้าง
 * item_key เดียวกัน)
 *
 * ห้าม import React ที่นี่ (แยก logic การโหลด/cache ออกจาก hook เพื่อทดสอบ pure ได้)
 *
 * T-504 (US-8.3) — `toExportTrendData` แปลง `TrendResult` (รูปแบบเดียวกับที่ `useTrendResult`/
 * `BoqTrendCell` ใช้อยู่แล้ว) เป็นรูปร่างที่ prop `loadTrend` ของ `ExportDialog` ต้องการ (`@/features/export`)
 * — container (`slots.tsx`) ประกอบ `loadTrend` จาก `loadTrend()` (โหลด+cache เดิมของไฟล์นี้) ต่อด้วย
 * ฟังก์ชันนี้ แทนที่จะเขียน loader ซ้ำอีกชุด (ตามที่ BACKLOG T-504 กำชับ)
 */
import type { ExportTrendData, ExportTrendPoint } from '@/features/export';
import { data, type EconTrend, type GetPriceTrendRef, type PriceTrend } from '@/data';

export type TrendResult = PriceTrend | EconTrend;

const trendCache = new Map<string, Promise<TrendResult | null>>();

function cacheKey(ref: GetPriceTrendRef): string {
  return `${ref.kind}:${ref.key}`;
}

/** โหลด trend ของ ref หนึ่งตัว — cache ตาม `(kind,key)`; โหลดพลาด (throw) จะไม่ถูก cache (ลองใหม่ได้) */
export function loadTrend(ref: GetPriceTrendRef): Promise<TrendResult | null> {
  const key = cacheKey(ref);
  let cached = trendCache.get(key);
  if (!cached) {
    cached = data.getPriceTrend(ref).catch((err: unknown) => {
      trendCache.delete(key);
      throw err;
    });
    trendCache.set(key, cached);
  }
  return cached;
}

/** ล้าง cache ทั้งหมด (ใช้ใน test เท่านั้น) */
export function resetTrendCacheForTests(): void {
  trendCache.clear();
}

/** แยกแยะ `PriceTrend` (มี `unitLabel`) จาก `EconTrend` (มี `label_th`) — ไม่มี discriminant field ตรง ๆ
 * ในทั้งสอง type จึงตรวจจาก field ที่มีเฉพาะฝั่งใดฝั่งหนึ่งเท่านั้น */
export function isPriceTrend(result: TrendResult): result is PriceTrend {
  return 'unitLabel' in result;
}

/**
 * T-504 (US-8.3) — แปลง `TrendResult` ที่โหลดแล้ว (`loadTrend` ด้านบน) เป็นรูปร่างที่ prop `loadTrend`
 * ของ `ExportDialog` ต้องการ — ตัวเดียวที่ใช้ทั้ง `BoqTrendCell`/`ProposalStatCard` (บนหน้าเว็บ) และ
 * `ExportDialog` (ตอนส่งออก PDF) เพื่อไม่ให้ตรรกะแปลง `PriceTrend`/`EconTrend` แยกกันสองชุด
 *
 * `PriceTrend.key` และ `EconTrend.label_th` เป็นข้อความภาษาไทยที่อ่านได้อยู่แล้ว (catalog key/ป้ายตัวชี้วัด
 * มาจาก pipeline — ดู `docs/03-DATA-PIPELINE.md` §3.4) ใช้เป็น `title` ตรง ๆ ได้โดยไม่ต้อง query ชื่อ
 * เพิ่ม (BOQ item name เต็มไม่มีติดมากับ `TrendRef`/`TrendResult` — ยอมรับข้อจำกัดนี้ รายงานท้าย task)
 */
export function toExportTrendData(result: TrendResult): ExportTrendData {
  if (isPriceTrend(result)) {
    const points: ExportTrendPoint[] = result.points.map((p) => ({
      yearBe: p.yearBe,
      median: p.median,
      n: p.n,
      ...(p.p25 !== undefined ? { p25: p.p25 } : {}),
      ...(p.p75 !== undefined ? { p75: p.p75 } : {}),
    }));
    return {
      title: result.key,
      basis: result.basis === 'unit_price_per_line' ? 'unit_price' : 'amount_per_line',
      points,
    };
  }
  const points: ExportTrendPoint[] = result.points.map((p) => ({ yearBe: p.yearBe, median: p.value }));
  return { title: result.label_th, basis: 'econ', points };
}
