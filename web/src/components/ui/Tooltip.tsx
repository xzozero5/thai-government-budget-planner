import { cloneElement, useId, useState } from 'react';
import type { FocusEvent, MouseEvent, ReactElement } from 'react';
import { cn } from '@/components/ui/utils';

export interface TooltipProps {
  content: string;
  children: ReactElement<{
    'aria-describedby'?: string;
    onFocus?: (e: FocusEvent) => void;
    onBlur?: (e: FocusEvent) => void;
    onMouseEnter?: (e: MouseEvent) => void;
    onMouseLeave?: (e: MouseEvent) => void;
  }>;
  className?: string;
}

/** Tooltip อย่างง่าย (06 §7): แสดงเมื่อ hover/focus trigger — ผูกด้วย `aria-describedby` */
export function Tooltip({ content, children, className }: TooltipProps): ReactElement {
  const [visible, setVisible] = useState(false);
  const id = useId();

  const trigger = cloneElement(children, {
    'aria-describedby': id,
    onFocus: (e: FocusEvent) => {
      setVisible(true);
      children.props.onFocus?.(e);
    },
    onBlur: (e: FocusEvent) => {
      setVisible(false);
      children.props.onBlur?.(e);
    },
    onMouseEnter: (e: MouseEvent) => {
      setVisible(true);
      children.props.onMouseEnter?.(e);
    },
    onMouseLeave: (e: MouseEvent) => {
      setVisible(false);
      children.props.onMouseLeave?.(e);
    },
  });

  return (
    <span className="relative inline-flex">
      {trigger}
      <span
        id={id}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-sm bg-primary px-2 py-1 text-xs text-primary-contrast shadow-1',
          'transition duration-fast ease-out',
          visible ? 'visible opacity-100' : 'invisible opacity-0',
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}
