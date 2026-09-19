/**
 * T-303 — `ai/tools/proposal.ts`: schema ของ Proposal (05-FEATURES.md §5 เป๊ะ) + `emit_proposal`
 * handler/validator
 *
 * Citation integrity (04 §D4, N3): ทุก citation ใน BOQ/audit_findings/comparables/citations_web/
 * illustrations/stat_cards ต้อง "เคยปรากฏจริง" ใน `ToolLog` ของบทสนทนานี้เท่านั้น — ไม่พบ → ตัดออก/
 * ลดระดับ + แจ้งเป็น `warnings[]` (ไม่ throw ทั้งก้อน เพื่อให้ AI เห็นแล้วแก้ในรอบถัดไปได้)
 *
 * ตัวเลข (total_thb, subtotal_thb, grand_total_thb) ไม่ถูกแก้ให้อัตโนมัติ — mismatch คืนเป็น
 * `warnings[]` เท่านั้น (ให้ AI/ผู้ใช้เป็นคนแก้ค่า ไม่ใช่ validator เดาแทน)
 *
 * T-307 (security review H2) — เดิมตรวจแค่ "id เคยปรากฏ" (`hasSourceId`/`hasDocId`) ทำให้โมเดลอ้าง
 * source_id/doc_id จริงแต่ใส่ตัวเลข/เนื้อหาที่แต่งขึ้นได้ ("pointer ถูก ค่าผิด") เพิ่มการตรวจ "ค่า" จริง:
 * - `comparables[]`: เทียบทุก field กับ `SourceFingerprint` ของ source_id นั้น — เป็นข้อเท็จจริง (ไม่ใช่
 *   การประมาณของโมเดล) จึง **เขียนทับด้วยค่าจริง** เมื่อไม่ตรง แทนการตัดทิ้ง/ลดระดับ
 * - `boq[].unit_price_thb` ที่ `basis:'historical'`: ต้อง trace ได้กับค่าจริงของแถวที่ cite (±2%) หรือ
 *   ตรงกับผล `adjust_for_inflation` ที่ log ไว้จริง — trace ไม่ได้ → `price_not_traceable` + confidence
 *   ≤ low และถ้าห่างเกิน 10 เท่า → ลดเป็น `basis:'estimate'` (ตัวเลข BOQ **ไม่ถูกแก้ให้อัตโนมัติ** เพราะ
 *   เป็นการประมาณของโมเดล ต่างจาก comparables ที่เป็นข้อเท็จจริง)
 * - `citation.kind==='document'`: `quote` ต้องเป็น substring ของ chunk ที่เคยอ่านจริงจาก
 *   `(doc_id, page)` นั้น (เทียบหลัง normalize — ดู `../textNormalize.ts`) ไม่พบ → ตัด `quote` ทิ้ง;
 *   `page` ที่ไม่เคยอ่าน → ตัด `page` ทิ้ง (คง citation ระดับเอกสารไว้ถ้า doc_id เคยอ่านจริง)
 * - `citation.kind==='econ'`: `ToolLog.hasEconValue` ถูกบันทึกเฉพาะตอนค่าที่ได้ไม่เป็น null อยู่แล้ว
 *   (`tools/getEconIndicator.ts`) จึงตรวจ "ค่าไม่ null" ให้แล้วโดยไม่ต้องแก้ไฟล์นี้เพิ่ม
 *
 * ฟังก์ชันที่ตรวจค่าจริงเรียกเมธอด optional ของ `ToolLog` (`getSourceFingerprint`/`hasDocPage`/
 * `hasDocQuote`) เสมอผ่าน `?.` — ถ้า `ToolLog` ที่ส่งมาไม่ implement (เช่น wrapper ของโค้ดอื่นนอก
 * `ai/**`) จะ "ปล่อยผ่านเหมือนพฤติกรรมเดิม" (ตรวจไม่ได้ ≠ ปฏิเสธ) ไม่ใช่ throw
 */
import { z } from 'zod';
import type { SourceFingerprint } from '../toolLog';
import { createTool, type ToolContext } from './toolKit';

// ---------------------------------------------------------------------------
// Schema (05-FEATURES.md §5)
// ---------------------------------------------------------------------------

