import Anthropic from '@anthropic-ai/sdk';
import { createDataFacade } from '@/data';
import { describe, expect, it, vi } from 'vitest';
import { costFromUsage } from './pricing';
import {
  createFakeAnthropicClient,
  makeMessage,
  makeTextBlock,
  makeToolUseBlock,
  makeUsage,
} from './testing/fakeAnthropic';
import { createInMemoryIllustrationSink } from './illustrationSink';
import { createToolLog } from './toolLog';
import type { ToolContext } from './tools';
import { runAgentTurn, type AgentEvent, type RunAgentTurnInput } from './agent';

function makeApiError(status: number, type: string, headers = new Headers()): InstanceType<typeof Anthropic.APIError> {
  return Anthropic.APIError.generate(status, { type: 'error', error: { type, message: 'boom' } }, 'boom', headers);
}

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    data: createDataFacade(),
    toolLog: createToolLog(),
    illustrationSink: createInMemoryIllustrationSink(),
    ...overrides,
  };
}

function baseInput(overrides: Partial<RunAgentTurnInput> = {}): RunAgentTurnInput {
  return {
    client: createFakeAnthropicClient({ turns: [] }).client,
    model: 'claude-sonnet-5',
    mode: 'draft',
    system: 'system prompt ทดสอบ (ไม่ใช่ของจริง)',
    messages: [{ role: 'user', content: 'สวัสดี ช่วยประเมินงบให้หน่อย' }],
    toolContext: makeCtx(),
    ...overrides,
  };
}

describe('runAgentTurn — end_turn ธรรมดา', () => {
  it('ไม่มี tool_use → จบทันที ประวัติมี assistant message ต่อท้าย', async () => {
    const fake = createFakeAnthropicClient({
      turns: [{ kind: 'message', message: makeMessage({ content: [makeTextBlock('สวัสดีครับ')], stop_reason: 'end_turn' }) }],
    });
    const events: AgentEvent[] = [];
    const result = await runAgentTurn(baseInput({ client: fake.client, onEvent: (e) => events.push(e) }));

    expect(result.endedBecause).toBe('end_turn');
    expect(result.stopReason).toBe('end_turn');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toEqual({ role: 'assistant', content: [makeTextBlock('สวัสดีครับ')] });
    expect(fake.callCount()).toBe(1);
    expect(events.some((e) => e.type === 'text_delta' && e.text === 'สวัสดีครับ')).toBe(true);
    expect(events.some((e) => e.type === 'usage')).toBe(true);
  });
});

