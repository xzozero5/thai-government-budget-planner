import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactElement } from 'react';
import { cn, FOCUS_RING } from '@/components/ui/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** ข้อความ error ที่ตรวจ inline (06 §2) — แสดงใต้ input พร้อม `role="alert"` */
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, helperText, id, className, ...rest },
  ref,
): ReactElement {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const helperId = `${inputId}-helper`;
  const describedBy = [error ? errorId : null, !error && helperText ? helperId : null]
    .filter((v): v is string => v !== null)
    .join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-fg">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy.length > 0 ? describedBy : undefined}
        className={cn(
          'h-10 rounded-sm border bg-surface px-3 text-fg placeholder:text-fg-muted',
          'transition duration-fast ease-out',
          FOCUS_RING,
          'disabled:cursor-not-allowed disabled:opacity-50',
          error ? 'border-danger' : 'border-line',
          className,
        )}
        {...rest}
      />
      {error && (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {!error && helperText && (
        <p id={helperId} className="text-sm text-fg-muted">
          {helperText}
        </p>
      )}
    </div>
  );
});
