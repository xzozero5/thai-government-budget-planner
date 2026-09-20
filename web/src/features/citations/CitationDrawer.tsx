/**
 * T-407 — Citation drawer แบบ props-driven (06 §4.4) — component นี้ **ไม่เรียก `@/data` เอง**
 * ผู้เรียก (container ที่จะต่อเข้ากับ store/ai ภายหลัง) ต้องส่ง `loaders` มาให้ครบ เพื่อให้ test ง่าย
 * และไม่ผูกกับ DuckDB/AI จริง
 *
 * รองรับ `Citation` ทั้ง 4 kind (`ai/tools/proposal.ts` §5): budget_line / document / econ / web
 * - loader ทุกตัวคืน `null` แปลว่า "ไม่พบในชุดข้อมูลปัจจุบัน" → แสดง `citation.notFoundBody` เดียวกันทุก kind
 * - throw จาก loader → สถานะ error พร้อมปุ่ม "ลองใหม่" (`common.retry`)
 * - เปลี่ยน citation ระหว่างโหลด → ผลเก่าต้องไม่ทับ state ปัจจุบัน (ดู `useCitationDetail.ts`)
 */
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { BoqLine, Citation } from '@/ai/tools/proposal';
import {
  BasisBadge,
  type Basis,
  Button,
  ConfidenceDots,
  type ConfidenceLevel,
  CopyButton,
  Drawer,
  ExternalLink,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tooltip,
} from '@/components/ui';
import type { BudgetLine } from '@/data';
import { type CopyKey, t } from '@/i18n';
import { formatFiscalYearBe, formatNumber, formatPercent, formatThb } from '@/lib/format';
import { datasetTypeLabel, describeQualityFlag, formatCitationDate, getWebDomain } from './citationLabel';
import {
  useCitationDetail,
  type CitationDetailState,
  type CitationDrawerLoaders,
  type DocumentChunkView,
  type EconPointView,
} from './useCitationDetail';

export type { CitationDrawerLoaders, DocumentChunkView, EconPointView } from './useCitationDetail';

export interface CitationDrawerProps {
  open: boolean;
  onClose: () => void;
  citation: Citation | null;
  /** บรรทัด BOQ ต้นทางที่เปิด drawer นี้มา (ถ้ามี) — ใช้แสดง basis/confidence ของบรรทัดนั้นที่หัว drawer
   * (ตรงกับ wireframe 06 §4.4: "▣ จากงบจริง ●●● มั่นใจสูง") — ไม่บังคับเพราะบาง entry point (เช่น
   * เปิดจากการ์ดสถิติ/แชท) ไม่มีบริบท BOQ ให้ */
  contextLine?: BoqLine;
  loaders: CitationDrawerLoaders;
  /** ป้าย N3 เมื่อ `unit_price_thb === null` — ยังไม่มี key ใน docs/ui/copy.th.json ณ วันที่ทำ T-407
   * (รายงานไว้ท้ายงาน) จึงรับ override ผ่าน prop ได้ตามธรรมเนียมเดิมของ primitives อื่นในโปรเจกต์
   * (เช่น `Drawer.closeLabel`, `ExternalLink.copyLabel`) */
  amountAsUnitPriceLabel?: string;
  /** ปุ่ม "ไม่เอาราคานี้" ของ web citation (06 §4.4) — เพิ่มเป็น optional callback นอกสัญญา props เดิม
   * ที่ระบุมา (ไม่ทำให้ผู้เรียกเดิมพัง เพราะ optional); ไม่ส่งมา = ไม่แสดงปุ่ม */
  onRejectWeb?: (citation: Extract<Citation, { kind: 'web' }>) => void;
}

const TYPE_TITLE_KEY: Record<Citation['kind'], CopyKey> = {
  budget_line: 'citation.types.budget_line',
  document: 'citation.types.document',
  econ: 'citation.types.econ',
  web: 'citation.types.web',
};