describe('runAgentTurn — tool loop 2 รอบ', () => {
  it('tool_use รอบแรก → รัน tool → รอบสองจบด้วย end_turn', async () => {
    const getEconValue = vi.fn().mockResolvedValue({
      value: 105.2,
      unit: 'index',
      source_name: 'สนค.',
      source_url: 'https://example.go.th',
      verified: false,
      note: 'ค่าดัชนี',
    });
    const ctx = makeCtx({ data: createDataFacade({ getEconValue }) });

    const round1 = makeMessage({
      content: [makeToolUseBlock('tu_1', 'get_econ_indicator', { indicators: ['cpi_headline_index'], years_be: [2567] })],
      stop_reason: 'tool_use',
    });
    const round2 = makeMessage({ content: [makeTextBlock('ได้ค่าดัชนีแล้วครับ')], stop_reason: 'end_turn' });

    const fake = createFakeAnthropicClient({
      turns: [
        { kind: 'message', message: round1 },
        { kind: 'message', message: round2 },
      ],
    });

    const events: AgentEvent[] = [];
    const result = await runAgentTurn(
      baseInput({ client: fake.client, toolContext: ctx, onEvent: (e) => events.push(e) }),
    );

    expect(fake.callCount()).toBe(2);
    expect(result.endedBecause).toBe('end_turn');
    expect(result.toolCalls).toEqual([{ id: 'tu_1', name: 'get_econ_indicator', isError: false, round: 1 }]);
    // original(1) + assistant(round1) + user(tool_result) + assistant(round2)
    expect(result.messages).toHaveLength(4);
    expect(result.messages[2]).toMatchObject({ role: 'user' });
    const toolResultMsg = result.messages[2];
    if (toolResultMsg?.role === 'user' && Array.isArray(toolResultMsg.content)) {
      expect(toolResultMsg.content).toHaveLength(1);
      expect(toolResultMsg.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1', is_error: false });
    } else {
      throw new Error('คาดว่า user message ต้องเป็น array ของ tool_result');
    }
    expect(ctx.toolLog.hasEconValue('cpi_headline_index', 2567)).toBe(true);
    expect(events.some((e) => e.type === 'tool_start' && e.id === 'tu_1')).toBe(true);
    expect(events.some((e) => e.type === 'tool_result' && !e.isError)).toBe(true);
  });

  it('input ผิด schema → is_error แล้วโมเดลแก้ในรอบถัดไปสำเร็จ', async () => {
    const getEconValue = vi.fn().mockResolvedValue({
      value: 1,
      unit: 'index',
      source_name: 'x',
      source_url: 'https://example.go.th',
      verified: false,
      note: 'n',
    });
    const ctx = makeCtx({ data: createDataFacade({ getEconValue }) });

    const round1 = makeMessage({
      content: [makeToolUseBlock('tu_bad', 'get_econ_indicator', { indicators: [], years_be: [2567] })], // indicators ว่าง → ผิด schema (min 1)
      stop_reason: 'tool_use',
    });
    const round2 = makeMessage({
      content: [makeToolUseBlock('tu_fixed', 'get_econ_indicator', { indicators: ['cpi_headline_index'], years_be: [2567] })],
      stop_reason: 'tool_use',
    });
    const round3 = makeMessage({ content: [makeTextBlock('เรียบร้อย')], stop_reason: 'end_turn' });

    const fake = createFakeAnthropicClient({
      turns: [
        { kind: 'message', message: round1 },
        { kind: 'message', message: round2 },
        { kind: 'message', message: round3 },
      ],
    });

    const result = await runAgentTurn(baseInput({ client: fake.client, toolContext: ctx }));

    expect(result.toolCalls[0]).toMatchObject({ id: 'tu_bad', isError: true });
    expect(result.toolCalls[1]).toMatchObject({ id: 'tu_fixed', isError: false });
    expect(result.endedBecause).toBe('end_turn');
    expect(getEconValue).toHaveBeenCalledTimes(1); // เรียกจริงเฉพาะรอบที่ผ่าน schema
  });

  it('parallel 3 tools → tool_result ทุกตัวอยู่ใน user message เดียว เรียงลำดับตาม tool_use เดิม', async () => {
    const getEconValue = vi.fn().mockResolvedValue({
      value: 1,
      unit: 'index',
      source_name: 'x',
      source_url: 'https://example.go.th',
      verified: false,
      note: 'n',
    });
    const ctx = makeCtx({ data: createDataFacade({ getEconValue }) });

    const round1 = makeMessage({
      content: [
        makeToolUseBlock('a', 'get_econ_indicator', { indicators: ['cpi_headline_index'], years_be: [2565] }),
        makeToolUseBlock('b', 'get_econ_indicator', { indicators: ['cpi_headline_index'], years_be: [2566] }),
        makeToolUseBlock('c', 'get_econ_indicator', { indicators: ['cpi_headline_index'], years_be: [2567] }),
      ],
      stop_reason: 'tool_use',
    });
    const round2 = makeMessage({ content: [makeTextBlock('ครบแล้ว')], stop_reason: 'end_turn' });

    const fake = createFakeAnthropicClient({
      turns: [
        { kind: 'message', message: round1 },
        { kind: 'message', message: round2 },
      ],
    });

    const result = await runAgentTurn(baseInput({ client: fake.client, toolContext: ctx }));
    const toolResultMsg = result.messages[2];
    if (toolResultMsg?.role !== 'user' || !Array.isArray(toolResultMsg.content)) {
      throw new Error('คาดว่าเป็น user message เดียวที่มี tool_result หลายตัว');
    }
    expect(toolResultMsg.content).toHaveLength(3);
    expect(toolResultMsg.content.map((c) => (c as { tool_use_id: string }).tool_use_id)).toEqual(['a', 'b', 'c']);
  });

  it('unknown tool → is_error ไม่ throw', async () => {
    const round1 = makeMessage({
      content: [makeToolUseBlock('u1', 'ไม่มีเครื่องมือชื่อนี้', {})],
      stop_reason: 'tool_use',
    });
    const round2 = makeMessage({ content: [makeTextBlock('ขอโทษครับ')], stop_reason: 'end_turn' });
    const fake = createFakeAnthropicClient({
      turns: [
        { kind: 'message', message: round1 },
        { kind: 'message', message: round2 },
      ],
    });
    const result = await runAgentTurn(baseInput({ client: fake.client }));
    expect(result.toolCalls[0]).toMatchObject({ id: 'u1', isError: true });
    expect(result.endedBecause).toBe('end_turn');
  });
});

describe('runAgentTurn — tool_result.summary แบบมีโครงสร้าง (T-410 ข้อ 3, US-2.2)', () => {
  it('tool ที่มี output.total → summary.status ตาม count, คง summaryTh เดิมไว้ (backward compatible)', async () => {
    const getEconValue = vi.fn().mockResolvedValue({
      value: 105.2,
      unit: 'index',
      source_name: 'สนค.',
      source_url: 'https://example.go.th',
      verified: false,
      note: 'ค่าดัชนี',
    });
    const ctx = makeCtx({ data: createDataFacade({ getEconValue }) });
    const round1 = makeMessage({
      content: [makeToolUseBlock('tu_1', 'get_econ_indicator', { indicators: ['cpi_headline_index'], years_be: [2567] })],
      stop_reason: 'tool_use',
    });
    const round2 = makeMessage({ content: [makeTextBlock('ครบแล้ว')], stop_reason: 'end_turn' });
    const fake = createFakeAnthropicClient({ turns: [{ kind: 'message', message: round1 }, { kind: 'message', message: round2 }] });
    const events: AgentEvent[] = [];

    await runAgentTurn(baseInput({ client: fake.client, toolContext: ctx, onEvent: (e) => events.push(e) }));

    const toolResult = events.find((e) => e.type === 'tool_result');
    if (toolResult?.type !== 'tool_result') {
      throw new Error('คาดว่ามี event tool_result');
    }
    expect(toolResult.summaryTh).toBe('get_econ_indicator: พบ 1 รายการ');
    expect(toolResult.summary).toEqual({ tool: 'get_econ_indicator', status: 'done', count: 1 });
  });

  it('tool ที่ output.total เป็น 0 → summary.status = "empty"', async () => {
    const searchResult = { matches: [], total: 0 };
    const emptyFacets = {
      budget_types: [],
      coverage_notes: [],
      datasets: [],
      fiscal_years: [],
      ministries: [],
      provinces: [],
    };
    const ctx = makeCtx({
      data: createDataFacade({
        searchCatalog: () => Promise.resolve(searchResult),
        facets: () => Promise.resolve(emptyFacets),
      }),
    });
    const round1 = makeMessage({
      content: [makeToolUseBlock('tu_1', 'search_catalog', { query: 'เครื่องปรับอากาศ' })],
      stop_reason: 'tool_use',
    });
    const round2 = makeMessage({ content: [makeTextBlock('ไม่พบครับ')], stop_reason: 'end_turn' });
    const fake = createFakeAnthropicClient({ turns: [{ kind: 'message', message: round1 }, { kind: 'message', message: round2 }] });
    const events: AgentEvent[] = [];

    await runAgentTurn(baseInput({ client: fake.client, toolContext: ctx, onEvent: (e) => events.push(e) }));

    const toolResult = events.find((e) => e.type === 'tool_result');
    if (toolResult?.type !== 'tool_result') {
      throw new Error('คาดว่ามี event tool_result');
    }
    expect(toolResult.summary).toEqual({ tool: 'search_catalog', status: 'empty', count: 0, query: 'เครื่องปรับอากาศ' });
  });

  it('tool ที่ isError → summary.status = "error" (ไม่มี count)', async () => {
    const round1 = makeMessage({
      content: [makeToolUseBlock('u1', 'ไม่มีเครื่องมือชื่อนี้', {})],
      stop_reason: 'tool_use',
    });
    const round2 = makeMessage({ content: [makeTextBlock('ขอโทษครับ')], stop_reason: 'end_turn' });
    const fake = createFakeAnthropicClient({ turns: [{ kind: 'message', message: round1 }, { kind: 'message', message: round2 }] });
    const events: AgentEvent[] = [];

    await runAgentTurn(baseInput({ client: fake.client, onEvent: (e) => events.push(e) }));

    const toolResult = events.find((e) => e.type === 'tool_result');
    if (toolResult?.type !== 'tool_result') {
      throw new Error('คาดว่ามี event tool_result');
    }
    expect(toolResult.summary).toEqual({ tool: 'ไม่มีเครื่องมือชื่อนี้', status: 'error' });
  });
});

describe('runAgentTurn — pause_turn', () => {
  it('ส่งประวัติเดิมกลับไปให้ server ทำต่อโดยไม่เติม user message ใหม่', async () => {
    const round1 = makeMessage({
      content: [{ type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'ราคาแอร์' }, caller: { type: 'direct' } }],
      stop_reason: 'pause_turn',
    });
    const round2 = makeMessage({ content: [makeTextBlock('สรุปราคาแล้วครับ')], stop_reason: 'end_turn' });
    const fake = createFakeAnthropicClient({
      turns: [
        { kind: 'message', message: round1 },
        { kind: 'message', message: round2 },
      ],
    });
    const events: AgentEvent[] = [];
    const result = await runAgentTurn(baseInput({ client: fake.client, onEvent: (e) => events.push(e) }));

    expect(fake.callCount()).toBe(2);
    expect(result.endedBecause).toBe('end_turn');
    expect(events.filter((e) => e.type === 'round')).toEqual([
      { type: 'round', round: 1 },
      { type: 'round', round: 2 },
    ]);
    // ประวัติจะมี assistant ติดกัน 2 ก้อน (pause_turn resume ไม่แทรก user message — ตามพฤติกรรมของ API)
    expect(result.messages.at(-2)).toMatchObject({ role: 'assistant' });
    expect(result.messages.at(-1)).toMatchObject({ role: 'assistant' });
  });
});

