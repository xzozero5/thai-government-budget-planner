/**
 * T-407 — Chip ของ citation หนึ่งตัว ใช้ในบรรทัด BOQ/ข้อความแชท (06 §4.2/§4.3)
 * - kind='web': ตัว chip เป็นลิงก์เปิดแท็บใหม่**ทันที** (https เท่านั้น — ตรงกับ N5/T-307) + ปุ่มเล็ก
 *   แยกต่างหากเปิด citation drawer (สองเป้าหมายกดแยกกันตาม 06 §4.3/US-4.3) — URL ที่ไม่ใช่ https ไม่ใช่
 *   ลิงก์ (render เป็น text เฉย ๆ) แต่ปุ่มเปิด drawer ยังกดได้เสมอ
 * - kind อื่น: ทั้ง chip เป็นปุ่มเดียวเปิด drawer
 *
 * chip เอง**ไม่โหลดข้อมูล** — ถ้าต้องการ label ที่มีรายละเอียด (เช่น dataset/ปี/หน่วยงานของ budget_line)
 * ผู้เรียกต้องคำนวณ/ส่ง `labelOptions` มาเอง (ดู `citationLabel.ts`) มิฉะนั้นจะ fallback เป็น label อย่างย่อ
 */
import type { ReactElement } from 'react';
import type { Citation } from '@/ai/tools/proposal';
import { IconButton } from '@/components/ui';
import { cn, FOCUS_RING, PRESS_TRANSITION } from '@/components/ui/utils';
import { t } from '@/i18n';
import { type CitationChipLabelOptions, getCitationChipLabel, isHttpsUrl } from './citationLabel';

export interface CitationChipProps {
  citation: Citation;
  /** เปิด citation drawer ของ citation นี้ */
  onOpenDrawer: () => void;
  /** ป้ายข้อความ override เอง — ไม่ส่งมาจะคำนวณผ่าน `getCitationChipLabel(citation, labelOptions)` */
  label?: string;
  labelOptions?: CitationChipLabelOptions;
  /** citation นี้ resolve ไม่ได้ในข้อมูลปัจจุบัน (06 §4.3: badge เทา "อ้างอิงไม่พบ") */
  unresolved?: boolean;
  className?: string;
}

/** ตัวอักษรกำกับประเภทแหล่ง (aria-hidden — label ที่มองเห็นมาจาก text เสมอ ไม่ใช่สีอย่างเดียว) */
const KIND_MARK: Record<Citation['kind'], string> = {
  budget_line: 'ง',
  document: 'อ',
  econ: 'ต',
  web: '↗',
};

const BASE_PILL_CLASSES = 'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm';

function pillClasses(unresolved: boolean, interactive: boolean): string {
  if (unresolved) {
    return cn(BASE_PILL_CLASSES, 'border-dashed border-danger bg-surface-2 text-fg-muted');
  }
  return cn(
    BASE_PILL_CLASSES,
    interactive ? 'border-line bg-surface text-fg hover:bg-surface-2' : 'border-line bg-surface-2 text-fg-muted',
  );
}

function InfoIcon(): ReactElement {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9v4.5M10 6.5v.01" strokeLinecap="round" />
    </svg>
  );
}

function UnresolvedMark(): ReactElement {
  return <span className="text-danger">· {t('citation.notFoundBadge')}</span>;
}

/** Chip ของ citation หนึ่งตัว (06 §4.2/§4.3) — ดูหัวไฟล์สำหรับพฤติกรรมของ kind='web' */
export function CitationChip({
  citation,
  onOpenDrawer,
  label,
  labelOptions,
  unresolved = false,
  className,
}: CitationChipProps): ReactElement {
  const text = label ?? getCitationChipLabel(citation, labelOptions);
  const mark = KIND_MARK[citation.kind];

  if (citation.kind === 'web') {
    const https = isHttpsUrl(citation.url);
    return (
      <span className={cn('inline-flex items-center gap-1', className)}>
        {https ? (
          <a
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            className={cn(pillClasses(unresolved, true), FOCUS_RING, PRESS_TRANSITION)}
          >
            <span aria-hidden="true">{mark}</span>
            <span>{text}</span>
          </a>
        ) : (
          <span className={pillClasses(unresolved, false)}>
            <span aria-hidden="true">{mark}</span>
            <span>{text}</span>
          </span>
        )}
        {unresolved && <UnresolvedMark />}
        <IconButton label={t('a11y.citationDrawer')} onClick={onOpenDrawer} icon={<InfoIcon />} />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpenDrawer}
      className={cn(pillClasses(unresolved, true), FOCUS_RING, PRESS_TRANSITION, className)}
    >
      <span aria-hidden="true">{mark}</span>
      <span>{text}</span>
      {unresolved && <UnresolvedMark />}
    </button>
  );
}
