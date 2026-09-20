/**
 * T-411 — โหลด feature set ของ `motion/react` (`domAnimation`, เบากว่า `domMax`) ครั้งเดียวผ่าน
 * `LazyMotion` แล้วให้ `m.*` ทั้งต้นไม้ข้างใต้ใช้ร่วมกัน (motion.md กฎข้อ 4)
 *
 * **ห้าม import ไฟล์นี้ (หรือไฟล์อื่นใน `components/motion/*` ที่ import `motion/react`) จาก
 * `features/keygate/**`/`features/about/**`** — ต้องครอบเฉพาะใต้ `features/workspace/**` เท่านั้น
 * เพราะ `WorkspaceRoute` เป็น lazy chunk (`lazy(() => import('@/features/workspace'))`) อยู่แล้ว การ
 * import `motion/react` เฉพาะจากที่นี่ทำให้ไลบรารีนี้ไม่เข้า entry chunk (CLAUDE.md §3: initial load < 3 MB gz)
 */
import { LazyMotion, domAnimation } from 'motion/react';
import type { ReactElement, ReactNode } from 'react';

export function MotionProvider({ children }: { children: ReactNode }): ReactElement {
  return (
    <LazyMotion features={domAnimation} strict>
      {children}
    </LazyMotion>
  );
}