describe('runAgentTurn — max_tokens กลาง tool_use', () => {
  it('ไม่รัน tool ที่ค้าง เติม tool_result is_error แทน และจบด้วย max_tokens', async () => {
    const getEconValue = vi.fn();
    const ctx = makeCtx({ data: createDataFacade({ getEconValue }) });
    const round1 = makeMessage({
      content: [makeTextBlock('กำลังจะเรียก'), makeToolUseBlock('tu_cut', 'get_econ_indicator', { indicators: ['x'] })],
      stop_reason: 'max_tokens',
    });
    const fake = createFakeAnthropicClient({ turns: [{ kind: 'message', message: round1 }] });

    const result = await runAgentTurn(baseInput({ client: fake.client, toolContext: ctx }));

    expect(fake.callCount()).toBe(1);
    expect(result.endedBecause).toBe('max_tokens');
    expect(getEconValue).not.toHaveBeenCalled();
    const last = result.messages.at(-1);
    if (last?.role !== 'user' || !Array.isArray(last.content)) {
      throw new Error('คาดว่ามี tool_result is_error แทนที่ tool ที่ค้าง');
    }
    expect(last.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_cut', is_error: true });
  });
});

describe('runAgentTurn — refusal', () => {
  it('ไม่รัน tool ที่ค้าง และจบด้วย refusal', async () => {
    const getEconValue = vi.fn();
    const ctx = makeCtx({ data: createDataFacade({ getEconValue }) });
    const round1 = makeMessage({
      content: [makeToolUseBlock('tu_ref', 'get_econ_indicator', { indicators: ['x'] })],
      stop_reason: 'refusal',
    });
    const fake = createFakeAnthropicClient({ turns: [{ kind: 'message', message: round1 }] });
    const result = await runAgentTurn(baseInput({ client: fake.client, toolContext: ctx }));

    expect(result.endedBecause).toBe('refusal');
    expect(getEconValue).not.toHaveBeenCalled();
    const last = result.messages.at(-1);
    if (last?.role !== 'user' || !Array.isArray(last.content)) {
      throw new Error('คาดว่ามี tool_result is_error แทนที่ tool ที่ค้าง');
    }
    expect(last.content[0]).toMatchObject({ is_error: true });
  });

  it('refusal แบบไม่มี tool_use ค้าง → ไม่เติม user message', async () => {
    const round1 = makeMessage({ content: [makeTextBlock('ขอโทษ ไม่สามารถช่วยได้')], stop_reason: 'refusal' });
    const fake = createFakeAnthropicClient({ turns: [{ kind: 'message', message: round1 }] });
    const result = await runAgentTurn(baseInput({ client: fake.client }));
    expect(result.endedBecause).toBe('refusal');
    expect(result.messages).toHaveLength(2); // original + assistant เท่านั้น
  });
});

describe('runAgentTurn — เพดานรอบ (max_rounds)', () => {
  it('หยุดก่อนยิง request ถัดไปเมื่อครบเพดานรอบ', async () => {
    const getEconValue = vi.fn().mockResolvedValue({
      value: 1,
      unit: null,
      source_name: null,
      source_url: null,
      verified: false,
      note: 'n',
    });
    const ctx = makeCtx({ data: createDataFacade({ getEconValue }) });
    const round1 = makeMessage({
      content: [makeToolUseBlock('r1', 'get_econ_indicator', { indicators: ['x'], years_be: [2567] })],
      stop_reason: 'tool_use',
    });
    const fake = createFakeAnthropicClient({ turns: [{ kind: 'message', message: round1 }] });
    const events: AgentEvent[] = [];
    const result = await runAgentTurn(
      baseInput({ client: fake.client, toolContext: ctx, budget: { maxToolRounds: 1 }, onEvent: (e) => events.push(e) }),
    );

    expect(fake.callCount()).toBe(1);
    expect(result.endedBecause).toBe('max_rounds');
    expect(events.some((e) => e.type === 'warning' && e.messageTh.includes('เพดาน'))).toBe(true);
  });
});

describe('runAgentTurn — เพดานงบ (budget)', () => {
  it('หยุดก่อนยิงรอบถัดไปเมื่อค่าใช้จ่ายสะสมถึงเพดานต่อ turn', async () => {
    const getEconValue = vi.fn().mockResolvedValue({
      value: 1,
      unit: null,
      source_name: null,
      source_url: null,
      verified: false,
      note: 'n',
    });
    const ctx = makeCtx({ data: createDataFacade({ getEconValue }) });
    const round1Usage = makeUsage({ input_tokens: 1000, output_tokens: 1000 }); // haiku: 0.001+0.005=0.006 USD
    const round1 = makeMessage({
      content: [makeToolUseBlock('r1', 'get_econ_indicator', { indicators: ['x'], years_be: [2567] })],
      stop_reason: 'tool_use',
      usage: round1Usage,
    });
    const round2 = makeMessage({ content: [makeTextBlock('ไม่ควรถึงรอบนี้')], stop_reason: 'end_turn' });
    const fake = createFakeAnthropicClient({
      turns: [
        { kind: 'message', message: round1 },
        { kind: 'message', message: round2 },
      ],
    });
    const result = await runAgentTurn(
      baseInput({
        client: fake.client,
        model: 'claude-haiku-4-5-20251001',
        toolContext: ctx,
        budget: { maxCostUsdPerTurn: 0.005 },
      }),
    );

    expect(fake.callCount()).toBe(1); // ไม่ยิงรอบสอง
    expect(result.endedBecause).toBe('budget');
    expect(result.costUsd).toBeCloseTo(0.006, 6);
  });
});

describe('runAgentTurn — ยกเลิกกลางคัน', () => {
  it('ยกเลิกก่อน finalMessage() (ระหว่าง stream) → ประวัติไม่เปลี่ยนจากเดิม', async () => {
    const controller = new AbortController();
    const round1 = makeMessage({ content: [makeTextBlock('ไม่ควรเห็นข้อความนี้')], stop_reason: 'end_turn' });
    const fake = createFakeAnthropicClient({
      turns: [{ kind: 'message', message: round1 }],
      onStreamCall: () => {
        controller.abort(); // จำลองยกเลิกทันทีที่ request เริ่มยิง (ระหว่าง stream ยังไม่ทัน finalMessage)
      },
    });
    const originalMessages = baseInput().messages;
    const result = await runAgentTurn(baseInput({ client: fake.client, signal: controller.signal, messages: originalMessages }));

    expect(result.endedBecause).toBe('cancelled');
    expect(result.messages).toEqual(originalMessages);
  });

  it('ยกเลิกระหว่างรัน tool → ประวัติยัง valid (ทุก tool_use มี tool_result คู่กัน)', async () => {
    const controller = new AbortController();
    const getEconValue = vi.fn().mockImplementation(() => {
      controller.abort(); // จำลองผู้ใช้กดยกเลิกขณะ tool กำลังทำงาน
      return Promise.resolve({ value: 1, unit: null, source_name: null, source_url: null, verified: false, note: 'n' });
    });
    const ctx = makeCtx({ data: createDataFacade({ getEconValue }) });
    const round1 = makeMessage({
      content: [makeToolUseBlock('c1', 'get_econ_indicator', { indicators: ['x'], years_be: [2567] })],
      stop_reason: 'tool_use',
    });
    const round2 = makeMessage({ content: [makeTextBlock('ไม่ควรถึงรอบนี้')], stop_reason: 'end_turn' });
    const fake = createFakeAnthropicClient({
      turns: [
        { kind: 'message', message: round1 },
        { kind: 'message', message: round2 },
      ],
    });
    const result = await runAgentTurn(baseInput({ client: fake.client, toolContext: ctx, signal: controller.signal }));

    expect(fake.callCount()).toBe(1); // ไม่ยิงรอบสองหลังยกเลิก
    expect(result.endedBecause).toBe('cancelled');
    const last = result.messages.at(-1);
    const secondLast = result.messages.at(-2);
    expect(secondLast).toMatchObject({ role: 'assistant' });
    expect(last).toMatchObject({ role: 'user' });
    if (last?.role !== 'user' || !Array.isArray(last.content)) {
      throw new Error('คาดว่ามี tool_result');
    }
    expect(last.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'c1' });
  });
});

