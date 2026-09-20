/**
 * T-410 M5 (po-review ชุด B) — logic pure ล้วนของการแสดงผล `comparables[]` (ไม่มี React) แยกจาก
 * `sections/ComparablesSection.tsx` เพื่อทดสอบได้โดยไม่ต้อง render
 *
 * `shouldShowComparableUnitPrice` copy แนวคิดมาจาก `features/export/pdf/ProposalDocument.tsx`
 * (`shouldShowComparableUnitPrice`) โดยไม่ import จากโฟลเดอร์ `pdf/` ตรง ๆ (ขอบเขตงานห้ามแตะ/พึ่งพา
 * `features/export/pdf/**`) — `ComparableSchema` ไม่มี field แยกว่า `unit_price_thb` เป็น "ราคาต่อหน่วยจริง"
 * หรือ "ยอดรวมของบรรทัดงบ" (เมื่อ qty=1 ทั้งสองอย่างจะเท่ากันเสมอ) จึงใช้ heuristic เดียวกัน: ถ้า
 * `unit_price_thb` เท่ากับ `amount_thb` เป๊ะ ให้ถือว่าไม่มีข้อมูลราคาต่อหน่วยที่ต่างจากยอดรวมจริง ๆ
 */
import type { Comparable } from './types';

export function shouldShowComparableUnitPrice(comparable: Comparable): boolean {
  return (
    comparable.unit_price_thb !== undefined && comparable.unit_price_thb !== comparable.amount_thb
  );
}
