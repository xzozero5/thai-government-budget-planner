/**
 * T-502 — logic pure ของ `ExportDialog` (แยกจาก component ตาม CLAUDE.md §7): สถานะ checkbox ของแต่ละ
 * ส่วน + คำเตือน N3 ที่ต้องแสดงในไดอะล็อกก่อนส่งออก + ประกอบ `RenderProposalPdfInput`
 *
 * ข้อจำกัดของ `ProposalDocumentProps` (`./pdf/types.ts`, เจ้าของคือ agent อื่น — ห้ามแก้): BOQ/
 * ภาคผนวกอ้างอิงถูกสร้างจาก `proposal` ตรง ๆ เสมอใน `ProposalDocument.tsx` (ไม่มี flag ให้ปิด) เช่นเดียว
 * กับ `stat_cards` (ตัวชี้วัดเศรษฐกิจ) — ส่วนที่ผู้ใช้ "ปิด" ได้จริงมีแค่ `warnings` (ส่ง `[]` แทนของจริง)
 * และภาพประกอบ (`images.overview`, ควบคุมว่าจะส่งรูปเข้าไปหรือไม่) จึงมีแค่ 2 checkbox ที่ทำงานได้จริงใน
 * `ExportDialog`; ที่เหลือ (BOQ/ภาคผนวกอ้างอิง/ตัวชี้วัด) แสดงเป็น checkbox ที่ติ๊กค้างและ disabled พร้อม
 * tooltip อธิบาย — ไม่ใช่ปิดบัง แต่เพราะ PDF ยังไม่รองรับจริง (รายงานไว้ท้ายงานตามที่โจทย์สั่ง)
 */
import type { Proposal } from '@/ai/tools/proposal';
import type { ToolLog } from '@/ai/toolLog';
import { computeBasisMix } from '@/features/proposal/stats';
import { boqLineNeedsCitationWarning, buildCitationRegistry } from './pdf/citationRegistry';
import type { BudgetLineCitationDetail, RenderProposalPdfInput } from './pdf/types';

export interface ExportSections {
  illustrations: boolean;
  warnings: boolean;
}

export const DEFAULT_EXPORT_SECTIONS: ExportSections = {
  illustrations: true,
  warnings: true,
};

/** ส่วนที่ PDF ยังไม่รองรับการปิด (เสมอ "รวม" — ล็อกไว้ในตัว UI) — ดูหมายเหตุหัวไฟล์ */
export const ALWAYS_INCLUDED_SECTIONS = ['boq', 'citations', 'stats'] as const;

/** เกณฑ์ "ประมาณการเยอะ" (N3) — เอกสารโครงการยังไม่ระบุตัวเลขตายตัว ใช้ ≥30% ของยอดรวมเป็นเกณฑ์ที่ตัดสินใจ
 * เองใน T-502 (ปรับได้ภายหลังถ้ามีเกณฑ์ทางการ) */
export const ESTIMATE_HEAVY_THRESHOLD_PERCENT = 30;

export interface ExportWarningsInfo {
  estimatePercent: number;
  isEstimateHeavy: boolean;
  missingCitationCount: number;
  validatorWarningCount: number;
}

/** สรุปคำเตือนที่ `ExportDialog` ต้องแสดงก่อนส่งออก (N3: ตัวเลขประมาณการ/ไม่มี citation ต้องเห็นชัด) */
export function computeExportWarningsInfo(
  proposal: Pick<Proposal, 'boq'>,
  validatorWarnings: readonly string[],
): ExportWarningsInfo {
  const mix = computeBasisMix(proposal.boq);
  const missingCitationCount = proposal.boq.filter(boqLineNeedsCitationWarning).length;
  return {
    estimatePercent: mix.estimatePercent,
    isEstimateHeavy: mix.estimatePercent >= ESTIMATE_HEAVY_THRESHOLD_PERCENT,
    missingCitationCount,
    validatorWarningCount: validatorWarnings.length,
  };
}

export interface BuildRenderInputParams {
  proposal: Proposal;
  warnings: string[];
  editedLineIds: string[];
  sections: ExportSections;
  dataVersion?: string | undefined;
  overviewImageDataUrl?: string | null | undefined;
  budgetLineDetails?: Record<string, BudgetLineCitationDetail> | undefined;
}

/** ประกอบ input ของ `renderProposalPdf` ตามส่วนที่ผู้ใช้เลือก — pure ล้วน ๆ (ไม่แตะ DOM/network) */
export function buildRenderInput(params: BuildRenderInputParams): RenderProposalPdfInput {
  const { proposal, warnings, editedLineIds, sections, dataVersion, overviewImageDataUrl, budgetLineDetails } =
    params;

  const includeOverview = sections.illustrations && overviewImageDataUrl !== undefined && overviewImageDataUrl !== null;

  return {
    proposal,
    warnings: sections.warnings ? warnings : [],
    editedLineIds,
    ...(dataVersion !== undefined ? { dataVersion } : {}),
    ...(includeOverview ? { images: { overview: overviewImageDataUrl } } : {}),
    ...(budgetLineDetails !== undefined ? { budgetLineDetails } : {}),
  };
}

/** ภาคผนวก citation ในไฟล์ PDF อ่านง่ายขึ้นถ้ามีรายละเอียดเสริมจาก `ToolLog.getSourceFingerprint`
 * (มีเฉพาะโหมดที่มี session ai จริงอยู่ — `/load` ไม่มี ToolLog จึงคืน `{}` เสมอ ไม่ใช่ข้อผิดพลาด) */
export function buildBudgetLineDetailsFromToolLog(
  proposal: Pick<Proposal, 'citations_web' | 'boq' | 'audit_findings'>,
  toolLog: Pick<ToolLog, 'getSourceFingerprint'> | null | undefined,
): Record<string, BudgetLineCitationDetail> {
  if (!toolLog?.getSourceFingerprint) {
    return {};
  }
  const registry = buildCitationRegistry(proposal);
  const details: Record<string, BudgetLineCitationDetail> = {};
  for (const entry of registry) {
    if (entry.citation.kind !== 'budget_line') {
      continue;
    }
    const fingerprint = toolLog.getSourceFingerprint(entry.citation.source_id);
    if (!fingerprint) {
      continue;
    }
    details[entry.citation.source_id] = {
      dataset: fingerprint.dataset,
      fiscalYearBe: fingerprint.fiscalYearBe,
      itemNameRaw: fingerprint.itemNameRaw,
      ...(fingerprint.agency !== null ? { agency: fingerprint.agency } : {}),
      ...(fingerprint.amountThb !== null ? { amountThb: fingerprint.amountThb } : {}),
    };
  }
  return details;
}
