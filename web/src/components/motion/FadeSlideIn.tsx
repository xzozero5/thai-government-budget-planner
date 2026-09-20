/**
 * T-411 — motion.md #6: ข้อความแชทใหม่ fade+slide-up (200ms ease-out) ตอน mount ครั้งแรกเท่านั้น
 * (React ไม่ replay `initial`→`animate` ถ้า component ไม่ unmount/remount ใหม่ — ใช้ `key` ที่คงที่ต่อ
 * ข้อความหนึ่งรายการ เช่น `message.id` เพื่อไม่ให้ทุก token ที่สตรีมเข้ามาทำให้ fade ซ้ำ)
 *
 * reduced-motion: render children ตรง ๆ ไม่มี wrapper ที่ set opacity เริ่มต้นเป็น 0 เลย (กัน edge case ที่
 * environment ไม่รัน animation loop เลยแล้วเนื้อหาค้างที่ opacity 0)
 *
 * ต้องอยู่ใต้ `MotionProvider`/`LazyMotion` (เฉพาะใน `features/workspace/**`) — ถ้าไม่มี ancestor นี้ `m.div`
 * จะ render เป็น element เปล่า ๆ ไม่มี animation features (ไม่ throw, ไม่ใช่ error — ดู motion docs) แต่
 * เนื้อหายังคงอยู่ใน DOM เสมอไม่ว่ากรณีใด
 */
import { m } from 'motion/react';
import type { ReactElement, ReactNode } from 'react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export interface FadeSlideInProps {
  children: ReactNode;
  className?: string;
}

const TRANSITION = { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] as const };

export function FadeSlideIn({ children, className }: FadeSlideInProps): ReactElement {
  const reducedMotion = usePrefersReducedMotion();

  if (reducedMotion) {
    // fallback ตาราง motion.md #6: "fade อย่างเดียว 0ms (แสดงทันที)" — เท่ากับไม่มี transform/opacity
    // เริ่มต้นที่ซ่อนเนื้อหาเลย
    return <div className={className}>{children}</div>;
  }

  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={TRANSITION}
    >
      {children}
    </m.div>
  );
}
