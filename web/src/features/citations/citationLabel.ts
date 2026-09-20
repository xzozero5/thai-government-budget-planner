/**
 * T-407 — ฟังก์ชัน pure ล้วน (ไม่มี React) สำหรับคำนวณข้อความของ citation:
 * - label สั้นของ `CitationChip` ต่อประเภท (`kind`)
 * - โดเมนของ URL เว็บ (แสดงเป็น text เท่านั้น ไม่ใช่ลิงก์)
 * - วันที่แบบไทย (พ.ศ.) ของ `retrieved_at`
 * - ป้ายประเภทแหล่งของ BudgetLine ตาม dataset (ใช้ใน CitationDrawer body)
 * - ข้อความของ quality flag (badge สั้น + tooltip เต็ม) — บาง flag ยังไม่มี copy ใน
 *   `docs/ui/copy.th.json` (`citation.flags.*`) เลย fallback เป็นโค้ดดิบ (ดูรายงาน T-407)
 *
 * ห้าม import React ในไฟล์นี้ (module boundary เดียวกับ `@/data/*`)
 */
import type { Citation } from '@/ai/tools/proposal';
import type { Dataset } from '@/data';
import { t } from '@/i18n';

// ---------------------------------------------------------------------------
// URL helpers (web citation) — ไม่ fetch ปลายทางใด ๆ (N5), แค่ parse ด้วย `URL` ในตัวเบราว์เซอร์
// ---------------------------------------------------------------------------

/** true เฉพาะ `https://` เท่านั้น (T-307/N5) — ใช้ตัดสินว่าจะ render เป็นลิงก์ได้หรือต้องเป็น text */
export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** โดเมนของ URL (ตัด `www.` นำหน้า) สำหรับแสดงเป็น text — คืน `null` ถ้า parse ไม่ได้ */
export function getWebDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** จัดรูปแบบวันที่ (ISO string) เป็นวันที่ไทย พ.ศ. — คืนค่าดิบถ้า parse ไม่ได้ (ปลอดภัยกว่าซ่อนข้อมูล) */
export function formatCitationDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { dateStyle: 'medium' }).format(date);
}

// ---------------------------------------------------------------------------
// CitationChip label ต่อประเภท (06 §4.3 / T-407 ข้อ 3)
// ---------------------------------------------------------------------------

export interface BudgetLineChipHint {
  /** ป้ายสั้นของ dataset เช่น "PBO", "พ.ร.บ. 2570" — คำนวณจาก `datasetTypeLabel` หรือกำหนดเอง */
  datasetLabel: string;
  fiscalYearBe: number;
  agency: string | null;
  ministry: string | null;
}

export interface CitationChipLabelOptions {
  /** ต้องโหลด `BudgetLine` มาก่อน (chip เองไม่โหลดข้อมูล) — ไม่ส่งมา = fallback เป็น source_id ย่อ */
  budgetLine?: BudgetLineChipHint;
  /** ป้ายสั้นของตัวชี้วัดเศรษฐกิจ เช่น "CPI" — ไม่ส่งมา = fallback เป็นรหัส indicator ตัวพิมพ์ใหญ่ */
  econLabel?: string;
}

/** label สั้นของ `CitationChip` ต่อประเภท — pure, ไม่โหลดข้อมูลเอง (T-407 ข้อ 4) */
export function getCitationChipLabel(
  citation: Citation,
  options: CitationChipLabelOptions = {},
): string {
  switch (citation.kind) {
    case 'budget_line': {
      const hint = options.budgetLine;
      if (hint) {
        return t('citation.budgetLine.chip', {
          source: hint.datasetLabel,
          year: hint.fiscalYearBe,
          agency: hint.agency ?? hint.ministry ?? t('common.unknown'),
        });
      }
      return `${t('citation.types.budget_line_short')} · ${citation.source_id.slice(-8)}`;
    }
    case 'document': {
      const pageText =
        citation.page !== undefined
          ? t('citation.page', { page: citation.page })
          : t('common.unknown');
      return `${t('citation.types.document')} · ${pageText}`;
    }
    case 'econ': {
      const label = options.econLabel ?? citation.indicator.toUpperCase();
      return `${label} ${String(citation.year_be)}`;
    }
    case 'web': {
      return getWebDomain(citation.url) ?? citation.url;
    }
  }
}

