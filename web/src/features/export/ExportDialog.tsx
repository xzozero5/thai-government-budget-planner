/**
 * T-502 — Export dialog (06-UI-SPEC §4.5): เลือกส่วนที่จะใส่ → ส่งออก PDF พร้อม progress/ยกเลิก/error+retry
 *
 * `@react-pdf/renderer` (~458 kB gz) ต้องไม่เข้า initial/workspace bundle (04-ARCHITECTURE §5) — โมดูล
 * `./pdf/renderProposalPdf`/`./pdf/svgToPng` จึงถูก `await import(...)` เฉพาะตอนกดส่งออกจริงเท่านั้น
 * ไฟล์นี้ **ห้าม** static import โมดูลทั้งสอง
 *
 * โหมดใช้งาน 2 แบบ (ผ่าน prop `source`):
 * - ไม่ส่ง `source` (ปุ่ม "ส่งออก PDF" ใน workspace): อ่าน proposal ปัจจุบันจาก `proposalStore` และเสริม
 *   รายละเอียด citation/ภาพประกอบจาก `toolLogStore` (มี session AI จริงอยู่)
 * - ส่ง `source` (หน้า `/load` อ่านไฟล์ `.tgbp.json`): ใช้ proposal จากไฟล์ตรง ๆ — ไม่มี ToolLog/
 *   IllustrationSink ของ session นั้นแล้ว (session เก่าจบไปแล้ว) จึงข้ามการเสริมภาพประกอบ/รายละเอียด
 *   citation เสมอ (คืนที่มีอยู่ในไฟล์ก็เพียงพอสำหรับ "อ่านและส่งออกได้" ตาม 06 §3)
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { Proposal } from '@/ai/tools/proposal';
import { getSvgElementForExport } from '@/components/viz';
import { Button, Dialog, Spinner, Switch } from '@/components/ui';
import { data } from '@/data';
import { t } from '@/i18n';
import { formatPercent } from '@/lib/format';
import { getCurrentProposalVersion, useProposalStore } from '@/stores/proposalStore';
import { useToolLogStore } from '@/stores/toolLogStore';
import { downloadBlob } from './downloadBlob';
import {
  buildBudgetLineDetailsFromToolLog,
  buildRenderInput,
  computeExportWarningsInfo,
  DEFAULT_EXPORT_SECTIONS,
  type ExportSections,
} from './pdfInputs';

/** ค่า sentinel ภายในไฟล์นี้: error จาก chunk ที่หายหลัง deploy ใหม่ → แสดง `export.staleVersion` แทน */
const STALE_VERSION_MARKER = '__stale_version__';

export interface ExportSource {
  proposal: Proposal;
  warnings: string[];
  editedLineIds: string[];
}

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  /** ไม่ส่ง = ใช้ proposal ปัจจุบันจาก `proposalStore` (โหมด workspace ปกติ) */
  source?: ExportSource;
}

type ExportPhase = 'idle' | 'preparingImages' | 'renderingPdf' | 'downloading' | 'done' | 'error';

const BUSY_PHASES: ReadonlySet<ExportPhase> = new Set([
  'preparingImages',
  'renderingPdf',
  'downloading',
]);

