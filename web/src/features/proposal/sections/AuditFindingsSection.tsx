/**
 * T-406 — ข้อสังเกตจากการตรวจสอบ (โหมด audit เท่านั้น, 05 §5 `audit_findings[]`)
 *
 * [MISSING COPY KEY] ไม่มี key แปล severity ('info'|'warn'|'high') ใน `docs/ui/copy.th.json`
 * (`proposal.audit.severityInfo/Warn/High`) — ใช้ข้อความคงที่ใกล้เคียงแทน
 */
import type { ReactElement } from 'react';
import { Badge, Chip } from '@/components/ui';
import type { BadgeVariant } from '@/components/ui';
import { t } from '@/i18n';
import type { AuditFinding, BoqLine, Citation } from '../types';
import { citationChipLabel } from '../citationLabel';

const SEVERITY_VARIANT: Record<AuditFinding['severity'], BadgeVariant> = {
  info: 'info',
  warn: 'warn',
  high: 'danger',
};

const SEVERITY_LABEL_FALLBACK: Record<AuditFinding['severity'], string> = {
  info: 'ข้อสังเกต',
  warn: 'คำเตือน',
  high: 'ความเสี่ยงสูง',
};

export interface AuditFindingsSectionProps {
  findings: readonly AuditFinding[];
  onOpenCitation: (citation: Citation, line?: BoqLine) => void;
}

export function AuditFindingsSection({
  findings,
  onOpenCitation,
}: AuditFindingsSectionProps): ReactElement {
  if (findings.length === 0) {
    return <p className="text-sm text-fg-muted">{t('proposal.sections.empty')}</p>;
  }
  return (
    <ul className="space-y-3">
      {findings.map((finding, index) => (
        <li key={`${String(index)}-${finding.text.slice(0, 24)}`} className="text-sm text-fg">
          <div className="flex items-start gap-2">
            <Badge variant={SEVERITY_VARIANT[finding.severity]}>
              {SEVERITY_LABEL_FALLBACK[finding.severity]}
            </Badge>
            <span>{finding.text}</span>
          </div>
          {finding.citations.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5 pl-1">
              {finding.citations.map((citation, cIndex) => (
                <Chip
                  key={`${String(index)}-${String(cIndex)}`}
                  onClick={() => {
                    onOpenCitation(citation);
                  }}
                >
                  {citationChipLabel(citation)}
                </Chip>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
