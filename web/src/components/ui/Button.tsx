import { forwardRef, useEffect, useRef } from 'react';
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { Spinner } from '@/components/ui/Spinner';
import { cn, FOCUS_RING, PRESS_TRANSITION } from '@/components/ui/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';
export type ButtonStatus = 'idle' | 'loading' | 'success';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-contrast hover:brightness-105',
  secondary: 'bg-primary text-primary-contrast hover:brightness-110',
  ghost: 'bg-transparent text-fg border border-line hover:bg-surface-2',
  danger: 'bg-danger text-primary-contrast hover:brightness-105',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-base gap-2',
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** สถานะ feedback ทันที (06 §2): `loading` แสดง spinner, `success` แสดง ✓ ค้าง `successDurationMs` แล้วกลับ idle */
  status?: ButtonStatus;
  /** ระยะเวลาที่ค้าง success ก่อนเรียก `onStatusTimeout` (ms) — ค่าเริ่มต้น 1500 ตาม 06 §2 */
  successDurationMs?: number;
  /** เรียกเมื่อ success ครบเวลา — ใช้ให้ผู้เรียกเซ็ต status กลับเป็น idle */
  onStatusTimeout?: () => void;
  /** ข้อความ aria สำหรับ spinner ระหว่างโหลด — override ได้ (ค่าเริ่มต้นภาษาไทย) */
  loadingLabel?: string;
  /** ข้อความสำหรับ screen reader ตอนสำเร็จ — override ได้ (ค่าเริ่มต้นภาษาไทย) */
  successLabel?: string;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    status = 'idle',
    successDurationMs = 1500,
    onStatusTimeout,
    loadingLabel = 'กำลังโหลด',
    successLabel = 'สำเร็จ',
    className,
    disabled,
    children,
    ...rest
  },
  ref,
): ReactElement {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onStatusTimeoutRef = useRef(onStatusTimeout);
  onStatusTimeoutRef.current = onStatusTimeout;

  useEffect(() => {
    if (status !== 'success') {
      return;
    }
    timeoutRef.current = setTimeout(() => {
      onStatusTimeoutRef.current?.();
    }, successDurationMs);
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [status, successDurationMs]);

  const isLoading = status === 'loading';
  const isSuccess = status === 'success';

  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium',
        PRESS_TRANSITION,
        FOCUS_RING,
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      disabled={disabled ?? isLoading}
      aria-busy={isLoading}
      {...rest}
    >
      {isLoading && <Spinner size="sm" label={loadingLabel} />}
      {isSuccess && (
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="h-4 w-4 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path d="M4 10.5 8 14.5 16 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <span>{children}</span>
      {isSuccess && (
        <span className="sr-only" role="status">
          {successLabel}
        </span>
      )}
    </button>
  );
});
