/**
 * T-502/T-504 — logic pure ของ `ExportDialog` (แยกจาก component ตาม CLAUDE.md §7): สถานะ checkbox ของ
 * แต่ละส่วน + คำเตือน N3 ที่ต้องแสดงในไดอะล็อกก่อนส่งออก + ประกอบ `RenderProposalPdfInput`
 *
 * S13 (po-review `docs/qa/po-review-phase4-5.md`): เดิม (T-502) มีแค่ 2 checkbox ที่ทำงานได้จริง
 * (ภาพประกอบ/คำเตือน) ที่เหลือเป็น checkbox ติ๊กค้าง+disabled เพราะ `ProposalDocument`/`ProposalDocumentProps`
 * ยังไม่รองรับ — ตอนนี้ `ProposalDocumentProps.sections` (`./pdf/types.ts`, T-504) รองรับปิด/เปิดจริงแล้ว
 * สำหรับ: สถิติ/stat cards, สมมติฐาน+ความเสี่ยง (รวมสวิตช์เดียว), เทียบเคียง, ภาพประกอบ, กราฟแนวโน้ม —
 * ส่วนที่ยังปิดไม่ได้ตาม N3 (BOQ/ยอดรวม/ภาคผนวกอ้างอิง/คำเตือนจากระบบตรวจสอบ/ป้ายร่างโดย AI/footer) ไม่มี
 * flag ให้ปิดเลยโดยตั้งใจ — `ProposalDocument.tsx` render เสมอไม่สนใจ `sections`
 *
 * เปลี่ยนจาก T-502 เดิมอย่างมีนัยสำคัญ: "คำเตือนจากระบบตรวจสอบ" (`warnings[]`) **ย้ายจากปิดได้ไปเป็นปิด
 * ไม่ได้** (N3 — ผู้อ่าน PDF ต้องเห็นคำเตือนของ validator เสมอ ไม่ใช่แค่ตอนเปิดสวิตช์) `ExportSections`
 * จึงไม่มี key `warnings` แล้ว — `buildRenderInput` ส่ง `warnings` ที่ได้รับมาตรง ๆ เสมอ
 */
import type { Proposal, TrendRef } from '@/ai/tools/proposal';
import type { ToolLog } from '@/ai/toolLog';
import { computeBasisMix } from '@/features/proposal/stats';
import { boqLineNeedsCitationWarning, buildCitationRegistry } from './pdf/citationRegistry';
import type {
  BudgetLineCitationDetail,
  ProposalPdfImages,
  ProposalPdfSections,
  ProposalPdfTrendImage,
  RenderProposalPdfInput,
} from './pdf/types';

export interface ExportSections {
  illustrations: boolean;
  trends: boolean;
  stats: boolean;
  assumptionsRisks: boolean;
  comparables: boolean;
}

/** T-504 — จุดข้อมูลหนึ่งปีของกราฟแนวโน้ม ตามรูปแบบที่ `buildTrendSvg` (`./pdf/trendSvg.ts`) รับ */
export interface ExportTrendPoint {
  yearBe: number;
  median: number;
  p25?: number;
  p75?: number;
  n?: number;
}

/** `unit_price`/`amount_per_line` = แนวโน้มราคาของ catalog item (`kind:'item'`); `econ` = ตัวชี้วัด
 * เศรษฐกิจ (`kind:'indicator'`) ซึ่งไม่มีแนวคิด "ราคาต่อหน่วย/รายการ" ให้ติดป้าย basis (N3) */
export type ExportTrendBasisKind = 'unit_price' | 'amount_per_line' | 'econ';

/** รูปร่างที่ `ExportDialog` ต้องการจาก prop `loadTrend` — คอนเทนเนอร์ของหน้าเว็บ (`features/workspace/
 * slots.tsx`) ประกอบให้จาก `TrendResult` ของ `features/workspace/trendData.ts` (ดู `toExportTrendData`
 * ที่นั่น — แปลงจากรูปแบบเดียวกับที่ `useTrendResult`/`BoqTrendCell` ใช้อยู่แล้ว ไม่ทำ loader ซ้ำ) */
export interface ExportTrendData {
  title: string;
  basis: ExportTrendBasisKind;
  points: ExportTrendPoint[];
  /** T-602 (เก็บตก PDF, N3) — เฉพาะ `basis:'econ'`: `EconTrend.verified` จริง (docs/econ-sources.md:
   * ตัวชี้วัดเศรษฐกิจทุกตัว `verified:false` เสมอ ณ วันนี้) — `undefined` เมื่อไม่มีแนวคิดนี้ (`unit_price`/
   * `amount_per_line` ไม่มี field ตรวจสอบแล้ว/ยัง ในความหมายเดียวกัน) */
  verified?: boolean;
}

export const DEFAULT_EXPORT_SECTIONS: ExportSections = {
  illustrations: true,
  trends: true,
  stats: true,
  assumptionsRisks: true,
  comparables: true,
};

/** ส่วนที่ PDF ไม่รองรับการปิดเลย (N3) — คงชื่อ export เดิมไว้ (ไม่มีที่อื่นอ้างถึง แต่เก็บไว้เป็นเอกสารในโค้ด) */
export const ALWAYS_INCLUDED_SECTIONS = [
  'boq',
  'totals',
  'citations',
  'warnings',
  'aiDraftBadge',
  'footer',
] as const;

