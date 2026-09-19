/**
 * T-304 — `ai/agent.ts`: manual agentic loop (ADR-006 ข้อ 4 — ไม่ใช้ beta Tool Runner)
 *
 * ใช้ `client.messages.stream()` + `stream.finalMessage()` ตามแพทเทิร์น "Streaming Manual Loop"
 * (`typescript/claude-api/tool-use.md`) คุมเองทั้งหมด: จำนวนรอบ tool สูงสุด, เพดานค่าใช้จ่าย, การ
 * ยกเลิกกลางคันผ่าน `AbortSignal`, citation integrity ผ่าน `ToolLog` (มาจาก `toolContext`), และ event
 * สำหรับ UI (`onEvent`)
 *
 * ขอบเขต/สิ่งที่ไม่ทำในไฟล์นี้ (ตั้งใจ — ดูรายงานปิดงาน T-304):
 * - **ไม่ประกอบ system prompt เอง** — รับ `system` (ผลลัพธ์ของ `ai/systemPrompt.ts#buildSystemBlocks`,
 *   T-305) ตรง ๆ จากผู้เรียก แล้วส่งต่อให้ `requestBuilder` (ADR-006 ข้อ 7: "ถ้าต้องขยาย requestBuilder
 *   ให้ทำที่นั่น ไม่ทำซ้ำใน agent") — เลี่ยงไม่ให้ agent.ts ต้องรู้จัก dataset key/indicator list ซ้ำกับ
 *   T-305 และเปิดให้ทดสอบ agent loop ได้โดยไม่ต้องประกอบ facets/econIndicators fixture ทุกเทสต์
 * - **`claude-opus-5` server-side refusal fallback (ADR-006 ข้อ 6) ยังไม่เดินผ่าน beta endpoint** —
 *   `client.beta.messages` ใน SDK เวอร์ชันนี้ไม่มี helper `.stream()` (มีแค่ `.create()` ที่คืน
 *   `BetaMessage`/`BetaContentBlock` คนละ type กับ non-beta ทั้งก้อน) การรองรับจริงต้องทำ loop คู่ขนาน
 *   แยกสำหรับ beta types ซึ่งเกินเวลาของงานนี้ และ ADR-006 เองก็ทำเครื่องหมาย `[UNVERIFIED]` ไว้แล้ว
 *   (ไม่มีงบทดสอบ Opus จริง) — จึงตัด `fallbacks` ออกก่อนส่งแล้วเรียกผ่าน endpoint ปกติเสมอ พร้อมแจ้ง
 *   เตือนผู้ใช้ผ่าน event `warning`
 *
 * ห้าม import React/DOM API (module boundary — docs/04-ARCHITECTURE.md §3)
 */
import Anthropic from '@anthropic-ai/sdk';
import { costFromUsage } from './pricing';
import type { EffortLevel, ModelId } from './models';
import { buildRequestParams, type SystemPromptInput } from './requestBuilder';
import type { ChatMode } from './systemPrompt';
import { TOOL_REGISTRY, toApiTools, type ToolContext } from './tools';
import { EmitProposalOutputSchema, type EmitProposalOutput } from './tools/proposal';

// ---------------------------------------------------------------------------
// ค่าคงที่
// ---------------------------------------------------------------------------

/** ค่าเริ่มต้นของ `budget.maxToolRounds` (04 §D4: "ครบ MAX_TOOL_ROUNDS = 8") */
export const DEFAULT_MAX_TOOL_ROUNDS = 8;

/** T-307 (security review M2) — เดิม `maxCostUsdPerTurn`/`maxCostUsdPerSession` เป็น `undefined` เมื่อ
 * ผู้เรียกไม่ส่งมา (ไม่มีเพดานเงินโดยปริยายเลย มีแต่ `maxToolRounds`) สินทรัพย์ที่ป้องกันคือเงินของผู้ใช้
 * เอง — ถ้า UI (Phase 4) ลืมส่ง budget จะไม่มีเพดานใด ๆ คุมค่าใช้จ่ายต่อการสนทนา ค่าเหล่านี้เป็นค่า
 * เริ่มต้นที่ใช้เฉพาะตอนผู้เรียกไม่ระบุ (`input.budget?.maxCostUsdPerTurn`/`...PerSession` ยังคง override
 * ได้ตามปกติ) — ผู้ใช้ควรปรับได้เองใน UI ภายหลัง (settings ของ Phase 4) ไม่ใช่ค่าตายตัวถาวร */
