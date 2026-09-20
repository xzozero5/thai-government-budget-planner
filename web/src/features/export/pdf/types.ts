/**
 * T-501 — ชนิดข้อมูลร่วมของ `ProposalDocument`/`renderProposalPdf`
 *
 * หมายเหตุขอบเขตของ schema (`@/ai/tools/proposal.ts`, ดู docs/05-FEATURES.md §5): `Citation` แต่ละชนิด
 * เก็บแค่ตัวชี้ (`source_id`/`doc_id`/`indicator`) ไม่ได้เก็บรายละเอียดเต็ม (dataset/หน่วยงาน/ยอดเงิน/
 * ชื่อเอกสาร/ค่าตัวชี้วัด) เพราะรายละเอียดเต็มอยู่ใน `ToolLog` ของบทสนทนา (`@/ai/**`) ซึ่ง agent ของ
 * feature นี้ไม่ได้รับอนุญาตให้แตะ — ภาคผนวก citations จึงแสดงเท่าที่ schema มีเสมอ (`source_id`/`note`,
 * `doc_id`/`page`/`quote`, `indicator`/`year_be`, หรือ web ครบทุก field) และ **เปิดช่องทางเสริม**
 * (`budgetLineDetails`/`documentDetails`/`econValues`) ให้โค้ดที่เรียกใช้ (เจ้าของ store/tgbpFile.ts)
 * แนบรายละเอียดที่ resolve จาก ToolLog มาเสริมได้ถ้ามี — ไม่ระบุก็ยัง fallback แสดงผลได้ปกติ
 */
import type { Proposal } from '@/ai/tools/proposal';
import type { FontSource } from './fonts';

export interface ProposalPdfTrendImage {
  title: string;
  /** PNG data URL (ไม่ใช่ blob: — ดู `svgToPng.ts`) */
  dataUrl: string;
  /** ป้าย basis ใต้กราฟ (N3 — `proposal.trend.basisUnitPrice`/`basisAmountPerLine`) — ไม่มีเมื่อเป็น
   * ตัวชี้วัดเศรษฐกิจ (`kind:'indicator'`) เพราะไม่มีแนวคิด "ราคาต่อหน่วย/รายการ" */
  basisLabel?: string;
  /** ผลรวม n ของทุกจุดที่มีข้อมูล — ไม่มีเมื่อเป็นตัวชี้วัดเศรษฐกิจ (จุดละ 1 ค่า ไม่มีแนวคิดขนาดตัวอย่าง) */
  nTotal?: number;
  /** T-602 (เก็บตก PDF, N3) — `true` เมื่อ series นี้เป็นตัวชี้วัดเศรษฐกิจที่ยังไม่ได้ตรวจทาน
   * (`EconTrend.verified === false`) — `ProposalDocument.tsx` แสดงคำบรรยาย `proposal.stat.unverified`
   * ต่อท้าย caption เมื่อเป็น `true`; ไม่มีค่า/`false` = ไม่แสดง */
  unverified?: boolean;
}

export interface ProposalPdfImages {
  /** PNG data URL ของภาพรวมโครงการ (ภาพประกอบ/แผนผัง) */
  overview?: string;
  trends?: ProposalPdfTrendImage[];
}

/** T-504/S13 — ส่วนที่ผู้ใช้เลือกได้ใน export dialog (ค่าเริ่มต้นทุกตัว `true` เมื่อไม่ระบุ) ส่วนที่ "ปิดไม่ได้"
 * ตาม N3 (BOQ, ยอดรวม, ภาคผนวกอ้างอิง, คำเตือนจากระบบตรวจสอบ, ป้ายร่างโดย AI, footer) ไม่มี key ในนี้ —
 * ถูก render เสมอไม่ว่าอะไรก็ตาม ดูคอมเมนต์หัวไฟล์ `pdfInputs.ts` */
export interface ProposalPdfSections {
  /** การ์ดสถิติ/ตัวชี้วัด (highlight box บนหน้าปก) */
  stats?: boolean;
  /** สมมติฐาน + ความเสี่ยง (รวมเป็นสวิตช์เดียวตามสเปค T-504) */
  assumptionsRisks?: boolean;
  /** เทียบเคียงงบในอดีต */
  comparables?: boolean;
  /** ภาพประกอบ (ภาพรวมโครงการ + คำบรรยายของ `proposal.illustrations`) */
  illustrations?: boolean;
  /** กราฟแนวโน้มราคา (US-8.3) */
  trends?: boolean;
}

/** รายละเอียดเสริมของ budget_line citation หนึ่งรายการ (key = `source_id`) — ดูหมายเหตุหัวไฟล์ */
export interface BudgetLineCitationDetail {
  dataset?: string;
  fiscalYearBe?: number;
  agency?: string;
  itemNameRaw?: string;
  amountThb?: number;
  sourcePath?: string;
  sheet?: string;
  row?: number;
}

/** รายละเอียดเสริมของ document citation หนึ่งรายการ (key = `doc_id`) */
export interface DocumentCitationDetail {
  title?: string;
}

/** ค่าจริงของตัวชี้วัดเศรษฐกิจหนึ่งจุด (key = `${indicator}@${year_be}`) */
export interface EconCitationDetail {
  value?: number;
  unit?: string;
  verified?: boolean;
}

export interface ProposalDocumentProps {
  proposal: Proposal;
  /** `warnings[]` จาก `validateAndNormalizeProposal`/`emit_proposal` — ไม่ใช่ field ของ Proposal schema */
  warnings?: string[];
  /** ชุดข้อมูล (data_version) ที่ใช้ตอนสร้างข้อเสนอ — แสดงใน footer ทุกหน้า */
  dataVersion?: string;
  /** เวลาที่สร้าง PDF — ค่าเริ่มต้น `new Date()` ตอน render */
  generatedAt?: Date;
  images?: ProposalPdfImages;
  /** id ของ `boq[].id` ที่ผู้ใช้แก้ไขค่าเอง (schema ไม่มี field `user_edited` ให้ตรวจ — ดู T-501 brief) */
  editedLineIds?: string[];
  budgetLineDetails?: Record<string, BudgetLineCitationDetail>;
  documentDetails?: Record<string, DocumentCitationDetail>;
  econValues?: Record<string, EconCitationDetail>;
  /** T-504/S13 — ส่วนที่เลือกได้ (undefined ทั้งก้อน หรือ key ไหนไม่ระบุ = แสดงเสมอ ค่าเริ่มต้น `true`) */
  sections?: ProposalPdfSections;
  /** S13 — ชื่อผู้จัดทำ (optional, ≤ 80 ตัวอักษร ตรวจ/ตัดที่ `pdfInputs.ts#sanitizeExportAuthorName`)
   * แสดงบนหน้าปกเท่านั้น ไม่ถูกเก็บที่ไหนนอกจาก state ของ dialog ตอนกำลังส่งออก (N2 เดียวกับ key) */
  author?: string;
}

export interface RenderProposalPdfInput extends ProposalDocumentProps {
  /** inject แหล่งฟอนต์อื่นได้ (ใช้ใน test ฝั่ง Node ที่ไม่มี HTTP server ให้ดึง URL จริง) */
  fontSource?: FontSource;
}
