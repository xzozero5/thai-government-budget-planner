/**
 * T-406/T-410 S11 (po-review ชุด B, US-1.2) — empty state (06 §4.3: "ยังไม่มี proposal") พร้อม checklist
 * ข้อมูลที่ผู้ช่วยยังต้องการ (`proposal.checklist*`) ให้ผู้ใช้รู้ล่วงหน้าว่าควรบอกอะไรบ้างเพื่อให้ข้อเสนอ
 * แม่นขึ้น — component นี้ไม่มี state ของตัวเอง (ไม่รู้ว่าผู้ใช้บอกอะไรไปแล้วบ้าง) จึงแสดงเป็นรายการเฉย ๆ
 * ไม่ใช่ checklist แบบติ๊กถูก (`proposal.checklistDone`/`checklistPending` ยังไม่มีจุดต่อข้อมูลจริงให้ใช้)
 */
import type { ReactElement } from 'react';
import { Card } from '@/components/ui';
import { t } from '@/i18n';

const CHECKLIST_ITEM_KEYS = [
  'proposal.checklistWhat',
  'proposal.checklistQty',
  'proposal.checklistSpec',
  'proposal.checklistWhere',
  'proposal.checklistWhen',
  'proposal.checklistWho',
] as const;

export function ProposalEmptyState(): ReactElement {
  return (
    <Card className="flex flex-col items-center gap-4 py-10 text-center">
      <div>
        <p className="text-lg font-medium text-fg">{t('proposal.emptyTitle')}</p>
        <p className="mt-2 max-w-md text-sm text-fg-muted">{t('proposal.emptyBody')}</p>
      </div>
      <div className="w-full max-w-sm text-left">
        <h3 className="text-sm font-semibold text-fg">{t('proposal.checklistTitle')}</h3>
        <ul className="mt-2 space-y-1 text-sm text-fg-muted">
          {CHECKLIST_ITEM_KEYS.map((key) => (
            <li key={key} className="flex items-start gap-2">
              <span aria-hidden="true">•</span>
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