export const DEFAULT_MAX_COST_USD_PER_TURN = 0.5;
export const DEFAULT_MAX_COST_USD_PER_SESSION = 3.0;

// ---------------------------------------------------------------------------
// ประเภทข้อมูล public
// ---------------------------------------------------------------------------

export interface RunAgentTurnBudget {
  /** เพดานจำนวนรอบที่ยิง request หา model ได้ต่อ 1 การเรียก `runAgentTurn` (ค่าเริ่มต้น 8) */
  maxToolRounds?: number;
  /** เพดานค่าใช้จ่าย (USD) เฉพาะของ turn นี้ */
  maxCostUsdPerTurn?: number;
  /** เพดานค่าใช้จ่ายรวมของทั้ง session (เทียบกับ `spentUsdSoFar` + ค่าใช้จ่ายที่เกิดขึ้นใน turn นี้) */
  maxCostUsdPerSession?: number;
  /** ค่าใช้จ่ายที่ session นี้ใช้ไปแล้วก่อนเริ่ม turn นี้ (ค่าเริ่มต้น 0) */
  spentUsdSoFar?: number;
}

export interface AgentToolCallRecord {
  id: string;
  name: string;
  isError: boolean;
  /** รอบ (round) ที่ tool นี้ถูกเรียก — เริ่มที่ 1 */
  round: number;
}

/** สรุป usage สะสมของทุก round ใน turn นี้ (SDK ไม่มี helper รวม `Anthropic.Usage` หลายก้อนให้เอง) */
export interface AgentUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  webSearchRequests: number;
}

export type AgentEndedBecause =
  | 'end_turn'
  | 'max_rounds'
  | 'budget'
  | 'cancelled'
  | 'refusal'
  | 'max_tokens'
  | 'error';

export type AgentEvent =
  | { type: 'round'; round: number }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; id: string; name: string }
  | { type: 'tool_input_progress'; id: string; partialJson: string }
  | { type: 'tool_result'; id: string; name: string; isError: boolean; summaryTh: string }
  | { type: 'server_tool'; name: 'web_search'; query?: string }
  | { type: 'usage'; costUsd: number; totalSpentUsd: number }
  | { type: 'warning'; messageTh: string };

export interface RunAgentTurnInput {
  client: Anthropic;
  model: ModelId;
  /** ค่าเริ่มต้นของรุ่น (`DEFAULT_EFFORT`) ใช้เมื่อไม่ระบุ — ถูกเพิกเฉยกับรุ่นที่ไม่รองรับ (Haiku 4.5) */
  effort?: EffortLevel;
  /** โหมดที่ผู้ใช้เลือก — agent.ts ไม่ใช้ตัดสินใจ logic ของ loop เอง (แค่ผ่านต่อให้ event/log เผื่อ UI
   * ต้องการ) เพราะเนื้อหาที่โหมดมีผลจริง ๆ (ย่อหน้าท้าย system prompt) ผู้เรียกต้องใส่ไว้ใน `system`
   * ที่ส่งเข้ามาแล้ว (ผ่าน `buildSystemBlocks({mode, ...})` ของ T-305) */
  mode: ChatMode;
  /** system prompt ที่ประกอบไว้แล้ว — ปกติคือผลลัพธ์ของ `ai/systemPrompt.ts#buildSystemBlocks` */
  system: SystemPromptInput;
  /** ประวัติที่ UI ถืออยู่ (รวมข้อความล่าสุดของผู้ใช้ที่ยังไม่ได้ตอบ) — ฟังก์ชันนี้ไม่ mutate array/object
   * ใด ๆ ในนี้เลย (คืน array ใหม่เสมอ) */
  messages: Anthropic.MessageParam[];
  toolContext: ToolContext;
  signal?: AbortSignal;
  budget?: RunAgentTurnBudget;
  onEvent?: (event: AgentEvent) => void;
  /** ปิด web search ได้ (ส่งต่อให้ `requestBuilder`) — ค่าเริ่มต้น true (เปิด); ตั้ง false ตอน eval ที่
   * ต้องการผลลัพธ์ deterministic/คุมต้นทุน */
  enableWebSearch?: boolean;
}

