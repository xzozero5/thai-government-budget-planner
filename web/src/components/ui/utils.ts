/**
 * T-402 — ตัวช่วยภายในของ `components/ui/*` เท่านั้น (ไม่ export ผ่าน barrel `index.ts`)
 */

export type ClassValue = string | false | null | undefined;

/** รวม className แบบง่าย (ไม่มี dependency ภายนอก — ไม่มี clsx/tailwind-merge ใน package.json) */
export function cn(...values: ClassValue[]): string {
  return values.filter((v): v is string => Boolean(v)).join(' ');
}

/** class มาตรฐานของ focus ring ที่มองเห็นชัด (06 §6) ใช้กับทุก interactive element */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** transition มาตรฐานสำหรับ micro-interaction (06 §2) — เคารพ reduced-motion ผ่าน tokens.css (global) */
export const PRESS_TRANSITION = 'transition duration-fast ease-out active:scale-[0.98]';
