/**
 * T-409 — mock ของ `https://api.anthropic.com` สำหรับ e2e (Playwright `page.route`)
 *
 * ทุก request ไป `https://api.anthropic.com/**` ต้องถูกดักที่นี่เสมอ (N5/09-SECURITY §2) — ไม่มีการ
 * เรียก API จริงในสภาพแวดล้อม e2e ไม่ว่ากรณีใด (ห้ามใส่ key จริง/`.env.local` ในไฟล์นี้หรือที่อื่นใน
 * `tests/e2e/**`)
 *
 * กลยุทธ์: mock ที่ระดับ HTTP/SSE จริง (ไม่ใช่ mock SDK) เพื่อให้ CSP `connect-src`, header
 * `x-api-key`, และ egress audit (07 §3.3 ข้อ 3) ทำงานตามจริงทั้งหมด ยกเว้นปลายทางเครือข่ายจริง
 *
 * รูปแบบ SSE ที่ generate ตรงกับที่ `@anthropic-ai/sdk` (`core/streaming.js`/`lib/MessageStream.js`)
 * คาดหวังจริง (ยืนยันจากโค้ด SDK ที่ bundle มากับ repo): `event: <type>\ndata: <json>\n\n` เรียงตาม
 * `message_start` → `content_block_start/delta/stop` ต่อบล็อก → `message_delta` (มี stop_reason/
 * usage) → `message_stop` — ลำดับเดียวกับที่ `web/src/ai/testing/fakeAnthropic.ts` ใช้ทดสอบ
 * `agent.ts` ระดับ unit (พิสูจน์แล้วว่าตรงกับ accumulator จริงของ SDK เวอร์ชันนี้)
 *
 * เหตุผลที่ต้องอ่าน tool_result จาก request body ของรอบถัดไป (ไม่ใช่ประกอบ input เอง): tool ต่าง ๆ
 * (search_catalog/query_budget_lines) รันจริงกับข้อมูลจริงใน `web/public/data/` ผ่าน DuckDB-WASM —
 * mock ไม่รู้ผลลัพธ์ล่วงหน้า ต้อง "อ่านของจริง" จาก history ที่แอปส่งมาในรอบถัดไปเสมอ (ตามที่ main
 * thread สั่งไว้) เพื่อให้ citation ใน emit_proposal อ้าง source_id ที่ resolve ได้จริงใน ToolLog
 */
import type { Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// ค่าคงที่ที่ห้ามมีสตริงรูป key จริง (กฎของงานนี้: ห้ามมีสตริง `sk-ant-`+≥8 อักขระ)
// ---------------------------------------------------------------------------

export const FAKE_API_KEY = ['sk', 'ant', 'e2e-fake-key-000000'].join('-');
/** โดเมนปลอมที่ไม่มีอยู่จริง — ใช้เป็นเป้าโจมตีของ SVG sanitizer test (T-412/T-307) */
export const EVIL_ORIGIN = 'https://evil.e2e.invalid';

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const COUNT_TOKENS_URL = 'https://api.anthropic.com/v1/messages/count_tokens';
const ANTHROPIC_CATCH_ALL = 'https://api.anthropic.com/**';

// ---------------------------------------------------------------------------
// Content block / message builders (รูปร่างตรงกับ Anthropic Messages API จริง — ดู
// `web/src/ai/testing/fakeAnthropic.ts` สำหรับ TS-typed เทียบเคียง)
// ---------------------------------------------------------------------------

export interface MockTextBlock {
  type: 'text';
  text: string;
  citations: null;
}

export interface MockToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export type MockContentBlock = MockTextBlock | MockToolUseBlock;

export interface MockUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation: null;
  server_tool_use: { web_search_requests: number } | null;
  output_tokens_details: null;
  service_tier: string;
  inference_geo: null;
}

export interface MockMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: MockContentBlock[];
  stop_reason: string | null;
  stop_sequence: string | null;
  stop_details: null;
  container: null;
  usage: MockUsage;
}

let messageIdSeq = 0;
let toolUseIdSeq = 0;

export function textBlock(text: string): MockTextBlock {
  return { type: 'text', text, citations: null };
}

