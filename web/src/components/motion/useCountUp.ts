/**
 * T-411 — hook ยอดรวม count-up ใช้ร่วมกัน (motion.md #10: rAF, tabular-nums, ease-out เบา ๆ, ปิดเมื่อ
 * reduced-motion — ค่าปลายทางต้องอยู่ใน DOM เสมอ ไม่ใช่แค่ตอน animation จบ เพื่อไม่ให้ screen reader อ่าน
 * ค่ากลางอนิเมชัน ผู้เรียก (`StatCard` ฯลฯ) รับผิดชอบ render ค่าสุดท้ายลง `aria-live` เอง)
 *
 * ย้ายมาจาก `components/viz/StatCard.tsx` (T-412) ให้เป็นจุดเดียว (N7) — พฤติกรรมเดิมทุกประการ:
 * ไม่ animate ตอน mount ครั้งแรก, ข้ามอนิเมชันทันทีเมื่อ reduced-motion หรือค่าไม่เปลี่ยน
 */
import { useEffect, useRef, useState } from 'react';

/** เพดานระยะเวลา animation (ms) — ตาราง motion.md #10 ระบุ 250ms แต่ของเดิม (T-412) ผ่อนเป็น 600ms
 * สำหรับตัวเลขที่เปลี่ยนเยอะ (เช่น ยอดรวม BOQ หลายสิบล้านบาท) เพื่อไม่ให้ตัวเลขวิ่งเร็วจนอ่านไม่ทัน */
export const DEFAULT_MAX_COUNT_UP_MS = 600;

/** rAF count-up จากค่าที่แสดงอยู่ก่อนหน้า → `target` ใหม่ */
export function useCountUp(
  target: number,
  durationMs: number,
  reducedMotion: boolean,
  maxDurationMs: number = DEFAULT_MAX_COUNT_UP_MS,
): number {
  const [display, setDisplay] = useState(target);
  const prevTargetRef = useRef(target);
  const rafRef = useRef<number | null>(null);
  const isFirstRunRef = useRef(true);

  useEffect(() => {
    const from = prevTargetRef.current;
    const to = target;
    prevTargetRef.current = target;

    // ไม่ animate ตอน mount ครั้งแรก (ไม่มี "ค่าเดิม" ให้ไต่จากจริง ๆ) หรือเมื่อค่าไม่เปลี่ยน/reduced-motion
    if (isFirstRunRef.current || reducedMotion || from === to) {
      isFirstRunRef.current = false;
      setDisplay(to);
      return;
    }

    const clampedDuration = Math.min(durationMs, maxDurationMs);
    const start = performance.now();

    function tick(now: number): void {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / clampedDuration);
      const eased = 1 - (1 - progress) * (1 - progress); // ease-out เบา ๆ
      setDisplay(from + (to - from) * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(to);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [target, durationMs, reducedMotion, maxDurationMs]);

  return display;
}
