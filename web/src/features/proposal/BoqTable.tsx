/**
 * T-406 — ตาราง BOQ (06 §4.3): group by category + subtotal, inline edit qty/ราคาต่อหน่วย, basis/
 * confidence badge, popover เหตุผล, sparkline slot, citation chips; มือถือ = การ์ดต่อแถว (best-effort)
 *
 * แถวใหม่/บรรทัดที่ยอดเปลี่ยน (เทียบกับ render ก่อนหน้า) highlight แล้วจางด้วย CSS transition ธรรมดา
 * (ไม่ใช่ `@keyframes` ใหม่) จึงเคารพ `prefers-reduced-motion` โดยอัตโนมัติผ่าน global override ใน
 * `src/styles/tokens.css` (บังคับ `transition-duration: 0.01ms` เมื่อผู้ใช้ตั้งค่า reduced motion)
 */
import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  BasisBadge,
  Button,
  Card,
  ConfidenceDots,
  ExternalLink,
  Popover,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tooltip,
} from '@/components/ui';
import type { Basis } from '@/components/ui';
import { CitationChip } from '@/features/citations';
import { formatFiscalYearBe, formatNumber, formatThb } from '@/lib/format';
import { t } from '@/i18n';
import { BoqInlineEditCell } from './BoqInlineEditCell';
import { useProposalReadOnly } from './readOnlyContext';
import { citationChipLabel, isWebCitation } from './citationLabel';
import { QTY_MAX, UNIT_PRICE_MAX_THB } from './recompute';
import type { BoqLine, Citation, Proposal, TrendRef } from './types';

const BASIS_LABEL_KEY: Record<Basis, 'historical' | 'market' | 'estimate'> = {
  historical: 'historical',
  market: 'market',
  estimate: 'estimate',
};

const CONFIDENCE_TOOLTIP_KEY = {
  high: 'proposal.confidence.highTooltip',
  medium: 'proposal.confidence.mediumTooltip',
  low: 'proposal.confidence.lowTooltip',
} as const;

const CONFIDENCE_LABEL_KEY = {
  high: 'proposal.confidence.high',
  medium: 'proposal.confidence.medium',
  low: 'proposal.confidence.low',
} as const;

/** ปุ่ม "ให้ AI ทบทวน" ต่อแถว — ซ่อนในโหมดอ่านอย่างเดียว (หน้า /load ไม่มี AI session) */
function ReviewLineButton({
  lineId,
  onRequestReview,
}: {
  lineId: string;
  onRequestReview: (lineId?: string) => void;
}): ReactElement | null {
  const readOnly = useProposalReadOnly();
  if (readOnly) {
    return null;
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        onRequestReview(lineId);
      }}
    >
      {t('proposal.reviewWithAi')}
    </Button>
  );
}

export interface BoqTableProps {
  proposal: Proposal;
  editedLineIds: readonly string[];
  onEditLine: (lineId: string, patch: { qty?: number; unit_price_thb?: number }) => void;
  onRequestReview: (lineId?: string) => void;
  onOpenCitation: (citation: Citation, line: BoqLine) => void;
  renderTrend?: ((trendRef: TrendRef) => ReactNode) | undefined;
  /** ป้าย citation chip แบบละเอียด (เช่น "PBO 2566 · กรมพลังงาน") — ไม่ส่งมา/คืน `undefined` ต่อ
   * citation หนึ่ง ๆ = ใช้ label ย่อเดิมจาก `citationChipLabel` (ไม่ทำลาย test เดิมของ T-406) */
  resolveCitationLabel?: ((citation: Citation) => string | undefined) | undefined;
  /** M2 (06 §4.3, po-review): citation นี้ resolve กับข้อมูล/ToolLog ปัจจุบันไม่ได้ → แสดง badge เทา
   * "อ้างอิงไม่พบ" — ไม่ส่ง prop นี้มา (เช่นหน้า `/load` ที่ไม่มี ToolLog) = ไม่ตัดสิน ไม่แสดง badge เลย */
  isCitationUnresolved?: ((citation: Citation) => boolean) | undefined;
}