export function toolUseBlock(name: string, input: unknown, id?: string): MockToolUseBlock {
  toolUseIdSeq += 1;
  return { type: 'tool_use', id: id ?? `toolu_e2e_${String(toolUseIdSeq)}`, name, input };
}

export function makeUsage(overrides: Partial<MockUsage> = {}): MockUsage {
  return {
    input_tokens: 500,
    output_tokens: 120,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    cache_creation: null,
    server_tool_use: null,
    output_tokens_details: null,
    service_tier: 'standard',
    inference_geo: null,
    ...overrides,
  };
}

export function makeMessage(input: {
  content: MockContentBlock[];
  stopReason: string | null;
  usage?: MockUsage;
  model?: string;
}): MockMessage {
  messageIdSeq += 1;
  return {
    id: `msg_e2e_${String(messageIdSeq)}`,
    type: 'message',
    role: 'assistant',
    model: input.model ?? 'claude-sonnet-5',
    content: input.content,
    stop_reason: input.stopReason,
    stop_sequence: null,
    stop_details: null,
    container: null,
    usage: input.usage ?? makeUsage(),
  };
}

// ---------------------------------------------------------------------------
// SSE encoding — ดูคอมเมนต์หัวไฟล์
// ---------------------------------------------------------------------------

function sseLine(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function buildSseBody(message: MockMessage): string {
  const lines: string[] = [];
  lines.push(sseLine('message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null } }));

  message.content.forEach((block, index) => {
    if (block.type === 'text') {
      lines.push(
        sseLine('content_block_start', {
          type: 'content_block_start',
          index,
          content_block: { type: 'text', text: '', citations: null },
        }),
      );
      lines.push(
        sseLine('content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'text_delta', text: block.text },
        }),
      );
    } else {
      lines.push(
        sseLine('content_block_start', {
          type: 'content_block_start',
          index,
          content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
        }),
      );
      lines.push(
        sseLine('content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
        }),
      );
    }
    lines.push(sseLine('content_block_stop', { type: 'content_block_stop', index }));
  });

  lines.push(
    sseLine('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: message.stop_reason,
        stop_sequence: message.stop_sequence,
        stop_details: message.stop_details,
        container: message.container,
      },
      usage: message.usage,
    }),
  );
  lines.push(sseLine('message_stop', { type: 'message_stop' }));
  return lines.join('');
}

// ---------------------------------------------------------------------------
// อ่าน request body ที่แอปส่งจริง — ดึง tool_result ของรอบก่อนหน้ามาประกอบรอบถัดไป
// ---------------------------------------------------------------------------

export interface AnthropicContentBlockParam {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
  text?: string;
  [key: string]: unknown;
}

export interface AnthropicMessageParam {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlockParam[];
}

export interface AnthropicRequestBody {
  model: string;
  system?: unknown;
  messages: AnthropicMessageParam[];
  tools?: unknown[];
  stream?: boolean;
  max_tokens?: number;
  [key: string]: unknown;
}

/** หา `tool_use` ตัวล่าสุดที่ชื่อ `toolName` ใน history (สแกนจากท้าย) */
export function findLastToolUse(
  messages: AnthropicMessageParam[],
  toolName: string,
): AnthropicContentBlockParam | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const content = messages[i]?.content;
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0; j -= 1) {
      const block = content[j];
      if (block.type === 'tool_use' && block.name === toolName) {
        return block;
      }
    }
  }
  return undefined;
}

/** หา `tool_result` string content ที่จับคู่กับ `tool_use_id` (สแกนทั้ง history จากท้าย) */
export function findToolResultContent(
  messages: AnthropicMessageParam[],
  toolUseId: string,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const content = messages[i]?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'tool_result' && block.tool_use_id === toolUseId) {
        return typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
      }
    }
  }
  return undefined;
}