const BASIS_LABEL_KEY: Record<Basis, CopyKey> = {
  historical: 'proposal.basis.historical',
  market: 'proposal.basis.market',
  estimate: 'proposal.basis.estimate',
};

const CONFIDENCE_LABEL_KEY: Record<ConfidenceLevel, CopyKey> = {
  high: 'proposal.confidence.high',
  medium: 'proposal.confidence.medium',
  low: 'proposal.confidence.low',
};

function citationIdentifier(citation: Citation): string {
  switch (citation.kind) {
    case 'budget_line':
      return citation.source_id;
    case 'document':
      return citation.doc_id;
    case 'econ':
      return `${citation.indicator}@${String(citation.year_be)}`;
    case 'web':
      return citation.url;
  }
}

/** Citation drawer — 06 §4.4. `citation === null` ปิด drawer เสมอ (ไม่มีอะไรให้แสดง) */
export function CitationDrawer({
  open,
  onClose,
  citation,
  contextLine,
  loaders,
  amountAsUnitPriceLabel = t('citation.flags.amountPerLineNotUnitPrice'),
  onRejectWeb,
}: CitationDrawerProps): ReactElement {
  const { state, retry } = useCitationDetail(citation, loaders);
  const title = citation ? t(TYPE_TITLE_KEY[citation.kind]) : t('citation.drawerTitle');

  return (
    <Drawer open={open && citation !== null} onClose={onClose} title={title} closeLabel={t('citation.close')}>
      {citation &&
        renderBody({
          citation,
          contextLine,
          loaders,
          state,
          retry,
          amountAsUnitPriceLabel,
          onRejectWeb,
        })}
    </Drawer>
  );
}

function renderBody(props: {
  citation: Citation;
  contextLine: BoqLine | undefined;
  loaders: CitationDrawerLoaders;
  state: CitationDetailState;
  retry: () => void;
  amountAsUnitPriceLabel: string;
  onRejectWeb: ((citation: Extract<Citation, { kind: 'web' }>) => void) | undefined;
}): ReactNode {
  const { citation, contextLine, loaders, state, retry, amountAsUnitPriceLabel, onRejectWeb } = props;

  if (state.status === 'loading') {
    return <LoadingState />;
  }
  if (state.status === 'error') {
    return <ErrorState message={state.message} onRetry={retry} />;
  }
  if (state.status === 'not-found') {
    return <NotFoundState id={citationIdentifier(citation)} reason={state.reason} />;
  }

  switch (citation.kind) {
    case 'budget_line':
      if (state.data.kind !== 'budget_line') return null;
      return (
        <BudgetLineBody
          key={citation.source_id}
          line={state.data.line}
          contextLine={contextLine}
          loaders={loaders}
          amountAsUnitPriceLabel={amountAsUnitPriceLabel}
        />
      );
    case 'document':
      if (state.data.kind !== 'document') return null;
      return <DocumentBody key={`${citation.doc_id}:${String(citation.page)}`} citation={citation} chunk={state.data.chunk} />;
    case 'econ':
      if (state.data.kind !== 'econ') return null;
      return (
        <EconBody key={`${citation.indicator}@${String(citation.year_be)}`} citation={citation} point={state.data.point} />
      );
    case 'web':
      return <WebBody key={citation.url} citation={citation} onReject={onRejectWeb} />;
  }
}

// ---------------------------------------------------------------------------
// สถานะร่วม (loading / error / not-found)
// ---------------------------------------------------------------------------

