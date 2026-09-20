/**
 * T-406/T-410 M5 — เทียบเคียงงบในอดีต (05 §5 `comparables[]` — ข้อเท็จจริงจาก `SourceFingerprint`, ไม่ใช่
 * การประมาณของโมเดล — ดูคอมเมนต์ `ai/tools/proposal.ts` เรื่อง `reconcileComparable`)
 *
 * M5 (po-review ชุด B, US-3.1): ทุกแถวมี `source_id` เสมอ (ไม่ optional ใน `ComparableSchema`) จึงคลิก
 * เปิด citation drawer ได้ทุกแถวผ่าน `CitationChip` คอลัมน์ท้าย — `unit_price_thb` ที่เท่ากับ `amount_thb`
 * เป๊ะ (ไม่รู้ว่าเป็นราคาต่อหน่วยจริงหรือยอดรวมของบรรทัดงบที่ qty=1) ไม่ติดป้ายราคาต่อหน่วยซ้ำ (ดู
 * `shouldShowComparableUnitPrice` ใน `../comparablesDisplay.ts`)
 */
import type { ReactElement } from 'react';
import type { Citation } from '@/ai/tools/proposal';
import { CitationChip } from '@/features/citations';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui';
import { formatFiscalYearBe, formatThb } from '@/lib/format';
import { t } from '@/i18n';
import { shouldShowComparableUnitPrice } from '../comparablesDisplay';
import type { Comparable } from '../types';

export interface ComparablesSectionProps {
  comparables: readonly Comparable[];
  onOpenCitation: (citation: Citation) => void;
}

export function ComparablesSection({ comparables, onOpenCitation }: ComparablesSectionProps): ReactElement {
  if (comparables.length === 0) {
    return <p className="text-sm text-fg-muted">{t('proposal.sections.empty')}</p>;
  }
  return (
    <Table>
      <caption className="sr-only">{t('proposal.sections.comparison')}</caption>
      <TableHead>
        <TableRow>
          <TableHeaderCell>{t('proposal.comparables.fiscalYear')}</TableHeaderCell>
          <TableHeaderCell>{t('proposal.comparables.agency')}</TableHeaderCell>
          <TableHeaderCell>{t('proposal.comparables.item')}</TableHeaderCell>
          <TableHeaderCell numeric>{t('proposal.comparables.unitPrice')}</TableHeaderCell>
          <TableHeaderCell numeric>{t('proposal.comparables.amount')}</TableHeaderCell>
          <TableHeaderCell>{t('proposal.boq.colCitations')}</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {comparables.map((c) => {
          const showUnitPrice = shouldShowComparableUnitPrice(c);
          const citation: Citation = { kind: 'budget_line', source_id: c.source_id };
          return (
            <TableRow key={c.source_id}>
              <TableCell numeric>{formatFiscalYearBe(c.fiscal_year_be, { withEra: true })}</TableCell>
              <TableCell>{c.agency}</TableCell>
              <TableCell>
                <span>{c.item_name}</span>
                <p className="mt-1 text-xs text-fg-muted">
                  {t('proposal.comparables.note')}: {c.similarity_note}
                </p>
              </TableCell>
              <TableCell numeric>{showUnitPrice ? formatThb(c.unit_price_thb ?? 0) : '—'}</TableCell>
              <TableCell numeric>{formatThb(c.amount_thb)}</TableCell>
              <TableCell>
                <CitationChip
                  citation={citation}
                  onOpenDrawer={() => {
                    onOpenCitation(citation);
                  }}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
