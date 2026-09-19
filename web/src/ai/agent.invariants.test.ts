/**
 * main thread (review ของ T-304): invariant ที่ต้องจริงใน **ทุกทางออก** ของ loop —
 * ประวัติที่คืนมาต้องใช้ยิง request ถัดไปได้เสมอ (Messages API ปฏิเสธ 400 ถ้า `tool_use` ไม่มี
 * `tool_result` ใน user message ถัดไป หรือ role ไม่สลับกัน) และต้องไม่ mutate ประวัติของผู้เรียก
 */
import type Anthropic from '@anthropic-ai/sdk';
import { createDataFacade } from '@/data';
import { describe, expect, it } from 'vitest';
import { runAgentTurn, type RunAgentTurnInput } from './agent';
import { createInMemoryIllustrationSink } from './illustrationSink';
import {
  createFakeAnthropicClient,
  makeMessage,
  makeTextBlock,
  makeToolUseBlock,
  makeUsage,
  type ScriptedTurn,
} from './testing/fakeAnthropic';
import { createToolLog } from './toolLog';

function assertValidHistory(messages: Anthropic.MessageParam[]): void {
  expect(messages.length).toBeGreaterThan(0);
  expect(messages[0]?.role).toBe('user');
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (msg === undefined) continue;
    const prev = messages[i - 1];
    if (prev !== undefined && prev.role === msg.role) {
      // role ซ้ำติดกันยอมได้กรณีเดียว: assistant → assistant จากการทำต่อหลัง `pause_turn` (pattern ทางการ:
      // append เนื้อหา assistant แล้วยิงซ้ำ — API รวม turn ที่ role ซ้ำให้เอง) และตัวแรกต้องไม่มี tool_use
      // ของ client ค้างอยู่; user → user ไม่ควรเกิดจาก loop นี้
      expect(msg.role, `role ซ้ำติดกันที่ index ${String(i)} ต้องเป็น assistant เท่านั้น`).toBe(
        'assistant',
      );
      const prevHasToolUse =
        typeof prev.content !== 'string' && prev.content.some((b) => b.type === 'tool_use');
      expect(prevHasToolUse, 'assistant ที่ถูกทำต่อ (pause_turn) ต้องไม่มี tool_use ค้าง').toBe(
        false,
      );
    }
    if (msg.role !== 'assistant' || typeof msg.content === 'string') continue;
    const toolUseIds = msg.content.flatMap((b) => (b.type === 'tool_use' ? [b.id] : []));
    if (toolUseIds.length === 0) continue;
    const next = messages[i + 1];
    expect(
      next,
      `assistant ที่มี tool_use (index ${String(i)}) ต้องมี user message ตามหลัง`,
    ).toBeDefined();
    expect(next?.role).toBe('user');
    const resultIds =
      next === undefined || typeof next.content === 'string'
        ? []
        : next.content.flatMap((b) => (b.type === 'tool_result' ? [b.tool_use_id] : []));
    expect([...resultIds].sort(), 'tool_result ต้องครบและตรงกับ tool_use ทุกตัว').toEqual(
      [...toolUseIds].sort(),
    );
    expect(new Set(resultIds).size, 'ห้ามมี tool_result ซ้ำ').toBe(resultIds.length);
  }
}

const toolUse = (id: string, name = 'get_econ_indicator') =>
  makeToolUseBlock(id, name, { indicators: ['cpi_headline_index'], years_be: [2566] });

const toolTurn = (
  ids: string[],
  stop: Anthropic.Message['stop_reason'] = 'tool_use',
): ScriptedTurn => ({
  kind: 'message',
  message: makeMessage({
    content: [makeTextBlock('กำลังค้นข้อมูล'), ...ids.map((id) => toolUse(id))],
    stop_reason: stop,
    usage: makeUsage({ input_tokens: 1000, output_tokens: 200 }),
  }),
});

const endTurn: ScriptedTurn = {
  kind: 'message',
  message: makeMessage({
    content: [makeTextBlock('สรุปแล้ว')],
    stop_reason: 'end_turn',
    usage: makeUsage(),
  }),
};

