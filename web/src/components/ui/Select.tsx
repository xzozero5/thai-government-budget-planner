import { forwardRef, useId } from 'react';
import type { ReactElement, SelectHTMLAttributes } from 'react';
import { cn, FOCUS_RING } from '@/components/ui/utils';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  options: SelectOption[];
}

/** native `<select>` (06 §2: ต้องใช้บนมือถือได้เลย ไม่ต้อง custom listbox) */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, helperText, options, id, className, ...rest },
  ref,
): ReactElement {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const errorId = `${selectId}-error`;
  const helperId = `${selectId}-helper`;
  const describedBy = [error ? errorId : null, !error && helperText ? helperId : null]
    .filter((v): v is string => v !== null)
    .join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={selectId} className="text-sm font-medium text-fg">
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy.length > 0 ? describedBy : undefined}
        className={cn(
          'h-10 rounded-sm border bg-surface px-3 text-fg',
          'transition duration-fast ease-out',
          FOCUS_RING,
          'disabled:cursor-not-allowed disabled:opacity-50',
          error ? 'border-danger' : 'border-line',
          className,
        )}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
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
