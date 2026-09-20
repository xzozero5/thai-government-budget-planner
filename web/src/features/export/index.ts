/**
 * T-502 — public entry point ของ `features/export/*`: `ExportDialog` (PDF export dialog + progress)
 * และ `downloadSessionFile` (save `.tgbp.json`)
 *
 * หมายเหตุ chunking: `ExportDialog` เอง import ได้แบบ static (เบา — ไม่มี react-pdf) แต่ภายในต้อง
 * dynamic-import `@/features/export/pdf/renderProposalPdf` เพื่อไม่ให้ react-pdf (~458 kB gz) หลุดเข้า
 * initial/workspace chunk (ดู `docs/04-ARCHITECTURE.md` §5 performance budget)
 */
export { ExportDialog } from './ExportDialog';
export type { ExportDialogProps, ExportSource } from './ExportDialog';

// T-504 — type ที่ `features/workspace/trendData.ts` ต้องอ้างเพื่อประกอบ prop `loadTrend` ของ
// `ExportDialog` (ดูหมายเหตุหัวไฟล์ `pdfInputs.ts`) — type-only, ไม่ผูก runtime dependency ข้าม feature
export type { ExportTrendBasisKind, ExportTrendData, ExportTrendPoint } from './pdfInputs';

export { downloadSessionFile, saveSessionFile } from './downloadSessionFile';

export { LoadPage } from './LoadPage';
