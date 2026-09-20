/**
 * T-411 — barrel export ของ `components/motion/*`
 *
 * **ห้าม import จาก `index.ts` นี้ (หรือไฟล์ย่อยที่ import `motion/react`) ใน `features/keygate/**`/
 * `features/about/**`/`app/**` แบบ static** — ใช้เฉพาะใต้ `features/workspace/**` เท่านั้น เพื่อกัน
 * `motion/react` หลุดเข้า entry chunk (ดูคอมเมนต์ `MotionProvider.tsx`)
 */

export { usePrefersReducedMotion } from './usePrefersReducedMotion';
export { useCountUp, DEFAULT_MAX_COUNT_UP_MS } from './useCountUp';
export { FadeSlideIn } from './FadeSlideIn';
export type { FadeSlideInProps } from './FadeSlideIn';
export { Collapse } from './Collapse';
export type { CollapseProps } from './Collapse';
export { DrawerSlide } from './DrawerSlide';
export type { DrawerSlideProps, DrawerSlideVariant } from './DrawerSlide';
export { MotionProvider } from './MotionProvider';
