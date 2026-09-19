/**
 * T-301 — จุดเดียวที่ประกอบ `MessageCreateParams` ตามความสามารถของแต่ละรุ่น (ADR-006)
 *
 * ใช้ SDK types เท่านั้น (`Anthropic.MessageParam`, `Anthropic.ToolUnion`, ...) — ห้ามนิยามซ้ำ
 * (ADR-006 ข้อ 4) ห้าม import React/DOM API (module boundary — docs/04-ARCHITECTURE.md §3)
 *
 * กฎที่บังคับ (ADR-006):
 * - ห้ามส่ง `temperature`/`top_p`/`top_k`/`thinking.budget_tokens` เด็ดขาด (ข้อ 2) — ทำได้โดย "ไม่ใส่
 *   key เหล่านี้เลย" ในทุก branch ของฟังก์ชันนี้ (มี unit test ต่อรุ่นยืนยันว่าไม่หลุด)
 * - `output_config.effort` เฉพาะรุ่นที่ `supportsEffort` (ข้อ 2)
 * - `thinking: {type:"adaptive"}` เฉพาะรุ่นที่ `supportsAdaptiveThinking` (ไม่ส่ง `budget_tokens` ใด ๆ)
 * - `max_tokens` คงที่ 16,000 ทุก turn (ข้อ 8)
 * - web search: ใช้ `webSearchToolType` ของรุ่น, `max_uses: 3`, ห้ามประกาศ `code_execution` คู่กัน
 *   (เราไม่เพิ่ม code_execution ที่ไหนเลยในไฟล์นี้ — ตรงตามข้อ 3 โดยไม่ต้องมี logic พิเศษ)
 * - Prompt caching (ข้อ 7): breakpoint ≤ 4 — ใช้ 3 จุดคงที่: (ก) tool ตัวสุดท้าย (ในที่นี้คือ
 *   web_search ที่ถูกเติมท้ายเสมอ) (ข) ท้าย system block เดียว (ค) เนื้อหาสุดท้ายของข้อความล่าสุด
 * - opus-5: เปิด server-side refusal fallback (`fallbacks:"default"` + beta
 *   `server-side-fallback-2026-07-01`) ตามข้อ 6 — **[UNVERIFIED]** เพราะงบไม่พอทดสอบ Opus จริง
 *   (ยืนยันแค่รูปร่างของ request ด้วย unit test)
 *
 * หมายเหตุ: การเรียกจริง (`client.messages.stream()` vs `client.beta.messages.stream()`,
 * MAX_TOOL_ROUNDS, ToolLog ต่อ session, ยกเลิกกลางคัน) เป็นของ `ai/agent.ts` (T-304 — นอกขอบเขตงานนี้)
 * ไฟล์นี้คืนแค่พารามิเตอร์ที่ประกอบแล้ว + ธงบอกว่าต้องใช้ namespace `beta` หรือไม่
 */
import type Anthropic from '@anthropic-ai/sdk';
import { getModelCapability, type EffortLevel, type ModelId, MAX_TOKENS_PER_TURN, WEB_SEARCH_MAX_USES } from './models';

/** ADR-006 ข้อ 6: header เฉพาะ opus-5 สำหรับฟอร์ม scalar `fallbacks:"default"` */
export const OPUS_5_FALLBACK_BETA_HEADER = 'server-side-fallback-2026-07-01';

export interface BuildRequestInput {
  model: ModelId;
  /** ค่าเริ่มต้น `DEFAULT_EFFORT` ('medium') — ถูกเพิกเฉยเมื่อรุ่นไม่รองรับ effort (Haiku 4.5) */
  effort?: EffortLevel;
  /** system prompt ส่วนที่ cache ได้ (ต้อง deterministic — ห้ามมีวันที่/ค่าที่เปลี่ยนต่อ request ตามข้อ 7) */
  system: string;
  messages: Anthropic.MessageParam[];
  /** client tools ที่จะเสนอ (เรียงคงที่จาก `tools/index.ts` — ฟังก์ชันนี้ไม่จัดเรียงเอง) */
  tools: Anthropic.Tool[];
  /** ปิด web search ได้ (ค่าเริ่มต้น true) — ใช้ตอน eval ที่ต้องการคุมต้นทุน/deterministic */
  enableWebSearch?: boolean;
}

/**
 * `params` มีชนิดตรงกับ `Anthropic.MessageCreateParams` เสมอ ยกเว้นฟิลด์ `fallbacks` ที่เป็นของ
 * `client.beta.messages.*` เท่านั้น (SDK ยังไม่มี field นี้ใน type ของ non-beta — ดูคอมเมนต์หัวไฟล์)
 * — ตรวจสอบด้วย `useBetaMessages`/`betaHeaders` ก่อนเลือกว่าจะเรียกผ่าน namespace ไหน
 */
export interface BuildRequestResult {
  params: Anthropic.MessageCreateParams & { fallbacks?: 'default' };
  useBetaMessages: boolean;
  betaHeaders: string[];
}

