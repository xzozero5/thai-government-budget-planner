/** T-406 — empty state (06 §4.3: "ยังไม่มี proposal") */
import type { ReactElement } from 'react';
import { Card } from '@/components/ui';
import { t } from '@/i18n';

export function ProposalEmptyState(): ReactElement {
  return (
    <Card className="flex flex-col items-center gap-2 py-10 text-center">
      <p className="text-lg font-medium text-fg">{t('proposal.emptyTitle')}</p>
      <p className="max-w-md text-sm text-fg-muted">{t('proposal.emptyBody')}</p>
    </Card>
  );
}