describe('runAgentTurn — web_search server tool', () => {
  it('web_search_tool_result สำเร็จ → URL (https เท่านั้น) เข้า ToolLog', async () => {
    const ctx = makeCtx();
    const round1 = makeMessage({
      content: [
        { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'แอร์ 18000 บีทียู ราคา' }, caller: { type: 'direct' } },
        {
          type: 'web_search_tool_result',
          tool_use_id: 'srv1',
          caller: { type: 'direct' },
          content: [
            {
              type: 'web_search_result',
              url: 'https://shopee.co.th/x',
              title: 'แอร์ 18000 BTU',
              encrypted_content: 'enc',
              page_age: null,
            },
          ],
        },
        makeTextBlock('พบราคาจาก Shopee'),
      ],
      stop_reason: 'end_turn',
    });
    const fake = createFakeAnthropicClient({ turns: [{ kind: 'message', message: round1 }] });
    const events: AgentEvent[] = [];
    await runAgentTurn(baseInput({ client: fake.client, toolContext: ctx, onEvent: (e) => events.push(e) }));

    expect(ctx.toolLog.hasWebUrl('https://shopee.co.th/x')).toBe(true);
    expect(events.some((e) => e.type === 'server_tool' && e.query === 'แอร์ 18000 บีทียู ราคา')).toBe(true);
  });

  it('web_search_tool_result เป็น error object (ไม่ใช่ list) → ไม่ throw แค่แจ้งเตือน', async () => {
    const ctx = makeCtx();
    const round1 = makeMessage({
      content: [
        {
          type: 'web_search_tool_result',
          tool_use_id: 'srv2',
          caller: { type: 'direct' },
          content: { type: 'web_search_tool_result_error', error_code: 'unavailable' },
        },
        makeTextBlock('ค้นเว็บไม่สำเร็จ'),
      ],
      stop_reason: 'end_turn',
    });
    const fake = createFakeAnthropicClient({ turns: [{ kind: 'message', message: round1 }] });
    const events: AgentEvent[] = [];
    const result = await runAgentTurn(baseInput({ client: fake.client, toolContext: ctx, onEvent: (e) => events.push(e) }));

    expect(result.endedBecause).toBe('end_turn'); // ไม่ throw
    expect(events.some((e) => e.type === 'warning' && e.messageTh.includes('ค้นเว็บ'))).toBe(true);
  });
});