interface CategoryGroup {
  category: string;
  lines: BoqLine[];
}

function groupByCategory(boq: readonly BoqLine[]): CategoryGroup[] {
  const groups: CategoryGroup[] = [];
  const index = new Map<string, CategoryGroup>();
  for (const line of boq) {
    let group = index.get(line.category);
    if (!group) {
      group = { category: line.category, lines: [] };
      index.set(line.category, group);
      groups.push(group);
    }
    group.lines.push(line);
  }
  return groups;
}

/** ตรวจว่าบรรทัดไหน "ใหม่/เปลี่ยนยอด" เทียบกับ render ก่อนหน้า สำหรับ highlight motion */
function useChangedLineIds(boq: readonly BoqLine[]): Set<string> {
  const prevRef = useRef<Map<string, number> | null>(null);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());

  useEffect(() => {
    const prev = prevRef.current;
    const changed = new Set<string>();
    for (const line of boq) {
      const prevTotal = prev?.get(line.id);
      if (prevTotal === undefined || prevTotal !== line.total_thb) {
        changed.add(line.id);
      }
    }
    prevRef.current = new Map(boq.map((line) => [line.id, line.total_thb]));
    if (changed.size === 0) {
      return;
    }
    setHighlighted(changed);
    const timer = window.setTimeout(() => {
      setHighlighted(new Set());
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ตั้งใจ track เฉพาะ boq (ไม่ใช่ทุก prop ของ component แม่)
  }, [boq]);

  return highlighted;
}

function RationalePopover({ line }: { line: BoqLine }): ReactElement {
  return (
    <Popover triggerLabel="ⓘ">
      <h4 className="mb-1 font-medium text-fg">{t('proposal.boq.whyTitle')}</h4>
      <p className="max-w-72 text-fg">{line.rationale}</p>
      {line.price_derivation && (
        <p className="mt-2 max-w-72 border-t border-line pt-2 text-xs text-fg-muted">
          {formatThb(line.price_derivation.from_amount_thb)} (
          {formatFiscalYearBe(line.price_derivation.from_year_be, { withEra: true })}) × factor{' '}
          {formatNumber(line.price_derivation.factor, { fractionDigits: 4 })} (
          {line.price_derivation.indicator}) →{' '}
          {formatFiscalYearBe(line.price_derivation.to_year_be, { withEra: true })}
        </p>
      )}
    </Popover>
  );
}

/** M2: badge เล็ก ๆ "อ้างอิงไม่พบ" — ใช้ทั้งกรณีไม่มี citation เหลือเลยในบรรทัดที่ basis≠estimate และ
 * กรณี citation ของ kind='web' (ซึ่งคง markup เดิมของ T-406 ไว้เป๊ะแทนการเปลี่ยนไปใช้ `CitationChip` ทั้งก้อน
 * — ดูคอมเมนต์ `CitationChips` ด้านล่างเรื่อง aria-label ที่ต้องคงเดิม) resolve ไม่ได้ */
function UnresolvedBadge(): ReactElement {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-danger">
      <span aria-hidden="true">!</span>
      {t('proposal.citationUnresolved')}
    </span>
  );
}

