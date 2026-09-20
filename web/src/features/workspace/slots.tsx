import { useState } from 'react';
import type { ReactElement } from 'react';
import type { BoqLine, Citation } from '@/ai/tools/proposal';
import { sessionChatController } from '@/ai/session/chatController';
import { Drawer, useToast } from '@/components/ui';
import type { Dataset } from '@/data';
import { CitationDrawer, datasetTypeLabel, getCitationChipLabel, getWebDomain } from '@/features/citations';
import { ExportDialog, saveSessionFile } from '@/features/export';
import { ProposalPane } from '@/features/proposal/ProposalPane';
import type { LineEditPatch, ProposalVersionInfo } from '@/features/proposal/types';
import { t } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { useChatStore } from '@/stores/chatStore';
import { getCurrentProposalVersion, useProposalStore, type ProposalVersion } from '@/stores/proposalStore';
import { useToolLogStore } from '@/stores/toolLogStore';
import { createCitationDrawerLoaders } from './citationDrawerLoaders';
import { loadTrend, toExportTrendData } from './trendData';
import { BoqTrendCell, ProposalIllustration, ProposalStatCard } from './vizRenderers';

/**
 * T-405/406/407 (ต่อสาย) — `ProposalPaneContainer`/`CitationDrawerContainer` แทน placeholder เดิม
 * (`ProposalPaneSlot`/`CitationDrawerSlot`) — จุดต่อของ `WorkspacePage` ยังเป็นไฟล์นี้ไฟล์เดียวเหมือนเดิม
 * (import 2 ตัวจากที่นี่) เพียงแต่ตอนนี้เชื่อม store/ai/data จริงแล้วแทนที่จะเป็น placeholder เปล่า ๆ
 */

// ---------------------------------------------------------------------------
// ProposalPaneContainer
// ---------------------------------------------------------------------------

function formatVersionTime(createdAtMs: number): string {
  return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(createdAtMs),
  );
}

function buildVersionLabel(version: ProposalVersion, index: number, isCurrent: boolean): string {
  const base = t('proposal.versionItem', { n: index + 1 });
  const withTime = `${base} · ${t('proposal.versionAt', { time: formatVersionTime(version.createdAt) })}`;
  return isCurrent ? `${withTime} (${t('proposal.versionCurrent')})` : withTime;
}

export interface ProposalPaneContainerProps {
  /** เปิด citation drawer ของ citation ที่คลิกใน BOQ/audit findings (เจ้าของ state จริงคือ `WorkspacePage`
   * เพื่อให้ drawer ตัวเดียวใช้ร่วมกับ "ดูผล" ของ tool activity ในแชทได้ — ดู `CitationDrawerOpenState`) */
  onOpenCitation: (citation: Citation, line?: BoqLine) => void;
}

/** ต่อ `ProposalPane` (props-driven, T-406) เข้ากับ `proposalStore`/`chatStore`/`toolLogStore`/
 * `sessionChatController`/`@/features/export`/`@/components/viz` ของจริง */
