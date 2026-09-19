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
 */
import { z } from 'zod';
import { createTool, type ToolContext } from './toolKit';

// ---------------------------------------------------------------------------
// Schema (05-FEATURES.md §5)
// ---------------------------------------------------------------------------

export const TrendRefSchema = z.object({
  kind: z.enum(['item', 'indicator']),
  key: z.string(),
});
export type TrendRef = z.infer<typeof TrendRefSchema>;

export const CitationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('budget_line'), source_id: z.string(), note: z.string().optional() }),
  z.object({
    kind: z.literal('document'),
    doc_id: z.string(),
    page: z.number().int().optional(),
    quote: z.string().optional(),
  }),
  z.object({ kind: z.literal('econ'), indicator: z.string(), year_be: z.number().int() }),
  z.object({
    kind: z.literal('web'),
    url: z.string(),
    title: z.string().optional(),
    retrieved_at: z.string(),
    price_note: z.string().optional(),
  }),
]);
export type Citation = z.infer<typeof CitationSchema>;

const CONFIDENCE_VALUES = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCE_VALUES)[number];

export const BoqLineSchema = z.object({
  id: z.string(),
  category: z.string(),
  item: z.string(),
  spec: z.string().optional(),
  // main thread (review T-303): จำนวน/เงินต้องเป็นค่าบวกจำกัด — `qty:-2 × 28000 = -56000` เลขคณิต
  // สอดคล้องกันจึงเคยผ่านตัวตรวจ total แบบเงียบ ๆ; เพดาน 1e13 บาท = เกณฑ์ `corrupt_row` ของ pipeline
  qty: z.number().positive().max(1e9), // zod v4: z.number() ปฏิเสธ NaN/Infinity อยู่แล้ว
  unit: z.string().min(1),
  unit_price_thb: z.number().nonnegative().max(1e13),
  total_thb: z.number().nonnegative().max(1e13),
  basis: z.enum(['historical', 'market', 'estimate']),
  confidence: z.enum(CONFIDENCE_VALUES),
  rationale: z.string().min(1),
  price_derivation: z
    .object({
      from_amount_thb: z.number(),
      from_year_be: z.number().int(),
      to_year_be: z.number().int(),
      indicator: z.string(),
      factor: z.number(),
    })
    .optional(),
  citations: z.array(CitationSchema),
  trend_ref: TrendRefSchema.optional(),
});
export type BoqLine = z.infer<typeof BoqLineSchema>;

export const AssumptionSchema = z.object({
  text: z.string(),
  impact: z.enum(['high', 'medium', 'low']),
});
export const RiskSchema = z.object({ text: z.string(), mitigation: z.string().optional() });
export const ScopeSectionSchema = z.object({ section: z.string(), items: z.array(z.string()) });

export const ComparableSchema = z.object({
  source_id: z.string(),
  fiscal_year_be: z.number().int(),
  agency: z.string(),
  item_name: z.string(),
  amount_thb: z.number(),
  unit_price_thb: z.number().optional(),
  similarity_note: z.string(),
});
export type Comparable = z.infer<typeof ComparableSchema>;

export const WebCitationSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  retrieved_at: z.string(),
  price_note: z.string().optional(),
});
export type WebCitation = z.infer<typeof WebCitationSchema>;

export const AuditFindingSchema = z.object({
  text: z.string(),
  severity: z.enum(['info', 'warn', 'high']),
  citations: z.array(CitationSchema),
});
export type AuditFinding = z.infer<typeof AuditFindingSchema>;

export const IllustrationRefSchema = z.object({
  illustration_id: z.string(),
  title: z.string(),
  caption: z.string(),
  kind: z.enum(['map', 'cross_section', 'isometric', 'diagram']),
});
export type IllustrationRef = z.infer<typeof IllustrationRefSchema>;

export const StatCardSchema = z.object({ trend_ref: TrendRefSchema, headline_th: z.string() });
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
  area: z.string().optional(),
  owner_agency: z.string().optional(),
  target_group: z.string().optional(),
  fiscal_year_be: z.number().int(),
  duration_months: z.number().optional(),
});

export const ProposalSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  mode: z.enum(['audit', 'draft']),
  requester_context: RequesterContextSchema,
  objectives: z.array(z.string()),
  scope_and_specs: z.array(ScopeSectionSchema),
  assumptions: z.array(AssumptionSchema),
  boq: z.array(BoqLineSchema).min(1),
  totals: TotalsSchema,
  comparables: z.array(ComparableSchema),
  risks: z.array(RiskSchema),
  audit_findings: z.array(AuditFindingSchema).optional(),
  open_questions: z.array(z.string()),
  citations_web: z.array(WebCitationSchema),
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

function filterCitations(
  citations: Citation[],
  ctx: ToolContext,
  warnings: string[],
  label: string,
): Citation[] {
  const resolved: Citation[] = [];
  for (const c of citations) {
    if (isCitationResolved(c, ctx)) {
      resolved.push(c);
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

  const comparables = input.comparables.filter((c) => {
    if (!ctx.toolLog.hasSourceId(c.source_id)) {
      warnings.push(`comparables: source_id "${c.source_id}" ไม่เคยปรากฏในบทสนทนานี้ — ตัดออก`);
      return false;
    }
    return true;
  });

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
