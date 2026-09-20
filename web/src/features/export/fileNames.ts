/**
 * T-502 — ชื่อไฟล์ `.tgbp.json` จากชื่อโครงการ ปลอดภัยบน Windows (ตัดอักขระต้องห้าม `< > : " / \ | ? *`
 * และช่องว่าง/จุดต่อท้าย) — แยกเป็นไฟล์ของตัวเองแทนการนำ `buildPdfFileName` (`./pdf/renderProposalPdf.tsx`)
 * มาใช้ซ้ำ เพราะไฟล์นั้นเป็นเจ้าของโดย agent อื่น (ห้ามแก้) และผูกกับนามสกุล `.pdf`/รูปแบบ proposal โดยเฉพาะ
 */

// eslint-disable-next-line no-control-regex -- ตั้งใจตัดอักขระควบคุมออกจากชื่อไฟล์ (Windows ห้ามใช้)
const WINDOWS_FORBIDDEN_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
const MAX_FILENAME_LENGTH = 120;
const FALLBACK_TITLE = 'ข้อเสนอโครงการ';

/** สร้างชื่อไฟล์ `.tgbp.json` ที่ปลอดภัยบน Windows จากชื่อโครงการ */
export function buildTgbpFileName(title: string): string {
  const cleaned = title
    .replace(WINDOWS_FORBIDDEN_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FILENAME_LENGTH)
    .replace(/[. ]+$/, '');
  const base = cleaned.length > 0 ? cleaned : FALLBACK_TITLE;
  return `${base}.tgbp.json`;
}