/** เกณฑ์ "ประมาณการเยอะ" (N3) — เอกสารโครงการยังไม่ระบุตัวเลขตายตัว ใช้ ≥30% ของยอดรวมเป็นเกณฑ์ที่ตัดสินใจ
 * เองใน T-502 (ปรับได้ภายหลังถ้ามีเกณฑ์ทางการ) */
export const ESTIMATE_HEAVY_THRESHOLD_PERCENT = 30;

/** จำนวนกราฟแนวโน้มสูงสุดต่อไฟล์ (T-504 BACKLOG: "≤ 6 กราฟ") — กันไฟล์ใหญ่/ช้าเกินไปเมื่อ proposal อ้าง
 * trend_ref หลายสิบรายการ */
export const MAX_TREND_IMAGES = 6;

/** ความยาวสูงสุดของชื่อผู้จัดทำ (S13) */
export const EXPORT_AUTHOR_MAX_LENGTH = 80;

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

/** ตัด/ตรวจชื่อผู้จัดทำ (S13): trim ช่องว่างหัวท้าย + จำกัดความยาว — pure ล้วน ๆ ใช้ทั้งตอนพิมพ์ (maxLength
 * ของ `<Input>` กันไว้ชั้นหนึ่งแล้ว) และตอนประกอบ input ส่งเข้า PDF จริง (กันกรณี paste ข้อความยาวเกิน) */
export function sanitizeExportAuthorName(raw: string): string {
  return raw.trim().slice(0, EXPORT_AUTHOR_MAX_LENGTH);
}

/** T-504 — รวบ `trend_ref` ที่ไม่ซ้ำจาก BOQ + stat cards (เรียงตามลำดับที่พบก่อน-หลัง) จำกัดไม่เกิน `max`
 * รายการ (ค่าเริ่มต้น `MAX_TREND_IMAGES`) — pure function ล้วน ๆ ไม่แตะ network/DOM */
export function collectTrendRefs(
  proposal: Pick<Proposal, 'boq' | 'stat_cards'>,
  max: number = MAX_TREND_IMAGES,
): TrendRef[] {
  const seen = new Set<string>();
  const refs: TrendRef[] = [];

  function tryAdd(ref: TrendRef | undefined): void {
    if (ref === undefined || refs.length >= max) return;
    const key = `${ref.kind}:${ref.key}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  }

  for (const line of proposal.boq) tryAdd(line.trend_ref);
  for (const card of proposal.stat_cards) tryAdd(card.trend_ref);
  return refs;
}

export interface BuildRenderInputParams {
  proposal: Proposal;
  /** คำเตือนจาก validator — ส่งเข้า PDF เสมอตรง ๆ (N3: ปิดไม่ได้ ต่างจาก T-502 เดิม) */
  warnings: string[];
  editedLineIds: string[];
  sections: ExportSections;
  dataVersion?: string | undefined;
  overviewImageDataUrl?: string | null | undefined;
  trendImages?: ProposalPdfTrendImage[] | undefined;
  budgetLineDetails?: Record<string, BudgetLineCitationDetail> | undefined;
  /** S13 — ชื่อผู้จัดทำหลังผ่าน `sanitizeExportAuthorName` แล้ว (ว่าง/`undefined` = ไม่แสดงบนปก) */
  author?: string | undefined;
}

/** ประกอบ input ของ `renderProposalPdf` ตามส่วนที่ผู้ใช้เลือก — pure ล้วน ๆ (ไม่แตะ DOM/network) */
export function buildRenderInput(params: BuildRenderInputParams): RenderProposalPdfInput {
  const {
    proposal,
    warnings,
    editedLineIds,
    sections,
    dataVersion,
    overviewImageDataUrl,
    trendImages,
    budgetLineDetails,
    author,
  } = params;

  const includeOverview =
    sections.illustrations && overviewImageDataUrl !== undefined && overviewImageDataUrl !== null;
  const includeTrends = sections.trends && trendImages !== undefined && trendImages.length > 0;

  const images: ProposalPdfImages | undefined =
    includeOverview || includeTrends
      ? {
          ...(includeOverview ? { overview: overviewImageDataUrl } : {}),
          ...(includeTrends ? { trends: trendImages } : {}),
        }
      : undefined;

  const pdfSections: ProposalPdfSections = {
    stats: sections.stats,
    assumptionsRisks: sections.assumptionsRisks,
    comparables: sections.comparables,
    illustrations: sections.illustrations,
    trends: sections.trends,
  };

  const cleanedAuthor = author !== undefined ? sanitizeExportAuthorName(author) : '';

  return {
    proposal,
    warnings,
    editedLineIds,
    sections: pdfSections,
    ...(dataVersion !== undefined ? { dataVersion } : {}),
    ...(images !== undefined ? { images } : {}),
    ...(budgetLineDetails !== undefined ? { budgetLineDetails } : {}),
    ...(cleanedAuthor.length > 0 ? { author: cleanedAuthor } : {}),
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
