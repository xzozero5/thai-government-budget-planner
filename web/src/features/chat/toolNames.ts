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

/** T-410 M4 (po-review ชุด B, US-2.2) — ข้อความไทยล้วนต่อ tool/สถานะผลลัพธ์ (`ToolResultSummary.status`)
 * ใช้เมื่อ `ToolActivity.summary` มีค่า (ชุด A) — บาง tool ไม่มี key ของสถานะบางอย่าง (เช่น
 * `adjust_for_inflation`/`emit_illustration`/`emit_proposal` ไม่มี `.empty` ใน copy.th.json เพราะ output
 * ของ tool เหล่านี้ไม่มีแนวคิด "ว่างเปล่า") — จงใจไม่ใส่ให้ครบทุกช่อง ผู้เรียก (`ToolActivityCard`) ต้อง
 * เผื่อกรณี `undefined` เสมอ แล้ว fallback ไปใช้ `inputSummary` เดิม
 *
 * ตัด `web_search` ออกจากตารางนี้โดยตั้งใจ — ต้องแสดง query เสมอไม่ว่าสถานะไหน (T-307) ซึ่ง
 * `ToolActivityCard` ดักจับเป็นกรณีพิเศษไว้ก่อนถึงจุดที่ใช้ตารางนี้อยู่แล้ว */
export const STATUS_KEY: Record<
  Exclude<KnownToolName, 'web_search'>,
  Partial<Record<'done' | 'empty' | 'error', CopyKey>>
> = {
  search_catalog: {
    done: 'chat.tool.search_catalog.done',
    empty: 'chat.tool.search_catalog.empty',
    error: 'chat.tool.search_catalog.error',
  },
  query_budget_lines: {
    done: 'chat.tool.query_budget_lines.done',
    empty: 'chat.tool.query_budget_lines.empty',
    error: 'chat.tool.query_budget_lines.error',
  },
  get_budget_line: {
    done: 'chat.tool.get_budget_line.done',
    empty: 'chat.tool.get_budget_line.empty',
    error: 'chat.tool.get_budget_line.error',
  },
  find_documents: {
    done: 'chat.tool.find_documents.done',
    empty: 'chat.tool.find_documents.empty',
    error: 'chat.tool.find_documents.error',
  },
  read_document: {
    done: 'chat.tool.read_document.done',
    empty: 'chat.tool.read_document.empty',
    error: 'chat.tool.read_document.error',
  },
  get_econ_indicator: {
    done: 'chat.tool.get_econ_indicator.done',
    empty: 'chat.tool.get_econ_indicator.empty',
    error: 'chat.tool.get_econ_indicator.error',
  },
  adjust_for_inflation: {
    done: 'chat.tool.adjust_for_inflation.done',
    error: 'chat.tool.adjust_for_inflation.error',
  },
  get_price_trend: {
    done: 'chat.tool.get_price_trend.done',
    empty: 'chat.tool.get_price_trend.empty',
    error: 'chat.tool.get_price_trend.error',
  },
  emit_illustration: {
    done: 'chat.tool.emit_illustration.done',
    error: 'chat.tool.emit_illustration.error',
  },
  emit_proposal: {
    done: 'chat.tool.emit_proposal.done',
    error: 'chat.tool.emit_proposal.error',
  },
};