describe('runAgentTurn — typed errors → ข้อความไทย', () => {
  it.each([
    ['auth', () => makeApiError(401, 'authentication_error')],
    ['rate_limit', () => makeApiError(429, 'rate_limit_error', new Headers({ 'retry-after': '7' }))],
    ['server', () => makeApiError(529, 'overloaded_error')],
    ['network', () => new Anthropic.APIConnectionError({ message: 'down' })],
    ['unknown', () => new Error('เหตุผลอื่น')],
  ])('%s → endedBecause=error พร้อม warning ข้อความไทย', async (_label, buildError) => {
    const fake = createFakeAnthropicClient({ turns: [{ kind: 'error', error: buildError() }] });
    const events: AgentEvent[] = [];
    const result = await runAgentTurn(baseInput({ client: fake.client, onEvent: (e) => events.push(e) }));

    expect(result.endedBecause).toBe('error');
    const warning = events.find((e) => e.type === 'warning');
    expect(warning?.type).toBe('warning');
    if (warning?.type === 'warning') {
      expect(warning.messageTh.length).toBeGreaterThan(0);
    }
  });

  it('rate limit อ่านค่า retry-after มาใส่ในข้อความ', async () => {
    const fake = createFakeAnthropicClient({
      turns: [{ kind: 'error', error: makeApiError(429, 'rate_limit_error', new Headers({ 'retry-after': '42' })) }],
    });
    const events: AgentEvent[] = [];
    await runAgentTurn(baseInput({ client: fake.client, onEvent: (e) => events.push(e) }));
    const warning = events.find((e) => e.type === 'warning');
    expect(warning?.type === 'warning' && warning.messageTh.includes('42')).toBe(true);
  });
});

