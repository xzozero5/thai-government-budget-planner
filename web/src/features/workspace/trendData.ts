/**
 * T-405 (ต่อสาย) — โหลด `PriceTrend`/`EconTrend` ผ่าน facade `@/data` (`data.getPriceTrend`) พร้อม
 * cache ต่อ key ใน memory (module scope) ระหว่าง session — ใช้ร่วมกันโดย `BoqTrendCell`/`ProposalStatCard`
 * (`vizRenderers.tsx`) เพื่อไม่ต้องยิงซ้ำเมื่อ trend_ref เดียวกันปรากฏหลายจุด (เช่น BOQ หลายบรรทัดอ้าง
 * item_key เดียวกัน)
 *
 * ห้าม import React ที่นี่ (แยก logic การโหลด/cache ออกจาก hook เพื่อทดสอบ pure ได้)
 */
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
