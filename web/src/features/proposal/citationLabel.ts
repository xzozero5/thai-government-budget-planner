/**
 * T-406 — ป้ายข้อความสั้นของ citation ใช้กับ Chip ในตาราง BOQ/audit findings
 *
 * `Citation` (จาก `ai/tools/proposal.ts`) เก็บแค่ id อ้างอิง (source_id/doc_id) ไม่มีชื่อกระทรวง/
 * หน่วยงานที่ resolve แล้วแนบมาด้วย (ข้อมูลนั้นอยู่ใน `ToolLog`/citation drawer ซึ่งเป็นคนละ feature
 * — `features/citations/**`, กำลังทำขนานและห้าม import) ป้ายที่นี่จึงเป็นเวอร์ชัน "ดีที่สุดเท่าที่มีตาม
 * props" เท่านั้น ไม่ใช่ label เต็มแบบ "PBO 2566 · กรมพลังงาน" ตามตัวอย่างใน 06 §4.3 — เมื่อ container
 * ต่อกับ citation drawer/ToolLog จริงในภายหลัง ควรพิจารณาส่ง label ที่ resolve แล้วมาแทนผ่าน props ใหม่
 */
import { formatFiscalYearBe } from '@/lib/format';
import { t } from '@/i18n';
import type { Citation } from './types';

export function citationChipLabel(citation: Citation): string {
  switch (citation.kind) {
    case 'budget_line':
      return citation.note ?? `${t('citation.types.budget_line_short')} · ${citation.source_id}`;
    case 'document':
      return citation.doc_id;
    case 'econ':
      return `${citation.indicator} · ${formatFiscalYearBe(citation.year_be, { withEra: true })}`;
    case 'web':
      return citation.title ?? citation.url;
  }
}

export function isWebCitation(citation: Citation): citation is Extract<Citation, { kind: 'web' }> {
  return citation.kind === 'web';
}
