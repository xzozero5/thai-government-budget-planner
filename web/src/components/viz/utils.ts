/**
 * T-412 (viz) — ตัวช่วยภายในของ `components/viz/*` เท่านั้น (ไม่ export ผ่าน barrel `index.ts`)
 * แยกไว้ต่างหากจาก `components/ui/utils.ts` เพราะไฟล์นั้นเป็นของภายใน `components/ui/**` เอง
 * (ดูคอมเมนต์หัวไฟล์ `components/ui/utils.ts`) — คัดลอกของที่จำเป็นมาเพื่อไม่ต้อง deep-import ข้าม owner
 *
 * T-411: `usePrefersReducedMotion` ย้าย implementation ไปไว้ที่ `components/motion/` (จุดเดียวใช้ร่วมกันทั้ง
 * repo ตาม N7) — ที่นี่ re-export เฉย ๆ เพื่อไม่ต้องแก้ import เดิมของ `Sparkline`/`StatCard`
 */
export type ClassValue = string | false | null | undefined;

/** รวม className แบบง่าย (ไม่มี dependency ภายนอก — ไม่มี clsx/tailwind-merge ใน package.json) */
export function cx(...values: ClassValue[]): string {
  return values.filter((v): v is string => Boolean(v)).join(' ');
}

/** class มาตรฐานของ focus ring ที่มองเห็นชัด (06 §6) ใช้กับทุก interactive element */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export { usePrefersReducedMotion } from '@/components/motion/usePrefersReducedMotion';
