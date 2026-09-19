import type { ReactElement, ReactNode } from 'react';
import { CopyButton } from '@/components/ui/CopyButton';
import { cn, FOCUS_RING } from '@/components/ui/utils';

/**
 * T-402/T-307 — ลิงก์ภายนอกเดียวที่อนุญาตให้ใช้ในระบบ (citation เว็บ, drawer, แชท — 06 §4.4)
 * https เท่านั้น: URL ที่ไม่ใช่ https (http/javascript:/data:/relative ฯลฯ) จะ **ไม่ใช่ลิงก์** —
 * render เป็น text node ธรรมดา (ไม่มี href ให้กด) กัน scheme อันตรายและ mixed content
 * ไม่ prefetch, ไม่โหลด favicon/รูป preview จากโดเมนนั้น (ไม่มี request ใด ๆ ออกจาก component นี้ นอกจาก
 * การเปิดแท็บใหม่โดยผู้ใช้เอง)
 */

function parseHttpsUrl(href: string): URL | null {
  try {
    const url = new URL(href);
    // main thread review: ปฏิเสธ URL ที่มี userinfo (`https://bank.example@evil.example/`) — รูปแบบหลอกตา
    // ให้ดูเหมือนโดเมนที่น่าเชื่อถือ; URL จากโมเดล/ผลค้นเว็บไม่มีเหตุให้ต้องมี user:pass
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export interface ExternalLinkProps {
  href: string;
  children: ReactNode;
  /** ข้อความปุ่มคัดลอก URL — override ได้ (ค่าเริ่มต้นภาษาไทย) */
  copyLabel?: string;
  /** ซ่อนปุ่มคัดลอก URL (เช่น กรณีพื้นที่จำกัดมาก) — ค่าเริ่มต้นแสดง */
  hideCopyButton?: boolean;
  className?: string;
}

/** ลิงก์ https-only เปิดแท็บใหม่ `noopener noreferrer` เสมอ + ปุ่ม copy URL */
export function ExternalLink({
  href,
  children,
  copyLabel = 'คัดลอกลิงก์',
  hideCopyButton = false,
  className,
}: ExternalLinkProps): ReactElement {
  const url = parseHttpsUrl(href);

  if (!url) {
    // ไม่ใช่ https ที่ถูกต้อง — แสดงเป็นข้อความล้วน (ไม่มี href ให้กด, ไม่มี request ใด ๆ)
    return <span className={className}>{children}</span>;
  }

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <a
        href={url.href}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        className={cn(
          'inline-flex items-center gap-1 text-info underline underline-offset-2',
          FOCUS_RING,
        )}
      >
        {children}
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="h-3.5 w-3.5 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M8 5h7v7M15 5 5 15" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
      {!hideCopyButton && (
        <CopyButton value={url.href} className="text-xs">
          {copyLabel}
        </CopyButton>
      )}
    </span>
  );
}