export interface RunAgentTurnResult {
  /** ประวัติใหม่ทั้งหมด (ของเดิม + สิ่งที่เกิดขึ้นใน turn นี้) — valid เสมอสำหรับส่งเป็น request ถัดไป
   * (ไม่มี `tool_use` ที่ขาด `tool_result` ค้างอยู่ ไม่ว่าจะจบด้วยเหตุผลใด) */
  messages: Anthropic.MessageParam[];
  stopReason: Anthropic.StopReason | null;
  usageTotals: AgentUsageTotals;
  /** ค่าใช้จ่ายรวมของ turn นี้เท่านั้น (USD) — ไม่รวม `spentUsdSoFar` ที่ส่งเข้ามา */
  costUsd: number;
  toolCalls: AgentToolCallRecord[];
  /** ผลลัพธ์ของ `emit_proposal` ล่าสุดที่สำเร็จใน turn นี้ (ถ้ามี) */
  proposal?: EmitProposalOutput;
  endedBecause: AgentEndedBecause;
}

// ---------------------------------------------------------------------------
// tool registry แบบ generic (ไม่สนใจ TInput/TOutput เฉพาะของแต่ละ tool — agent.ts เรียกผ่าน `run()`
// ที่ validate ด้วย Zod ให้แล้วใน `tools/toolKit.ts#createTool` เท่านั้น)
// ---------------------------------------------------------------------------

type GenericToolRunResult =
  | { isError: true; content: string }
  | { isError: false; content: string; output: unknown };

interface RunnableTool {
  name: string;
  run: (rawInput: unknown, ctx: ToolContext) => Promise<GenericToolRunResult>;
}

const TOOL_BY_NAME: ReadonlyMap<string, RunnableTool> = new Map(
  TOOL_REGISTRY.map((tool): [string, RunnableTool] => [tool.name, tool]),
);

function isEmitProposalOutput(value: unknown): value is EmitProposalOutput {
  return EmitProposalOutputSchema.safeParse(value).success;
}

// ---------------------------------------------------------------------------
// usage totals
// ---------------------------------------------------------------------------

function createEmptyUsageTotals(): AgentUsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    webSearchRequests: 0,
  };
}

function addUsage(totals: AgentUsageTotals, usage: Anthropic.Usage): void {
  totals.inputTokens += usage.input_tokens;
  totals.outputTokens += usage.output_tokens;
  totals.cacheCreationInputTokens += usage.cache_creation_input_tokens ?? 0;
  totals.cacheReadInputTokens += usage.cache_read_input_tokens ?? 0;
  totals.webSearchRequests += usage.server_tool_use?.web_search_requests ?? 0;
}

// ---------------------------------------------------------------------------
// typed error chain → ข้อความไทย (ADR-006 ข้อ 4: ห้าม string-match; `shared/error-codes.md`
// "Catch most-specific first" — ลำดับ TS: NotFoundError → RateLimitError → APIConnectionError →
// APIError ทั่วไป)
// ---------------------------------------------------------------------------

function classifyAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'API key ไม่ถูกต้องหรือถูกเพิกถอน กรุณาตรวจสอบแล้วลองใหม่อีกครั้ง';
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return 'บัญชีนี้ไม่มีสิทธิ์เรียกใช้โมเดลที่เลือก กรุณาตรวจสอบสิทธิ์ในบัญชี Anthropic ของคุณ';
  }
  if (err instanceof Anthropic.RateLimitError) {
    const retryAfter = err.headers.get('retry-after');
    return retryAfter !== null && retryAfter !== ''
      ? `ถูกจำกัดอัตราการเรียกใช้ (rate limit) กรุณารออย่างน้อย ${retryAfter} วินาทีแล้วลองใหม่อีกครั้ง`
      : 'ถูกจำกัดอัตราการเรียกใช้ (rate limit) กรุณารอสักครู่แล้วลองใหม่อีกครั้ง';
  }
  // ต้องเช็คก่อน APIError ทั่วไป — ใน TS SDK เป็น subclass ของ APIError
  if (err instanceof Anthropic.APIConnectionError) {
    return 'เชื่อมต่อ api.anthropic.com ไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่';
  }
  if (err instanceof Anthropic.APIError) {
    // ครอบคลุม 5xx (รวม 529 overloaded — TS SDK ไม่มี class แยกสำหรับ overloaded, ดู
    // `shared/error-codes.md`: "APIStatusError (Python only)") และ 4xx อื่นที่ไม่ใช่ 3 ชนิดข้างบน
    // หมายเหตุ: `instanceof` กับ class ทั่วไป (ไม่ระบุ generic args) ทำให้ TS narrow `err.status` เป็น
    // `any` แทนที่จะใช้ default type param ของ `APIError` — กัน `no-unsafe-assignment` ด้วย typeof guard
    const status = typeof err.status === 'number' ? err.status : undefined;
    return `เซิร์ฟเวอร์ Anthropic ขัดข้องหรือปฏิเสธคำขอ (สถานะ ${status !== undefined ? String(status) : 'ไม่ทราบ'}) กรุณาลองใหม่อีกครั้ง`;
  }
  return 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุขณะเรียก AI กรุณาลองใหม่อีกครั้ง';
}

// ---------------------------------------------------------------------------
// stream events (ADR-006 ข้อ 4/5) → AgentEvent สำหรับ UI (เฉพาะที่ต้องการ real-time: ข้อความ/tool
// input กำลังสร้าง — ส่วนที่ต้องรอผลลัพธ์ที่ประกอบสมบูรณ์แล้ว เช่น server_tool/tool_result/usage มา
// จาก `message` ที่ได้จาก `finalMessage()` แทน ไม่ใช่จาก raw stream events)
// ---------------------------------------------------------------------------