// T-307 (security review M6) — เพดานขนาด input ของ emit_proposal ครบทุก string/array (เดิมมีแต่
// `.min()` ไม่มี `.max()` — object นี้จะถูกเขียนลง `.tgbp.json` (Phase 5) และ render ทั้งก้อน จึงต้องกัน
// DoS ฝั่ง client/ไฟล์บวมจาก input ที่ใหญ่ผิดปกติ) กติกาที่ยึด: id-like (source_id/doc_id/...) ≤ 200,
// ป้ายสั้น (title/category/agency/...) ≤ 300, ข้อความยาว (item/spec/quote/note/...) ≤ 2,000,
// rationale/summary ≤ 4,000, array ทั่วไป ≤ 50, citations ต่อบรรทัด ≤ 20, boq ≤ 200
const ID_MAX = 200;
const LABEL_MAX = 300;
const TEXT_MAX = 2000;
const LONG_TEXT_MAX = 4000;
const ARRAY_MAX = 50;
const CITATIONS_PER_LINE_MAX = 20;

export const TrendRefSchema = z.object({
  kind: z.enum(['item', 'indicator']),
  key: z.string().max(ID_MAX),
});
export type TrendRef = z.infer<typeof TrendRefSchema>;

export const CitationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('budget_line'),
    source_id: z.string().max(ID_MAX),
    note: z.string().max(TEXT_MAX).optional(),
  }),
  z.object({
    kind: z.literal('document'),
    doc_id: z.string().max(ID_MAX),
    page: z.number().int().optional(),
    quote: z.string().max(TEXT_MAX).optional(),
  }),
  z.object({
    kind: z.literal('econ'),
    indicator: z.string().max(ID_MAX),
    year_be: z.number().int(),
  }),
  z.object({
    kind: z.literal('web'),
    url: z.string().max(TEXT_MAX),
    title: z.string().max(LABEL_MAX).optional(),
    retrieved_at: z.string().max(50),
    price_note: z.string().max(TEXT_MAX).optional(),
  }),
]);
export type Citation = z.infer<typeof CitationSchema>;

const CONFIDENCE_VALUES = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCE_VALUES)[number];

export const BoqLineSchema = z.object({
  id: z.string().max(ID_MAX),
  category: z.string().max(LABEL_MAX),
  item: z.string().max(TEXT_MAX),
  spec: z.string().max(TEXT_MAX).optional(),
  // main thread (review T-303): จำนวน/เงินต้องเป็นค่าบวกจำกัด — `qty:-2 × 28000 = -56000` เลขคณิต
  // สอดคล้องกันจึงเคยผ่านตัวตรวจ total แบบเงียบ ๆ; เพดาน 1e13 บาท = เกณฑ์ `corrupt_row` ของ pipeline
  qty: z.number().positive().max(1e9), // zod v4: z.number() ปฏิเสธ NaN/Infinity อยู่แล้ว
  unit: z.string().min(1).max(LABEL_MAX),
  unit_price_thb: z.number().nonnegative().max(1e13),
  total_thb: z.number().nonnegative().max(1e13),
  basis: z.enum(['historical', 'market', 'estimate']),
  confidence: z.enum(CONFIDENCE_VALUES),
  rationale: z.string().min(1).max(LONG_TEXT_MAX),
  price_derivation: z
    .object({
      from_amount_thb: z.number(),
      from_year_be: z.number().int(),
      to_year_be: z.number().int(),
      indicator: z.string().max(ID_MAX),
      factor: z.number(),
    })
    .optional(),
  citations: z.array(CitationSchema).max(CITATIONS_PER_LINE_MAX),
  trend_ref: TrendRefSchema.optional(),
});
export type BoqLine = z.infer<typeof BoqLineSchema>;

export const AssumptionSchema = z.object({
  text: z.string().max(TEXT_MAX),
  impact: z.enum(['high', 'medium', 'low']),
});
export const RiskSchema = z.object({
  text: z.string().max(TEXT_MAX),
  mitigation: z.string().max(TEXT_MAX).optional(),
});
export const ScopeSectionSchema = z.object({
  section: z.string().max(LABEL_MAX),
  items: z.array(z.string().max(TEXT_MAX)).max(ARRAY_MAX),
});

export const ComparableSchema = z.object({
  source_id: z.string().max(ID_MAX),
  fiscal_year_be: z.number().int(),
  agency: z.string().max(LABEL_MAX),
  item_name: z.string().max(TEXT_MAX),
  amount_thb: z.number(),
  unit_price_thb: z.number().optional(),
  similarity_note: z.string().max(TEXT_MAX),
});
export type Comparable = z.infer<typeof ComparableSchema>;

export const WebCitationSchema = z.object({
  url: z.string().max(TEXT_MAX),
  title: z.string().max(LABEL_MAX).optional(),
  retrieved_at: z.string().max(50),
  price_note: z.string().max(TEXT_MAX).optional(),
});
export type WebCitation = z.infer<typeof WebCitationSchema>;

