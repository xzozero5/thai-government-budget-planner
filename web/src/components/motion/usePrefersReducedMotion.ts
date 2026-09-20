/**
 * T-411 — hook เดียวที่อ่าน `prefers-reduced-motion: reduce` ผ่าน JS ให้ทั้ง `components/motion/*`,
 * `components/viz/*` และ `features/**` ใช้ร่วมกัน (N7: ห้ามทำซ้ำ — ของเดิมอยู่ใน `components/viz/utils.ts`
 * ย้าย implementation มาไว้ที่นี่เป็นจุดเดียว แล้วให้ `viz/utils.ts` re-export เพื่อไม่ต้องแก้ import เดิม)
 *
 * `tokens.css` บังคับ `prefers-reduced-motion: reduce` ระดับ global (`animation-duration: 0.01ms`) อยู่แล้ว
 * แต่ effect บางอย่างต้อง "เปลี่ยนวิธีสื่อสาร" ไม่ใช่แค่ปิด transition (motion.md กฎข้อ 1) — hook นี้ใช้กับ
 * effect เหล่านั้นเท่านั้น
 */
import { useEffect, useState } from 'react';

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

/** อ่าน `prefers-reduced-motion: reduce` แบบ reactive (ติดตาม media query change ด้วย) */
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
