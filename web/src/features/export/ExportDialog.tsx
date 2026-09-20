/**
 * T-502/T-504/S13 — Export dialog (06-UI-SPEC §4.5): เลือกส่วนที่จะใส่ → ส่งออก PDF พร้อม progress/ยกเลิก/
 * error+retry
 *
 * `@react-pdf/renderer` (~458 kB gz) ต้องไม่เข้า initial/workspace bundle (04-ARCHITECTURE §5) — โมดูล
 * `./pdf/renderProposalPdf`/`./pdf/svgToPng` จึงถูก `await import(...)` เฉพาะตอนกดส่งออกจริงเท่านั้น
 * ไฟล์นี้ **ห้าม** static import โมดูลทั้งสอง (`./pdf/trendSvg` เป็น pure string builder ล้วน ๆ ไม่มี
 * dependency หนัก — import แบบ static ได้ตามปกติ)
 *
 * โหมดใช้งาน 2 แบบ (ผ่าน prop `source`):
 * - ไม่ส่ง `source` (ปุ่ม "ส่งออก PDF" ใน workspace): อ่าน proposal ปัจจุบันจาก `proposalStore` และเสริม
 *   รายละเอียด citation/ภาพประกอบจาก `toolLogStore` (มี session AI จริงอยู่)
 * - ส่ง `source` (หน้า `/load` อ่านไฟล์ `.tgbp.json`): ใช้ proposal จากไฟล์ตรง ๆ — ไม่มี ToolLog/
 *   IllustrationSink ของ session นั้นแล้ว (session เก่าจบไปแล้ว) จึงข้ามการเสริมภาพประกอบ/รายละเอียด
 *   citation เสมอ (คืนที่มีอยู่ในไฟล์ก็เพียงพอสำหรับ "อ่านและส่งออกได้" ตาม 06 §3)
 *
 * T-504 (US-8.3) — prop `loadTrend` optional: container ของหน้าเว็บ (`features/workspace/slots.tsx`)
 * ส่งมาเฉพาะตอนมี session จริง (ไม่ส่งใน `/load` — "หน้า /load ไม่มี loader = ไม่มี section" ตาม brief);
 * ไม่ได้รับมา = ไม่พยายามสร้างกราฟแนวโน้มเลย (ไม่ error, สวิตช์ปิดใช้งานเอง)
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { Proposal, TrendRef } from '@/ai/tools/proposal';
import { getSvgElementForExport } from '@/components/viz';
import { Button, Dialog, Input, Spinner, Switch } from '@/components/ui';
import { data } from '@/data';
import { t } from '@/i18n';
import { formatPercent } from '@/lib/format';
import { sanitizeSvg } from '@/lib/svgSanitizer';
import { getCurrentProposalVersion, useProposalStore } from '@/stores/proposalStore';
import { useToolLogStore } from '@/stores/toolLogStore';
import { downloadBlob } from './downloadBlob';
import type { ProposalPdfTrendImage } from './pdf/types';
import { buildTrendSvg } from './pdf/trendSvg';
import {
  buildBudgetLineDetailsFromToolLog,
  buildRenderInput,
  collectTrendRefs,
  computeExportWarningsInfo,
  DEFAULT_EXPORT_SECTIONS,
  EXPORT_AUTHOR_MAX_LENGTH,
  type ExportSections,
  type ExportTrendData,
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
  /** T-504 — โหลด series แนวโน้มของ `TrendRef` หนึ่งตัว คืน `null` เมื่อไม่มีข้อมูล; ไม่ส่ง prop นี้มาเลย =
   * ไม่มีส่วน "แนวโน้มราคาที่เกี่ยวข้อง" ในไฟล์ (ดูหัวไฟล์) */
  loadTrend?: (ref: TrendRef) => Promise<ExportTrendData | null>;
}

type ExportPhase = 'idle' | 'preparingImages' | 'renderingPdf' | 'downloading' | 'done' | 'error';