export const AuditFindingSchema = z.object({
  text: z.string().max(TEXT_MAX),
  severity: z.enum(['info', 'warn', 'high']),
  citations: z.array(CitationSchema).max(CITATIONS_PER_LINE_MAX),
});
export type AuditFinding = z.infer<typeof AuditFindingSchema>;

export const IllustrationRefSchema = z.object({
  illustration_id: z.string().max(ID_MAX),
  title: z.string().max(LABEL_MAX),
  caption: z.string().max(TEXT_MAX),
  kind: z.enum(['map', 'cross_section', 'isometric', 'diagram']),
});
export type IllustrationRef = z.infer<typeof IllustrationRefSchema>;

export const StatCardSchema = z.object({
  trend_ref: TrendRefSchema,
  headline_th: z.string().max(LABEL_MAX),
});
export type StatCard = z.infer<typeof StatCardSchema>;

export const TotalsSchema = z.object({
  subtotal_thb: z.number().nonnegative().max(1e14),
  contingency_pct: z.number().min(0).max(100).optional(),
  contingency_thb: z.number().nonnegative().max(1e14).optional(),
  vat_included: z.boolean(),
  grand_total_thb: z.number().nonnegative().max(1e14),
});
export type Totals = z.infer<typeof TotalsSchema>;

export const RequesterContextSchema = z.object({
  area: z.string().max(LABEL_MAX).optional(),
  owner_agency: z.string().max(LABEL_MAX).optional(),
  target_group: z.string().max(LABEL_MAX).optional(),
  fiscal_year_be: z.number().int(),
  duration_months: z.number().optional(),
});

export const ProposalSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1).max(LABEL_MAX),
  summary: z.string().min(1).max(LONG_TEXT_MAX),
  mode: z.enum(['audit', 'draft']),
  requester_context: RequesterContextSchema,
  objectives: z.array(z.string().max(TEXT_MAX)).max(ARRAY_MAX),
  scope_and_specs: z.array(ScopeSectionSchema).max(ARRAY_MAX),
  assumptions: z.array(AssumptionSchema).max(ARRAY_MAX),
  boq: z.array(BoqLineSchema).min(1).max(200),
  totals: TotalsSchema,
  comparables: z.array(ComparableSchema).max(ARRAY_MAX),
  risks: z.array(RiskSchema).max(ARRAY_MAX),
  audit_findings: z.array(AuditFindingSchema).max(ARRAY_MAX).optional(),
  open_questions: z.array(z.string().max(TEXT_MAX)).max(ARRAY_MAX),
  citations_web: z.array(WebCitationSchema).max(ARRAY_MAX),
  illustrations: z.array(IllustrationRefSchema).max(3),
  stat_cards: z.array(StatCardSchema).max(4),
});
export type Proposal = z.infer<typeof ProposalSchema>;

// ---------------------------------------------------------------------------
// Validator — citation integrity + totals (05 §5 ท้ายหัวข้อ)
// ---------------------------------------------------------------------------

const EPSILON_THB = 1;
const CONFIDENCE_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

function capConfidence(confidence: Confidence, cap: Confidence): Confidence {
  return CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK[cap] ? cap : confidence;
}

function describeCitation(c: Citation): string {
  switch (c.kind) {
    case 'budget_line':
      return `budget_line:${c.source_id}`;
    case 'document':
      return `document:${c.doc_id}`;
    case 'econ':
      return `econ:${c.indicator}@${String(c.year_be)}`;
    case 'web':
      return `web:${c.url}`;
  }
}

function isCitationResolved(c: Citation, ctx: ToolContext): boolean {
  switch (c.kind) {
    case 'budget_line':
      return ctx.toolLog.hasSourceId(c.source_id);
    case 'document':
      return ctx.toolLog.hasDocId(c.doc_id);
    case 'econ':
      return ctx.toolLog.hasEconValue(c.indicator, c.year_be);
    case 'web':
      return c.url.startsWith('https://') && ctx.toolLog.hasWebUrl(c.url);
  }
}

/** T-307 H2: `quote`/`page` ของ citation เอกสารต้อง trace ได้กับเนื้อหาที่เคยอ่านจริง — เมธอดของ
 * `ToolLog` ที่ใช้เป็น optional (ดูคอมเมนต์หัวไฟล์) ถ้าไม่มีให้ถือว่า "ตรวจไม่ได้ = ปล่อยผ่าน" (ค่า
 * เดิมก่อน T-307 คือไม่ตรวจอะไรเลยสำหรับสองฟิลด์นี้ จึงไม่ถือเป็นการถอยหลัง) */
