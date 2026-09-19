/**
 * T-304 — fake `Anthropic` client สำหรับ unit test ของ `ai/agent.ts`
 *
 * **ใช้ได้เฉพาะไฟล์ `*.test.ts` และ `web/src/app/dataHarness/**`** (T-306: หน้า harness ของ eval
 * ต้อง "dry-run" ด้วย fake client กับ agent loop/data facade จริงในโหมด build `e2e-harness` เท่านั้น —
 * ไม่ถูก bundle เข้า production เพราะทั้งโฟลเดอร์ dataHarness ถูกตัดด้วย `resolve.alias` ใน
 * `vite.config.ts`/`DataHarnessRoute.stub.tsx` เมื่อไม่ใช่โหมดนั้น) — จำลองเฉพาะพฤติกรรมที่ `agent.ts`
 * ใช้จริง: `client.messages.stream(params, {signal}) → AsyncIterable<MessageStreamEvent> &
 * {finalMessage(): Promise<Message>}` (ดู `typescript/claude-api/streaming.md`/`tool-use.md`)
 *
 * ผู้เขียนเทสต์ประกอบ `Anthropic.Message` ที่ "ควรได้" ต่อ 1 รอบ (1 ครั้งที่ `stream()` ถูกเรียก) แล้ว
 * fake จะ synthesize ลำดับ stream event ที่สมเหตุสมผลให้เอง (message_start → content_block_start/delta/
 * stop ต่อบล็อก → message_delta → message_stop) ก่อนให้ `finalMessage()` resolve ด้วย message เต็มก้อน
 * ที่ผู้เขียนเทสต์กำหนด — ไม่ต้องเขียน raw SSE event เองทุกฟิลด์
 *
 * ห้าม import React/DOM API (module boundary — docs/04-ARCHITECTURE.md §3)
 */
import Anthropic from '@anthropic-ai/sdk';

export type ScriptedTurn =
  | { kind: 'message'; message: Anthropic.Message }
  /** T-306: สร้าง message ตอนถูกเรียกจริง (ไม่ใช่ล่วงหน้า) — ใช้ตอน dry-run harness ที่ต้องอ่าน
   * ผลลัพธ์ "จริง" ของ tool ก่อนหน้า (เช่น item_key จาก search_catalog, source_id จาก
   * query_budget_lines กับข้อมูล production จริง — ผ่าน `ai/testing/toolCapture.ts` ไม่ใช่จาก
   * `params` ของการเรียกนี้ เพราะรูปแบบการห่อ `tool_result.content` เปลี่ยนได้) มาประกอบ tool_use ของ
   * รอบถัดไป โดยไม่ต้อง mock ผลลัพธ์ของ data facade เอง */
  | { kind: 'dynamic'; build: () => Anthropic.Message }
  /** จำลอง error ที่ SDK โยนตอน iterate stream หรือตอน `finalMessage()` (เช่น typed exception ของ SDK) */
  | { kind: 'error'; error: unknown }
  /** จำลองการยกเลิกกลางคัน (`finalMessage()` reject ด้วย `Anthropic.APIUserAbortError`) โดยไม่ต้องพึ่ง
   * `AbortSignal` จริง (ใช้ตอนอยากทดสอบ path ที่ error มาเป็น abort โดยเฉพาะ) */
  | { kind: 'abort' };

export interface RecordedStreamCall {
  params: Anthropic.MessageCreateParams;
  signal: AbortSignal | undefined;
}

export interface FakeAnthropicOptions {
  /** สคริปต์ 1 รายการต่อ 1 ครั้งที่ `client.messages.stream()` ถูกเรียก (ตามลำดับ) */
  turns: ScriptedTurn[];
  /** เรียกทุกครั้งที่ `stream()` ถูกเรียก — ใช้ตรวจ params จริงที่ agent.ts ประกอบ (messages/tools/system) */
  onStreamCall?: (call: RecordedStreamCall) => void;
}

