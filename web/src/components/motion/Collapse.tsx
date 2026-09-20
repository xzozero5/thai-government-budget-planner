/**
 * T-411 — motion.md #24: accordion/แผงเปิด-ปิด "height auto→content (grid-template-rows 0fr→1fr) + fade"
 * (200ms ease-out) — ใช้ CSS ล้วน (ไม่ผ่าน `motion/react`) ตามกฎข้อ 4 ของ motion.md ("ส่วนที่เหลือใช้ CSS
 * transition ล้วน — เบากว่า") เพราะ:
 *   1) การ "ปิด" ของ `Accordion`/`WarningsPanel` (T-402/T-406) unmount เนื้อหาแบบ synchronous อยู่แล้ว
 *      (test เดิมเช็ค `not.toBeInTheDocument()` ทันทีไม่มี `waitFor`) — animate ตอนออกไม่ได้โดยไม่ทำลาย
 *      test เดิม (N7/บรีฟงาน: ห้ามเปลี่ยนโครง DOM ที่มีอยู่)
 *   2) จึงใช้ `Collapse` เป็น entrance animation ตอน "เปิด" เท่านั้น — ปิดให้ parent ลบออกจาก DOM ทันที
 *      (ตรงกับ reduced-motion fallback ของตาราง "สลับทันที" อยู่แล้วโดยไม่ต้องเช็ค reduced-motion ตอนปิด)
 *
 * เนื้อหาอยู่ใน DOM ทันทีที่ mount เสมอ (ไม่มี state ที่ซ่อนเนื้อหาไว้ก่อน) — แค่ grid row เริ่มที่ 0fr
 * แล้วขยายเป็น 1fr เฟรมถัดไปเท่านั้น (content ยังอยู่ใน `document` ให้ query ได้ทันที)
 */
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export interface CollapseProps {
  children: ReactNode;
  className?: string;
}

const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export function Collapse({ children, className }: CollapseProps): ReactElement {
  const reducedMotion = usePrefersReducedMotion();
  const [entered, setEntered] = useState(reducedMotion);

  useEffect(() => {
    if (reducedMotion) {
      setEntered(true);
      return undefined;
    }
    const raf = requestAnimationFrame(() => {
      setEntered(true);
    });
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [reducedMotion]);

  const style: CSSProperties = {
    display: 'grid',
    gridTemplateRows: entered ? '1fr' : '0fr',
    opacity: entered ? 1 : 0,
    transition: reducedMotion ? 'none' : `grid-template-rows 200ms ${EASE_OUT}, opacity 200ms ${EASE_OUT}`,
  };

  return (
    <div className={className} style={style}>
      <div style={{ overflow: 'hidden', minHeight: 0 }}>{children}</div>
    </div>
  );
}
