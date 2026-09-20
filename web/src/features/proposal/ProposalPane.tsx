/**
 * T-406 — Proposal pane แบบ props-driven (presentational เท่านั้น — ไม่มี store/fetch/side effect
 * นอกจากเรียก callback props ที่ได้รับมา) ตาม 06 §4.3
 *
 * ทุกข้อความที่มาจากโมเดล (title/summary/objectives/…) render ผ่าน JSX text interpolation ล้วน ๆ
 * (ไม่มี `dangerouslySetInnerHTML` ที่ไหนในไฟล์นี้ทั้งต้นไม้) — React escape เนื้อหาเป็น text node ให้
 * เองเสมอ จึงปลอดภัยจาก markup/script ที่ AI อาจใส่มาในสตริงโดยไม่ต้องเรียก sanitizer เพิ่ม (N9 sanitizer
 * มีไว้เฉพาะ SVG ภาพประกอบผ่าน `renderIllustration` slot ซึ่งเป็นความรับผิดชอบของ component ที่ฉีดเข้ามา)
 */
import type { ReactElement } from 'react';
import { Accordion, Button } from '@/components/ui';
import { t } from '@/i18n';
import { BoqTable } from './BoqTable';
import { ProposalEmptyState } from './ProposalEmptyState';
import { ProposalHeader } from './ProposalHeader';
import { ProposalSkeleton } from './ProposalSkeleton';
import { AssumptionsSection } from './sections/AssumptionsSection';
import { AuditFindingsSection } from './sections/AuditFindingsSection';
import { ComparablesSection } from './sections/ComparablesSection';
import { ListSection } from './sections/ListSection';
import { RisksSection } from './sections/RisksSection';
import { ScopeSection } from './sections/ScopeSection';
import { WarningsPanel } from './sections/WarningsPanel';
import { WebCitationsSection } from './sections/WebCitationsSection';
import type { ProposalPaneProps } from './types';

export function ProposalPane({
  proposal,
  warnings,
  versions,
  currentVersionIndex,
  onSelectVersion,
  editedLineIds,
  onEditLine,
  onRequestReview,
  onOpenCitation,
  onExport,
  onSave,
  isAiRunning,
  renderStatCards,
  renderTrend,
  renderIllustration,
  resolveCitationLabel,
}: ProposalPaneProps): ReactElement {
  if (proposal === null) {
    if (isAiRunning) {
      return (
        <section aria-label={t('a11y.proposalRegion')} className="p-4">
          <ProposalSkeleton />
        </section>
      );
    }
    return (
      <section aria-label={t('a11y.proposalRegion')} className="p-4">
        <ProposalEmptyState />
      </section>
    );
  }

  const accordionItems = [
    {
      id: 'objectives',
      title: t('proposal.sections.objective'),
      content: <ListSection items={proposal.objectives} />,
    },
    {
      id: 'scope',
      title: t('proposal.sections.scope'),
      content: <ScopeSection sections={proposal.scope_and_specs} />,
    },
    {
      id: 'boq',
      title: t('proposal.sections.boq'),
      content: (
        <BoqTable
          proposal={proposal}
          editedLineIds={editedLineIds}
          onEditLine={onEditLine}
          onRequestReview={onRequestReview}
          onOpenCitation={onOpenCitation}
          renderTrend={renderTrend}
          resolveCitationLabel={resolveCitationLabel}
        />
      ),
    },
    {
      id: 'assumptions',
      title: t('proposal.sections.assumptions'),
      content: <AssumptionsSection assumptions={proposal.assumptions} />,
    },
    {
      id: 'risks',
      title: t('proposal.sections.risks'),
      content: <RisksSection risks={proposal.risks} />,
    },
    {
      id: 'comparison',
      title: t('proposal.sections.comparison'),
      content: <ComparablesSection comparables={proposal.comparables} />,
    },
    ...(proposal.mode === 'audit'
      ? [
          {
            id: 'audit',
            title: t('proposal.sections.audit'),
            content: (
              <AuditFindingsSection
                findings={proposal.audit_findings ?? []}
                onOpenCitation={onOpenCitation}
              />
            ),
          },
        ]
      : []),
    ...(proposal.citations_web.length > 0
      ? [
          {
            id: 'web-citations',
            title: t('citation.web.title'),
            content: <WebCitationsSection citations={proposal.citations_web} />,
          },
        ]
      : []),
    {
      id: 'open-questions',
      title: t('proposal.sections.openQuestions'),
      content: <ListSection items={proposal.open_questions} />,
    },
  ];

  return (
    <section aria-label={t('a11y.proposalRegion')} className="space-y-4 p-4">
      <ProposalHeader
        proposal={proposal}
        versions={versions}
        currentVersionIndex={currentVersionIndex}
        onSelectVersion={onSelectVersion}
      />

      {renderStatCards && proposal.stat_cards.length > 0 && (
        <div>{renderStatCards(proposal.stat_cards)}</div>
      )}

      {renderIllustration && proposal.illustrations.length > 0 && (
        <div className="space-y-3">
          {proposal.illustrations.map((illustration) => (
            <div key={illustration.illustration_id}>{renderIllustration(illustration)}</div>
          ))}
        </div>
      )}

      <Accordion items={accordionItems} />

      <WarningsPanel warnings={warnings} onRequestReview={onRequestReview} />

      <footer className="flex flex-wrap gap-2 border-t border-line pt-3">
        <Button variant="primary" onClick={onExport}>
          {t('proposal.actions.exportPdf')}
        </Button>
        <Button variant="secondary" onClick={onSave}>
          {t('proposal.actions.saveJson')}
        </Button>
      </footer>
    </section>
  );
}
