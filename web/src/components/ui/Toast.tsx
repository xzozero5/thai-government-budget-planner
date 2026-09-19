import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '@/components/ui/IconButton';
import { cn } from '@/components/ui/utils';

export type ToastVariant = 'info' | 'success' | 'warn' | 'danger';

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** ms ก่อนหายอัตโนมัติ — ค่าเริ่มต้น 5000, ใส่ 0 เพื่อไม่หายเอง (เช่น error ที่ต้องกดปิดเอง) */
  durationMs?: number;
}

interface ToastItem extends Required<Pick<ToastInput, 'title' | 'variant' | 'durationMs'>> {
  id: number;
  description: string | undefined;
}

interface ToastContextValue {
  push: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  info: 'border-info text-info',
  success: 'border-success text-success',
  warn: 'border-warn text-warn',
  danger: 'border-danger text-danger',
};

export interface ToastProviderProps {
  children: ReactNode;
  /** ข้อความปุ่มปิดสำหรับ screen reader — override ได้ */
  closeLabel?: string;
}

/** T-402/T-408 — ผู้ให้บริการ toast กลาง (aria-live=polite ตาม 06 §6) ครอบ App ครั้งเดียว */
export function ToastProvider({
  children,
  closeLabel = 'ปิดข้อความแจ้งเตือน',
}: ToastProviderProps): ReactElement {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (toast: ToastInput): number => {
      const id = nextId.current;
      nextId.current += 1;
      const durationMs = toast.durationMs ?? 5000;
      const item: ToastItem = {
        id,
        title: toast.title,
        description: toast.description,
        variant: toast.variant ?? 'info',
        durationMs,
      };
      setToasts((prev) => [...prev, item]);
      if (durationMs > 0) {
        const timer = setTimeout(() => {
          dismiss(id);
        }, durationMs);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          aria-live="polite"
          aria-atomic="false"
          className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role="status"
              className={cn(
                'flex items-start gap-2 rounded-md border-l-4 bg-surface p-3 shadow-2',
                VARIANT_CLASSES[toast.variant],
              )}
            >
              <div className="flex-1">
                <p className="text-sm font-medium text-fg">{toast.title}</p>
                {toast.description && <p className="text-sm text-fg-muted">{toast.description}</p>}
              </div>
              <IconButton
                label={closeLabel}
                variant="ghost"
                onClick={() => {
                  dismiss(toast.id);
                }}
                icon={
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path d="M5 5l10 10M15 5 5 15" strokeLinecap="round" />
                  </svg>
                }
              />
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

/** ใช้ต้องอยู่ใต้ `ToastProvider` — โยน error ทันทีถ้าไม่มี provider (ผิดจากการลืมครอบ) */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast ต้องถูกเรียกภายใน <ToastProvider>');
  }
  return ctx;
}