export interface FakeAnthropicClient {
  client: Anthropic;
  /** จำนวนครั้งที่ `messages.stream()` ถูกเรียกจริงจนถึงตอนนี้ */
  callCount: () => number;
}

/** boundary: จำลอง event ชนิดที่ `agent.ts` อ่านจริง (`content_block_start`/`content_block_delta`) ให้
 * ตรง type ครบ ส่วน `message_start`/`message_delta`/`message_stop`/บล็อกชนิดอื่นที่ agent.ts ไม่ได้อ่าน
 * จาก stream event (อ่านจาก `finalMessage()` แทน) cast ตรง ๆ เพื่อลดความซับซ้อนของไฟล์ test-only นี้ */
function* synthesizeEvents(message: Anthropic.Message): Generator<Anthropic.MessageStreamEvent> {
  yield {
    type: 'message_start',
    message: { ...message, content: [], stop_reason: null },
  };

  for (let index = 0; index < message.content.length; index += 1) {
    const block = message.content[index];
    if (block === undefined) {
      continue;
    }
    if (block.type === 'text') {
      yield {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '', citations: null },
      };
      yield {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: block.text },
      };
    } else if (block.type === 'tool_use') {
      yield {
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {}, caller: block.caller },
      };
      yield {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
      };
    } else {
      // server_tool_use/web_search_tool_result/ฯลฯ — agent.ts อ่านจาก `finalMessage()` เท่านั้น ไม่ต้อง
      // stream เป็น delta ที่นี่ (ยังคง emit content_block_start ให้ index ไล่ตรงกัน)
      yield { type: 'content_block_start', index, content_block: block };
    }
    yield { type: 'content_block_stop', index };
  }

  yield {
    type: 'message_delta',
    delta: {
      container: message.container,
      stop_details: message.stop_details,
      stop_reason: message.stop_reason,
      stop_sequence: message.stop_sequence,
    },
    usage: message.usage,
  };
  yield { type: 'message_stop' };
}

/** subset ของ `MessageStream` ที่ `agent.ts` ใช้จริง — ดูคอมเมนต์หัวไฟล์ */
interface FakeMessageStream {
  [Symbol.asyncIterator](): AsyncIterator<Anthropic.MessageStreamEvent>;
  finalMessage(): Promise<Anthropic.Message>;
}

/** รับเฉพาะ turn ที่ resolve แล้ว (ไม่ใช่ 'dynamic' — resolve ที่ `stream()` ก่อนเรียกฟังก์ชันนี้เสมอ) */
type ResolvedScriptedTurn = Exclude<ScriptedTurn, { kind: 'dynamic' }>;

function makeFakeMessageStream(
  turn: ResolvedScriptedTurn,
  signal: AbortSignal | undefined,
): FakeMessageStream {
  async function* run(): AsyncGenerator<Anthropic.MessageStreamEvent> {
    // await เปล่า ๆ เพื่อให้เป็น async generator จริง (สอดคล้องกับ `MessageStream` จริงที่ event แต่ละตัว
    // มาแบบ asynchronous) แม้เนื้อหาข้างล่างจะ synchronous ล้วนก็ตาม
    await Promise.resolve();
    if (signal?.aborted) {
      return;
    }
    if (turn.kind !== 'message') {
      return;
    }
    for (const event of synthesizeEvents(turn.message)) {
      if (signal?.aborted) {
        return;
      }
      yield event;
    }
  }

  return {
    [Symbol.asyncIterator]: () => run(),
    finalMessage(): Promise<Anthropic.Message> {
      if (signal?.aborted) {
        return Promise.reject(new Anthropic.APIUserAbortError());
      }
      if (turn.kind === 'abort') {
        return Promise.reject(new Anthropic.APIUserAbortError());
      }
      if (turn.kind === 'error') {
        // `turn.error` เป็น `unknown` โดยตั้งใจ (ผู้เขียนเทสต์เป็นคนรับผิดชอบส่ง Error/typed exception
        // ของ SDK จริงเข้ามา — ดู `ScriptedTurn`) จึง disable กฎนี้เฉพาะบรรทัดนี้
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject(turn.error);
      }
      return Promise.resolve(turn.message);
    },
  };
}

