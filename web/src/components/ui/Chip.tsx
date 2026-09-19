import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { cn, FOCUS_RING, PRESS_TRANSITION } from '@/components/ui/utils';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: ReactNode;
  icon?: ReactNode;
  selected?: boolean;
}

/** Chip คลิกได้ (citation / quick reply — 06 §4.2/§4.3) */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { children, icon, selected = false, className, ...rest },
  ref,
): ReactElement {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm',
        PRESS_TRANSITION,
        FOCUS_RING,
        'disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-accent bg-accent text-accent-contrast'
          : 'border-line bg-surface text-fg hover:bg-surface-2',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});