function LoadingState(): ReactElement {
  return (
    <div>
      <span className="sr-only" aria-live="polite">
        {t('common.loading')}
      </span>
      <div className="flex flex-col gap-2">
        <Skeleton height={20} width="60%" />
        <Skeleton height={16} />
        <Skeleton height={16} />
        <Skeleton height={16} width="80%" />
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }): ReactElement {
  return (
    <div role="alert" className="flex flex-col gap-3">
      <p className="text-danger">{t('errors.unknown', { detail: message })}</p>
      <Button variant="secondary" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}

/** `reason: 'noHint'` = ไฟล์/session นี้ไม่เคยเก็บตำแหน่งข้อมูลต้นทางของ citation นี้ไว้เลย (เช่นไฟล์
 * `.tgbp.json` เก่าก่อนมี `sourceShards` — ดู `LoadPage.tsx`) ต่างจาก "อ้างอิงไม่พบ" ทั่วไปซึ่งหมายถึงมี
 * hint แล้วแต่ค้นหาจริงไม่เจอ (อาจเป็นอ้างอิงปลอม) — ข้อความต้องไม่ทำให้เข้าใจผิดว่าอ้างอิงนี้ไม่จริง */
function NotFoundState({ id, reason }: { id: string; reason: 'noHint' | undefined }): ReactElement {
  const titleKey = reason === 'noHint' ? 'citation.lookupUnavailableTitle' : 'citation.notFoundTitle';
  const bodyKey = reason === 'noHint' ? 'citation.lookupUnavailableBody' : 'citation.notFoundBody';
  return (
    <div role="alert" className="flex flex-col gap-2">
      <p className="font-medium text-fg">{t(titleKey)}</p>
      <p className="text-fg-muted">{t(bodyKey, { id })}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="text-right text-fg">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// budget_line
// ---------------------------------------------------------------------------

type NeighborsState = { status: 'idle' } | CitationDetailState<BudgetLine[]>;

function BudgetLineBody({
  line,
  contextLine,
  loaders,
  amountAsUnitPriceLabel,
}: {
  line: BudgetLine;
  contextLine: BoqLine | undefined;
  loaders: CitationDrawerLoaders;
  amountAsUnitPriceLabel: string;
}): ReactElement {
  const [neighborsState, setNeighborsState] = useState<NeighborsState>({ status: 'idle' });

  async function handleLoadNeighbors(): Promise<void> {
    if (!loaders.loadNeighbors) return;
    setNeighborsState({ status: 'loading' });
    try {
      const rows = await loaders.loadNeighbors(line);
      setNeighborsState({ status: 'loaded', data: rows.slice(0, 10) });
    } catch (err) {
      setNeighborsState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {contextLine && (
        <div className="mb-2 flex items-center gap-2">
          <BasisBadge basis={contextLine.basis} label={t(BASIS_LABEL_KEY[contextLine.basis])} />
          <ConfidenceDots
            level={contextLine.confidence}
            label={t(CONFIDENCE_LABEL_KEY[contextLine.confidence])}
          />
        </div>
      )}

      <Row label={t('citation.budgetLine.itemFull')} value={line.item_name_raw} />
      <Row label={t('citation.typeLabel')} value={datasetTypeLabel(line.dataset, line.fiscal_year_be)} />
      <Row label={t('citation.budgetLine.year')} value={formatFiscalYearBe(line.fiscal_year_be, { withEra: true })} />
      {line.ministry !== null && <Row label={t('citation.budgetLine.ministry')} value={line.ministry} />}
      {line.agency !== null && <Row label={t('citation.budgetLine.agency')} value={line.agency} />}
      {line.plan !== null && <Row label={t('citation.budgetLine.program')} value={line.plan} />}
      {(line.province !== null || line.local_gov_name !== null) && (
        <Row label={t('citation.budgetLine.province')} value={line.province ?? line.local_gov_name ?? ''} />
      )}
      {line.item_qty !== null && <Row label={t('proposal.boq.colQty')} value={formatNumber(line.item_qty)} />}
      {line.item_unit !== null && <Row label={t('proposal.boq.colUnit')} value={line.item_unit} />}

      {line.unit_price_thb !== null ? (
        <Row label={t('proposal.boq.colUnitPrice')} value={formatThb(line.unit_price_thb)} />
      ) : (
        <div
          role="note"
          className="my-1.5 flex items-center gap-2 rounded-sm border border-warn bg-surface-2 px-2 py-1 text-sm text-warn"
        >
          <span aria-hidden="true">!</span>
          <span>{amountAsUnitPriceLabel}</span>
        </div>
      )}

      {line.amount_thb !== null && <Row label={t('citation.budgetLine.amountAct')} value={formatThb(line.amount_thb)} />}
      {line.revised_thb !== null && (
        <Row label={t('citation.budgetLine.amountAfterTransfer')} value={formatThb(line.revised_thb)} />
      )}
      {line.po_thb !== null && <Row label={t('citation.budgetLine.amountPo')} value={formatThb(line.po_thb)} />}
      {line.disbursed_thb !== null && (
        <Row label={t('citation.budgetLine.amountDisbursed')} value={formatThb(line.disbursed_thb)} />
      )}
      {line.disbursement_rate !== null && (
        <p className="mt-1 text-sm text-fg-muted">
          {t('citation.budgetLine.disbursedPercent', { percent: formatPercent(line.disbursement_rate, { alreadyPercent: false, withSymbol: false }) })}
        </p>
      )}

      {line.quality_flags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <h3 className="sr-only">{t('citation.flags.title')}</h3>
          {line.quality_flags.map((flag) => {
            const display = describeQualityFlag(flag, { page: line.source_page });
            return (
              <Tooltip key={flag} content={display.full}>
                <span
                  tabIndex={0}
                  aria-label={t('a11y.flagBadge', { flag: display.short })}
                  className="inline-flex items-center gap-1 rounded-sm border border-line bg-surface-2 px-2 py-0.5 text-xs text-fg-muted"
                >
                  <span aria-hidden="true">!</span>
                  {display.short}
                </span>
              </Tooltip>
            );
          })}
        </div>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <h3 className="mb-1 text-sm font-semibold text-fg">{t('citation.sourcePath')}</h3>
        <div className="flex items-center gap-2">
          <span className="break-all font-mono text-xs text-fg">{line.source_path}</span>
          <CopyButton value={line.source_path}>{t('citation.copyPath')}</CopyButton>
        </div>
        <p className="mt-1 text-sm text-fg-muted">
          {t('citation.sheet')}: {line.source_sheet} · {t('citation.row', { row: line.source_row })}
          {line.source_page !== null ? ` · ${t('citation.page', { page: line.source_page })}` : ''}
        </p>
      </div>

      {loaders.loadNeighbors && (
        <div className="mt-4 border-t border-line pt-3">
          <Button
            variant="secondary"
            size="sm"
            status={neighborsState.status === 'loading' ? 'loading' : 'idle'}
            onClick={() => {
              void handleLoadNeighbors();
            }}
          >
            {t('citation.nearbyRows')}
          </Button>
          <p className="mt-1 text-xs text-fg-muted">{t('citation.nearbyRowsHint')}</p>
          <div aria-live="polite">
            {neighborsState.status === 'loaded' &&
              (neighborsState.data.length === 0 ? (
                <p className="mt-2 text-sm text-fg-muted">{t('citation.nearbyRowsEmpty')}</p>
              ) : (
                <Table className="mt-2">
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>{t('citation.budgetLine.itemFull')}</TableHeaderCell>
                      <TableHeaderCell numeric>{t('proposal.boq.colAmount')}</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {neighborsState.data.map((row) => (
                      <TableRow key={row.source_id}>
                        <TableCell>{row.item_name_raw}</TableCell>
                        <TableCell numeric>
                          {row.amount_thb !== null ? formatThb(row.amount_thb) : t('common.unknown')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ))}
            {neighborsState.status === 'error' && (
              <p className="mt-2 text-sm text-danger">{t('errors.unknown', { detail: neighborsState.message })}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// document
// ---------------------------------------------------------------------------

function DocumentBody({
  citation,
  chunk,
}: {
  citation: Extract<Citation, { kind: 'document' }>;
  chunk: DocumentChunkView;
}): ReactElement {
  const excerpt = citation.quote ?? (chunk.isScanned ? undefined : chunk.text || undefined);
  const pageForScannedNotice = citation.page ?? chunk.page ?? undefined;

  return (
    <div className="flex flex-col gap-2">
      <Row label={t('citation.document.docTitle')} value={chunk.title} />
      {chunk.page !== null && <p className="text-sm text-fg-muted">{t('citation.page', { page: chunk.page })}</p>}

      {chunk.isScanned && (
        <div className="rounded-sm border border-warn bg-surface-2 p-2 text-warn">
          <p className="font-medium">{t('citation.document.scannedBadge')}</p>
          <p className="mt-1 text-sm">
            {t('citation.document.scannedBody', { page: pageForScannedNotice ?? t('common.unknown') })}
          </p>
        </div>
      )}

      {!chunk.isScanned && excerpt !== undefined && excerpt !== '' && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-fg">{t('citation.excerpt')}</h3>
          <p className="whitespace-pre-wrap text-sm text-fg-muted">{excerpt}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// econ
// ---------------------------------------------------------------------------

function EconBody({
  citation,
  point,
}: {
  citation: Extract<Citation, { kind: 'econ' }>;
  point: EconPointView;
}): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <Row label={t('citation.econ.indicator')} value={point.label} />
      <Row label={t('citation.econ.year')} value={formatFiscalYearBe(citation.year_be, { withEra: true })} />
      <Row label={t('citation.econ.value')} value={point.value !== null ? formatNumber(point.value) : t('common.unknown')} />
      <Row label={t('citation.econ.unit')} value={point.unit || t('common.unknown')} />

      {point.verified ? (
        <span className="inline-flex w-fit items-center gap-1 rounded-sm bg-surface-2 px-2 py-0.5 text-xs text-success">
          {t('citation.econ.verified')}
        </span>
      ) : (
        <div className="rounded-sm border border-warn bg-surface-2 p-2 text-warn">
          <p className="font-medium">{t('citation.econ.unverified')}</p>
          <p className="mt-1 text-sm">{t('citation.econ.unverifiedBody')}</p>
        </div>
      )}

      {(point.sourceUrl !== undefined || point.sourceName !== undefined) && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-fg">{t('citation.econ.sourceUrl')}</h3>
          {point.sourceUrl !== undefined ? (
            <ExternalLink href={point.sourceUrl}>{point.sourceName ?? point.sourceUrl}</ExternalLink>
          ) : (
            <p className="text-sm text-fg-muted">{point.sourceName}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// web
// ---------------------------------------------------------------------------

function WebBody({
  citation,
  onReject,
}: {
  citation: Extract<Citation, { kind: 'web' }>;
  onReject: ((citation: Extract<Citation, { kind: 'web' }>) => void) | undefined;
}): ReactElement {
  const domain = getWebDomain(citation.url);

  return (
    <div className="flex flex-col gap-3">
      <ExternalLink href={citation.url} className="text-base font-medium">
        {citation.title ?? citation.url}
      </ExternalLink>

      <Row label={t('citation.web.domain')} value={domain ?? t('common.unknown')} />

      <div className="flex flex-col gap-1">
        <span className="text-sm text-fg-muted">{t('citation.web.url')}</span>
        <div className="flex items-center gap-2">
          <span className="break-all font-mono text-xs text-fg">{citation.url}</span>
          <CopyButton value={citation.url}>{t('common.copy')}</CopyButton>
        </div>
      </div>

      {citation.price_note !== undefined && <Row label={t('citation.web.priceNote')} value={citation.price_note} />}

      <p className="text-sm text-fg-muted">{t('citation.retrievedAt', { date: formatCitationDate(citation.retrieved_at) })}</p>

      <p className="rounded-sm bg-surface-2 p-2 text-xs text-fg-muted">{t('citation.web.caution')}</p>

      {onReject && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            onReject(citation);
          }}
        >
          {t('citation.web.reject')}
        </Button>
      )}
    </div>
  );
}
