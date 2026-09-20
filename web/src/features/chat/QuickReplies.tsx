import type { ReactElement } from 'react';
import { t, type CopyKey } from '@/i18n';

export interface QuickRepliesProps {
  /** กดชิปแล้วส่งข้อความนั้นทันที (ต่างจากตัวอย่างใน empty state ที่แค่เติม composer — 06 §4.2) */
  onPick: (text: string) => void;
}

const QUICK_REPLY_KEYS: CopyKey[] = [
  // "ทำต่อ" มาก่อนเสมอ: ข้อความเตือนเพดานรอบ tool บอกให้ผู้ใช้กด "ทำต่อ" แต่เดิมไม่มีปุ่มนี้ (พบจาก demo จริง)
  'chat.quickReplyContinue',
  'chat.quickReplySkip',
  'chat.quickReplyNotSure',
  'chat.quickReplyUseDefault',
  'chat.quickReplyMoreDetail',
];

/** T-405 — ชุดตอบเร็วเมื่อผู้ช่วยถามกลับ (06 §4.2); รวม "ใช้ค่ามาตรฐานทั่วไปไปก่อน" (05: ใช้สมมติฐานที่
 * เหมาะสมแล้วสรุปเลย) และ "ข้าม สรุปเลย" */
export function QuickReplies({ onPick }: QuickRepliesProps): ReactElement {
  return (
    <div role="group" aria-label={t('chat.quickRepliesLabel')} className="flex flex-wrap gap-2 px-4 pb-2">
      {QUICK_REPLY_KEYS.map((key) => {
        const label = t(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => {
              onPick(label);
            }}
            className="inline-flex min-h-8 items-center rounded-sm border border-line bg-surface-2 px-2 text-sm hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
