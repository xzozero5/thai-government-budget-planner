/**
 * T-406 — สมมติฐาน + impact badge (06 §4.3: "สมมติฐาน (impact badge)")
 *
 * [MISSING COPY KEY] `docs/ui/copy.th.json` ไม่มี key สำหรับป้าย impact ของสมมติฐาน
 * (`proposal.assumptions.impactHigh/Medium/Low`) — ใช้ข้อความใกล้เคียงคงที่แทนชั่วคราวตามที่ brief
 * อนุญาต ("ใส่ข้อความใกล้เคียง แล้วระบุ key ที่ขาดในรายงาน")
 */
import type { ReactElement } from 'react';
import { Badge } from '@/components/ui';
import type { BadgeVariant } from '@/components/ui';
import { t } from '@/i18n';
import type { Assumption } from '../types';

const IMPACT_VARIANT: Record<Assumption['impact'], BadgeVariant> = {
  high: 'danger',
  medium: 'warn',
  low: 'neutral',
};

const IMPACT_FALLBACK_LABEL: Record<Assumption['impact'], string> = {
  high: 'ผลกระทบสูง',
  medium: 'ผลกระทบปานกลาง',
  low: 'ผลกระทบต่ำ',
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
            {IMPACT_FALLBACK_LABEL[assumption.impact]}
          </Badge>
          <span>{assumption.text}</span>
        </li>
      ))}
    </ul>
  );
}
