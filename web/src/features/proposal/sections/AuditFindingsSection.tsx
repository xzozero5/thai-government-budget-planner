/**
 * T-406/T-410 (po-review ชุด B) — ข้อสังเกตจากการตรวจสอบ (โหมด audit เท่านั้น, 05 §5 `audit_findings[]`)
 * ป้าย severity ใช้ `proposal.audit.severityInfo/Warn/High` (เพิ่มใน copy.th.json ชุด A แล้ว)
 */
import type { ReactElement } from 'react';
import { Badge, Chip } from '@/components/ui';
import type { BadgeVariant } from '@/components/ui';
import { t, type CopyKey } from '@/i18n';
import type { AuditFinding, BoqLine, Citation } from '../types';
import { citationChipLabel } from '../citationLabel';

const SEVERITY_VARIANT: Record<AuditFinding['severity'], BadgeVariant> = {
  info: 'info',
  warn: 'warn',
  high: 'danger',
};

const SEVERITY_LABEL_KEY: Record<AuditFinding['severity'], CopyKey> = {
  info: 'proposal.audit.severityInfo',
  warn: 'proposal.audit.severityWarn',
  high: 'proposal.audit.severityHigh',
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
              {t(SEVERITY_LABEL_KEY[finding.severity])}
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