function input(
  turns: ScriptedTurn[],
  overrides: Partial<RunAgentTurnInput> = {},
): RunAgentTurnInput {
  return {
    client: createFakeAnthropicClient({ turns }).client,
    model: 'claude-sonnet-5',
    mode: 'draft',
    system: 'ทดสอบ',
    messages: [{ role: 'user', content: 'ประเมินงบซื้อแอร์ 2 เครื่อง' }],
    toolContext: {
      data: createDataFacade(),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    },
    ...overrides,
  };
}

const scenarios: [string, () => RunAgentTurnInput][] = [
  ['end_turn ทันที', () => input([endTurn])],
  ['tool 1 รอบ แล้วจบ', () => input([toolTurn(['t1']), endTurn])],
  ['parallel 3 tools แล้วจบ', () => input([toolTurn(['a', 'b', 'c']), endTurn])],
  [
    'เพดานรอบ = 1 ขณะโมเดลยังขอ tool ต่อ',
    () => input([toolTurn(['t1']), toolTurn(['t2']), endTurn], { budget: { maxToolRounds: 1 } }),
  ],
  [
    'เพดานงบถึงทันทีหลังรอบแรก',
    () => input([toolTurn(['t1']), endTurn], { budget: { maxCostUsdPerTurn: 0.000001 } }),
  ],
  [
    'เพดานงบของ session ถูกใช้หมดตั้งแต่ก่อนเริ่ม',
    () => input([endTurn], { budget: { maxCostUsdPerSession: 1, spentUsdSoFar: 1 } }),
  ],
  ['max_tokens ขณะมี tool_use ค้าง', () => input([toolTurn(['t1', 't2'], 'max_tokens')])],
  ['refusal ขณะมี tool_use ค้าง', () => input([toolTurn(['t1'], 'refusal')])],
  [
    'pause_turn แล้วจบ',
    () =>
      input([
        {
          kind: 'message',
          message: makeMessage({
            content: [makeTextBlock('กำลังค้นเว็บ')],
            stop_reason: 'pause_turn',
            usage: makeUsage(),
          }),
        },
        endTurn,
      ]),
  ],
  [
    'error จาก API หลังรัน tool ไปแล้ว 1 รอบ',
    () => input([toolTurn(['t1']), { kind: 'error', error: new Error('network down') }]),
  ],
  ['error จาก API ตั้งแต่ request แรก', () => input([{ kind: 'error', error: new Error('boom') }])],
  ['abort ตั้งแต่ request แรก', () => input([{ kind: 'abort' }])],
  ['abort หลังรัน tool ไปแล้ว 1 รอบ', () => input([toolTurn(['t1']), { kind: 'abort' }])],
  ['สคริปต์หมดก่อนโมเดลจบ (fake client ไม่มี turn เหลือ)', () => input([toolTurn(['t1'])])],
];

describe('runAgentTurn — invariant ของประวัติสนทนาในทุกทางออก', () => {
  it.each(scenarios)('%s → ประวัติ valid, ไม่ mutate input, ไม่ throw', async (_name, make) => {
    const args = make();
    const before = structuredClone(args.messages);
    const result = await runAgentTurn(args);
    expect(args.messages, 'ห้าม mutate messages ของผู้เรียก').toEqual(before);
    expect(
      result.messages.slice(0, before.length),
      'ประวัติเดิมต้องเป็น prefix ของผลลัพธ์',
    ).toEqual(before);
    assertValidHistory(result.messages);
    expect(Number.isFinite(result.costUsd)).toBe(true);
    expect(result.costUsd).toBeGreaterThanOrEqual(0);
    expect(typeof result.endedBecause).toBe('string');
  });

  it('ประวัติที่คืนจากรอบหนึ่ง ใช้เป็น input ของรอบถัดไปได้ (หลังผู้ใช้พิมพ์ต่อ) โดยยัง valid', async () => {
    const first = await runAgentTurn(input([toolTurn(['t1']), toolTurn(['t2'], 'max_tokens')]));
    assertValidHistory(first.messages);
    const last = first.messages[first.messages.length - 1];
    const followUp: Anthropic.MessageParam[] =
      last?.role === 'user'
        ? [
            ...first.messages,
            { role: 'assistant', content: 'ขออภัย คำตอบถูกตัด' },
            { role: 'user', content: 'ทำต่อ' },
          ]
        : [...first.messages, { role: 'user', content: 'ทำต่อ' }];
    const second = await runAgentTurn(input([endTurn], { messages: followUp }));
    assertValidHistory(second.messages);
    expect(second.endedBecause).toBe('end_turn');
  });
});