/**
 * สร้าง fake `Anthropic` client — ใช้ boundary cast `as unknown as Anthropic` จุดเดียวตรงนี้ เพราะ
 * `Anthropic` เป็น class จริงที่มี private field ภายใน (nominal typing) ทำให้ไม่มีทางสร้าง object literal
 * ที่ "เป็น" `Anthropic` ตาม structural typing ได้ตรง ๆ — เฉพาะไฟล์ test-only นี้เท่านั้นที่ทำ
 */
export function createFakeAnthropicClient(opts: FakeAnthropicOptions): FakeAnthropicClient {
  let callCount = 0;
  const fakeClient = {
    messages: {
      stream(
        params: Anthropic.MessageCreateParams,
        options?: { signal?: AbortSignal },
      ): FakeMessageStream {
        const turn = opts.turns[callCount];
        callCount += 1;
        opts.onStreamCall?.({ params, signal: options?.signal });
        if (turn === undefined) {
          throw new Error(
            `fakeAnthropic: scripted turns หมดแล้ว (เรียก stream() ครั้งที่ ${String(callCount)}) แต่มีสคริปต์แค่ ${String(opts.turns.length)} รายการ`,
          );
        }
        // 'dynamic' ต้อง resolve เป็น 'message' ที่นี่ (ก่อนสร้าง stream) เพราะต้องอ่าน `params` ของ
        // การเรียกครั้งนี้จริง ๆ — ทุก path ถัดไป (`synthesizeEvents`/`finalMessage`) รับแค่ turn ที่
        // resolve แล้วเท่านั้น
        const resolvedTurn: ResolvedScriptedTurn =
          turn.kind === 'dynamic' ? { kind: 'message', message: turn.build() } : turn;
        return makeFakeMessageStream(resolvedTurn, options?.signal);
      },
    },
  };
  return {
    // boundary cast (ดู docstring ของฟังก์ชันนี้) — ใช้ได้เฉพาะไฟล์ `ai/testing/**`
    client: fakeClient as unknown as Anthropic,
    callCount: () => callCount,
  };
}

// ---------------------------------------------------------------------------
// Fixture builders — ลดความซ้ำซ้อนในเทสต์ของ `agent.ts` (ค่า default ที่ไม่ได้ทดสอบตรง ๆ ใส่พอผ่าน type)
// ---------------------------------------------------------------------------

export function makeUsage(overrides: Partial<Anthropic.Usage> = {}): Anthropic.Usage {
  return {
    cache_creation: null,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    inference_geo: null,
    input_tokens: 100,
    output_tokens: 50,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: 'standard',
    ...overrides,
  };
}

export function makeTextBlock(text: string): Anthropic.TextBlock {
  return { type: 'text', text, citations: null };
}

export function makeToolUseBlock(id: string, name: string, input: unknown): Anthropic.ToolUseBlock {
  return { type: 'tool_use', id, name, input, caller: { type: 'direct' } };
}

let messageIdCounter = 0;

/** สร้าง `Anthropic.Message` ฉบับเต็ม — ใส่เฉพาะ field ที่ทดสอบจริง ที่เหลือใส่ค่า default ที่ valid */
export function makeMessage(overrides: {
  content: Anthropic.ContentBlock[];
  stop_reason: Anthropic.StopReason | null;
  usage?: Anthropic.Usage;
  model?: Anthropic.Model;
  stop_details?: Anthropic.RefusalStopDetails | null;
}): Anthropic.Message {
  messageIdCounter += 1;
  return {
    id: `msg_fake_${String(messageIdCounter)}`,
    container: null,
    content: overrides.content,
    model: overrides.model ?? 'claude-sonnet-5',
    role: 'assistant',
    stop_details: overrides.stop_details ?? null,
    stop_reason: overrides.stop_reason,
    stop_sequence: null,
    type: 'message',
    usage: overrides.usage ?? makeUsage(),
  };
}