function sanitizeDocumentCitation(
  c: Extract<Citation, { kind: 'document' }>,
  ctx: ToolContext,
  warnings: string[],
  label: string,
): Citation {
  let page = c.page;
  if (page !== undefined && ctx.toolLog.hasDocPage?.(c.doc_id, page) === false) {
    warnings.push(
      `${label}: page ${String(page)} ของเอกสาร ${c.doc_id} ไม่เคยถูกอ่านผ่าน read_document ในบทสนทนานี้ — ตัด page ออก`,
    );
    page = undefined;
  }
  let quote = c.quote;
  if (quote !== undefined && ctx.toolLog.hasDocQuote?.(c.doc_id, page, quote) === false) {
    warnings.push(
      `${label}: quote ที่อ้างไม่พบเป็นข้อความย่อยของเนื้อหาที่เคยอ่านจริงจากเอกสาร ${c.doc_id} — ตัด quote ออก`,
    );
    quote = undefined;
  }
  return {
    kind: 'document',
    doc_id: c.doc_id,
    ...(page !== undefined ? { page } : {}),
    ...(quote !== undefined ? { quote } : {}),
  };
}

function filterCitations(
  citations: Citation[],
  ctx: ToolContext,
  warnings: string[],
  label: string,
): Citation[] {
  const resolved: Citation[] = [];
  for (const c of citations) {
    if (isCitationResolved(c, ctx)) {
      resolved.push(c.kind === 'document' ? sanitizeDocumentCitation(c, ctx, warnings, label) : c);
    } else {
      warnings.push(
        `${label}: ตัด citation ที่อ้างอิงไม่พบใน ToolLog ของบทสนทนานี้ (${describeCitation(c)}) — ` +
          (c.kind === 'web' && !c.url.startsWith('https://')
            ? 'URL ต้องเป็น https:// เท่านั้น'
            : 'ไม่เคยปรากฏจากผลลัพธ์ tool ในบทสนทนานี้'),
      );
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// T-307 H2 — ตรวจ traceability ของ unit_price_thb (basis=historical) กับ fingerprint ของแถวที่ cite
// ---------------------------------------------------------------------------

const HISTORICAL_PRICE_TOLERANCE_PCT = 0.02;
const NOT_TRACEABLE_TO_ESTIMATE_MULTIPLIER = 10;

interface TraceRange {
  min: number;
  max: number;
}

/** ราคาอ้างอิงของแถวหนึ่ง — ใช้ unit_price_thb ถ้ามี มิฉะนั้นใช้ amount_thb (ราคาต่อรายการงบ) แทน */
function referencePriceOf(fp: SourceFingerprint): number | null {
  if (fp.unitPriceThb !== null) return fp.unitPriceThb;
  return fp.amountThb;
}

function collectTraceRange(citations: readonly Citation[], ctx: ToolContext): TraceRange | null {
  const prices: number[] = [];
  for (const c of citations) {
    if (c.kind !== 'budget_line') continue;
    const fp = ctx.toolLog.getSourceFingerprint?.(c.source_id);
    if (fp === undefined) continue;
    const price = referencePriceOf(fp);
    if (price !== null) prices.push(price);
  }
  if (prices.length === 0) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

function isWithinTolerance(value: number, range: TraceRange, pct: number): boolean {
  return value >= range.min * (1 - pct) && value <= range.max * (1 + pct);
}

/** ราคา trace ได้ผ่าน `adjust_for_inflation` ที่ log ไว้จริงหรือไม่ — ต้องผ่านทั้ง 3 เงื่อนไข: (1)
 * price_derivation ยังไม่ถูกตัดทิ้ง (ตรงกับผลจริงของ tool อยู่แล้วจากเช็คก่อนหน้าในไฟล์นี้) (2)
 * from_amount_thb ตรงกับราคาแถวใดแถวหนึ่งที่ cite จริง (±1 บาท) (3) unit_price_thb ของบรรทัดนี้ตรงกับ
 * ผล adjustedThb ของ tool จริง (±1 บาท) — ป้องกันโมเดลอ้าง price_derivation ที่ผ่านเงื่อนไข factor แล้ว
 * เอา from_amount_thb ที่ไม่เกี่ยวกับแถวที่ cite จริงมาแต่ง */
function priceTraceableViaInflation(
  line: Pick<BoqLine, 'unit_price_thb' | 'price_derivation'>,
  citations: readonly Citation[],
  ctx: ToolContext,
): boolean {
  const pd = line.price_derivation;
  if (pd === undefined) return false;
  const found = ctx.toolLog.findInflationAdjustment({
    fromAmountThb: pd.from_amount_thb,
    fromYearBe: pd.from_year_be,
    toYearBe: pd.to_year_be,
    indicator: pd.indicator,
  });
  if (found === undefined || Math.abs(found.factor - pd.factor) > 1e-6) return false;

  const matchesCitedRow = citations.some((c) => {
    if (c.kind !== 'budget_line') return false;
    const fp = ctx.toolLog.getSourceFingerprint?.(c.source_id);
    if (fp === undefined) return false;
    const price = referencePriceOf(fp);
    return price !== null && Math.abs(price - pd.from_amount_thb) <= 1;
  });
  if (!matchesCitedRow) return false;

  return Math.abs(line.unit_price_thb - found.adjustedThb) <= 1;
}

function processBoqLine(line: BoqLine, ctx: ToolContext, warnings: string[]): BoqLine {
  const label = `BOQ "${line.item}" (id=${line.id})`;
  const originalCount = line.citations.length;
  const citations = filterCitations(line.citations, ctx, warnings, label);

  let basis = line.basis;
  let confidence = line.confidence;

  if (originalCount > 0 && citations.length === 0 && basis !== 'estimate') {
    warnings.push(
      `${label}: อ้างอิงทั้งหมดไม่พบใน ToolLog ของบทสนทนานี้ — ลดระดับเป็น basis=estimate, confidence=low`,
    );
    basis = 'estimate';
    confidence = 'low';
  }

  if (
    basis === 'historical' &&
    !citations.some((c) => c.kind === 'budget_line' || c.kind === 'document')
  ) {
    warnings.push(
      `${label}: basis=historical ต้องมี citation ชนิด budget_line/document อย่างน้อย 1 รายการ — ลดระดับเป็น estimate/low`,
    );
    basis = 'estimate';
    confidence = 'low';
  }

  if (basis === 'market' && !citations.some((c) => c.kind === 'web')) {
    warnings.push(
      `${label}: basis=market ต้องมี citation ชนิด web (https) อย่างน้อย 1 รายการ — ลดระดับเป็น estimate/low`,
    );
    basis = 'estimate';
    confidence = 'low';
  }

  // AC 2/4: cap confidence ตามแถวที่มี quality flag/ตัวอย่างน้อย ที่บันทึกไว้ตอนเรียก tool
  for (const c of citations) {
    if (c.kind === 'budget_line') {
      const ceiling = ctx.toolLog.getConfidenceCeiling(c.source_id);
      if (ceiling !== undefined) {
        const capped = capConfidence(confidence, ceiling);
        if (capped !== confidence) {
          warnings.push(
            `${label}: แถวที่อ้าง (source_id=${c.source_id}) มีข้อบ่งชี้คุณภาพข้อมูล/ตัวอย่างน้อย — จำกัด confidence ไม่เกิน ${ceiling}`,
          );
        }
        confidence = capped;
      }
    }
  }

  let priceDerivation = line.price_derivation;
  if (priceDerivation !== undefined) {
    const found = ctx.toolLog.findInflationAdjustment({
      fromAmountThb: priceDerivation.from_amount_thb,
      fromYearBe: priceDerivation.from_year_be,
      toYearBe: priceDerivation.to_year_be,
      indicator: priceDerivation.indicator,
    });
    if (!found || Math.abs(found.factor - priceDerivation.factor) > 1e-6) {
      warnings.push(
        `${label}: price_derivation ไม่ตรงกับผลจริงของ adjust_for_inflation ที่เคยเรียกในบทสนทนานี้ — ตัดออก`,
      );
      priceDerivation = undefined;
    }
  }

  // T-307 H2: basis=historical ต้อง trace unit_price_thb กลับไปยังค่าจริงของแถวที่ cite ได้ — ไม่ใช่แค่
  // "มี citation" (ซึ่งตรวจไปแล้วข้างบน) **ห้ามแก้ตัวเลข BOQ อัตโนมัติ** ต่างจาก comparables ที่เป็น
  // ข้อเท็จจริง — ที่นี่เป็นการประมาณของโมเดล จึงลดแค่ confidence/basis พร้อม warning ให้ไปแก้เอง
  //
  // ถ้าไม่มีข้อมูลให้ตรวจเลย (ไม่มี fingerprint ของ citation ไหนเลย และไม่มี price_derivation ที่จะ
  // ตรวจผ่าน adjust_for_inflation) ให้ถือว่า "ตรวจไม่ได้" แล้วปล่อยผ่านเงียบ ๆ (เหมือนพฤติกรรมก่อน T-307)
  // — เช่น citation มาจาก search_catalog aggregate ที่ไม่มีค่ารายแถว หรือ `ToolLog` ที่ไม่ implement
  // เมธอด fingerprint (wrapper นอก `ai/**`) เพื่อไม่ให้ "ข้อมูลไม่พอ" กลายเป็นการลงโทษทุกบรรทัด
  const originalHadPriceDerivation = line.price_derivation !== undefined;
  if (basis === 'historical') {
    const range = collectTraceRange(citations, ctx);
    // main thread (review ของการแก้ H2): "ไม่มีค่าให้ตรวจ" ต้องไม่ใช่ทางลัด — `search_catalog` บันทึก
    // `sample_source_ids` เป็น id ล้วน (ไม่มีค่า) โมเดลจึงอ้าง id เหล่านั้นพร้อมตัวเลขที่แต่งขึ้นได้ ถ้า ToolLog
    // รองรับ fingerprint (ตัวจริงของ `ai/`) แต่แถวที่ cite ไม่เคยถูกดึงค่าเลย → ยืนยันราคาไม่ได้ → confidence
    // ≤ low + บอกวิธีแก้ (เรียก get_budget_line) ; ToolLog ภายนอกที่ไม่มีเมธอดนี้ยังปล่อยผ่านตามเดิม
    const canVerifyValues = typeof ctx.toolLog.getSourceFingerprint === 'function';
    const citesBudgetLine = citations.some((c) => c.kind === 'budget_line');
    if (range === null && !originalHadPriceDerivation && canVerifyValues && citesBudgetLine) {
      warnings.push(
        `${label}: ยังไม่เคยดึงค่าจริงของแถวที่อ้าง (price_not_verifiable) — เรียก get_budget_line ด้วย source_id ` +
          'ที่อ้างเพื่อยืนยันราคา แล้วค่อยส่ง emit_proposal ใหม่; จำกัด confidence ไม่เกิน low',
      );
      confidence = capConfidence(confidence, 'low');
    }
    if (range !== null || originalHadPriceDerivation) {
      const traceableByRange =
        range !== null &&
        isWithinTolerance(line.unit_price_thb, range, HISTORICAL_PRICE_TOLERANCE_PCT);
      const traceableByInflation =
        !traceableByRange && priceTraceableViaInflation(line, citations, ctx);
      if (!traceableByRange && !traceableByInflation) {
        warnings.push(
          `${label}: unit_price_thb (${String(line.unit_price_thb)}) ตรวจสอบย้อนกลับไปยัง citation ไม่ได้ ` +
            '(price_not_traceable) — จำกัด confidence ไม่เกิน low',
        );
        confidence = capConfidence(confidence, 'low');
        if (range !== null) {
          const farAway =
            line.unit_price_thb > range.max * NOT_TRACEABLE_TO_ESTIMATE_MULTIPLIER ||
            line.unit_price_thb < range.min / NOT_TRACEABLE_TO_ESTIMATE_MULTIPLIER;
          if (farAway) {
            warnings.push(
              `${label}: unit_price_thb ห่างจากช่วงราคาที่ตรวจสอบได้ (${String(range.min)}–${String(range.max)}) เกิน ${String(NOT_TRACEABLE_TO_ESTIMATE_MULTIPLIER)} เท่า — ลดระดับเป็น basis=estimate`,
            );
            basis = 'estimate';
          }
        }
      }
    }
  }

  const expectedTotal = line.qty * line.unit_price_thb;
  if (Math.abs(expectedTotal - line.total_thb) > EPSILON_THB) {
    warnings.push(
      `${label}: total_thb (${String(line.total_thb)}) ไม่ตรงกับ qty×unit_price_thb (${expectedTotal.toFixed(2)}) เกิน ±1 บาท`,
    );
  }

  let trendRef = line.trend_ref;
  if (trendRef !== undefined && !ctx.toolLog.hasTrendRef(trendRef)) {
    warnings.push(
      `${label}: trend_ref (${trendRef.kind}:${trendRef.key}) ไม่เคยผ่าน get_price_trend ในบทสนทนานี้ — ตัดออก`,
    );
    trendRef = undefined;
  }

  const result: BoqLine = {
    id: line.id,
    category: line.category,
    item: line.item,
    qty: line.qty,
    unit: line.unit,
    unit_price_thb: line.unit_price_thb,
    total_thb: line.total_thb,
    basis,
    confidence,
    rationale: line.rationale,
    citations,
    ...(line.spec !== undefined ? { spec: line.spec } : {}),
    ...(priceDerivation !== undefined ? { price_derivation: priceDerivation } : {}),
    ...(trendRef !== undefined ? { trend_ref: trendRef } : {}),
  };
  return result;
}

function processWebCitation(
  w: WebCitation,
  ctx: ToolContext,
  warnings: string[],
): WebCitation | null {
  if (!w.url.startsWith('https://')) {
    warnings.push(`citations_web: URL ต้องเป็น https:// เท่านั้น (${w.url}) — ตัดออก`);
    return null;
  }
  if (!ctx.toolLog.hasWebUrl(w.url)) {
    warnings.push(
      `citations_web: URL นี้ไม่เคยปรากฏในผล web_search ของบทสนทนานี้ (${w.url}) — ตัดออก`,
    );
    return null;
  }
  return w;
}

/** T-307 H2: `comparables[]` เป็น "ข้อเท็จจริง" (ไม่ใช่การประมาณของโมเดล) — ต่างจาก BOQ ตรงที่ต้องแก้
 * ทับด้วยค่าจริงจาก `SourceFingerprint` เมื่อไม่ตรง (ไม่ใช่แค่ตัด/ลดระดับ) เพื่อไม่ให้ AI ใช้ source_id
 * จริงเป็น "ใบเบิกทาง" แล้วแต่งตัวเลข/ชื่อหน่วยงานที่ผูกกับ id นั้นขึ้นมาเอง ไม่ตรวจ field ที่ fingerprint
 * เป็น `null` จริง (แปลว่าแถวต้นทางไม่มีค่านั้นอยู่แล้ว — ไม่มีค่าจริงให้เขียนทับ) */
function reconcileComparable(c: Comparable, ctx: ToolContext, warnings: string[]): Comparable {
  const fp = ctx.toolLog.getSourceFingerprint?.(c.source_id);
  if (fp === undefined) {
    // ไม่มี fingerprint ให้ตรวจ (เช่น source_id นี้เห็นแค่ผ่าน search_catalog aggregate ที่ไม่มีค่า
    // รายแถว) — คงค่าเดิม (ผ่านด่าน hasSourceId มาแล้ว เหมือนพฤติกรรมก่อน T-307)
    return c;
  }
  const mismatches: string[] = [];
  let corrected: Comparable = c;

  if (fp.amountThb !== null && c.amount_thb !== fp.amountThb) {
    mismatches.push(`amount_thb (${String(c.amount_thb)} → ${String(fp.amountThb)})`);
    corrected = { ...corrected, amount_thb: fp.amountThb };
  }
  if (
    c.unit_price_thb !== undefined &&
    fp.unitPriceThb !== null &&
    c.unit_price_thb !== fp.unitPriceThb
  ) {
    mismatches.push(`unit_price_thb (${String(c.unit_price_thb)} → ${String(fp.unitPriceThb)})`);
    corrected = { ...corrected, unit_price_thb: fp.unitPriceThb };
  }
  if (c.fiscal_year_be !== fp.fiscalYearBe) {
    mismatches.push(`fiscal_year_be (${String(c.fiscal_year_be)} → ${String(fp.fiscalYearBe)})`);
    corrected = { ...corrected, fiscal_year_be: fp.fiscalYearBe };
  }
  if (fp.agency !== null && c.agency !== fp.agency) {
    mismatches.push(`agency ("${c.agency}" → "${fp.agency}")`);
    corrected = { ...corrected, agency: fp.agency };
  }
  if (c.item_name !== fp.itemNameRaw) {
    mismatches.push(`item_name ("${c.item_name}" → "${fp.itemNameRaw}")`);
    corrected = { ...corrected, item_name: fp.itemNameRaw };
  }

  if (mismatches.length > 0) {
    warnings.push(
      `comparables (source_id=${c.source_id}): ค่าที่ AI ใส่ไม่ตรงกับข้อมูลจริงที่เคยเห็นในบทสนทนานี้ — ` +
        `แก้ทับด้วยค่าจริงแล้ว: ${mismatches.join(', ')}`,
    );
  }
  return corrected;
}

export interface ValidateProposalResult {
  proposal: Proposal;
  warnings: string[];
}

export function validateAndNormalizeProposal(
  input: Proposal,
  ctx: ToolContext,
): ValidateProposalResult {
  const warnings: string[] = [];

  const boq = input.boq.map((line) => processBoqLine(line, ctx, warnings));

  const citationsWeb = input.citations_web
    .map((w) => processWebCitation(w, ctx, warnings))
    .filter((w): w is WebCitation => w !== null);

  const comparables = input.comparables
    .filter((c) => {
      if (!ctx.toolLog.hasSourceId(c.source_id)) {
        warnings.push(`comparables: source_id "${c.source_id}" ไม่เคยปรากฏในบทสนทนานี้ — ตัดออก`);
        return false;
      }
      return true;
    })
    .map((c) => reconcileComparable(c, ctx, warnings));

  const illustrations = input.illustrations.filter((i) => {
    if (!ctx.toolLog.hasIllustrationId(i.illustration_id)) {
      warnings.push(
        `illustrations: illustration_id "${i.illustration_id}" ไม่เคยผ่าน emit_illustration ในบทสนทนานี้ — ตัดออก`,
      );
      return false;
    }
    return true;
  });

  const statCards = input.stat_cards.filter((s) => {
    if (!ctx.toolLog.hasTrendRef(s.trend_ref)) {
      warnings.push(
        `stat_cards: trend_ref (${s.trend_ref.kind}:${s.trend_ref.key}) ไม่เคยผ่าน get_price_trend ในบทสนทนานี้ — ตัดออก`,
      );
      return false;
    }
    return true;
  });

  const auditFindings = input.audit_findings?.map((f) => ({
    text: f.text,
    severity: f.severity,
    citations: filterCitations(
      f.citations,
      ctx,
      warnings,
      `audit_finding "${f.text.slice(0, 40)}"`,
    ),
  }));

  const sumBoq = boq.reduce((sum, line) => sum + line.total_thb, 0);
  if (Math.abs(sumBoq - input.totals.subtotal_thb) > EPSILON_THB) {
    warnings.push(
      `totals.subtotal_thb (${String(input.totals.subtotal_thb)}) ไม่ตรงกับผลรวม boq[].total_thb (${sumBoq.toFixed(2)}) เกิน ±1 บาท`,
    );
  }
  const contingencyAmount =
    input.totals.contingency_thb ??
    (input.totals.contingency_pct !== undefined
      ? (input.totals.subtotal_thb * input.totals.contingency_pct) / 100
      : 0);
  const expectedGrand = input.totals.subtotal_thb + contingencyAmount;
  if (Math.abs(expectedGrand - input.totals.grand_total_thb) > EPSILON_THB) {
    warnings.push(
      `totals.grand_total_thb (${String(input.totals.grand_total_thb)}) ไม่สอดคล้องกับ subtotal+contingency (${expectedGrand.toFixed(2)}) เกิน ±1 บาท`,
    );
  }

  const proposal: Proposal = {
    ...input,
    boq,
    citations_web: citationsWeb,
    comparables,
    illustrations,
    stat_cards: statCards,
    ...(auditFindings !== undefined ? { audit_findings: auditFindings } : {}),
  };

  return { proposal, warnings };
}

// ---------------------------------------------------------------------------
// emit_proposal tool
// ---------------------------------------------------------------------------

const MAX_RECOMMENDED_ATTEMPTS = 2;

export const EmitProposalOutputSchema = z.object({
  ok: z.literal(true),
  proposal_id: z.string(),
  warnings: z.array(z.string()),
  proposal: ProposalSchema,
  attempt: z.number().int(),
});
export type EmitProposalOutput = z.infer<typeof EmitProposalOutputSchema>;

function generateProposalId(): string {
  return `prop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ไม่มี await ในนี้จริง ๆ (validator เป็น pure function ทั้งหมด) — ไม่ใช้ `async` เพื่อไม่ให้
// eslint (`@typescript-eslint/require-await`) เตือน แต่ `createTool` ต้องการ handler ที่คืน Promise
function handler(input: Proposal, ctx: ToolContext): Promise<EmitProposalOutput> {
  const { proposal, warnings } = validateAndNormalizeProposal(input, ctx);
  const attempt = ctx.toolLog.recordProposalAttempt();
  if (attempt > MAX_RECOMMENDED_ATTEMPTS) {
    warnings.push(
      `นี่คือรอบแก้ไขที่ ${String(attempt)} (แนะนำไม่เกิน ${String(MAX_RECOMMENDED_ATTEMPTS)} รอบ) — ระบบจะแสดงผลตามที่ได้พร้อม badge ให้ผู้ใช้ตัดสินใจต่อ`,
    );
  }
  return Promise.resolve({
    ok: true,
    proposal_id: generateProposalId(),
    warnings,
    proposal,
    attempt,
  });
}

export const emitProposalTool = createTool({
  name: 'emit_proposal',
  description:
    'ส่งข้อเสนอโครงการฉบับสมบูรณ์ (BOQ + citations + totals) — ทุกตัวเลขที่ basis≠estimate ต้องมี ' +
    'citation ที่มาจากผล tool จริงในบทสนทนานี้เท่านั้น (ตรวจกับ ToolLog อัตโนมัติ อ้างอิงที่หาไม่พบจะถูก ' +
    'ตัด/ลดระดับ confidence ให้พร้อม warning) เรียกซ้ำได้เมื่อผู้ใช้ขอแก้ (แนะนำไม่เกิน 2 รอบ)',
  inputSchema: ProposalSchema,
  outputSchema: EmitProposalOutputSchema,
  handler,
});
