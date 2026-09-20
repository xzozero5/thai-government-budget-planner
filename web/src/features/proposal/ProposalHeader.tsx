/**
 * T-406 — header ของ proposal pane (06 §4.3): ชื่อโครงการ, badge โหมด, version selector,
 * ยอดรวม/จำนวนบรรทัด/สัดส่วนที่มา (mix)
 */
import type { ReactElement } from 'react';
import { Badge, Select } from '@/components/ui';
import { formatNumber } from '@/lib/format';
import { t } from '@/i18n';
import { computeBasisMix } from './stats';
import type { Proposal, ProposalVersionInfo } from './types';

export interface ProposalHeaderProps {
  proposal: Proposal;
  versions: readonly ProposalVersionInfo[];
  currentVersionIndex: number;
  onSelectVersion: (index: number) => void;
}

export function ProposalHeader({
  proposal,
  versions,
  currentVersionIndex,
  onSelectVersion,
}: ProposalHeaderProps): ReactElement {
  const mix = computeBasisMix(proposal.boq);

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-fg">{proposal.title}</h2>
          <Badge variant="info" className="mt-1">
            {proposal.mode === 'audit' ? t('chat.modeAudit') : t('chat.modeDraft')}
          </Badge>
        </div>
        {versions.length > 0 && (
          <Select
            aria-label={t('proposal.versionLabel')}
            value={String(currentVersionIndex)}
            onChange={(e) => {
              onSelectVersion(Number(e.target.value));
            }}
            options={versions.map((v) => ({ value: String(v.index), label: v.label }))}
          />
        )}
      </div>

      <p className="text-sm text-fg">{proposal.summary}</p>

      <div className="flex flex-wrap items-center gap-4 text-sm text-fg-muted">
        <span>
          <span className="font-medium text-fg">{t('proposal.totalLabel')}: </span>
          {t('proposal.totalValue', { amount: formatNumber(proposal.totals.grand_total_thb) })}
        </span>
        <span>
          <span className="font-medium text-fg">{t('proposal.lineCountLabel')}: </span>
          {proposal.boq.length}
        </span>
      </div>

      {proposal.boq.length > 0 && (
        <div
          role="img"
          aria-label={t('proposal.mixTooltip')}
          title={t('proposal.mixTooltip')}
          className="flex h-2 w-full max-w-md overflow-hidden rounded-full bg-surface-2"
        >
          <div
            className="bg-basis-historical"
            style={{ width: `${String(mix.historicalPercent)}%` }}
          />
          <div className="bg-basis-market" style={{ width: `${String(mix.marketPercent)}%` }} />
          <div className="bg-basis-estimate" style={{ width: `${String(mix.estimatePercent)}%` }} />
        </div>
      )}
      <div className="flex flex-wrap gap-3 text-xs text-fg-muted">
        <span>{t('proposal.mixHistorical', { percent: Math.round(mix.historicalPercent) })}</span>
        <span>{t('proposal.mixMarket', { percent: Math.round(mix.marketPercent) })}</span>
        <span>{t('proposal.mixEstimate', { percent: Math.round(mix.estimatePercent) })}</span>
      </div>
    </header>
  );
}
