/** T-406 — รายการข้อความล้วน (วัตถุประสงค์ / คำถามที่ยังเปิดอยู่) — เรนเดอร์เป็น text node เสมอ */
import type { ReactElement } from 'react';
import { t } from '@/i18n';

export interface ListSectionProps {
  items: readonly string[];
}

export function ListSection({ items }: ListSectionProps): ReactElement {
  if (items.length === 0) {
    return <p className="text-sm text-fg-muted">{t('proposal.sections.empty')}</p>;
  }
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-fg">
      {items.map((item, index) => (
        // ข้อความจาก AI ไม่มี id เสถียร ใช้ index เป็น key ได้เพราะลำดับคงที่ต่อการ render หนึ่งครั้ง
        <li key={`${String(index)}-${item.slice(0, 24)}`}>{item}</li>
      ))}
    </ul>
  );
}
