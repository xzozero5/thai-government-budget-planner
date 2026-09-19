import type { CSSProperties, ReactElement } from 'react';
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

/** placeholder ระหว่างโหลด shard/ข้อมูล (06 §2) — `aria-hidden` เสมอ เพราะไม่มีเนื้อหาจริง */
export function Skeleton({
  width,
  height,
  rounded = 'sm',
  className,
}: SkeletonProps): ReactElement {
  const style: CSSProperties = {
    width: typeof width === 'number' ? `${String(width)}px` : width,
    height: typeof height === 'number' ? `${String(height)}px` : height,
  };
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn('block animate-pulse bg-surface-2', ROUNDED_CLASSES[rounded], className)}
    />
  );
}
