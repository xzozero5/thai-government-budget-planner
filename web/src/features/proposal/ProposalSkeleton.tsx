/** T-406 — skeleton ระหว่าง `emit_proposal` กำลังทำงาน (06 §4.3 wireframe "proposal loading") */
import type { ReactElement } from 'react';
import { Skeleton } from '@/components/ui';
import { t } from '@/i18n';

export function ProposalSkeleton(): ReactElement {
  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" className="sr-only">
        {t('proposal.loadingTitle')}
      </p>
      <div aria-hidden="true" className="space-y-4">
        <Skeleton height={28} width="60%" />
        <div className="flex gap-2">
          <Skeleton height={24} width={96} rounded="full" />
          <Skeleton height={24} width={96} rounded="full" />
          <Skeleton height={24} width={96} rounded="full" />
        </div>
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((row) => (
            <Skeleton key={row} height={20} />
          ))}
        </div>
      </div>
    </div>
  );
}
