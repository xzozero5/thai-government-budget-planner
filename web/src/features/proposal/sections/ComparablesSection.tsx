/**
 * T-406 — เทียบเคียงงบในอดีต (05 §5 `comparables[]` — ข้อเท็จจริงจาก `SourceFingerprint`, ไม่ใช่การ
 * ประมาณของโมเดล — ดูคอมเมนต์ `ai/tools/proposal.ts` เรื่อง `reconcileComparable`)
 *
 * [MISSING COPY KEY] ไม่มีชุด key เฉพาะของตาราง comparables ใน `docs/ui/copy.th.json`
 * (`proposal.comparables.*`) — ยืมหัวคอลัมน์จาก `citation.budgetLine.*`/`proposal.boq.*` ที่ความหมาย
 * ตรงกันแทน (ปี/หน่วยงาน/รายการเต็ม/ราคาต่อหน่วย) ยกเว้น "หมายเหตุความคล้ายกัน" ที่ไม่มี key ใกล้เคียง
 * เลยจึงใช้ข้อความคงที่
 */
import type { ReactElement } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui';
import { formatFiscalYearBe, formatThb } from '@/lib/format';
import { t } from '@/i18n';
import type { Comparable } from '../types';

const SIMILARITY_NOTE_LABEL_FALLBACK = 'ความคล้ายกับโครงการนี้';

export interface ComparablesSectionProps {
  comparables: readonly Comparable[];
}

export function ComparablesSection({ comparables }: ComparablesSectionProps): ReactElement {
  if (comparables.length === 0) {
    return <p className="text-sm text-fg-muted">{t('proposal.sections.empty')}</p>;
  }
  return (
    <Table>
      <caption className="sr-only">{t('proposal.sections.comparison')}</caption>
      <TableHead>
        <TableRow>
          <TableHeaderCell>{t('citation.budgetLine.year')}</TableHeaderCell>
          <TableHeaderCell>{t('citation.budgetLine.agency')}</TableHeaderCell>
          <TableHeaderCell>{t('citation.budgetLine.itemFull')}</TableHeaderCell>
          <TableHeaderCell numeric>{t('proposal.boq.colUnitPrice')}</TableHeaderCell>
          <TableHeaderCell numeric>{t('proposal.totalLabel')}</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {comparables.map((c) => (
          <TableRow key={c.source_id}>
            <TableCell numeric>{formatFiscalYearBe(c.fiscal_year_be, { withEra: true })}</TableCell>
            <TableCell>{c.agency}</TableCell>
            <TableCell>
              <span>{c.item_name}</span>
              <p className="mt-1 text-xs text-fg-muted">
                {SIMILARITY_NOTE_LABEL_FALLBACK}: {c.similarity_note}
              </p>
            </TableCell>
            <TableCell numeric>
              {c.unit_price_thb !== undefined ? formatThb(c.unit_price_thb) : '—'}
            </TableCell>
            <TableCell numeric>{formatThb(c.amount_thb)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
