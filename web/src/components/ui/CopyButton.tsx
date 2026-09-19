import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { cn, FOCUS_RING, PRESS_TRANSITION } from '@/components/ui/utils';

async function copyToClipboard(text: string): Promise<void> {
  // boundary: TS lib.dom ประกาศ `Navigator.clipboard` เป็น non-optional แต่ runtime จริงเป็น undefined
  // ได้ในบริบทที่ไม่ secure (http) หรือเบราว์เซอร์เก่า — ตรวจซ้ำเองเพื่อกันพัง ไม่ fetch ข้าม origin (N5)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ดู comment ด้านบน
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // fallback สำหรับสภาพแวดล้อมที่ไม่มี Clipboard API — `execCommand` เลิกใช้แล้วแต่ยังจำเป็นเป็น fallback
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- fallback ตั้งใจใช้ API เก่าเมื่อไม่มี Clipboard API
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export interface CopyButtonProps {
  /** ค่าที่จะคัดลอก */
  value: string;
  /** ข้อความปกติของปุ่ม (06 §2 copy → ไอคอนเปลี่ยนเป็น ✓ 1.5 s) */
  children: ReactElement | string;
  /** ข้อความตอนคัดลอกสำเร็จ — override ได้ (ค่าเริ่มต้นภาษาไทย) */
  copiedLabel?: string;
  className?: string;
}

/** ปุ่มคัดลอก (ใช้ใน citation drawer / ExternalLink URL) — feedback ✓ ค้าง 1.5 วินาที */
export function CopyButton({
  value,
  children,
  copiedLabel = 'คัดลอกแล้ว',
  className,
}: CopyButtonProps): ReactElement {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    },
    [],
  );

  async function handleClick(): Promise<void> {
    await copyToClipboard(value);
    setCopied(true);
    timeoutRef.current = setTimeout(() => {
      setCopied(false);
    }, 1500);
  }

  return (
    <button
      type="button"
      onClick={() => {
        void handleClick();
      }}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-2 py-1 text-sm text-fg-muted hover:bg-surface-2',
        PRESS_TRANSITION,
        FOCUS_RING,
        className,
      )}
    >
      {copied ? (
        <>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-4 w-4 text-success"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path d="M4 10.5 8 14.5 16 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{copiedLabel}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
