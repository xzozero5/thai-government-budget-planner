/**
 * T-306 — สรุปผลลัพธ์ของแต่ละ tool ให้กระชับพอใส่ transcript ของ eval (ข้อ 2: "tool calls (ชื่อ+input+
 * สรุปผล+isError)") โดยไม่ต้องเก็บ output เต็มทุกฟิลด์ (จะโตเกินความจำเป็นสำหรับ 20 โจทย์ × หลายรอบ) —
 * ยกเว้น `emit_proposal` ที่ต้องเก็บ proposal ที่ normalize แล้ว + warnings เต็ม ๆ ตามสเปก
 *
 * pure function ล้วน (ไม่แตะ DOM/network) — รับ output ที่ tool คืนจริง (หลัง Zod parse ผ่านแล้วจาก
 * `ai/tools/toolKit.ts#createTool`) มาสรุป
 */
import type { GetBudgetLineOutput } from '@/ai/tools/getBudgetLine';
import type { QueryBudgetLinesOutput } from '@/ai/tools/queryBudgetLines';
import type { SearchCatalogOutput } from '@/ai/tools/searchCatalog';
import type { FindDocumentsOutput } from '@/ai/tools/findDocuments';
import type { ReadDocumentOutput } from '@/ai/tools/readDocument';
import type { GetEconIndicatorOutput } from '@/ai/tools/getEconIndicator';
import type { AdjustForInflationOutput } from '@/ai/tools/adjustForInflation';
import type { GetPriceTrendOutput } from '@/ai/tools/getPriceTrend';
import type { EmitIllustrationOutput } from '@/ai/tools/emitIllustration';
import type { EmitProposalOutput } from '@/ai/tools/proposal';

/** ค่าที่เก็บได้จาก JSON.stringify (transcript ถูกส่งข้าม `page.evaluate` — ต้อง JSON-serializable) */
export type ToolOutputPreview = Record<string, unknown>;

function uniq<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

function summarizeSearchCatalog(output: SearchCatalogOutput): ToolOutputPreview {
  return {
    total: output.total,
    item_keys: output.items.map((i) => i.key).slice(0, 10),
    any_low_specificity: output.items.some((i) => i.low_specificity),
    coverage_notes: output.coverage_notes,
  };
}

function summarizeQueryBudgetLines(output: QueryBudgetLinesOutput): ToolOutputPreview {
  return {
    total: output.total,
    truncated: output.truncated,
    row_count: output.rows.length,
    datasets: uniq(output.rows.map((r) => r.dataset)),
    fiscal_years_be: uniq(output.rows.map((r) => r.fiscal_year_be)).sort((a, b) => a - b),
    source_ids: output.rows.map((r) => r.source_id).slice(0, 10),
    coverage_notes: output.coverage_notes,
    warnings: output.warnings,
  };
}

function summarizeGetBudgetLine(output: GetBudgetLineOutput): ToolOutputPreview {
  return {
    total: output.total,
    datasets: uniq(output.lines.map((l) => l.dataset)),
    source_ids: output.lines.map((l) => l.source_id).slice(0, 10),
    not_found: output.not_found.map((n) => n.source_id),
  };
}

function summarizeFindDocuments(output: FindDocumentsOutput): ToolOutputPreview {
  return {
    total: output.total,
    doc_ids: output.docs.map((d) => d.doc_id).slice(0, 10),
    coverage_notes: output.coverage_notes,
  };
}

function summarizeReadDocument(output: ReadDocumentOutput): ToolOutputPreview {
  return {
    doc_id: output.doc.doc_id,
    total_chunks: output.total_chunks,
    note: output.note ?? null,
    coverage_notes: output.coverage_notes,
    warnings: output.warnings,
  };
}

function summarizeGetEconIndicator(output: GetEconIndicatorOutput): ToolOutputPreview {
  return { total: output.total, values: output.values };
}

function summarizeAdjustForInflation(output: AdjustForInflationOutput): ToolOutputPreview {
  return {
    adjusted_thb: output.adjusted_thb,
    factor: output.factor,
    indicator: output.indicator,
    warnings: output.warnings,
  };
}

function summarizeGetPriceTrend(output: GetPriceTrendOutput): ToolOutputPreview {
  return {
    has_series: output.series !== null,
    kind: output.series?.kind ?? null,
    key: output.series?.key ?? null,
    points_count: output.series?.points.length ?? 0,
    change_pct: output.summary?.change_pct ?? null,
    // T-604(A): เผื่อ transcript ต้องวิเคราะห์ว่า has_series:false เพราะ key ไม่ตรง catalog หรือไม่มี
    // ข้อมูลจริง (ดู `ai/tools/getPriceTrend.ts`)
    warnings: output.warnings,
  };
}

function summarizeEmitIllustration(output: EmitIllustrationOutput): ToolOutputPreview {
  return { illustration_id: output.illustration_id, warnings: output.warnings };
}

function summarizeEmitProposal(output: EmitProposalOutput): ToolOutputPreview {
  // เก็บเต็ม (proposal ที่ normalize แล้ว + warnings) ตามสเปก T-306 ข้อ 2 — cast ผ่าน JSON เพื่อยืนยันว่า
  // เป็น plain JSON-serializable ล้วน (ไม่มี class instance/Map/Set หลงเหลือ) ก่อนส่งข้าม page.evaluate
  return JSON.parse(JSON.stringify(output)) as ToolOutputPreview;
}

const DEFAULT_PREVIEW_MAX_CHARS = 2000;

function summarizeUnknown(output: unknown): ToolOutputPreview {
  const json = output === undefined ? 'null' : JSON.stringify(output);
  return {
    preview:
      json.length > DEFAULT_PREVIEW_MAX_CHARS
        ? `${json.slice(0, DEFAULT_PREVIEW_MAX_CHARS)}…`
        : json,
  };
}

/** boundary: `output` มาจาก `ToolDefinition.run()` เป็น `unknown` เชิง type ของ agent.ts (generic tool
 * registry ไม่ผูก TInput/TOutput ต่อ tool — ดู `ai/agent.ts`) แต่ shape จริงตรงกับ output schema ของ
 * tool ชื่อนั้นเสมอ (validate ผ่าน Zod มาแล้วก่อนถึงจุดนี้) จึง cast ตาม `name` ที่นี่จุดเดียว */
export function summarizeToolOutput(name: string, output: unknown): ToolOutputPreview {
  switch (name) {
    case 'search_catalog':
      return summarizeSearchCatalog(output as SearchCatalogOutput);
    case 'query_budget_lines':
      return summarizeQueryBudgetLines(output as QueryBudgetLinesOutput);
    case 'get_budget_line':
      return summarizeGetBudgetLine(output as GetBudgetLineOutput);
    case 'find_documents':
      return summarizeFindDocuments(output as FindDocumentsOutput);
    case 'read_document':
      return summarizeReadDocument(output as ReadDocumentOutput);
    case 'get_econ_indicator':
      return summarizeGetEconIndicator(output as GetEconIndicatorOutput);
    case 'adjust_for_inflation':
      return summarizeAdjustForInflation(output as AdjustForInflationOutput);
    case 'get_price_trend':
      return summarizeGetPriceTrend(output as GetPriceTrendOutput);
    case 'emit_illustration':
      return summarizeEmitIllustration(output as EmitIllustrationOutput);
    case 'emit_proposal':
      return summarizeEmitProposal(output as EmitProposalOutput);
    default:
      return summarizeUnknown(output);
  }
}
