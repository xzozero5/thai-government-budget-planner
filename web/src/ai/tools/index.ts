/**
 * T-302 — Registry ของ client tools ทั้งหมด (05-FEATURES.md §3) เรียงลำดับ **คงที่**
 * (ADR-006 ข้อ 7: tool ต้อง deterministic เพื่อไม่ทำลาย prompt cache — ห้ามเปลี่ยนลำดับโดยไม่ตั้งใจ)
 */
import type Anthropic from '@anthropic-ai/sdk';
import { getModelCapability, type ModelId } from '../models';
import { adjustForInflationTool } from './adjustForInflation';
import { emitIllustrationTool } from './emitIllustration';
import { findDocumentsTool } from './findDocuments';
import { getBudgetLineTool } from './getBudgetLine';
import { getEconIndicatorTool } from './getEconIndicator';
import { getPriceTrendTool } from './getPriceTrend';
import { emitProposalTool } from './proposal';
import { queryBudgetLinesTool } from './queryBudgetLines';
import { readDocumentTool } from './readDocument';
import { searchCatalogTool } from './searchCatalog';

export {
  adjustForInflationTool,
  emitIllustrationTool,
  emitProposalTool,
  findDocumentsTool,
  getBudgetLineTool,
  getEconIndicatorTool,
  getPriceTrendTool,
  queryBudgetLinesTool,
  readDocumentTool,
  searchCatalogTool,
};

export type { ToolContext, ToolDefinition, ToolRunResult } from './toolKit';

/** ลำดับคงที่ — ตามลำดับ "ขั้นตอนมาตรฐาน" ใน 05-FEATURES.md §4 (intake → search_catalog →
 * query_budget_lines → get_budget_line → find_documents/read_document → get_econ_indicator/
 * adjust_for_inflation → get_price_trend → emit_illustration → emit_proposal) */
export const TOOL_REGISTRY = [
  searchCatalogTool,
  queryBudgetLinesTool,
  getBudgetLineTool,
  findDocumentsTool,
  readDocumentTool,
  getEconIndicatorTool,
  adjustForInflationTool,
  getPriceTrendTool,
  emitIllustrationTool,
  emitProposalTool,
] as const;

/**
 * คืน `Anthropic.Tool[]` ตามลำดับคงที่ของ `TOOL_REGISTRY` — ทุก tool เหมือนกันทุกรุ่นในตอนนี้
 * (ยังไม่มีเหตุผลให้ต่างกันต่อรุ่น) รับ `model` ไว้เพื่อตรวจว่าเป็นรุ่นที่รู้จักจริง (โยน error ชัดเจน
 * แทนที่จะส่ง tools ผิดชุดออกไปเงียบ ๆ) และเผื่อ Phase ถัดไปต้องปรับชุด tool ต่อรุ่น
 */
export function toApiTools(model: ModelId): Anthropic.Tool[] {
  getModelCapability(model);
  return TOOL_REGISTRY.map((t) => t.toApiTool());
}