export function ProposalPaneContainer({ onOpenCitation }: ProposalPaneContainerProps): ReactElement {
  const versions = useProposalStore((s) => s.versions);
  const currentIndex = useProposalStore((s) => s.currentIndex);
  const isAiRunning = useChatStore((s) => s.isRunning);
  const toolLog = useToolLogStore((s) => s.toolLog);
  const illustrationSink = useToolLogStore((s) => s.illustrationSink);
  // subscribe `version` เพื่อ re-render เมื่อ ToolLog/IllustrationSink ถูก mutate ใน object เดิม (ดู
  // คอมเมนต์หัวไฟล์ `stores/toolLogStore.ts`) — ไม่ต้องอ่านค่าตรง ๆ ที่นี่
  useToolLogStore((s) => s.version);
  const { push } = useToast();
  const [exportOpen, setExportOpen] = useState(false);
  // S9 (po-review ชุด B, US-7.1): "ซ่อนภาพ" เป็น state ของ container นี้เท่านั้น (ไม่ persist ไม่มีผลต่อ
  // proposal เอง) — ต่อ session ใหม่/เปลี่ยนเวอร์ชันแล้ว id เดิมอาจไม่มีอยู่แล้วก็ไม่เป็นไร (Set ที่ไม่มี
  // id นั้นแค่ไม่ตรงเงื่อนไข ไม่ throw)
  const [hiddenIllustrationIds, setHiddenIllustrationIds] = useState<Set<string>>(new Set());

  const currentVersion = currentIndex >= 0 ? versions[currentIndex] : undefined;
  const proposal = currentVersion?.proposal ?? null;
  const warnings = currentVersion?.warnings ?? [];
  const editedLineIds = currentVersion?.userEditedLineIds ?? [];

  const versionInfos: ProposalVersionInfo[] = versions.map((version, index) => ({
    index,
    label: buildVersionLabel(version, index, index === versions.length - 1),
    createdAt: new Date(version.createdAt).toISOString(),
    source: version.source,
  }));

  function handleSelectVersion(index: number): void {
    useProposalStore.getState().selectVersion(index);
  }

  function handleEditLine(lineId: string, patch: LineEditPatch): void {
    const storePatch: { qty?: number; unitPriceThb?: number } = {};
    if (patch.qty !== undefined) {
      storePatch.qty = patch.qty;
    }
    if (patch.unit_price_thb !== undefined) {
      storePatch.unitPriceThb = patch.unit_price_thb;
    }
    const result = useProposalStore.getState().updateBoqLine(lineId, storePatch);
    if (!result.ok) {
      push({ title: result.error, variant: 'danger' });
      return;
    }
    const updated = getCurrentProposalVersion(useProposalStore.getState());
    const line = updated?.proposal.boq.find((l) => l.id === lineId);
    if (line) {
      push({
        title: t('toast.lineEdited', { item: line.item, total: formatNumber(line.total_thb) }),
        variant: 'success',
      });
    }
  }

  function handleRequestReview(lineId?: string): void {
    void sessionChatController.requestReview(lineId);
  }

  // M2 (po-review ชุด B): "อ้างอิงไม่พบ" — ตรวจกับ `ToolLog` ของบทสนทนานี้ (API เดียวกับที่
  // `ai/tools/proposal.ts#isCitationResolved` ใช้ตัดสิน) ไม่มี ToolLog เลย (เช่นยังไม่เคยเริ่มคุย) = ไม่มี
  // ข้อมูลพอจะตัดสิน ปล่อยผ่านทุก citation (ไม่ตีตราว่า resolve ไม่ได้ทั้งที่ยังไม่รู้)
  function isCitationUnresolved(citation: Citation): boolean {
    if (!toolLog) {
      return false;
    }
    switch (citation.kind) {
      case 'budget_line':
        return !toolLog.hasSourceId(citation.source_id);
      case 'document':
        return !toolLog.hasDocId(citation.doc_id);
      case 'econ':
        return !toolLog.hasEconValue(citation.indicator, citation.year_be);
      case 'web':
        return !toolLog.hasWebUrl(citation.url);
    }
  }

  function resolveCitationLabel(citation: Citation): string | undefined {
    if (citation.kind !== 'budget_line' || !toolLog?.getSourceFingerprint) {
      return undefined;
    }
    const fingerprint = toolLog.getSourceFingerprint(citation.source_id);
    if (!fingerprint) {
      return undefined;
    }
    return getCitationChipLabel(citation, {
      budgetLine: {
        datasetLabel: datasetTypeLabel(fingerprint.dataset as Dataset, fingerprint.fiscalYearBe),
        fiscalYearBe: fingerprint.fiscalYearBe,
        agency: fingerprint.agency,
        ministry: fingerprint.ministry,
      },
    });
  }

  // S9: "ซ่อนภาพ"/"แสดงภาพ" สลับ state ของ container — "สร้างภาพใหม่" ส่งข้อความขอภาพใหม่ไปให้ผู้ช่วยจริง
  // ผ่าน `sessionChatController.sendMessage` (ข้อความจาก copy `proposal.illustration.regenerateRequest`)
  function handleHideIllustration(illustrationId: string): void {
    setHiddenIllustrationIds((prev) => new Set(prev).add(illustrationId));
  }

  function handleShowIllustration(illustrationId: string): void {
    setHiddenIllustrationIds((prev) => {
      if (!prev.has(illustrationId)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(illustrationId);
      return next;
    });
  }

  function handleRegenerateIllustration(title: string): void {
    void sessionChatController.sendMessage(t('proposal.illustration.regenerateRequest', { title }));
  }

  async function handleSave(): Promise<void> {
    const result = await saveSessionFile();
    if (result.ok) {
      push({ title: t('toast.saved'), variant: 'success' });
    } else {
      push({ title: t('errors.unknown', { detail: result.error }), variant: 'danger' });
    }
  }

  return (
    <>
      <ProposalPane
        proposal={proposal}
        warnings={warnings}
        versions={versionInfos}
        currentVersionIndex={currentIndex}
        onSelectVersion={handleSelectVersion}
        editedLineIds={editedLineIds}
        onEditLine={handleEditLine}
        onRequestReview={handleRequestReview}
        onOpenCitation={onOpenCitation}
        onExport={() => {
          setExportOpen(true);
        }}
        onSave={() => {
          void handleSave();
        }}
        isAiRunning={isAiRunning}
        resolveCitationLabel={resolveCitationLabel}
        isCitationUnresolved={isCitationUnresolved}
        renderStatCards={(cards) => (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {cards.map((card, index) => (
              <ProposalStatCard
                key={`${card.trend_ref.kind}-${card.trend_ref.key}-${String(index)}`}
                card={card}
              />
            ))}
          </div>
        )}
        renderTrend={(trendRef) => <BoqTrendCell trendRef={trendRef} />}
        renderIllustration={(illustrationRef) => (
          <ProposalIllustration
            illustrationRef={illustrationRef}
            illustrationSink={illustrationSink}
            hidden={hiddenIllustrationIds.has(illustrationRef.illustration_id)}
            onHide={() => {
              handleHideIllustration(illustrationRef.illustration_id);
            }}
            onShow={() => {
              handleShowIllustration(illustrationRef.illustration_id);
            }}
            // S9: ระหว่าง AI กำลังรันเทิร์นอยู่ ไม่ส่ง `onRegenerate` มาเลย (แทนการ disable ปุ่มเอง เพราะ
            // `IllustrationFrame` ไม่มี prop แยกสำหรับปิดปุ่มโดยไม่ซ่อนมันไปด้วย)
            {...(!isAiRunning
              ? {
                  onRegenerate: () => {
                    handleRegenerateIllustration(illustrationRef.title);
                  },
                }
              : {})}
          />
        )}
      />
      <ExportDialog
        open={exportOpen}
        onClose={() => {
          setExportOpen(false);
        }}
        // T-504 (US-8.3) — ใช้ loader/cache เดิมของ `trendData.ts` (ตัวเดียวกับที่ `BoqTrendCell`/
        // `ProposalStatCard` ข้างบนใช้) ต่อด้วย `toExportTrendData` แปลงรูปร่างให้ตรงกับที่ `ExportDialog`
        // ต้องการ — ไม่ทำ loader ซ้ำอีกชุด
        loadTrend={(ref) => loadTrend(ref).then((result) => (result ? toExportTrendData(result) : null))}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// CitationDrawerContainer
// ---------------------------------------------------------------------------

/** บริบทของ tool activity ที่ผู้ใช้กด "ดูผล" มาจากแชท — คงชื่อ/รูปแบบเดิมของ T-405 ไว้ (ChatPane ยังส่ง
 * ค่าชุดนี้มาไม่เปลี่ยน) */
export interface CitationDrawerSlotContext {
  id: string;
  name: string;
  label: string;
}

/** state รวมของ drawer เดียวที่ `WorkspacePage` ใช้ร่วมกันทั้งสองทาง: คลิก citation chip ใน BOQ/audit
 * findings (มี citation จริง — ต่อ loaders ได้เต็ม) หรือกด "ดูผล" จาก tool activity ในแชท (ไม่มี
 * citation เดี่ยวเจาะจง — ToolLog ไม่ได้ผูกผลลัพธ์กับ tool_use_id เป็นรายตัว จึง fallback เป็นข้อความ
 * เดิมของ T-405 เท่านั้น ไม่พยายามเดา/สร้างของปลอมขึ้นมา) */
export type CitationDrawerOpenState =
  | { kind: 'toolActivity'; context: CitationDrawerSlotContext }
  | { kind: 'citation'; citation: Citation; contextLine?: BoqLine };

export interface CitationDrawerContainerProps {
  state: CitationDrawerOpenState | null;
  onClose: () => void;
}

/** ต่อ `CitationDrawer` (props-driven, T-407) เข้ากับ loaders จริงที่ผูก `ToolLog`/facade `@/data`
 * (`citationDrawerLoaders.ts`) — กรณี tool activity คงพฤติกรรม fallback เดิมของ T-405 ไว้เป๊ะ */
export function CitationDrawerContainer({ state, onClose }: CitationDrawerContainerProps): ReactElement {
  const toolLog = useToolLogStore((s) => s.toolLog);
  useToolLogStore((s) => s.version);
  const loaders = createCitationDrawerLoaders(toolLog);
  const { push } = useToast();

  // S10 (po-review ชุด B, US-4.3): "ไม่เอาราคานี้" ส่งข้อความขอผู้ช่วยเลิกใช้ราคานั้นจริง (ข้อความจาก copy
  // `citation.web.rejectRequest`) + toast ยืนยันด้วยชื่อโดเมน — ไม่แก้ proposal/ToolLog เองที่นี่ (ให้ผู้ช่วย
  // เป็นคนแก้ในรอบถัดไปตามปกติของ flow นี้ทั้งระบบ)
  function handleRejectWeb(citation: Extract<Citation, { kind: 'web' }>): void {
    void sessionChatController.sendMessage(t('citation.web.rejectRequest', { url: citation.url }));
    push({
      title: t('toast.citationRejected', { domain: getWebDomain(citation.url) ?? citation.url }),
      variant: 'info',
    });
  }

  if (state?.kind === 'citation') {
    return (
      <CitationDrawer
        open
        onClose={onClose}
        citation={state.citation}
        loaders={loaders}
        onRejectWeb={handleRejectWeb}
        {...(state.contextLine ? { contextLine: state.contextLine } : {})}
      />
    );
  }

  return (
    <Drawer open={state?.kind === 'toolActivity'} onClose={onClose} title={t('citation.drawerTitle')}>
      <p className="text-sm text-fg-muted">
        {state?.kind === 'toolActivity' ? state.context.label : t('common.none')}
      </p>
    </Drawer>
  );
}