/** ผลลัพธ์จริงของ tool call รอบก่อนหน้า — ห่อด้วย `<tool_result_data>` เฉพาะตอนสำเร็จ (ดู
 * `ai/tools/toolKit.ts#createTool`: `is_error:true` ส่ง JSON ดิบไม่มี wrapper — `invalidInputContent`/
 * `toolErrorContent`) จึง fallback เป็น `JSON.parse` ตรง ๆ เมื่อหา wrapper ไม่เจอ เพื่อให้ใช้ฟังก์ชันนี้
 * อ่านผลได้ทั้งกรณีสำเร็จและ error (เช่น `{ok:false}`/`{error:true, message_th}`)
 *
 * คืน `unknown` (ไม่ใช่ generic — type param ที่ใช้แค่ตำแหน่งเดียวโดน `no-unnecessary-type-parameters`
 * ห้าม) ผู้เรียกที่รู้ shape ที่คาดหวังอยู่แล้วเป็นคนกำกับชนิดตอนใช้งาน (เช่น
 * `parseWrappedToolResult(x) as QueryBudgetLinesOutputLike`) */
export function parseWrappedToolResult(content: string): unknown {
  const match = /<tool_result_data[^>]*>\n([\s\S]*?)\n<\/tool_result_data/.exec(content);
  const jsonText = match?.[1] ?? content;
  try {
    return JSON.parse(jsonText) as unknown;
  } catch (err) {
    throw new Error(
      `mockAnthropic: parse tool_result เป็น JSON ไม่สำเร็จ (${err instanceof Error ? err.message : String(err)}): ${content.slice(0, 200)}`,
    );
  }
}

/** ทางลัด: หาแล้ว parse ผลของ tool call ล่าสุดชื่อ `toolName` ในรอบก่อนหน้า (ดูหมายเหตุเรื่อง `unknown`
 * ใน `parseWrappedToolResult`) */
export function lastToolOutput(body: AnthropicRequestBody, toolName: string): unknown {
  const use = findLastToolUse(body.messages, toolName);
  if (!use?.id) {
    throw new Error(`mockAnthropic: ไม่พบ tool_use ชื่อ "${toolName}" ใน history ของ request นี้`);
  }
  const content = findToolResultContent(body.messages, use.id);
  if (content === undefined) {
    throw new Error(`mockAnthropic: ไม่พบ tool_result ของ tool_use id=${use.id} (${toolName})`);
  }
  return parseWrappedToolResult(content);
}

// ---------------------------------------------------------------------------
// Scripted turns ของ /v1/messages
// ---------------------------------------------------------------------------

export interface MessagesCallRecord {
  index: number;
  headers: Record<string, string>;
  body: AnthropicRequestBody;
}

export type ScriptedTurn =
  | { kind: 'message'; message: MockMessage; delayMs?: number }
  | { kind: 'dynamic'; build: (body: AnthropicRequestBody, call: MessagesCallRecord) => MockMessage; delayMs?: number }
  | { kind: 'httpError'; status: number; errorType: string; message: string; headers?: Record<string, string> }
  | { kind: 'networkFail' };

export type CountTokensMode =
  | { kind: 'ok' }
  | { kind: 'httpError'; status: number; errorType: string; message: string; headers?: Record<string, string> }
  | { kind: 'networkFail' };

export interface AnthropicMock {
  /** ติดตั้ง route handlers (เรียกครั้งเดียวต่อ page/context) */
  install(): Promise<void>;
  /** ตั้งสคริปต์ของ `/v1/messages` ใหม่ (รีเซ็ต call index) — ใช้ตอนเริ่ม flow ใหม่/ต่อยอดหลัง error path
   * เมื่อ request มาถึงเกินจำนวน turn ที่ให้ไว้ (เช่น SDK retry เอง — `maxRetries:1`) mock จะ "ค้าง" ที่
   * turn สุดท้ายซ้ำไปเรื่อย ๆ แทนที่จะโยน error — ทำให้ทดสอบ error path (network fail/rate limit) ได้โดย
   * ไม่ต้องรู้จำนวน retry ที่แน่นอนของ SDK ล่วงหน้า */
  setMessagesTurns(turns: ScriptedTurn[]): void;
  /** เพิ่มสคริปต์ต่อท้ายคิวเดิม (ไม่รีเซ็ต index) */
  pushMessagesTurn(turn: ScriptedTurn): void;
  setCountTokensMode(mode: CountTokensMode): void;
  /** ทุก call ที่ผ่าน route ของ `/v1/messages` จริง (สำเร็จหรือ error) เรียงตามเวลา */
  getMessagesCalls(): MessagesCallRecord[];
  /** request ที่หลุดไปที่ `api.anthropic.com` โดยไม่ถูก route เฉพาะดักไว้ (ต้องว่างเสมอ) */
  getUnhandledAnthropicRequests(): string[];
  /** จำนวน request ที่ยิงไปโดเมนปลอม `EVIL_ORIGIN` (ต้องเป็น 0 เสมอในทุกสถานการณ์) */
  getEvilOriginHitCount(): number;
}

