/**
 * T-410 M6 (po-review ชุด B, US-1.2/US-3.1) — logic pure ของการแสดงผล `Totals` (05 §5) แยกจาก
 * `sections/TotalsSection.tsx` เพื่อทดสอบได้โดยไม่ต้อง render — ไม่มี React ในไฟล์นี้
 */
import type { Totals } from './types';

export interface ContingencyDisplay {
  /** เปอร์เซ็นต์ที่โมเดลระบุ (ถ้ามี) — `null` เมื่อ proposal ระบุมาเป็นจำนวนเงินตรง ๆ (`contingency_thb`)
   * โดยไม่มี `contingency_pct` */
  pct: number | null;
  /** จำนวนเงินค่าเผื่อเหลือเผื่อขาด — ใช้ `contingency_thb` ตรง ๆ ถ้ามี มิฉะนั้นคำนวณจาก
   * `subtotal_thb × contingency_pct / 100` */
  amountThb: number;
}

/** `null` เมื่อ proposal ไม่ได้ระบุค่าเผื่อเหลือเผื่อขาดเลย (ทั้ง `contingency_pct`/`contingency_thb`
 * เป็น `undefined` — schema กำหนดให้ optional ทั้งคู่) */
export function computeContingencyDisplay(totals: Totals): ContingencyDisplay | null {
  if (totals.contingency_pct === undefined && totals.contingency_thb === undefined) {
    return null;
  }
  const amountThb =
    totals.contingency_thb ?? (totals.subtotal_thb * (totals.contingency_pct ?? 0)) / 100;
  return { pct: totals.contingency_pct ?? null, amountThb };
}
