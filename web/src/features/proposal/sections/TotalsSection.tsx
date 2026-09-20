/**
 * T-410 M6 (po-review ชุด B, US-1.2/US-3.1) — section "สรุปยอดรวม": subtotal, ค่าเผื่อเหลือเผื่อขาด
 * (% + จำนวนเงิน), VAT/หมายเหตุรวม VAT, รวมทั้งสิ้น — ตามโครง `Totals` จริง (05 §5) ไม่ใช่ accordion item
 * (แสดงเสมอ ไม่ต้องกดขยาย เพราะเป็นสรุปสำคัญเทียบเท่า PDF) ยอดรวมที่ header ของ proposal ยังอยู่เหมือนเดิม
 * (`ProposalHeader` — ไม่ถูกแตะ) ที่นี่เป็นรายละเอียดเพิ่มเติมของโครง totals ทั้งก้อน
 */
import type { ReactElement } from 'react';
import { formatNumber } from '@/lib/format';
import { t } from '@/i18n';
import { computeContingencyDisplay } from '../totalsDisplay';
import type { Totals } from '../types';

export interface TotalsSectionProps {
  totals: Totals;
}

function Row({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="font-medium text-fg">{value}</span>
    </div>
  );
}

export function TotalsSection({ totals }: TotalsSectionProps): ReactElement {
  const contingency = computeContingencyDisplay(totals);

  return (
    <section
      aria-label={t('proposal.sections.totals')}
      className="rounded-md border border-line bg-surface-2 p-3"
    >
      <h3 className="mb-1 text-sm font-semibold text-fg">{t('proposal.sections.totals')}</h3>
      <Row
        label={t('proposal.totals.subtotal')}
        value={t('proposal.totalValue', { amount: formatNumber(totals.subtotal_thb) })}
      />
      {contingency && (
        <Row
          label={t('proposal.totals.contingency')}
          value={
            contingency.pct !== null
              ? t('proposal.totals.contingencyValue', {
                  percent: formatNumber(contingency.pct),
                  amount: formatNumber(contingency.amountThb),
                })
              : t('proposal.totalValue', { amount: formatNumber(contingency.amountThb) })
          }
        />
      )}
      <Row
        label={t('proposal.totals.vat')}
        value={totals.vat_included ? t('proposal.totals.vatIncluded') : t('proposal.totals.vatExcluded')}
      />
      <Row
        label={t('proposal.totals.grandTotal')}
        value={t('proposal.totalValue', { amount: formatNumber(totals.grand_total_thb) })}
      />
    </section>
  );
}
