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
}

export interface ProposalPdfImages {
  /** PNG data URL ของภาพรวมโครงการ (ภาพประกอบ/แผนผัง) */
  overview?: string;
  trends?: ProposalPdfTrendImage[];
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
}

export interface RenderProposalPdfInput extends ProposalDocumentProps {
  /** inject แหล่งฟอนต์อื่นได้ (ใช้ใน test ฝั่ง Node ที่ไม่มี HTTP server ให้ดึง URL จริง) */
  fontSource?: FontSource;
}
