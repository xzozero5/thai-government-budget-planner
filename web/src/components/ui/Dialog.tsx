import { useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '@/components/ui/hooks/useFocusTrap';
import { IconButton } from '@/components/ui/IconButton';
import { cn } from '@/components/ui/utils';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel?: string;
  children: ReactNode;
  className?: string;
}

/** Dialog กลางจอ (06 §7 Export dialog ฯลฯ): focus trap, Esc ปิด, คืน focus, aria-modal — ใช้ trap เดียวกับ Drawer */
export function Dialog({
  open,
  onClose,
  title,
  closeLabel = 'ปิด',
  children,
  className,
}: DialogProps): ReactElement | null {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = 'dialog-title';

  useFocusTrap({ active: open, containerRef, onClose });

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-fg opacity-40"
        onClick={onClose}
        aria-hidden="true"
        data-testid="dialog-overlay"
      />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-md bg-surface shadow-2',
          className,
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
