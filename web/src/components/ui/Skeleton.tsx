import type { CSSProperties, ReactElement } from 'react';
// import ไฟล์เฉพาะ (ไม่ผ่าน barrel `@/components/motion`) เพื่อไม่ดึง `motion/react` เข้ามาด้วย —
// hook นี้เป็น React ล้วน ไม่มี dependency ของไลบรารี motion (ดูคอมเมนต์หัวไฟล์ต้นทาง)
import { usePrefersReducedMotion } from '@/components/motion/usePrefersReducedMotion';
import { cn } from '@/components/ui/utils';

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  rounded?: 'sm' | 'md' | 'full';
  className?: string;
}

const ROUNDED_CLASSES: Record<NonNullable<SkeletonProps['rounded']>, string> = {
  sm: 'rounded-sm',
  md: 'rounded-md',
  full: 'rounded-full',
};

/**
 * placeholder ระหว่างโหลด shard/ข้อมูล (06 §2) — `aria-hidden` เสมอ เพราะไม่มีเนื้อหาจริง
 *
 * motion.md #22: opacity 1→0.6→1 วนลูป 1.4s ease-in-out; reduced-motion fallback ต้อง**คงที่ที่ opacity
 * 0.75** (ไม่ใช่ 1 หรือ 0.6) — global CSS override ใน `tokens.css` (`animation-iteration-count: 1`) ทำได้
 * แค่ตัด animation ให้จบเร็ว แต่จะค้างที่ opacity 1 (keyframe `100%`) ไม่ตรงตามตาราง จึงต้องเช็คด้วย JS แล้ว
 * สลับ class แทนที่จะปล่อยให้ CSS override อย่างเดียว
 */
export function Skeleton({
  width,
  height,
  rounded = 'sm',
  className,
}: SkeletonProps): ReactElement {
  const reducedMotion = usePrefersReducedMotion();
  const style: CSSProperties = {
    width: typeof width === 'number' ? `${String(width)}px` : width,
    height: typeof height === 'number' ? `${String(height)}px` : height,
  };
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn(
        'block bg-surface-2',
        reducedMotion ? 'opacity-75' : 'animate-skeleton-shimmer',
        ROUNDED_CLASSES[rounded],
        className,
      )}
    />
  );
}
