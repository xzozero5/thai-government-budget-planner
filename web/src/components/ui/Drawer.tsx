import { useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '@/components/ui/hooks/useFocusTrap';
import { IconButton } from '@/components/ui/IconButton';
import { cn } from '@/components/ui/utils';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** หัวข้อ drawer (ใช้เป็น accessible name ผ่าน aria-labelledby ด้วย) */
  title: string;
  /** ข้อความปุ่มปิด สำหรับ screen reader — override ได้ (ค่าเริ่มต้นภาษาไทย) */
  closeLabel?: string;
  children: ReactNode;
}

/** Drawer overlay ขวา 480px / มือถือ full (06 §4.4): focus trap, Esc ปิด, คืน focus, aria-modal */
export function Drawer({
  open,
  onClose,
  title,
  closeLabel = 'ปิด',
  children,
}: DrawerProps): ReactElement | null {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = 'drawer-title';

  useFocusTrap({ active: open, containerRef, onClose });

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-fg opacity-40"
        onClick={onClose}
        aria-hidden="true"
        data-testid="drawer-overlay"
      />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'absolute inset-y-0 right-0 flex w-full flex-col bg-surface shadow-2 sm:w-[480px]',
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 id={titleId} className="text-lg font-semibold text-fg">
            {title}
          </h2>
          <IconButton
            label={closeLabel}
            onClick={onClose}
            icon={
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M5 5l10 10M15 5 5 15" strokeLinecap="round" />
              </svg>
            }
          />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
