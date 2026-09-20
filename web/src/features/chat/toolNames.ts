/**
 * T-405 — รายชื่อ tool ที่รู้จัก (ตรงกับ key ย่อยของ `chat.tool.*` ใน `docs/ui/copy.th.json`) +
 * ตารางคีย์ข้อความ "กำลังทำงาน" ต่อ tool
 *
 * เหตุผลที่ไม่ใช้ template literal type (`` `chat.tool.${ToolName}.running` ``) ตรง ๆ: `ToolActivity.name`
 * มาจาก `AgentEvent`/`ai/agent.ts` เป็น `string` ธรรมดา (ไม่ narrow เป็น union) — ใช้ตาราง lookup ที่ type
 * checked ไว้ล่วงหน้าแทน เพื่อไม่ต้อง `as` cast ที่จุดใช้งาน
 */
import type { CopyKey } from '@/i18n';

export const KNOWN_TOOL_NAMES = [
  'search_catalog',
  'query_budget_lines',
  'get_budget_line',
  'find_documents',
  'read_document',
  'get_econ_indicator',
  'adjust_for_inflation',
  'get_price_trend',
  'emit_illustration',
  'emit_proposal',
  'web_search',
] as const;

export type KnownToolName = (typeof KNOWN_TOOL_NAMES)[number];

export function isKnownToolName(name: string): name is KnownToolName {
  return (KNOWN_TOOL_NAMES as readonly string[]).includes(name);
}

/** ข้อความ "กำลังทำงาน" ต่อ tool — ใช้ตอน `ToolActivity.status === 'running'` (ยังไม่มี `inputSummary`
 * เพราะ `AgentEvent` ชนิด `tool_start` มีแค่ `id`/`name` เท่านั้น ดูคอมเมนต์ `toolCopy.ts`) */
export const RUNNING_KEY: Record<KnownToolName, CopyKey> = {
  search_catalog: 'chat.tool.search_catalog.running',
  query_budget_lines: 'chat.tool.query_budget_lines.running',
  get_budget_line: 'chat.tool.get_budget_line.running',
  find_documents: 'chat.tool.find_documents.running',
  read_document: 'chat.tool.read_document.running',
  get_econ_indicator: 'chat.tool.get_econ_indicator.running',
  adjust_for_inflation: 'chat.tool.adjust_for_inflation.running',
  get_price_trend: 'chat.tool.get_price_trend.running',
  emit_illustration: 'chat.tool.emit_illustration.running',
  emit_proposal: 'chat.tool.emit_proposal.running',
  web_search: 'chat.tool.web_search.running',
};
