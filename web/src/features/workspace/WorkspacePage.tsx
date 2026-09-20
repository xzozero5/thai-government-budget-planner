import { useState } from 'react';
import type { ReactElement } from 'react';
import type { BoqLine, Citation } from '@/ai/tools/proposal';
import { IconButton, Tabs } from '@/components/ui';
import { ChatPane } from '@/features/chat';
import { t } from '@/i18n';
import { getCurrentProposalVersion, useProposalStore } from '@/stores/proposalStore';
import { DataLoadingIndicator } from './DataLoadingIndicator';
import {
  CitationDrawerContainer,
  ProposalPaneContainer,
  type CitationDrawerOpenState,
} from './slots';
import { useDataStoreInit } from './useDataStoreInit';
import { useMediaQuery } from './useMediaQuery';
import { WorkspaceHeader } from './WorkspaceHeader';

type CollapsedPane = 'none' | 'chat' | 'proposal';

function PaneHeader({
  title,
  collapseLabel,
  onCollapse,
}: {
  title: string;
  collapseLabel: string;
  onCollapse: () => void;
}): ReactElement {
  return (
    <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
      <span className="text-sm font-medium text-fg-muted">{title}</span>
      <IconButton label={collapseLabel} variant="ghost" onClick={onCollapse} icon={<span aria-hidden="true">‹›</span>} />
    </div>
  );
}

function ExpandStrip({ label, onExpand }: { label: string; onExpand: () => void }): ReactElement {
  return (
    <div className="flex w-10 flex-col items-center border-l border-line bg-surface-2 pt-2">
      <IconButton label={label} variant="ghost" onClick={onExpand} icon={<span aria-hidden="true">›‹</span>} />
    </div>
  );
}

/**
 * T-405/406/407 — Workspace layout (06 §3–4.3): desktop 2-pane (chat ~40% / proposal ~60%,
 * ซ่อน/ขยายได้ทีละฝั่ง), มือถือ tabs สลับ, drawer overlay สำหรับ citation
 *
 * `ProposalPaneContainer`/`CitationDrawerContainer` (`./slots.tsx`) ต่อกับ store/ai/data ของจริงแล้ว —
 * `drawerState` รวมสองทางที่เปิด drawer เดียวกันได้: คลิก citation chip ใน BOQ (ผ่าน
 * `ProposalPaneContainer.onOpenCitation`) กับกด "ดูผล" ของ tool activity ในแชท (`ChatPane.onOpenToolResults`)
 */
export function WorkspacePage(): ReactElement {
  const isDesktop = useMediaQuery('(min-width: 1024px)', true);
  const [collapsed, setCollapsed] = useState<CollapsedPane>('none');
  const [drawerState, setDrawerState] = useState<CitationDrawerOpenState | null>(null);
  const warningCount = useProposalStore((s) => getCurrentProposalVersion(s)?.warnings.length ?? 0);

  useDataStoreInit();

  function closeDrawer(): void {
    setDrawerState(null);
  }

  function handleOpenCitation(citation: Citation, line?: BoqLine): void {
    setDrawerState(line !== undefined ? { kind: 'citation', citation, contextLine: line } : { kind: 'citation', citation });
  }

  const chatPane = (
    <ChatPane
      onOpenToolResults={(context) => {
        setDrawerState({ kind: 'toolActivity', context });
      }}
    />
  );
  const proposalPane = <ProposalPaneContainer onOpenCitation={handleOpenCitation} />;
  const proposalTabLabel =
    warningCount > 0 ? `${t('workspace.proposalPane')} (${String(warningCount)})` : t('workspace.proposalPane');

  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <WorkspaceHeader />
      <div className="flex min-h-0 flex-1 flex-col">
        {isDesktop ? (
          <div className="flex min-h-0 flex-1">
            {collapsed !== 'chat' && (
              <section
                aria-label={t('workspace.chatPane')}
                className={`flex min-h-0 flex-col border-r border-line ${collapsed === 'proposal' ? 'flex-1' : 'w-2/5'}`}
              >
                <PaneHeader
                  title={t('workspace.chatPane')}
                  collapseLabel={t('workspace.collapseChat')}
                  onCollapse={() => {
                    setCollapsed('chat');
                  }}
                />
                <div className="min-h-0 flex-1">{chatPane}</div>
              </section>
            )}
            {collapsed !== 'proposal' && (
              <section
                aria-label={t('workspace.proposalPane')}
                className={`flex min-h-0 flex-col ${collapsed === 'chat' ? 'flex-1' : 'w-3/5'}`}
              >
                <PaneHeader
                  title={t('workspace.proposalPane')}
                  collapseLabel={t('workspace.collapseProposal')}
                  onCollapse={() => {
                    setCollapsed('proposal');
                  }}
                />
                <div className="min-h-0 flex-1 overflow-y-auto">{proposalPane}</div>
              </section>
            )}
            {collapsed === 'chat' && (
              <ExpandStrip
                label={t('workspace.expandChat')}
                onExpand={() => {
                  setCollapsed('none');
                }}
              />
            )}
            {collapsed === 'proposal' && (
              <ExpandStrip
                label={t('workspace.expandProposal')}
                onExpand={() => {
                  setCollapsed('none');
                }}
              />
            )}
          </div>
        ) : (
          <Tabs
            className="flex min-h-0 flex-1 flex-col"
            items={[
              { id: 'chat', label: t('workspace.chatPane'), content: chatPane },
              { id: 'proposal', label: proposalTabLabel, content: proposalPane },
            ]}
          />
        )}
      </div>
      <DataLoadingIndicator />
      <CitationDrawerContainer state={drawerState} onClose={closeDrawer} />
    </div>
  );
}
