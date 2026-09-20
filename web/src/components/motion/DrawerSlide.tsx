/**
 * T-411 — motion.md #15/#17: drawer เปิด slide-in จากขวา (`translateX(24px→0)` + fade, 250ms ease-out) /
 * dialog เปิด `scale(0.98→1)` + fade (200ms ease-out)
 *
 * เป็น **drop-in replacement ของ `<div>`** (forward ref + HTML attributes ทั้งหมด) แทนที่จะเป็น wrapper
 * ที่เพิ่ม element ใหม่ห่อ children — เพราะแผงของ `Drawer`/`Dialog` ใช้ `position: absolute`/`fixed` วางตำแหน่ง
 * เอง ถ้าห่อด้วย wrapper div อีกชั้นที่มี `transform` (จาก framer-motion tween) จะทำให้ wrapper กลายเป็น
 * containing block ใหม่ของลูก แล้ววางตำแหน่งเพี้ยน (CSS: element ที่มี `transform !== none` เป็น containing
 * block ของ descendant ที่ position:absolute) — ทำให้ต้อง apply motion props ที่ตัว panel เอง
 *
 * **⚠ ไม่ได้ต่อเข้า `components/ui/Drawer.tsx`/`Dialog.tsx` จริง** (ทั้งสองไฟล์ใช้ CSS keyframe
 * `animate-drawer-in`/`animate-dialog-in` จาก `tailwind.config.ts` แทน) เพราะวัดจริงแล้ว `Drawer`/`Dialog`
 * ถูกใช้จาก route `/load` ซึ่ง**ไม่ได้ lazy-load** (ต่างจาก `/workspace`) — การ import `@/components/motion`
 * (barrel) จากไฟล์เหล่านั้นทำให้ `motion/react` หลุดเข้า entry chunk จริง (+16 kB gz วัดจาก `vite build`)
 * คอมโพเนนต์นี้จึงเก็บไว้เป็น building block ที่ทดสอบแล้วสำหรับ overlay ในอนาคตที่ยืนยันได้ว่าอยู่ใต้
 * `features/workspace/**` เท่านั้น (ต้อง `vite build` วัด entry gz ซ้ำทุกครั้งก่อนต่อเข้าจริง)
 *
 * ใช้ห่อ "แผงเนื้อหา" ของ overlay เฉพาะตอน**เปิด** เท่านั้น — ถ้า parent unmount แบบ synchronous ตอนปิด
 * (ไม่รอ exit animation) จะตรงกับ reduced-motion fallback ของตาราง ("ปิดซ่อนทันที") โดยอัตโนมัติ
 */
import { forwardRef } from 'react';
import { m } from 'motion/react';
import type { AriaAttributes, ReactElement, ReactNode } from 'react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export type DrawerSlideVariant = 'drawer' | 'dialog';

/**
 * รับเฉพาะ attribute ที่ `Drawer`/`Dialog` ใช้จริง (className/role/id/tabIndex/aria-*) แทนที่จะ extend
 * `HTMLAttributes<HTMLDivElement>` เต็ม — `motion/react` (`HTMLMotionProps`) กับ React DOM types ชนกันที่
 * `style` (`MotionStyle` เข้มกว่า) และ event handler บางตัว (`onDrag*` ถูก framer-motion ทับความหมายเป็น
 * gesture API คนละ signature กับ DOM drag event) ภายใต้ `exactOptionalPropertyTypes: true` — เลี่ยงปัญหา
 * ทั้งหมดด้วยการไม่ spread attribute ที่ไม่ได้ใช้จริง
 */
export interface DrawerSlideProps extends AriaAttributes {
  children: ReactNode;
  className?: string;
  role?: string;
  id?: string;
  tabIndex?: number;
  /** `drawer` = translateX จากขวา 24px (motion.md #15) · `dialog` = scale 0.98→1 (motion.md #17) */
  variant?: DrawerSlideVariant;
}

const VARIANT_MOTION: Record<
  DrawerSlideVariant,
  { initial: Record<string, number>; animate: Record<string, number>; durationS: number }
> = {
  drawer: { initial: { opacity: 0, x: 24 }, animate: { opacity: 1, x: 0 }, durationS: 0.25 },
  dialog: { initial: { opacity: 0, scale: 0.98 }, animate: { opacity: 1, scale: 1 }, durationS: 0.2 },
};

export const DrawerSlide = forwardRef<HTMLDivElement, DrawerSlideProps>(function DrawerSlide(
  { variant = 'drawer', children, ...rest },
  ref,
): ReactElement {
  const reducedMotion = usePrefersReducedMotion();

  if (reducedMotion) {
    // fallback ตาราง: "fade อย่างเดียว 0ms" — เท่ากับแสดงทันทีไม่มี transform ค้าง
    return (
      <div ref={ref} {...rest}>
        {children}
      </div>
    );
  }

  const { initial, animate, durationS } = VARIANT_MOTION[variant];
  return (
    <m.div
      ref={ref}
      initial={initial}
      animate={animate}
      transition={{ duration: durationS, ease: [0.2, 0.8, 0.2, 1] }}
      {...rest}
    >
      {children}
    </m.div>
  );
});
