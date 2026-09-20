/**
 * T-405 — ช่วยประกอบข้อความ tool activity จาก `docs/ui/copy.th.json`
 *
 * ข้อจำกัดของสถาปัตยกรรมปัจจุบัน (ไม่ใช่ของ T-405 — `ai/agent.ts`/`ai/session/chatController.ts` อยู่นอก
 * ขอบเขตไฟล์ที่แก้ได้ของงานนี้): `AgentEvent` ชนิด `tool_start` มีแค่ `{id, name}` และ `tool_result` มีแค่
 * `{id, name, isError, summaryTh}` — ไม่มี query/count/ปี ฯลฯ ที่ template ของ `chat.tool.<tool>.*`
 * ต้องการ (เช่น `{query}`, `{from}`, `{to}`) ยกเว้น `web_search` ที่ `server_tool` event ส่ง `query` มาให้
 * ตรง ๆ (เก็บใน `ToolActivity.inputSummary`) — ดู T-405 CLOSE-OUT ในรายงานปิดงาน: แนะนำให้ ai-engineer
 * ขยาย `AgentEvent`/`chatStore.ToolActivity` ให้พก raw input/output อย่างน้อย query/count ในรอบถัดไป
 *
 * ระหว่างนี้ `renderToolTemplate` แทนที่ placeholder ที่ไม่มีค่าด้วย "…" แทนการโชว์ `{name}` ดิบ ๆ
 */
import { t, type CopyKey } from '@/i18n';

const UNRESOLVED_PLACEHOLDER = /\{[a-zA-Z0-9_]+\}/g;

export function renderToolTemplate(key: CopyKey, params?: Record<string, string | number>): string {
  return t(key, params).replace(UNRESOLVED_PLACEHOLDER, '…');
}

/**
 * T-410 M4 — เหมือน `renderToolTemplate` แต่คืน `null` เมื่อ template ยังมี placeholder เหลือหลังแทนค่า
 * (แปลว่า `params` ที่มีให้ไม่พอจะเติมประโยคนี้ให้ครบ) แทนการโชว์ "…" — ผู้เรียก (`ToolActivityCard`)
 * ใช้เพื่อตัดสินว่าจะใช้ข้อความไทยเต็มจาก `chat.tool.<tool>.<status>` (ชุด A `ToolActivity.summary`) หรือ
 * ต้อง fallback ไปใช้ `inputSummary` เดิมที่ `ai/agent.ts` เตรียมมาให้ (ซึ่งมีค่าจริงครบกว่าในบาง tool)
 */
export function renderToolTemplateIfComplete(
  key: CopyKey,
  params: Record<string, string | number> = {},
): string | null {
  const rendered = t(key, params);
  return /\{[a-zA-Z0-9_]+\}/.test(rendered) ? null : rendered;
}