// ---------------------------------------------------------------------------
// ป้ายประเภทแหล่งของ BudgetLine ตาม dataset (CitationDrawer body — 06 §4.4)
// ---------------------------------------------------------------------------

/** ป้ายประเภทแหล่งที่ละเอียดกว่า `citation.types.budget_line` ทั่วไป — ใช้ในตัวเนื้อหา drawer */
export function datasetTypeLabel(dataset: Dataset, fiscalYearBe: number): string {
  switch (dataset) {
    case 'pbo_disbursement':
      return t('citation.types.budget_line');
    case 'act_2570_draft':
    case 'act_2570_province':
      return t('citation.types.budget_bill', { year: fiscalYearBe });
    case 'local_ordinance_2570':
    case 'local_subsidy_2570':
      return t('citation.types.local_ordinance');
    case 'committee_table':
      return t('citation.types.committee_doc');
  }
}

// ---------------------------------------------------------------------------
// Quality flag → ข้อความ (badge สั้น + tooltip เต็ม)
// ---------------------------------------------------------------------------

export interface QualityFlagDisplay {
  /** โค้ดดิบของ flag ตามที่ pipeline ส่งมา */
  code: string;
  /** ข้อความสั้นบน badge */
  short: string;
  /** ข้อความเต็มสำหรับ tooltip/รายละเอียด */
  full: string;
}

/**
 * แปลง quality flag ของ `BudgetLine.quality_flags` เป็นข้อความแสดงผล — flag ที่ `docs/ui/copy.th.json`
 * (`citation.flags.*`) ยังไม่มีคำแปล (เช่น `ministry_unmapped`, `ocr_suspect`, `amount_outlier`,
 * `negative_amount`, `corrupt_row`, `unit_price_outlier`, `lump_sum_category`, `org_tail_uncertain`,
 * `qty_is_measure`, `org_unmapped`, `qty_parsed_low_conf`, `subset_of_act_2570_draft`) จะ fallback
 * เป็นโค้ดดิบทั้ง short/full (รายงานใน T-407 ว่าเป็น key ที่ขาด — ไม่ใช่ bug ของฟังก์ชันนี้)
 */
export function describeQualityFlag(
  flag: string,
  params: { page?: number | null } = {},
): QualityFlagDisplay {
  switch (flag) {
    case 'upstream_ocr':
      return params.page != null
        ? {
            code: flag,
            short: t('citation.flags.upstream_ocrShort'),
            full: t('citation.flags.upstream_ocr', { page: params.page }),
          }
        : {
            code: flag,
            short: t('citation.flags.upstream_ocrShort'),
            full: t('citation.flags.upstream_ocrShort'),
          };
    case 'source_incomplete':
      return {
        code: flag,
        short: t('citation.flags.source_incompleteShort'),
        full: t('citation.flags.source_incomplete'),
      };
    case 'low_specificity':
      return {
        code: flag,
        short: t('citation.flags.low_specificityShort'),
        full: t('citation.flags.low_specificity'),
      };
    case 'group_total_mismatch':
      // ไม่มีค่า {diff} ให้ใส่ ณ ระดับ BudgetLine เดี่ยว ๆ (ต่างจากรายกลุ่มใน validation.json) —
      // ใช้ข้อความสั้นทั้ง short/full แทนการปล่อย "{diff}" ดิบค้างในข้อความ
      return {
        code: flag,
        short: t('citation.flags.group_total_mismatchShort'),
        full: t('citation.flags.group_total_mismatchShort'),
      };
    default:
      return { code: flag, short: flag, full: flag };
  }
}
