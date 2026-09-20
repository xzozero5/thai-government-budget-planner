/**
 * T-410 S14 (po-review ชุด B) — สร้างข้อความสรุปโครงการแบบ markdown ล้วน สำหรับปุ่ม "คัดลอกสรุป"
 * (`ProposalPane` ต่อกับ `CopyButton`) — pure function ไม่มี React/DOM ในไฟล์นี้ ทดสอบได้โดยไม่ต้อง render
 *
 * N3: ทุกบรรทัด BOQ ที่ `basis='estimate'` ต้องติดป้ายว่าเป็นประมาณการเสมอ — คอลัมน์ "ที่มา" ของตาราง
 * ใช้ label ไทยเดียวกับ UI ผ่าน `t('proposal.basis.<basis>')` (ไม่ hard-code ซ้ำ) จึงเห็นคำว่า "ประมาณการ"
 * ตรงกับที่ตารางบนเว็บแสดงเป๊ะ
 */
import { t } from '@/i18n';
import { formatNumber } from '@/lib/format';
import type { BoqLine, Proposal } from './types';

const BASIS_LABEL_KEY = {
  historical: 'proposal.basis.historical',
  market: 'proposal.basis.market',
  estimate: 'proposal.basis.estimate',
} as const;

/** markdown table cell ต้องไม่มี `|`/ขึ้นบรรทัดใหม่ค้างอยู่ (ทำตารางพัง) */
function escapeMarkdownCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function boqRowMarkdown(line: BoqLine): string {
  const basisLabel = t(BASIS_LABEL_KEY[line.basis]);
  return [
    escapeMarkdownCell(line.item),
    formatNumber(line.qty),
    escapeMarkdownCell(line.unit),
    formatNumber(line.unit_price_thb),
    formatNumber(line.total_thb),
    basisLabel,
  ]
    .map((cell) => `| ${cell} `)
    .join('') + '|';
}

/** สรุปโครงการแบบ markdown ล้วน: ชื่อ, สรุป, ยอดรวม, ตาราง BOQ ย่อ (พร้อมป้ายที่มา/ประมาณการทุกบรรทัด) */
export function buildSummaryMarkdown(proposal: Proposal): string {
  const lines: string[] = [];
  lines.push(`# ${proposal.title}`);
  lines.push('');
  lines.push(proposal.summary);
  lines.push('');
  lines.push(
    `**${t('proposal.totalLabel')}:** ${t('proposal.totalValue', {
      amount: formatNumber(proposal.totals.grand_total_thb),
    })}`,
  );

  if (proposal.boq.length > 0) {
    lines.push('');
    lines.push(`## ${t('proposal.sections.boq')}`);
    lines.push('');
    lines.push(
      `| ${t('proposal.boq.colItem')} | ${t('proposal.boq.colQty')} | ${t('proposal.boq.colUnit')} | ${t(
        'proposal.boq.colUnitPrice',
      )} | ${t('proposal.boq.colAmount')} | ${t('proposal.boq.colBasis')} |`,
    );
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const line of proposal.boq) {
      lines.push(boqRowMarkdown(line));
    }
  }

  return lines.join('\n');
}