describe('runAgentTurn — ไม่ mutate input', () => {
  it('ไม่แก้ไข messages array/object ของผู้เรียก', async () => {
    const round1 = makeMessage({ content: [makeTextBlock('ok')], stop_reason: 'end_turn' });
    const fake = createFakeAnthropicClient({ turns: [{ kind: 'message', message: round1 }] });
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'ข้อความต้นฉบับ' }];
    const snapshot = JSON.parse(JSON.stringify(messages)) as unknown;

    const result = await runAgentTurn(baseInput({ client: fake.client, messages }));

    expect(JSON.parse(JSON.stringify(messages))).toEqual(snapshot);
    expect(result.messages).not.toBe(messages);
  });
});

describe('runAgentTurn — usage/cost สะสมถูก', () => {
  it('รวม input/output/cache read-write/web search ของทุกรอบ', async () => {
    const getEconValue = vi.fn().mockResolvedValue({
      value: 1,
      unit: null,
      source_name: null,
      source_url: null,
      verified: false,
      note: 'n',
    });
    const ctx = makeCtx({ data: createDataFacade({ getEconValue }) });

    const usage1 = makeUsage({ input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 500 });
    const usage2 = makeUsage({
      input_tokens: 300,
      output_tokens: 100,
      cache_read_input_tokens: 1500,
      server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 },
    });

    const round1 = makeMessage({
      content: [makeToolUseBlock('u1', 'get_econ_indicator', { indicators: ['x'], years_be: [2567] })],
      stop_reason: 'tool_use',
      usage: usage1,
    });
    const round2 = makeMessage({ content: [makeTextBlock('จบแล้ว')], stop_reason: 'end_turn', usage: usage2 });

    const fake = createFakeAnthropicClient({
      turns: [
        { kind: 'message', message: round1 },
        { kind: 'message', message: round2 },
      ],
    });

    const result = await runAgentTurn(baseInput({ client: fake.client, toolContext: ctx }));

    expect(result.usageTotals).toEqual({
      inputTokens: 1300,
      outputTokens: 300,
      cacheCreationInputTokens: 500,
      cacheReadInputTokens: 1500,
      webSearchRequests: 1,
    });

    const expectedCost =
      costFromUsage('claude-sonnet-5', usage1).totalCostUsd + costFromUsage('claude-sonnet-5', usage2).totalCostUsd;
    expect(result.costUsd).toBeCloseTo(expectedCost, 9);
  });
});

