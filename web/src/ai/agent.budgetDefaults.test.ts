/**
 * T-307 (security review M2) — `runAgentTurn` ต้องมีเพดานเงินโดยปริยายเมื่อผู้เรียกไม่ระบุ `budget`
 * (เดิมไม่มีเพดานใด ๆ เลยนอกจาก `maxToolRounds`) ดู `DEFAULT_MAX_COST_USD_PER_TURN`/
 * `DEFAULT_MAX_COST_USD_PER_SESSION` ใน `agent.ts`
 */
import type Anthropic from '@anthropic-ai/sdk';
import { createDataFacade } from '@/data';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_COST_USD_PER_SESSION,
  DEFAULT_MAX_COST_USD_PER_TURN,
  runAgentTurn,
  type RunAgentTurnInput,
} from './agent';
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

const HEAVY_USAGE = makeUsage({ input_tokens: 300_000, output_tokens: 0 }); // sonnet-5: 300k × $2/M = $0.60

const heavyToolTurn: ScriptedTurn = {
  kind: 'message',
  message: makeMessage({
    content: [
      makeTextBlock('กำลังค้นข้อมูล'),
      makeToolUseBlock('t1', 'get_econ_indicator', { indicators: ['cpi_headline_index'], years_be: [2566] }),
    ],
    stop_reason: 'tool_use',
    usage: HEAVY_USAGE,
  }),
};

const endTurn: ScriptedTurn = {
  kind: 'message',
  message: makeMessage({ content: [makeTextBlock('สรุปแล้ว')], stop_reason: 'end_turn', usage: makeUsage() }),
};

function baseInput(
  turns: ScriptedTurn[],
  overrides: Partial<RunAgentTurnInput> = {},
): RunAgentTurnInput {
  return {
    client: createFakeAnthropicClient({ turns }).client,
    model: 'claude-sonnet-5',
    mode: 'draft',
    system: 'ทดสอบ',
    messages: [{ role: 'user', content: 'ประเมินงบ' } satisfies Anthropic.MessageParam],
    toolContext: {
      data: createDataFacade(),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    },
    ...overrides,
  };
}

describe('runAgentTurn — เพดานเงินโดยปริยาย (T-307 M2)', () => {
  it('ไม่ส่ง budget เลย → ใช้ DEFAULT_MAX_COST_USD_PER_TURN หยุดก่อนรอบถัดไปเมื่อ turn นี้แพงเกิน', async () => {
    expect(DEFAULT_MAX_COST_USD_PER_TURN).toBe(0.5);
    const result = await runAgentTurn(baseInput([heavyToolTurn, endTurn]));
    expect(result.costUsd).toBeGreaterThanOrEqual(DEFAULT_MAX_COST_USD_PER_TURN);
    expect(result.endedBecause).toBe('budget');
    // รอบแรกยังถูกเรียกจริง (tool ทำงานแล้ว) — เพดานหยุด "รอบถัดไป" ไม่ใช่รอบที่กำลังทำอยู่
    expect(result.toolCalls).toHaveLength(1);
  });

  it('ไม่ส่ง budget เลย → ใช้ DEFAULT_MAX_COST_USD_PER_SESSION เมื่อ spentUsdSoFar ใกล้เพดานอยู่แล้ว', async () => {
    expect(DEFAULT_MAX_COST_USD_PER_SESSION).toBe(3.0);
    const { client, callCount } = createFakeAnthropicClient({ turns: [endTurn] });
    const result = await runAgentTurn(
      baseInput([endTurn], {
        client,
        budget: { spentUsdSoFar: DEFAULT_MAX_COST_USD_PER_SESSION },
      }),
    );
    expect(result.endedBecause).toBe('budget');
    expect(callCount()).toBe(0); // หยุดก่อนยิง request ใด ๆ เลย
  });

  it('ระบุ budget เอง (override) → ใช้ค่าที่ส่งมาแทนค่า default', async () => {
    const result = await runAgentTurn(
      baseInput([endTurn], { budget: { maxCostUsdPerTurn: 100, maxCostUsdPerSession: 100 } }),
    );
    expect(result.endedBecause).toBe('end_turn');
  });
});
