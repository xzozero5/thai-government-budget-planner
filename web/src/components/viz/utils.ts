/**
 * T-412 (viz) — ตัวช่วยภายในของ `components/viz/*` เท่านั้น (ไม่ export ผ่าน barrel `index.ts`)
 * แยกไว้ต่างหากจาก `components/ui/utils.ts` เพราะไฟล์นั้นเป็นของภายใน `components/ui/**` เอง
 * (ดูคอมเมนต์หัวไฟล์ `components/ui/utils.ts`) — คัดลอกของที่จำเป็นมาเพื่อไม่ต้อง deep-import ข้าม owner
 */
import { useEffect, useState } from 'react';

export type ClassValue = string | false | null | undefined;

/** รวม className แบบง่าย (ไม่มี dependency ภายนอก — ไม่มี clsx/tailwind-merge ใน package.json) */
export function cx(...values: ClassValue[]): string {
  return values.filter((v): v is string => Boolean(v)).join(' ');
}

/** class มาตรฐานของ focus ring ที่มองเห็นชัด (06 §6) ใช้กับทุก interactive element */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

function getReducedMotionMedia(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)');
  } catch {
    // jsdom ที่ไม่ได้ mock matchMedia อาจ throw — ถือว่า "ไม่ลด motion" (ค่าเริ่มต้นปลอดภัยสุดสำหรับ preview)
    return null;
  }
}

/**
 * `prefers-reduced-motion: reduce` อ่านผ่าน JS (เพิ่มจาก global CSS override ใน `tokens.css`)
 * ใช้กับ animation ที่ "ต้องเปลี่ยนวิธีสื่อสาร" ไม่ใช่แค่ปิด transition (motion.md กฎข้อ 1)
 * ทดสอบได้ด้วยการ stub `window.matchMedia` ก่อน render (jsdom ไม่ implement ให้โดย default)
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => getReducedMotionMedia()?.matches ?? false);

  useEffect(() => {
    const mql = getReducedMotionMedia();
    if (!mql) {
      return;
    }
    const handleChange = (event: MediaQueryListEvent): void => {
      setReduced(event.matches);
    };
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handleChange);
      return () => {
        mql.removeEventListener('change', handleChange);
      };
    }
    return undefined;
  }, []);

  return reduced;
}
