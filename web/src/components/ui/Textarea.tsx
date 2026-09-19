import { forwardRef, useEffect, useId, useRef } from 'react';
import type { ForwardedRef, TextareaHTMLAttributes, ReactElement } from 'react';
import { cn, FOCUS_RING } from '@/components/ui/utils';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
  /** ความสูงสูงสุดก่อนขึ้น scroll (px) — ค่าเริ่มต้นไม่จำกัด */
  maxHeightPx?: number;
}

function resize(el: HTMLTextAreaElement, maxHeightPx: number | undefined): void {
  el.style.height = 'auto';
  const next = maxHeightPx ? Math.min(el.scrollHeight, maxHeightPx) : el.scrollHeight;
  el.style.height = `${String(next)}px`;
}

/** รวม ref ภายใน (สำหรับ auto-grow) กับ ref ที่ผู้เรียก forwardRef ส่งมา — เลี่ยง non-null assertion */
function mergeRefs(
  innerRef: { current: HTMLTextAreaElement | null },
  forwarded: ForwardedRef<HTMLTextAreaElement>,
): (node: HTMLTextAreaElement | null) => void {
  return (node: HTMLTextAreaElement | null): void => {
    innerRef.current = node;
    if (typeof forwarded === 'function') {
      forwarded(node);
    } else if (forwarded) {
      forwarded.current = node;
    }
  };
}

/** textarea auto-grow ตามเนื้อหา (06 §4.2 composer) — ทำงานทั้งแบบ controlled/uncontrolled */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, helperText, maxHeightPx, id, className, value, onInput, ...rest },
  ref,
): ReactElement {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const errorId = `${textareaId}-error`;
  const helperId = `${textareaId}-helper`;
  const describedBy = [error ? errorId : null, !error && helperText ? helperId : null]
    .filter((v): v is string => v !== null)
    .join(' ');

  useEffect(() => {
    if (innerRef.current) {
      resize(innerRef.current, maxHeightPx);
    }
  }, [value, maxHeightPx]);

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={textareaId} className="text-sm font-medium text-fg">
          {label}
        </label>
      )}
      <textarea
        ref={mergeRefs(innerRef, ref)}
        id={textareaId}
        value={value}
        rows={1}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy.length > 0 ? describedBy : undefined}
        onInput={(event) => {
          resize(event.currentTarget, maxHeightPx);
          onInput?.(event);
        }}
        className={cn(
          'resize-none overflow-hidden rounded-sm border bg-surface px-3 py-2 text-fg placeholder:text-fg-muted',
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
