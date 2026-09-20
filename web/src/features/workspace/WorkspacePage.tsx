import { useState } from 'react';
import type { ReactElement } from 'react';
import { IconButton, Tabs } from '@/components/ui';
import { ChatPane } from '@/features/chat';
import { t } from '@/i18n';
import { getCurrentProposalVersion, useProposalStore } from '@/stores/proposalStore';
import { DataLoadingIndicator } from './DataLoadingIndicator';
import { CitationDrawerSlot, ProposalPaneSlot, type CitationDrawerSlotContext } from './slots';
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
 * T-405 — Workspace layout (06 §3–4.3): desktop 2-pane (chat ~40% / proposal ~60%, ซ่อน/ขยายได้ทีละฝั่ง),
 * มือถือ tabs สลับ, drawer overlay สำหรับ citation
 *
 * `ProposalPaneSlot`/`CitationDrawerSlot` (`./slots.tsx`) เป็น placeholder ที่ main thread จะแทนที่ด้วย
 * T-406/T-407 ของจริง — จุดต่อคือ import 2 ตัวนี้จากไฟล์เดียวกัน ไม่ต้องแก้ `WorkspacePage` เอง
 */
export function WorkspacePage(): ReactElement {
  const isDesktop = useMediaQuery('(min-width: 1024px)', true);
  const [collapsed, setCollapsed] = useState<CollapsedPane>('none');
  const [drawerContext, setDrawerContext] = useState<CitationDrawerSlotContext | undefined>(undefined);
  const warningCount = useProposalStore((s) => getCurrentProposalVersion(s)?.warnings.length ?? 0);

  function closeDrawer(): void {
    setDrawerContext(undefined);
  }

  const chatPane = <ChatPane onOpenToolResults={setDrawerContext} />;
  const proposalPane = <ProposalPaneSlot />;
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
      <CitationDrawerSlot open={drawerContext !== undefined} onClose={closeDrawer} context={drawerContext} />
    </div>
  );
}
