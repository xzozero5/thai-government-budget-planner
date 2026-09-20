import type { ReactElement } from 'react';
import { Card, Drawer } from '@/components/ui';
import { t } from '@/i18n';

/**
 * T-405 — slot ที่ main thread จะมาต่อของจริงทีหลัง (T-406 proposal pane, T-407 citation drawer)
 * ตอนนี้เป็น placeholder ง่าย ๆ ตามที่ระบุไว้ในโจทย์ (Card + ข้อความ) เท่านั้น — ห้ามใส่ logic ของจริง
 */

export function ProposalPaneSlot(): ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
      <Card className="max-w-md">
        <h2 className="text-base font-semibold text-fg">{t('proposal.emptyTitle')}</h2>
        <p className="mt-2 text-sm text-fg-muted">{t('proposal.emptyBody')}</p>
      </Card>
    </div>
  );
}

export interface CitationDrawerSlotContext {
  id: string;
  name: string;
  label: string;
}

export interface CitationDrawerSlotProps {
  open: boolean;
  onClose: () => void;
  /** บริบทของ tool activity ที่ผู้ใช้กด "ดูผล" มา (T-407 จะแทนที่ด้วยตารางแถวจริง) */
  context?: CitationDrawerSlotContext | undefined;
}

export function CitationDrawerSlot({ open, onClose, context }: CitationDrawerSlotProps): ReactElement {
  return (
    <Drawer open={open} onClose={onClose} title={t('citation.drawerTitle')}>
      <p className="text-sm text-fg-muted">{context ? context.label : t('common.none')}</p>
    </Drawer>
  );
}