function handleStreamEvent(
  event: Anthropic.MessageStreamEvent,
  blockIndexToId: Map<number, string>,
  emit: (e: AgentEvent) => void,
): void {
  if (event.type === 'content_block_start') {
    const block = event.content_block;
    if (block.type === 'tool_use') {
      blockIndexToId.set(event.index, block.id);
      emit({ type: 'tool_start', id: block.id, name: block.name });
    }
    return;
  }
  if (event.type === 'content_block_delta') {
    const delta = event.delta;
    if (delta.type === 'text_delta') {
      emit({ type: 'text_delta', text: delta.text });
      return;
    }
    if (delta.type === 'input_json_delta') {
      const id = blockIndexToId.get(event.index);
      if (id !== undefined) {
        emit({ type: 'tool_input_progress', id, partialJson: delta.partial_json });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// server tool (web_search) — บันทึก URL ลง ToolLog (เฉพาะ https) เพื่อให้ `emit_proposal` ตรวจ
// citation ได้ (ADR-006 ข้อ 3: error ของ server tool มาเป็น object ไม่ใช่ list — ต้องแยกกรณี ไม่ throw)
// ---------------------------------------------------------------------------

const WEB_SEARCH_ERROR_TH: Record<Anthropic.WebSearchToolResultErrorCode, string> = {
  invalid_tool_input: 'พารามิเตอร์การค้นเว็บไม่ถูกต้อง',
  unavailable: 'บริการค้นเว็บไม่พร้อมใช้งานชั่วคราว',
  max_uses_exceeded: 'ใช้โควตาการค้นเว็บครบตามที่กำหนดต่อรอบสนทนาแล้ว',
  too_many_requests: 'มีการเรียกค้นเว็บถี่เกินไป',
  query_too_long: 'คำค้นยาวเกินไป',
  request_too_large: 'คำขอค้นเว็บมีขนาดใหญ่เกินไป',
};

function extractWebSearchQuery(input: unknown): string | undefined {
  if (input !== null && typeof input === 'object' && 'query' in input) {
    const query = (input as { query?: unknown }).query;
    return typeof query === 'string' ? query : undefined;
  }
  return undefined;
}

function processServerToolBlocks(
  content: Anthropic.ContentBlock[],
  toolContext: ToolContext,
  emit: (e: AgentEvent) => void,
): void {
  for (const block of content) {
    if (block.type === 'server_tool_use' && block.name === 'web_search') {
      const query = extractWebSearchQuery(block.input);
      emit(query !== undefined ? { type: 'server_tool', name: 'web_search', query } : { type: 'server_tool', name: 'web_search' });
      continue;
    }
    if (block.type === 'web_search_tool_result') {
      if (Array.isArray(block.content)) {
        for (const result of block.content) {
          if (result.url.startsWith('https://')) {
            toolContext.toolLog.recordWebUrl(result.url);
          }
        }
      } else {
        emit({
          type: 'warning',
          messageTh: `การค้นเว็บไม่สำเร็จ: ${WEB_SEARCH_ERROR_TH[block.content.error_code]}`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// รัน client tools ของ 1 round (ขนาน) — ส่ง tool_result ทุกตัวกลับใน user message เดียว เรียงตามลำดับ
// tool_use เดิม (ADR-006 ข้อ 5)
// ---------------------------------------------------------------------------

function summarizeToolResult(name: string, result: GenericToolRunResult): string {
  if (result.isError) {
    return `${name}: เรียกใช้ไม่สำเร็จ`;
  }
  const output = result.output;
  if (output !== null && typeof output === 'object') {
    const total = (output as { total?: unknown }).total;
    if (typeof total === 'number') {
      return `${name}: พบ ${String(total)} รายการ`;
    }
    if ((output as { ok?: unknown }).ok === true) {
      return `${name}: สำเร็จ`;
    }
  }
  return `${name}: เรียกสำเร็จ`;
}

interface ToolRoundOutcome {
  results: Anthropic.ToolResultBlockParam[];
  calls: AgentToolCallRecord[];
  proposal?: EmitProposalOutput;
}

async function runToolUseBlocks(
  blocks: Anthropic.ToolUseBlock[],
  toolContext: ToolContext,
  round: number,
  emit: (e: AgentEvent) => void,
): Promise<ToolRoundOutcome> {
  const outcomes = await Promise.all(
    blocks.map(async (block) => {
      const tool = TOOL_BY_NAME.get(block.name);
      if (tool === undefined) {
        const result: GenericToolRunResult = {
          isError: true,
          content: `ไม่รู้จักเครื่องมือชื่อ "${block.name}" ในระบบนี้ — ไม่มีการเรียกใด ๆ เกิดขึ้น`,
        };
        return { block, result };
      }
      const result = await tool.run(block.input, toolContext);
      return { block, result };
    }),
  );

  const results: Anthropic.ToolResultBlockParam[] = [];
  const calls: AgentToolCallRecord[] = [];
  let proposal: EmitProposalOutput | undefined;

  for (const { block, result } of outcomes) {
    results.push({
      type: 'tool_result',
      tool_use_id: block.id,
      is_error: result.isError,
      content: result.content,
    });
    calls.push({ id: block.id, name: block.name, isError: result.isError, round });
    emit({
      type: 'tool_result',
      id: block.id,
      name: block.name,
      isError: result.isError,
      summaryTh: summarizeToolResult(block.name, result),
    });
    if (!result.isError && block.name === 'emit_proposal' && isEmitProposalOutput(result.output)) {
      proposal = result.output;
    }
  }

  return proposal !== undefined ? { results, calls, proposal } : { results, calls };
}

/** ใช้ตอน `refusal`/`max_tokens` ที่มี `tool_use` ค้าง หรือตอนยกเลิกกลางคันระหว่างรัน tool — เติม
 * `tool_result` แบบ `is_error` ให้ทุก tool_use ที่ไม่ได้ถูกเรียกจริง เพื่อให้ประวัติ valid เสมอ (ห้ามค้าง
 * tool_use ที่ไม่มี tool_result — 09 §3 / ADR-006 ข้อ 5) */
function buildDroppedToolResults(
  blocks: Anthropic.ToolUseBlock[],
  messageTh: string,
): Anthropic.ToolResultBlockParam[] {
  return blocks.map((block) => ({
    type: 'tool_result',
    tool_use_id: block.id,
    is_error: true,
    content: messageTh,
  }));
}

// ---------------------------------------------------------------------------
// runAgentTurn
// ---------------------------------------------------------------------------

export async function runAgentTurn(input: RunAgentTurnInput): Promise<RunAgentTurnResult> {
  const { client, model, effort, system, toolContext, signal } = input;
  const maxToolRounds = input.budget?.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const maxCostUsdPerTurn = input.budget?.maxCostUsdPerTurn ?? DEFAULT_MAX_COST_USD_PER_TURN;
  const maxCostUsdPerSession = input.budget?.maxCostUsdPerSession ?? DEFAULT_MAX_COST_USD_PER_SESSION;
  const spentUsdSoFar = input.budget?.spentUsdSoFar ?? 0;
  const onEvent = input.onEvent;

  const emit = (event: AgentEvent): void => {
    onEvent?.(event);
  };

  // สำเนาใหม่เสมอ — ห้าม mutate `input.messages` ของผู้เรียก (ทั้ง array และ object ข้างในไม่ถูกแก้เลย
  // ตลอดฟังก์ชันนี้ มีแต่การสร้าง array/object ใหม่ต่อท้าย)
  let history: Anthropic.MessageParam[] = [...input.messages];
  const toolCallRecords: AgentToolCallRecord[] = [];
  const usageTotals = createEmptyUsageTotals();
  let turnCostUsd = 0;
  let latestProposal: EmitProposalOutput | undefined;
  let round = 0;
  let opusFallbackWarned = false;

  const finish = (stopReason: Anthropic.StopReason | null, endedBecause: AgentEndedBecause): RunAgentTurnResult => ({
    messages: history,
    stopReason,
    usageTotals,
    costUsd: turnCostUsd,
    toolCalls: toolCallRecords,
    ...(latestProposal !== undefined ? { proposal: latestProposal } : {}),
    endedBecause,
  });

  for (;;) {
    // ยกเลิก/เพดานงบ/เพดานรอบ ต้องเช็คก่อนยิง request ถัดไปเสมอ (รวมถึงก่อน request แรกของ turn นี้)
    if (signal?.aborted) {
      return finish(null, 'cancelled');
    }
    if (turnCostUsd >= maxCostUsdPerTurn) {
      emit({
        type: 'warning',
        messageTh: `ถึงเพดานค่าใช้จ่ายของการสนทนานี้ (${maxCostUsdPerTurn.toFixed(2)} USD) แล้ว ระบบหยุดก่อนเรียก AI รอบถัดไป`,
      });
      return finish(null, 'budget');
    }
    if (spentUsdSoFar + turnCostUsd >= maxCostUsdPerSession) {
      emit({
        type: 'warning',
        messageTh: `ถึงเพดานค่าใช้จ่ายรวมของ session นี้ (${maxCostUsdPerSession.toFixed(2)} USD) แล้ว ระบบหยุดก่อนเรียก AI รอบถัดไป`,
      });
      return finish(null, 'budget');
    }
    if (round >= maxToolRounds) {
      emit({
        type: 'warning',
        messageTh: `ถึงเพดานจำนวนรอบเครื่องมือสูงสุดต่อการสนทนา (${String(maxToolRounds)} รอบ) แล้ว กด "ทำต่อ" เพื่อดำเนินการต่อ`,
      });
      return finish(null, 'max_rounds');
    }

    round += 1;
    emit({ type: 'round', round });

    const { params } = buildRequestParams({
      model,
      system,
      messages: history,
      tools: toApiTools(model),
      ...(effort !== undefined ? { effort } : {}),
      ...(input.enableWebSearch !== undefined ? { enableWebSearch: input.enableWebSearch } : {}),
    });

    // ตัด `fallbacks` ออกก่อนเรียก endpoint ปกติเสมอ (ดูคอมเมนต์หัวไฟล์ — beta path ยังไม่รองรับ)
    const { fallbacks, ...paramsForStream } = params;
    if (fallbacks !== undefined && !opusFallbackWarned) {
      opusFallbackWarned = true;
      emit({
        type: 'warning',
        messageTh:
          'โมเดลนี้รองรับ server-side refusal fallback แต่ agent เวอร์ชันนี้ยังไม่เรียกผ่าน beta endpoint (ยังไม่ได้ทดสอบด้วยงบจริง) — ระบบเรียกแบบปกติแทน',
      });
    }

    let message: Anthropic.Message;
    try {
      const stream = client.messages.stream(paramsForStream, { signal, maxRetries: 1 });
      const blockIndexToId = new Map<number, string>();
      for await (const event of stream) {
        handleStreamEvent(event, blockIndexToId, emit);
      }
      message = await stream.finalMessage();
    } catch (err) {
      if (signal?.aborted || err instanceof Anthropic.APIUserAbortError) {
        return finish(null, 'cancelled');
      }
      emit({ type: 'warning', messageTh: classifyAnthropicError(err) });
      return finish(null, 'error');
    }

    const cost = costFromUsage(model, message.usage);
    addUsage(usageTotals, message.usage);
    turnCostUsd += cost.totalCostUsd;
    emit({ type: 'usage', costUsd: cost.totalCostUsd, totalSpentUsd: spentUsdSoFar + turnCostUsd });

    processServerToolBlocks(message.content, toolContext, emit);

    const toolUseBlocks = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

    // เติมประวัติด้วย response เต็มก้อนเสมอ (ห้ามเก็บแค่ text — ตัด tool_use/server_tool_use ทิ้งจะทำให้
    // ประวัติผิดรูปสำหรับรอบถัดไป) ไม่ว่าจะจบด้วย stop_reason ใด
    history = [...history, { role: 'assistant', content: message.content }];

    if (message.stop_reason === 'refusal') {
      if (toolUseBlocks.length > 0) {
        history = [
          ...history,
          {
            role: 'user',
            content: buildDroppedToolResults(
              toolUseBlocks,
              'คำขอนี้ถูกปฏิเสธด้วยเหตุผลด้านนโยบายก่อนที่การเรียกเครื่องมือจะเสร็จสมบูรณ์ — ไม่ได้เรียกเครื่องมือนี้จริง',
            ),
          },
        ];
      }
      return finish(message.stop_reason, 'refusal');
    }

    if (message.stop_reason === 'max_tokens') {
      if (toolUseBlocks.length > 0) {
        history = [
          ...history,
          {
            role: 'user',
            content: buildDroppedToolResults(
              toolUseBlocks,
              'พารามิเตอร์ของเครื่องมือนี้ถูกตัดกลางคันเพราะครบเพดาน max_tokens — ไม่ได้เรียกเครื่องมือนี้จริง กรุณาลองใหม่',
            ),
          },
        ];
      }
      emit({
        type: 'warning',
        messageTh: 'คำตอบยาวเกินเพดาน max_tokens ของรอบนี้ กรุณาลองใหม่หรือถามให้เจาะจงขึ้น',
      });
      return finish(message.stop_reason, 'max_tokens');
    }

    if (message.stop_reason === 'pause_turn') {
      // server-side tool loop (เช่น web_search) ยังไม่จบ — ส่งประวัติเดิมกลับไปให้ server ทำต่อโดยไม่
      // ต้องเติม user message ใหม่ (`shared/tool-use-concepts.md`: "Do NOT add an extra user message")
      continue;
    }

    if (message.stop_reason === 'tool_use' && toolUseBlocks.length > 0) {
      const outcome = await runToolUseBlocks(toolUseBlocks, toolContext, round, emit);
      toolCallRecords.push(...outcome.calls);
      if (outcome.proposal !== undefined) {
        latestProposal = outcome.proposal;
      }
      history = [...history, { role: 'user', content: outcome.results }];

      if (signal?.aborted) {
        // ประวัติข้างบน valid แล้ว (ทุก tool_use มี tool_result ครบ) — หยุดโดยไม่ยิง request ถัดไป
        return finish(message.stop_reason, 'cancelled');
      }
      continue;
    }

    // end_turn (ปกติ) หรือ stop_reason อื่นที่ไม่ได้ระบุไว้ข้างบน (`stop_sequence`,
    // `model_context_window_exceeded`) — จบ turn ตรงนี้เสมอ ประวัติล่าสุดถูกเติมไปแล้วข้างบน
    return finish(message.stop_reason, message.stop_reason === 'end_turn' ? 'end_turn' : 'error');
  }
}
