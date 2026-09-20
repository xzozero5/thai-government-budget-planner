/**
 * T-406/T-410 (po-review ชุด B) — สมมติฐาน + impact badge (06 §4.3: "สมมติฐาน (impact badge)")
 * ป้าย impact ใช้ `proposal.assumptions.impactHigh/Medium/Low` (เพิ่มใน copy.th.json ชุด A แล้ว)
 */
import type { ReactElement } from 'react';
import { Badge } from '@/components/ui';
import type { BadgeVariant } from '@/components/ui';
import { t, type CopyKey } from '@/i18n';
import type { Assumption } from '../types';

const IMPACT_VARIANT: Record<Assumption['impact'], BadgeVariant> = {
  high: 'danger',
  medium: 'warn',
  low: 'neutral',
};

const IMPACT_LABEL_KEY: Record<Assumption['impact'], CopyKey> = {
  high: 'proposal.assumptions.impactHigh',
  medium: 'proposal.assumptions.impactMedium',
  low: 'proposal.assumptions.impactLow',
};

export interface AssumptionsSectionProps {
  assumptions: readonly Assumption[];
}

export function AssumptionsSection({ assumptions }: AssumptionsSectionProps): ReactElement {
  if (assumptions.length === 0) {
    return <p className="text-sm text-fg-muted">{t('proposal.sections.empty')}</p>;
  }
  return (
    <ul className="space-y-2">
      {assumptions.map((assumption, index) => (
        <li
          key={`${String(index)}-${assumption.text.slice(0, 24)}`}
          className="flex items-start gap-2 text-sm text-fg"
        >
          <Badge variant={IMPACT_VARIANT[assumption.impact]}>
            {t(IMPACT_LABEL_KEY[assumption.impact])}
          </Badge>
          <span>{assumption.text}</span>
        </li>
      ))}
    </ul>
  );
}
