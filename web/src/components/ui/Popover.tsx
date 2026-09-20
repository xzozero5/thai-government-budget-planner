import { useEffect, useId, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { cn, FOCUS_RING } from '@/components/ui/utils';

export interface PopoverProps {
  /** ข้อความ/ปุ่ม trigger */
  triggerLabel: string;
  children: ReactNode;
  className?: string;
}

/** Popover อย่างง่าย (06 §7): คลิกเปิด/ปิด, ปิดเมื่อคลิกนอกกล่องหรือกด Esc */
export function Popover({ triggerLabel, children, className }: PopoverProps): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => {
          setOpen((v) => !v);
        }}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-full text-fg-muted hover:bg-surface-2',
          'transition duration-fast ease-out',
          FOCUS_RING,
        )}
      >
        {triggerLabel}
      </button>
      {open && (
        <div
          id={contentId}
          role="dialog"
          className={cn(
            // motion.md #19: fade + translateY(4px→0) ตอนเปิด — keyframe ล้วน (เคารพ reduced-motion
            // อัตโนมัติผ่าน global override ใน tokens.css โดยไม่ต้องเช็ค JS เพิ่ม)
            'absolute left-0 top-full z-20 mt-1.5 min-w-[200px] animate-popover-in rounded-md border border-line bg-surface p-3 text-sm text-fg shadow-2',
            className,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
