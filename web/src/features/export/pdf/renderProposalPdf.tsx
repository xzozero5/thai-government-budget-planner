/**
 * T-501 — public entry point ของ PDF export: `renderProposalPdf` + `buildPdfFileName`
 *
 * `@react-pdf/renderer` (456 KB gz — docs/decisions/SPIKES.md §S4) ต้อง**ไม่**อยู่ใน initial bundle
 * (04-ARCHITECTURE.md §5 performance budget) ⇒ ไฟล์นี้**ห้ามมี static import ของ
 * `@react-pdf/renderer` หรือ `./ProposalDocument`/`./fonts`** เด็ดขาด — ทุกอย่างต้องมาจาก
 * dynamic `import()` ข้างในฟังก์ชันเท่านั้น เพื่อให้ Rollup/Vite แยกเป็น lazy chunk แยกต่างหาก
 * (ตรวจด้วย `npx vite build` แล้วดู manifest ว่า chunk ของ react-pdf ไม่ถูกดึงเข้า initial JS)
 */
import type { RenderProposalPdfInput } from './types';

// eslint-disable-next-line no-control-regex -- ตั้งใจตัดอักขระควบคุมออกจากชื่อไฟล์ (Windows ห้ามใช้)
const WINDOWS_FORBIDDEN_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
const MAX_FILENAME_LENGTH = 120;

/** สร้างชื่อไฟล์ `.pdf` จากชื่อโครงการ — ตัดอักขระต้องห้ามของ Windows ออก (ภาษาไทยใช้ได้ปกติ) */
export function buildPdfFileName(proposal: { title: string; requester_context: { fiscal_year_be: number } }): string {
  const cleanedTitle = proposal.title
    .replace(WINDOWS_FORBIDDEN_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FILENAME_LENGTH)
    .replace(/[. ]+$/, ''); // Windows ห้ามลงท้ายด้วยจุด/ช่องว่าง
  const base = cleanedTitle.length > 0 ? cleanedTitle : 'ข้อเสนอโครงการ';
  return `${base} (ปีงบประมาณ ${String(proposal.requester_context.fiscal_year_be)}).pdf`;
}

/**
 * Render `Proposal` เป็น PDF `Blob` (พร้อม download/save ในเบราว์เซอร์) — lazy-load
 * `@react-pdf/renderer` และเอกสารทั้งหมดผ่าน dynamic import (ดูหัวไฟล์)
 */
export async function renderProposalPdf(input: RenderProposalPdfInput): Promise<Blob> {
  const [{ registerFonts }, { ProposalDocument }, { pdf }] = await Promise.all([
    import('./fonts'),
    import('./ProposalDocument'),
    import('@react-pdf/renderer'),
  ]);

  registerFonts(input.fontSource);

  // `RenderProposalPdfInput` เป็น superset ของ `ProposalDocumentProps` (เพิ่มแค่ `fontSource` ที่ใช้
  // เฉพาะตอน register ฟอนต์ข้างบน) — ส่งต่อทั้งก้อนได้โดยไม่ต้องแยก key
  const element = <ProposalDocument {...input} />;
  const instance = pdf(element);
  return instance.toBlob();
}
