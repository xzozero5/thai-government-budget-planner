import type { ReactElement } from 'react';
import { cn } from '@/components/ui/utils';

export type SpinnerSize = 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-9 w-9 border-[3px]',
};

export interface SpinnerProps {
  size?: SpinnerSize;
  /** ข้อความสำหรับ screen reader — override ได้ (ค่าเริ่มต้นภาษาไทย) */
  label?: string;
  className?: string;
}

/** ตัวหมุนโหลด — เคารพ `prefers-reduced-motion` ผ่าน `tokens.css` (global override ของ animation-duration) */
export function Spinner({
  size = 'md',
  label = 'กำลังโหลด',
  className,
}: SpinnerProps): ReactElement {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'inline-block shrink-0 animate-spin rounded-full border-current border-t-transparent',
        SIZE_CLASSES[size],
        className,
      )}
    />
  );
}