function errorBody(errorType: string, message: string): string {
  return JSON.stringify({ type: 'error', error: { type: errorType, message } });
}

export function createAnthropicMock(page: Page): AnthropicMock {
  let turns: ScriptedTurn[] = [];
  let callIndex = 0;
  let countTokensMode: CountTokensMode = { kind: 'ok' };
  const calls: MessagesCallRecord[] = [];
  const unhandled: string[] = [];
  let evilHits = 0;

  async function handleMessages(route: Route): Promise<void> {
    const request = route.request();
    const body = request.postDataJSON() as AnthropicRequestBody;
    const record: MessagesCallRecord = { index: calls.length, headers: request.headers(), body };
    calls.push(record);

    // ถ้า request มาเกินจำนวน turn ที่สคริปต์ไว้ (เช่น SDK retry เอง) ให้ "ค้าง" ที่ turn สุดท้ายซ้ำ
    // แทนที่จะโยน error (ดูคอมเมนต์ที่ `setMessagesTurns` ใน `AnthropicMock`)
    const turn = turns.at(callIndex) ?? turns.at(-1);
    callIndex += 1;
    if (!turn) {
      throw new Error(
        'mockAnthropic: ยังไม่ได้ตั้งสคริปต์ /v1/messages เลย — เรียก setMessagesTurns() ก่อนส่งข้อความ',
      );
    }

    if (turn.kind === 'networkFail') {
      await route.abort('failed');
      return;
    }
    if (turn.kind === 'httpError') {
      await route.fulfill({
        status: turn.status,
        contentType: 'application/json',
        headers: turn.headers ?? {},
        body: errorBody(turn.errorType, turn.message),
      });
      return;
    }

    const message = turn.kind === 'message' ? turn.message : turn.build(body, record);
    if (turn.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, turn.delayMs));
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body: buildSseBody(message),
    });
  }

  async function handleCountTokens(route: Route): Promise<void> {
    if (countTokensMode.kind === 'networkFail') {
      await route.abort('failed');
      return;
    }
    if (countTokensMode.kind === 'httpError') {
      await route.fulfill({
        status: countTokensMode.status,
        contentType: 'application/json',
        headers: countTokensMode.headers ?? {},
        body: errorBody(countTokensMode.errorType, countTokensMode.message),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ input_tokens: 3 }),
    });
  }

  return {
    async install(): Promise<void> {
      // ลงทะเบียน catch-all ก่อน (Playwright จับคู่ route จากตัวที่ลงทะเบียน "หลังสุด" ก่อนเสมอ ดังนั้น
      // route เฉพาะทางที่ลงทะเบียนทีหลังด้านล่างจะถูกลองก่อน catch-all นี้เสมอ)
      await page.route(ANTHROPIC_CATCH_ALL, async (route) => {
        unhandled.push(route.request().url());
        await route.abort('failed');
      });
      await page.route(COUNT_TOKENS_URL, (route) => handleCountTokens(route));
      await page.route(MESSAGES_URL, (route) => handleMessages(route));
      await page.route(`${EVIL_ORIGIN}/**`, async (route) => {
        evilHits += 1;
        await route.abort('failed');
      });
    },
    setMessagesTurns(newTurns: ScriptedTurn[]): void {
      turns = newTurns;
      callIndex = 0;
    },
    pushMessagesTurn(turn: ScriptedTurn): void {
      turns.push(turn);
    },
    setCountTokensMode(mode: CountTokensMode): void {
      countTokensMode = mode;
    },
    getMessagesCalls(): MessagesCallRecord[] {
      return calls;
    },
    getUnhandledAnthropicRequests(): string[] {
      return unhandled;
    },
    getEvilOriginHitCount(): number {
      return evilHits;
    },
  };
}
