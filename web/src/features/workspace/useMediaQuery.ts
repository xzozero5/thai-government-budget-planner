import { useEffect, useState } from 'react';

/**
 * T-405 — breakpoint detection แบบ JS (ใช้ตัดสิน desktop 2-pane vs มือถือ tabs — 06 §3)
 *
 * `fallback` ใช้เมื่อ `window.matchMedia` ไม่มีอยู่ (เช่น jsdom เริ่มต้นไม่ implement ให้) เพื่อไม่ให้ throw
 * ในเทสต์ที่ไม่ได้ mock ไว้ — ค่าเริ่มต้น `true` (desktop) ตาม "Desktop-first" ของ 06 §1
 */
export function useMediaQuery(query: string, fallback = true): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [matches, setMatches] = useState<boolean>(() => (supported ? window.matchMedia(query).matches : fallback));

  useEffect(() => {
    if (!supported) {
      return;
    }
    const mql = window.matchMedia(query);
    const handleChange = (): void => {
      setMatches(mql.matches);
    };
    handleChange();
    mql.addEventListener('change', handleChange);
    return () => {
      mql.removeEventListener('change', handleChange);
    };
  }, [query, supported]);

  return matches;
}
