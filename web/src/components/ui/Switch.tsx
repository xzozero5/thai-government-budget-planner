import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactElement } from 'react';
import { cn, FOCUS_RING } from '@/components/ui/utils';

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'children'
> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** ข้อความอธิบาย (บังคับ — ปุ่มไม่มีข้อความมองเห็นได้เอง) เช่น "เปิดใช้ web search" */
  label: string;
}

/** สวิตช์เปิด/ปิด — ปุ่ม native จึงรองรับ Enter/Space โดยอัตโนมัติ, role=switch + aria-checked */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onChange, label, className, disabled, ...rest },
  ref,
): ReactElement {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        onChange(!checked);
      }}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full',
        'transition duration-fast ease-out',
        FOCUS_RING,
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-surface-2 border border-line',
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-surface shadow-1',
          'transition duration-fast ease-out',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
});
