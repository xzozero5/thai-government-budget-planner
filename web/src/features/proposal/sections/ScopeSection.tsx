/** T-406 — ขอบเขต/สเปค: กลุ่ม section → รายการ items (05 §5 `scope_and_specs`) */
import type { ReactElement } from 'react';
import { t } from '@/i18n';
import type { ScopeSection as ScopeSectionData } from '../types';

export interface ScopeSectionProps {
  sections: readonly ScopeSectionData[];
}

export function ScopeSection({ sections }: ScopeSectionProps): ReactElement {
  if (sections.length === 0) {
    return <p className="text-sm text-fg-muted">{t('proposal.sections.empty')}</p>;
  }
  return (
    <div className="space-y-3">
      {sections.map((section) => (
        <div key={section.section}>
          <h4 className="text-sm font-medium text-fg">{section.section}</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg">
            {section.items.map((item, index) => (
              <li key={`${section.section}-${String(index)}`}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