export function ExportDialog({ open, onClose, source }: ExportDialogProps): ReactElement {
  const liveVersion = useProposalStore(getCurrentProposalVersion);
  const toolLog = useToolLogStore((s) => s.toolLog);
  const illustrationSink = useToolLogStore((s) => s.illustrationSink);

  // โหมด "ไฟล์ที่โหลดมา" ไม่มี ToolLog/IllustrationSink ของ session นั้นให้ใช้ (ดูหัวไฟล์)
  const isLoadedFileMode = source !== undefined;

  const effectiveSource: ExportSource | null =
    source ??
    (liveVersion
      ? {
          proposal: liveVersion.proposal,
          warnings: liveVersion.warnings,
          editedLineIds: liveVersion.userEditedLineIds,
        }
      : null);

  const [sections, setSections] = useState<ExportSections>(DEFAULT_EXPORT_SECTIONS);
  const [phase, setPhase] = useState<ExportPhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadedFileName, setDownloadedFileName] = useState<string | null>(null);
  // token ที่เพิ่มขึ้นทุกครั้งที่ยกเลิก/ปิดไดอะล็อกกลางทาง — เทียบกับ token ที่จับไว้ตอนเริ่ม export
  // แต่ละรอบ (รูปแบบเดียวกับ `requestIdRef` ของ `features/citations/useCitationDetail.ts`) แทนการใช้
  // boolean flag ธรรมดา เพราะ TS control-flow analysis จะ narrow boolean ที่ set แล้วอ่านหลัง `await`
  // ในฟังก์ชันเดียวกันเป็น literal คงที่ (false เสมอ) ทำให้ `@typescript-eslint/no-unnecessary-condition`
  // ฟ้อง แม้ค่าจริงจะเปลี่ยนได้จาก event handler อื่น (ปุ่มยกเลิก/ปิดไดอะล็อก) ระหว่างที่ await ค้างอยู่จริง
  const cancelTokenRef = useRef(0);

  // เปิดไดอะล็อกใหม่ทุกครั้ง = ล้างสถานะรอบก่อนหน้าทิ้ง (ไม่ค้าง error/done ของครั้งก่อน)
  useEffect(() => {
    if (open) {
      setPhase('idle');
      setErrorMessage(null);
      setDownloadedFileName(null);
    }
  }, [open]);

  const proposal = effectiveSource?.proposal ?? null;
  const hasProposal = proposal !== null;

  // โหลด chunk ของตัวสร้าง PDF ล่วงหน้าทันทีที่มีข้อเสนอ (พบจาก demo จริง: ถ้าเว็บถูก deploy เวอร์ชันใหม่ระหว่างที่
  // ผู้ใช้เปิดแท็บค้างไว้ chunk ชื่อเดิมจะหายจาก server → กดส่งออกแล้วพัง และรีเฟรชไม่ได้เพราะ key/แชทอยู่ใน
  // หน่วยความจำ) — โหลดไว้ก่อนตั้งแต่ยังมีไฟล์อยู่ ลดโอกาสเจอกรณีนี้ (เป็นไฟล์ JS ของเราเอง ไม่ออกนอก origin)
  useEffect(() => {
    if (hasProposal) {
      void import('./pdf/renderProposalPdf').catch(() => undefined);
    }
  }, [hasProposal]);

  const hasIllustrationSource =
    !isLoadedFileMode && illustrationSink !== null && (proposal?.illustrations.length ?? 0) > 0;

  const warningsInfo = proposal
    ? computeExportWarningsInfo(proposal, effectiveSource?.warnings ?? [])
    : null;
  const isBusy = BUSY_PHASES.has(phase);

  function toggleSection(key: keyof ExportSections): (checked: boolean) => void {
    return (checked: boolean) => {
      setSections((prev) => ({ ...prev, [key]: checked }));
    };
  }

  function handleCancel(): void {
    cancelTokenRef.current += 1;
    setPhase('idle');
  }

  function handleDialogClose(): void {
    if (isBusy) {
      // ยกเลิกกลางทาง — ทิ้งผลที่กำลังทำอยู่ (ไม่ดาวน์โหลด) ตาม brief
      cancelTokenRef.current += 1;
    }
    onClose();
  }

  async function buildOverviewImage(current: ExportSource): Promise<string | null> {
    // `hasIllustrationSource` รวมเงื่อนไข `illustrationSink !== null` ไว้แล้ว — TS (aliased conditions,
    // 4.4+) narrow `illustrationSink` เป็น non-null ต่อจากนี้ให้อัตโนมัติ เพราะทั้งสองเป็น `const`
    if (!sections.illustrations || !hasIllustrationSource) {
      return null;
    }
    const firstIllustration = current.proposal.illustrations[0];
    if (!firstIllustration) {
      return null;
    }
    const stored = illustrationSink.get(firstIllustration.illustration_id);
    if (!stored) {
      return null;
    }
    const svgNode = getSvgElementForExport(stored.svg);
    if (!svgNode) {
      return null;
    }
    const { svgToPngDataUrl } = await import('./pdf/svgToPng');
    return svgToPngDataUrl(svgNode);
  }

  async function handleExport(): Promise<void> {
    if (!effectiveSource) {
      return;
    }
    // จับ token ปัจจุบันไว้ — ถ้า `cancelTokenRef.current` เปลี่ยนไปจากนี้ระหว่างทาง (ผู้ใช้กดยกเลิก/ปิด
    // ไดอะล็อกกลางคัน) แปลว่ารอบนี้ถูกยกเลิกแล้ว ต้องทิ้งผลที่ทำค้างอยู่ (ดูคอมเมนต์ที่ประกาศ ref ด้านบน)
    const token = cancelTokenRef.current;
    const isCancelled = (): boolean => cancelTokenRef.current !== token;

    setErrorMessage(null);
    setPhase('preparingImages');

    try {
      const overviewImageDataUrl = await buildOverviewImage(effectiveSource);
      if (isCancelled()) {
        return;
      }

      const dataVersion = isLoadedFileMode ? undefined : await data.dataVersion();
      if (isCancelled()) {
        return;
      }

      const budgetLineDetails = isLoadedFileMode
        ? {}
        : buildBudgetLineDetailsFromToolLog(effectiveSource.proposal, toolLog);

      const input = buildRenderInput({
        proposal: effectiveSource.proposal,
        warnings: effectiveSource.warnings,
        editedLineIds: effectiveSource.editedLineIds,
        sections,
        dataVersion,
        overviewImageDataUrl,
        budgetLineDetails,
      });

      setPhase('renderingPdf');
      const { renderProposalPdf, buildPdfFileName } = await import('./pdf/renderProposalPdf');
      const blob = await renderProposalPdf(input);
      if (isCancelled()) {
        return;
      }

      setPhase('downloading');
      const fileName = buildPdfFileName(effectiveSource.proposal);
      downloadBlob(blob, fileName);
      if (isCancelled()) {
        return;
      }
      setDownloadedFileName(fileName);
      setPhase('done');
    } catch (err) {
      if (isCancelled()) {
        return;
      }
      const rawMessage = err instanceof Error ? err.message : String(err);
      // chunk ของเวอร์ชันเดิมหายจาก server หลัง deploy ใหม่ (ข้อความต่างกันตามเบราว์เซอร์) → บอกทางออกที่ไม่เสียงาน
      const isStaleChunk =
        /dynamically imported module|Importing a module script failed|error loading dynamically/i.test(
          rawMessage,
        );
      setErrorMessage(isStaleChunk ? STALE_VERSION_MARKER : rawMessage);
      setPhase('error');
    }
  }

  return (
    <Dialog open={open} onClose={handleDialogClose} title={t('export.dialogTitle')}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg-muted">{t('export.dialogIntro')}</p>

        {proposal === null ? (
          <p className="text-sm text-fg-muted">{t('common.none')}</p>
        ) : (
          <>
            <ExportWarnings
              missingCitationCount={warningsInfo?.missingCitationCount ?? 0}
              isEstimateHeavy={warningsInfo?.isEstimateHeavy ?? false}
              estimatePercent={warningsInfo?.estimatePercent ?? 0}
              validatorWarnings={effectiveSource?.warnings ?? []}
            />

            <fieldset className="flex flex-col gap-3" disabled={isBusy}>
              <legend className="mb-1 text-sm font-medium text-fg">
                {t('export.sectionsLabel')}
              </legend>

              <SectionRow label={t('export.includeIllustrations')}>
                <Switch
                  checked={sections.illustrations}
                  onChange={toggleSection('illustrations')}
                  disabled={!hasIllustrationSource}
                  label={t('export.includeIllustrations')}
                />
              </SectionRow>
              {!hasIllustrationSource && (
                <p className="text-xs text-fg-muted">{t('proposal.illustration.empty')}</p>
              )}

              <SectionRow label={t('export.includeStats')}>
                <Switch
                  checked
                  disabled
                  onChange={() => undefined}
                  label={t('export.includeStats')}
                />
              </SectionRow>

              <SectionRow label={t('export.includeBoq')}>
                <Switch
                  checked
                  disabled
                  onChange={() => undefined}
                  label={t('export.includeBoq')}
                />
              </SectionRow>

              <SectionRow label={t('export.includeCitations')}>
                <Switch
                  checked
                  disabled
                  onChange={() => undefined}
                  label={t('export.includeCitations')}
                />
              </SectionRow>

              <SectionRow label={t('export.includeWarnings')}>
                <Switch
                  checked={sections.warnings}
                  onChange={toggleSection('warnings')}
                  label={t('export.includeWarnings')}
                />
              </SectionRow>
            </fieldset>

            <ExportProgress
              phase={phase}
              errorMessage={errorMessage}
              downloadedFileName={downloadedFileName}
              onCancel={handleCancel}
              onRetry={() => {
                void handleExport();
              }}
            />

            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button variant="secondary" onClick={handleDialogClose}>
                {t('common.close')}
              </Button>
              <Button
                variant="primary"
                status={isBusy ? 'loading' : 'idle'}
                disabled={isBusy}
                onClick={() => {
                  void handleExport();
                }}
              >
                {t('export.download')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

function SectionRow({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-fg">{label}</span>
      {children}
    </div>
  );
}

function ExportWarnings({
  missingCitationCount,
  isEstimateHeavy,
  estimatePercent,
  validatorWarnings,
}: {
  missingCitationCount: number;
  isEstimateHeavy: boolean;
  estimatePercent: number;
  validatorWarnings: readonly string[];
}): ReactElement | null {
  if (!isEstimateHeavy && missingCitationCount === 0 && validatorWarnings.length === 0) {
    return null;
  }
  return (
    <div
      role="alert"
      className="flex flex-col gap-1.5 rounded-sm border border-warn bg-surface-2 p-3 text-sm"
    >
      <h3 className="flex items-center gap-1.5 font-semibold text-fg">
        <span aria-hidden="true">!</span>
        {t('proposal.warnings.title')}
      </h3>
      {isEstimateHeavy && (
        <p className="text-fg">
          {t('proposal.warnings.estimateHeavy', {
            percent: formatPercent(estimatePercent, { alreadyPercent: true }),
          })}
        </p>
      )}
      {missingCitationCount > 0 && (
        <p className="text-fg">
          {t('proposal.warnings.noCitation', { count: missingCitationCount })}
        </p>
      )}
      {validatorWarnings.map((warning, index) => (
        <p key={index} className="text-fg">
          {warning}
        </p>
      ))}
    </div>
  );
}

function ExportProgress({
  phase,
  errorMessage,
  downloadedFileName,
  onCancel,
  onRetry,
}: {
  phase: ExportPhase;
  errorMessage: string | null;
  downloadedFileName: string | null;
  onCancel: () => void;
  onRetry: () => void;
}): ReactElement | null {
  if (phase === 'idle') {
    return null;
  }
  if (phase === 'error') {
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p className="text-sm text-danger">
          {errorMessage === STALE_VERSION_MARKER
            ? t('export.staleVersion')
            : t('export.failed', { reason: errorMessage ?? '' })}
        </p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }
  if (phase === 'done') {
    return (
      <p role="status" className="text-sm text-success">
        {t('export.done', { filename: downloadedFileName ?? '' })}
      </p>
    );
  }
  return (
    <div aria-live="polite" className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm text-fg-muted">
        <Spinner size="sm" label={t('export.rendering')} />
        {t('export.rendering')}
      </span>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
    </div>
  );
}
