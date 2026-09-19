import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { cn, FOCUS_RING, PRESS_TRANSITION } from '@/components/ui/utils';

export type IconButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  primary: 'bg-accent text-accent-contrast hover:brightness-105',
  secondary: 'bg-primary text-primary-contrast hover:brightness-110',
  ghost: 'bg-transparent text-fg hover:bg-surface-2',
  danger: 'bg-danger text-primary-contrast hover:brightness-105',
};

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: IconButtonVariant;
  /** ชื่อการทำงานของปุ่ม (บังคับ — ไม่มีข้อความมองเห็นได้ ต้องมี accessible name เสมอ) */
  label: string;
  icon: ReactNode;
}

/** ปุ่มไอคอนล้วน (ขนาดแตะ ≥ 40px ตาม 06 §6) ต้องระบุ `label` เสมอเพราะไม่มีข้อความมองเห็น */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', label, icon, className, ...rest },
  ref,
): ReactElement {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md',
        PRESS_TRANSITION,
        FOCUS_RING,
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});