function CitationChips({
  line,
  onOpenCitation,
  resolveCitationLabel,
  isCitationUnresolved,
}: {
  line: BoqLine;
  onOpenCitation: (citation: Citation, line: BoqLine) => void;
  resolveCitationLabel?: ((citation: Citation) => string | undefined) | undefined;
  isCitationUnresolved?: ((citation: Citation) => boolean) | undefined;
}): ReactElement {
  if (line.citations.length === 0) {
    // M2 (po-review): บรรทัดที่ basis≠estimate ต้องมี citation รองรับ — ถ้าหลุดมาจนไม่มี citation
    // เหลือเลย (เช่น validator ตัดทิ้งหมดเพราะอ้างอิงไม่พบ) ต้องเตือนแทน "—" เฉย ๆ
    if (line.basis !== 'estimate') {
      return <UnresolvedBadge />;
    }
    return <span className="text-xs text-fg-muted">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {line.citations.map((citation, index) => {
        const label = resolveCitationLabel?.(citation) ?? citationChipLabel(citation);
        const unresolved = isCitationUnresolved?.(citation) ?? false;
        // kind='web' คงโครงสร้างเดิมของ T-406 ไว้เป๊ะ (ลิงก์เปิดแท็บใหม่ https + ปุ่มเปิด drawer แยก
        // aria-label={t('citation.drawerTitle')}) แทนการสลับไปใช้ `CitationChip` ทั้งก้อน — `CitationChip`
        // ใช้ `t('a11y.citationDrawer')` เป็น aria-label ของปุ่มนี้ ซึ่งเป็นข้อความคนละคำ (เปลี่ยนแล้วเสี่ยง
        // ชน e2e/a11y test ที่อ้าง aria-label เดิม ตามกฎห้ามเปลี่ยน aria-label ที่มีอยู่)
        if (isWebCitation(citation)) {
          return (
            <span key={`${line.id}-${String(index)}`} className="inline-flex items-center gap-1">
              <ExternalLink href={citation.url} hideCopyButton>
                {label}
              </ExternalLink>
              <button
                type="button"
                aria-label={t('citation.drawerTitle')}
                onClick={() => {
                  onOpenCitation(citation, line);
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-fg-muted hover:bg-surface-2"
              >
                ⓘ
              </button>
              {unresolved && <UnresolvedBadge />}
            </span>
          );
        }
        // M2: kind อื่น ๆ ใช้ `CitationChip` ของ `@/features/citations` แทน `Chip` เปล่าเดิม (คง
        // onClick/label เดิมทุกอย่าง — accessible name ของปุ่มยังเป็น `label` เหมือนก่อน เพราะ mark
        // ประเภทแหล่งของ `CitationChip` เป็น `aria-hidden`)
        return (
          <CitationChip
            key={`${line.id}-${String(index)}`}
            citation={citation}
            onOpenDrawer={() => {
              onOpenCitation(citation, line);
            }}
            label={label}
            unresolved={unresolved}
          />
        );
      })}
    </div>
  );
}

function TrendCell({
  line,
  renderTrend,
}: {
  line: BoqLine;
  renderTrend: ((trendRef: TrendRef) => ReactNode) | undefined;
}): ReactElement {
  if (!line.trend_ref) {
    return <span className="text-xs text-fg-muted">{t('proposal.boq.trendEmpty')}</span>;
  }
  if (!renderTrend) {
    return <span className="text-xs text-fg-muted">—</span>;
  }
  return <>{renderTrend(line.trend_ref)}</>;
}

function BoqLineRow({
  line,
  edited,
  highlighted,
  onEditLine,
  onRequestReview,
  onOpenCitation,
  renderTrend,
  resolveCitationLabel,
  isCitationUnresolved,
}: {
  line: BoqLine;
  edited: boolean;
  highlighted: boolean;
  onEditLine: (lineId: string, patch: { qty?: number; unit_price_thb?: number }) => void;
  onRequestReview: (lineId?: string) => void;
  onOpenCitation: (citation: Citation, line: BoqLine) => void;
  renderTrend: ((trendRef: TrendRef) => ReactNode) | undefined;
  resolveCitationLabel?: ((citation: Citation) => string | undefined) | undefined;
  isCitationUnresolved?: ((citation: Citation) => boolean) | undefined;
}): ReactElement {
  return (
    <TableRow
      className={[
        'align-top transition-colors duration-[1200ms] ease-out',
        edited ? 'border-l-2 border-accent' : '',
        highlighted ? 'bg-basis-historical-bg' : 'bg-transparent',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <TableCell>
        <div className="font-medium text-fg">{line.item}</div>
        {line.spec !== undefined && <div className="text-xs text-fg-muted">{line.spec}</div>}
        {edited && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-sm bg-surface-2 px-2 py-0.5 text-xs font-medium text-accent">
              {t('proposal.boq.editedBadge')}
            </span>
            <ReviewLineButton lineId={line.id} onRequestReview={onRequestReview} />
          </div>
        )}
      </TableCell>
      <TableCell numeric>
        <BoqInlineEditCell
          value={line.qty}
          max={QTY_MAX}
          ariaLabel={t('proposal.boq.editQty', { item: line.item })}
          formatValue={(v) => formatNumber(v)}
          onCommit={(qty) => {
            onEditLine(line.id, { qty });
          }}
        />
      </TableCell>
      <TableCell>{line.unit}</TableCell>
      <TableCell numeric>
        <BoqInlineEditCell
          value={line.unit_price_thb}
          max={UNIT_PRICE_MAX_THB}
          ariaLabel={t('proposal.boq.editPrice', { item: line.item })}
          formatValue={(v) => formatNumber(v)}
          onCommit={(unit_price_thb) => {
            onEditLine(line.id, { unit_price_thb });
          }}
        />
      </TableCell>
      <TableCell numeric>{formatNumber(line.total_thb)}</TableCell>
      <TableCell>
        <BasisBadge basis={line.basis} label={t(`proposal.basis.${BASIS_LABEL_KEY[line.basis]}`)} />
      </TableCell>
      <TableCell>
        <Tooltip content={t(CONFIDENCE_TOOLTIP_KEY[line.confidence])}>
          <span tabIndex={0}>
            <ConfidenceDots
              level={line.confidence}
              label={t(CONFIDENCE_LABEL_KEY[line.confidence])}
            />
          </span>
        </Tooltip>
      </TableCell>
      <TableCell>
        <RationalePopover line={line} />
      </TableCell>
      <TableCell>
        <TrendCell line={line} renderTrend={renderTrend} />
      </TableCell>
      <TableCell>
        <CitationChips
          line={line}
          onOpenCitation={onOpenCitation}
          resolveCitationLabel={resolveCitationLabel}
          isCitationUnresolved={isCitationUnresolved}
        />
      </TableCell>
    </TableRow>
  );
}

function BoqLineCard({
  line,
  edited,
  onEditLine,
  onRequestReview,
  onOpenCitation,
  resolveCitationLabel,
  isCitationUnresolved,
}: {
  line: BoqLine;
  edited: boolean;
  onEditLine: (lineId: string, patch: { qty?: number; unit_price_thb?: number }) => void;
  onRequestReview: (lineId?: string) => void;
  onOpenCitation: (citation: Citation, line: BoqLine) => void;
  resolveCitationLabel?: ((citation: Citation) => string | undefined) | undefined;
  isCitationUnresolved?: ((citation: Citation) => boolean) | undefined;
}): ReactElement {
  return (
    <Card className="space-y-2">
      <div className="font-medium text-fg">{line.item}</div>
      <div className="flex items-center gap-2 text-sm text-fg">
        <BoqInlineEditCell
          value={line.qty}
          max={QTY_MAX}
          ariaLabel={t('proposal.boq.editQty', { item: line.item })}
          formatValue={(v) => formatNumber(v)}
          onCommit={(qty) => {
            onEditLine(line.id, { qty });
          }}
        />
        <span>{line.unit}</span>
        <span>×</span>
        <BoqInlineEditCell
          value={line.unit_price_thb}
          max={UNIT_PRICE_MAX_THB}
          ariaLabel={t('proposal.boq.editPrice', { item: line.item })}
          formatValue={(v) => formatNumber(v)}
          onCommit={(unit_price_thb) => {
            onEditLine(line.id, { unit_price_thb });
          }}
        />
        <span>= {formatNumber(line.total_thb)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <BasisBadge basis={line.basis} label={t(`proposal.basis.${BASIS_LABEL_KEY[line.basis]}`)} />
        <ConfidenceDots level={line.confidence} label={t(CONFIDENCE_LABEL_KEY[line.confidence])} />
      </div>
      <CitationChips
        line={line}
        onOpenCitation={onOpenCitation}
        resolveCitationLabel={resolveCitationLabel}
        isCitationUnresolved={isCitationUnresolved}
      />
      {edited && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-sm bg-surface-2 px-2 py-0.5 text-xs font-medium text-accent">
            {t('proposal.boq.editedBadge')}
          </span>
          <ReviewLineButton lineId={line.id} onRequestReview={onRequestReview} />
        </div>
      )}
    </Card>
  );
}

export function BoqTable({
  proposal,
  editedLineIds,
  onEditLine,
  onRequestReview,
  onOpenCitation,
  renderTrend,
  resolveCitationLabel,
  isCitationUnresolved,
}: BoqTableProps): ReactElement {
  const groups = groupByCategory(proposal.boq);
  const editedSet = new Set(editedLineIds);
  const highlighted = useChangedLineIds(proposal.boq);

  if (proposal.boq.length === 0) {
    return (
      <div className="py-6 text-center">
        <p className="font-medium text-fg">{t('proposal.boq.emptyTitle')}</p>
        <p className="mt-1 text-sm text-fg-muted">{t('proposal.boq.emptyBody')}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="hidden md:block" data-testid="boq-table-desktop">
        <Table>
          <caption className="sr-only">
            {t('proposal.boq.caption', { project: proposal.title, lines: proposal.boq.length })}
          </caption>
          <TableHead>
            <TableRow>
              <TableHeaderCell>{t('proposal.boq.colItem')}</TableHeaderCell>
              <TableHeaderCell numeric>{t('proposal.boq.colQty')}</TableHeaderCell>
              <TableHeaderCell>{t('proposal.boq.colUnit')}</TableHeaderCell>
              <TableHeaderCell numeric>{t('proposal.boq.colUnitPrice')}</TableHeaderCell>
              <TableHeaderCell numeric>{t('proposal.boq.colAmount')}</TableHeaderCell>
              <TableHeaderCell>{t('proposal.boq.colBasis')}</TableHeaderCell>
              <TableHeaderCell>{t('proposal.boq.colConfidence')}</TableHeaderCell>
              <TableHeaderCell>{t('proposal.boq.colWhy')}</TableHeaderCell>
              <TableHeaderCell>{t('proposal.boq.colTrend')}</TableHeaderCell>
              <TableHeaderCell>{t('proposal.boq.colCitations')}</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {groups.map((group) => {
              const subtotal = group.lines.reduce((sum, line) => sum + line.total_thb, 0);
              return (
                <Fragment key={group.category}>
                  <TableRow className="bg-surface-2">
                    <TableCell colSpan={10} className="font-semibold">
                      <span role="rowgroup">{group.category}</span>
                    </TableCell>
                  </TableRow>
                  {group.lines.map((line) => (
                    <BoqLineRow
                      key={line.id}
                      line={line}
                      edited={editedSet.has(line.id)}
                      highlighted={highlighted.has(line.id)}
                      onEditLine={onEditLine}
                      onRequestReview={onRequestReview}
                      onOpenCitation={onOpenCitation}
                      renderTrend={renderTrend}
                      resolveCitationLabel={resolveCitationLabel}
                      isCitationUnresolved={isCitationUnresolved}
                    />
                  ))}
                  <TableRow className="bg-surface-2 font-medium">
                    <TableCell colSpan={4}>
                      {t('proposal.boq.subtotal', { category: group.category })}
                    </TableCell>
                    <TableCell numeric>{formatNumber(subtotal)}</TableCell>
                    <TableCell colSpan={5} />
                  </TableRow>
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-3 md:hidden" data-testid="boq-cards-mobile">
        <p className="text-xs text-fg-muted">{t('proposal.boq.mobileHint')}</p>
        {proposal.boq.map((line) => (
          <BoqLineCard
            key={line.id}
            line={line}
            edited={editedSet.has(line.id)}
            onEditLine={onEditLine}
            onRequestReview={onRequestReview}
            onOpenCitation={onOpenCitation}
            resolveCitationLabel={resolveCitationLabel}
            isCitationUnresolved={isCitationUnresolved}
          />
        ))}
      </div>
    </div>
  );
}