function withToolCacheControl<T extends { cache_control?: Anthropic.CacheControlEphemeral | null }>(
  tool: T,
): T {
  return { ...tool, cache_control: { type: 'ephemeral' } };
}

/** breakpoint (ก): ตั้งบน tool ตัวสุดท้ายของ array ที่ประกอบเสร็จแล้ว (รวม web_search ถ้ามี) */
function applyLastToolCacheControl(tools: Anthropic.ToolUnion[]): Anthropic.ToolUnion[] {
  if (tools.length === 0) {
    return tools;
  }
  const result = [...tools];
  const lastIndex = result.length - 1;
  const last = result[lastIndex];
  if (last !== undefined) {
    result[lastIndex] = withToolCacheControl(last);
  }
  return result;
}

/**
 * boundary: ไม่ใช่ทุกสมาชิกของ `Anthropic.ContentBlockParam` (union ใหญ่) ประกาศ `cache_control` ใน
 * type ตรง ๆ (เช่น `ContainerUploadBlockParam`) แต่บล็อกที่โปรเจกต์นี้ใช้จริง (text/tool_use/
 * tool_result/image) รองรับเสมอ — cast กลับเป็น `ContentBlockParam` หลังเติม field
 */
function applyCacheControlToBlock(block: Anthropic.ContentBlockParam): Anthropic.ContentBlockParam {
  return { ...block, cache_control: { type: 'ephemeral' } } as Anthropic.ContentBlockParam;
}

/** breakpoint (ค): ตั้งบน content block สุดท้ายของข้อความสุดท้ายใน `messages` */
function applyLastMessageCacheControl(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length === 0) {
    return messages;
  }
  const lastIndex = messages.length - 1;
  const last = messages[lastIndex];
  if (last === undefined) {
    return messages;
  }
  const content: Anthropic.ContentBlockParam[] =
    typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : [...last.content];
  const lastBlockIndex = content.length - 1;
  const lastBlock = content[lastBlockIndex];
  if (lastBlock === undefined) {
    return messages;
  }
  content[lastBlockIndex] = applyCacheControlToBlock(lastBlock);
  const updated = [...messages];
  updated[lastIndex] = { ...last, content };
  return updated;
}

function buildWebSearchTool(model: ModelId): Anthropic.ToolUnion {
  const cap = getModelCapability(model);
  // boundary: `WebSearchTool20260209`/`WebSearchTool20250305` เป็นสมาชิกของ `Anthropic.ToolUnion`
  // อยู่แล้ว (SDK types) — เลือก literal ตาม `webSearchToolType` ของรุ่นด้วย if แยก เพื่อให้ TS
  // narrow ชนิด `type`/`name` ที่ literal ตรงกันเป๊ะ (ไม่ cast เป็น any)
  if (cap.webSearchToolType === 'web_search_20260209') {
    return { type: 'web_search_20260209', name: 'web_search', max_uses: WEB_SEARCH_MAX_USES };
  }
  return { type: 'web_search_20250305', name: 'web_search', max_uses: WEB_SEARCH_MAX_USES };
}

/**
 * ประกอบ `MessageCreateParams` ตามรุ่น — จุดเดียวที่ห้ามแตะพารามิเตอร์ต้องห้าม (ADR-006)
 */
export function buildRequestParams(input: BuildRequestInput): BuildRequestResult {
  const cap = getModelCapability(input.model);

  const toolsWithWebSearch: Anthropic.ToolUnion[] =
    input.enableWebSearch === false ? [...input.tools] : [...input.tools, buildWebSearchTool(input.model)];
  const tools = applyLastToolCacheControl(toolsWithWebSearch);

  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: input.system, cache_control: { type: 'ephemeral' } },
  ];

  const messages = applyLastMessageCacheControl(input.messages);

  const params: Anthropic.MessageCreateParams & { fallbacks?: 'default' } = {
    model: input.model,
    max_tokens: MAX_TOKENS_PER_TURN,
    system,
    messages,
    tools,
  };

  // ห้ามส่ง thinking ให้ Haiku 4.5 เด็ดขาด (ADR-006 ข้อ 2) — ใส่คีย์เฉพาะรุ่นที่รองรับ
  if (cap.supportsAdaptiveThinking) {
    params.thinking = { type: 'adaptive' };
  }
  // ห้ามส่ง output_config.effort ให้ Haiku 4.5 (error) — ใส่คีย์เฉพาะรุ่นที่รองรับ
  if (cap.supportsEffort) {
    params.output_config = { effort: input.effort ?? 'medium' };
  }

  const betaHeaders: string[] = [];
  let useBetaMessages = false;
  if (input.model === 'claude-opus-5') {
    useBetaMessages = true;
    betaHeaders.push(OPUS_5_FALLBACK_BETA_HEADER);
    params.fallbacks = 'default';
  }

  return { params, useBetaMessages, betaHeaders };
}
