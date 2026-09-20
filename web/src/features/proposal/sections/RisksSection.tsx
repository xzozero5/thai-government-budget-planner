/**
 * T-406/T-410 (po-review ชุด B) — ความเสี่ยง + แนวทางลดความเสี่ยง (05 §5 `risks[].mitigation` optional)
 * ป้าย "แนวทางลดความเสี่ยง" ใช้ `proposal.risks.mitigationLabel` (เพิ่มใน copy.th.json ชุด A แล้ว)
 */
import type { ReactElement } from 'react';
import { t } from '@/i18n';
import type { Risk } from '../types';

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
              <span className="font-medium">{t('proposal.risks.mitigationLabel')}: </span>
              {risk.mitigation}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
