/**
 * T-406 — ความเสี่ยง + แนวทางลดความเสี่ยง (05 §5 `risks[].mitigation` optional)
 *
 * [MISSING COPY KEY] ไม่มี key สำหรับป้าย "แนวทางลดความเสี่ยง" ใน `docs/ui/copy.th.json`
 * (`proposal.risks.mitigationLabel`) — ใช้ข้อความคงที่ใกล้เคียงแทนชั่วคราว
 */
import type { ReactElement } from 'react';
import { t } from '@/i18n';
import type { Risk } from '../types';

const MITIGATION_LABEL_FALLBACK = 'แนวทางลดความเสี่ยง';

export interface RisksSectionProps {
  risks: readonly Risk[];
}

export function RisksSection({ risks }: RisksSectionProps): ReactElement {
  if (risks.length === 0) {
    return <p className="text-sm text-fg-muted">{t('proposal.sections.empty')}</p>;
  }
  return (
    <ul className="space-y-3">
      {risks.map((risk, index) => (
        <li key={`${String(index)}-${risk.text.slice(0, 24)}`} className="text-sm text-fg">
          <p>{risk.text}</p>
          {risk.mitigation !== undefined && (
            <p className="mt-1 text-fg-muted">
              <span className="font-medium">{MITIGATION_LABEL_FALLBACK}: </span>
              {risk.mitigation}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