describe('runAgentTurn — emit_proposal สำเร็จ → คืน proposal', () => {
  it('จับผลลัพธ์ emit_proposal ล่าสุดของ turn นี้', async () => {
    const ctx = makeCtx();
    ctx.toolLog.recordSourceId('src-1');
    const proposalInput = {
      version: 1 as const,
      title: 'ฝายชะลอน้ำทดสอบ',
      summary: 'สรุปโครงการทดสอบสำหรับ agent.test.ts เท่านั้น ไม่ใช่ข้อมูลจริง',
      mode: 'draft' as const,
      requester_context: { fiscal_year_be: 2570 },
      objectives: ['ทดสอบ'],
      scope_and_specs: [],
      assumptions: [],
      boq: [
        {
          id: 'b1',
          category: 'งานก่อสร้าง',
          item: 'ฝาย คสล.',
          qty: 1,
          unit: 'แห่ง',
          unit_price_thb: 500_000,
          total_thb: 500_000,
          basis: 'historical' as const,
          confidence: 'high' as const,
          rationale: 'ทดสอบ',
          citations: [{ kind: 'budget_line' as const, source_id: 'src-1' }],
        },
      ],
      totals: { subtotal_thb: 500_000, vat_included: false, grand_total_thb: 500_000 },
      comparables: [],
      risks: [],
      open_questions: [],
      citations_web: [],
      illustrations: [],
      stat_cards: [],
    };
    const round1 = makeMessage({
      content: [makeToolUseBlock('p1', 'emit_proposal', proposalInput)],
      stop_reason: 'tool_use',
    });
    const round2 = makeMessage({ content: [makeTextBlock('ส่งข้อเสนอแล้วครับ')], stop_reason: 'end_turn' });
    const fake = createFakeAnthropicClient({
      turns: [
        { kind: 'message', message: round1 },
        { kind: 'message', message: round2 },
      ],
    });

    const result = await runAgentTurn(baseInput({ client: fake.client, toolContext: ctx }));
    expect(result.proposal?.ok).toBe(true);
    expect(result.proposal?.proposal.title).toBe('ฝายชะลอน้ำทดสอบ');
  });
});