const BUSY_PHASES: ReadonlySet<ExportPhase> = new Set([
  'preparingImages',
  'renderingPdf',
  'downloading',
]);

const BASIS_LABEL_KEY = {
  unit_price: 'proposal.trend.basisUnitPrice',
  amount_per_line: 'proposal.trend.basisAmountPerLine',
} as const;

/** ผลรวม `n` ของทุกจุด — `undefined` เมื่อไม่มีจุดไหนมีแนวคิด n เลย (ตัวชี้วัดเศรษฐกิจ) */
function sumSampleSize(points: ExportTrendData['points']): number | undefined {
  let total = 0;
  let any = false;
  for (const p of points) {
    if (p.n !== undefined) {
      total += p.n;
      any = true;
    }
  }
  return any ? total : undefined;
}

export function ExportDialog({ open, onClose, source, loadTrend }: ExportDialogProps): ReactElement {
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
  const [authorName, setAuthorName] = useState('');
  const [phase, setPhase] = useState<ExportPhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadedFileName, setDownloadedFileName] = useState<string | null>(null);
  // token ที่เพิ่มขึ้นทุกครั้งที่ยกเลิก/ปิดไดอะล็อกกลางทาง — เทียบกับ token ที่จับไว้ตอนเริ่ม export
  // แต่ละรอบ (รูปแบบเดียวกับ `requestIdRef` ของ `features/citations/useCitationDetail.ts`) แทนการใช้
  // boolean flag ธรรมดา เพราะ TS control-flow analysis จะ narrow boolean ที่ set แล้วอ่านหลัง `await`
  // ในฟังก์ชันเดียวกันเป็น literal คงที่ (false เสมอ) ทำให้ `@typescript-eslint/no-unnecessary-condition`
  // ฟ้อง แม้ค่าจริงจะเปลี่ยนได้จาก event handler อื่น (ปุ่มยกเลิก/ปิดไดอะล็อก) ระหว่างที่ await ค้างอยู่จริง
  const cancelTokenRef = useRef(0);

  // เปิดไดอะล็อกใหม่ทุกครั้ง = ล้างสถานะรอบก่อนหน้าทิ้ง (ไม่ค้าง error/done/ชื่อผู้จัดทำของครั้งก่อน — S13:
  // ชื่อผู้จัดทำเก็บใน state ของ dialog เท่านั้น ไม่ persist ข้าม session ตาม N2)
  useEffect(() => {
    if (open) {
      setPhase('idle');
      setErrorMessage(null);
      setDownloadedFileName(null);
      setAuthorName('');
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

  const trendRefs = proposal ? collectTrendRefs(proposal) : [];
  const hasTrendSource = loadTrend !== undefined && trendRefs.length > 0;

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

  /** T-504 — สร้างกราฟแนวโน้ม ≤ 6 รูปจาก `trend_ref` ที่ไม่ซ้ำของ BOQ/stat cards: โหลด series (loader
   * ของ container) → วาด SVG เอง (`buildTrendSvg`) → sanitize (N9 defense-in-depth แม้สร้างเอง) →
   * แปลงเป็น PNG (`svgToPngDataUrl`) จุดไหนพลาด (ไม่มีข้อมูล/sanitize ไม่ผ่าน/แปลง PNG ไม่สำเร็จ) ข้ามเงียบ ๆ
   * ไม่ทำให้การส่งออกทั้งไฟล์ล้ม */
  async function buildTrendImages(current: ExportSource): Promise<ProposalPdfTrendImage[]> {
    if (!sections.trends || loadTrend === undefined) {
      return [];
    }
    const refs = collectTrendRefs(current.proposal);
    if (refs.length === 0) {
      return [];
    }
    const { svgToPngDataUrl } = await import('./pdf/svgToPng');
    const images: ProposalPdfTrendImage[] = [];
    for (const ref of refs) {
      let trend: ExportTrendData | null;
      try {
        trend = await loadTrend(ref);
      } catch {
        trend = null;
      }
      if (!trend || trend.points.length === 0) {
        continue;
      }
      const svgString = buildTrendSvg({ title: trend.title, points: trend.points });
      const sanitized = sanitizeSvg(svgString);
      if (!sanitized.ok) {
        continue;
      }
      const dataUrl = await svgToPngDataUrl(sanitized.node());
      if (!dataUrl) {
        continue;
      }
      const nTotal = trend.basis === 'econ' ? undefined : sumSampleSize(trend.points);
      images.push({
        title: trend.title,
        dataUrl,
        ...(trend.basis !== 'econ' ? { basisLabel: t(BASIS_LABEL_KEY[trend.basis]) } : {}),
        ...(nTotal !== undefined ? { nTotal } : {}),
      });
    }
    return images;
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

      const trendImages = await buildTrendImages(effectiveSource);
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
        trendImages,
        budgetLineDetails,
        author: authorName,
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

              <SectionRow label={t('export.includeTrends')}>
                <Switch
                  checked={sections.trends}
                  onChange={toggleSection('trends')}
                  disabled={!hasTrendSource}
                  label={t('export.includeTrends')}
                />
              </SectionRow>
              {!hasTrendSource && <p className="text-xs text-fg-muted">{t('export.trendsEmpty')}</p>}

              <SectionRow label={t('export.includeStats')}>
                <Switch
                  checked={sections.stats}
                  onChange={toggleSection('stats')}
                  label={t('export.includeStats')}
                />
              </SectionRow>

              <SectionRow label={t('export.includeAssumptionsRisks')}>
                <Switch
                  checked={sections.assumptionsRisks}
                  onChange={toggleSection('assumptionsRisks')}
                  label={t('export.includeAssumptionsRisks')}
                />
              </SectionRow>

              <SectionRow label={t('export.includeComparables')}>
                <Switch
                  checked={sections.comparables}
                  onChange={toggleSection('comparables')}
                  label={t('export.includeComparables')}
                />
              </SectionRow>

              <AlwaysIncludedRow label={t('export.includeBoq')} />
              <AlwaysIncludedRow label={t('export.includeCitations')} />
              <AlwaysIncludedRow label={t('export.includeWarnings')} />
              <p className="text-xs text-fg-muted">{t('export.alwaysIncludedHint')}</p>
            </fieldset>

            <Input
              label={t('export.authorLabel')}
              placeholder={t('export.authorPlaceholder')}
              helperText={t('export.authorHelp')}
              value={authorName}
              maxLength={EXPORT_AUTHOR_MAX_LENGTH}
              disabled={isBusy}
              onChange={(e) => {
                // ตัดเฉพาะความยาวตอนพิมพ์ (กัน paste ข้อความยาวเกิน `maxLength` ซึ่งเป็นแค่ hint ของ
                // เบราว์เซอร์ ไม่ใช่การบังคับจริงสำหรับทุก input method) — **ห้าม trim ที่นี่**: ผู้ใช้ต้อง
                // พิมพ์ช่องว่างกลางชื่อได้ตามปกติระหว่างพิมพ์ ตัด/trim ค่าสุดท้ายจริงตอนส่งออกที่
                // `buildRenderInput` (`pdfInputs.ts#sanitizeExportAuthorName`) เท่านั้น
                setAuthorName(e.target.value.slice(0, EXPORT_AUTHOR_MAX_LENGTH));
              }}
            />

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

/** ส่วนที่ปิดไม่ได้ (N3) — สวิตช์ติ๊กค้าง+disabled พร้อมป้าย "รวมเสมอ" (ดู `export.alwaysIncludedHint`
 * ท้าย fieldset สำหรับเหตุผล) */
function AlwaysIncludedRow({ label }: { label: string }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-fg">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-xs font-medium text-fg-muted">{t('export.alwaysIncluded')}</span>
        <Switch checked disabled onChange={() => undefined} label={label} />
      </span>
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
