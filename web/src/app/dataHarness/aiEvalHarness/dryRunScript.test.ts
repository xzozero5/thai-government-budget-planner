import type Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeAnthropicClient } from '@/ai/testing/fakeAnthropic';
import { recordSuccessForTest, resetToolCapture } from '@/ai/testing/toolCapture';
import { buildGenericDryRunScript } from './dryRunScript';

function toolUseBlockOf(message: Anthropic.Message): Anthropic.ToolUseBlock {
  const block = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (block === undefined) {
    throw new Error('ไม่มี tool_use block ในข้อความนี้');
  }
  return block;
}

const baseParams = (messages: Anthropic.MessageParam[]): Anthropic.MessageCreateParams => ({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 16_000,
  system: 's',
  messages,
  tools: [],
});

describe('buildGenericDryRunScript', () => {
  beforeEach(() => {
    resetToolCapture();
  });

  it('เรียก search_catalog → query_budget_lines (item_key จาก capture จริง) → emit_proposal (citation จริง) → end_turn', async () => {
    const scripted = buildGenericDryRunScript(1);
    expect(scripted).toHaveLength(4);
    const { client } = createFakeAnthropicClient({ turns: scripted });
    const history: Anthropic.MessageParam[] = [{ role: 'user', content: 'สวัสดี' }];

    // round 1: search_catalog
    const r1 = await client.messages.stream(baseParams(history)).finalMessage();
    expect(r1.stop_reason).toBe('tool_use');
    expect(toolUseBlockOf(r1).name).toBe('search_catalog');
    // จำลองว่า tool นี้ถูกรันสำเร็จแล้ว (ไม่ผ่าน regex ของ tool_result.content — อ่านจาก capture โดยตรง)
    recordSuccessForTest('search_catalog', toolUseBlockOf(r1).input, {
      items: [{ key: 'เครื่องปรับอากาศ ขนาด 18000 บีทียู' }],
      total: 1,
      coverage_notes: [],
    });

    // round 2: query_budget_lines ต้องใช้ item_key จาก capture ของรอบ 1 จริง
    const r2 = await client.messages.stream(baseParams(history)).finalMessage();
    const queryBlock = toolUseBlockOf(r2);
    expect(queryBlock.name).toBe('query_budget_lines');
    expect((queryBlock.input as { item_key?: string }).item_key).toBe(
      'เครื่องปรับอากาศ ขนาด 18000 บีทียู',
    );
    recordSuccessForTest('query_budget_lines', queryBlock.input, {
      rows: [
        {
          source_id: 'src_real_1',
          item_name_raw: 'เครื่องปรับอากาศ ขนาด 18000 บีทียู',
          unit_price_thb: 27500,
          amount_thb: null,
        },
      ],
      total: 1,
      truncated: false,
      shards_loaded: [],
      coverage_notes: [],
      warnings: [],
    });

    // round 3: emit_proposal ต้องอ้าง source_id จาก capture ของรอบ 2 จริง
    const r3 = await client.messages.stream(baseParams(history)).finalMessage();
    const proposalBlock = toolUseBlockOf(r3);
    expect(proposalBlock.name).toBe('emit_proposal');
    const proposalInput = proposalBlock.input as {
      boq: { unit_price_thb: number; citations: { source_id: string }[] }[];
    };
    expect(proposalInput.boq[0]?.unit_price_thb).toBe(27500);
    expect(proposalInput.boq[0]?.citations[0]?.source_id).toBe('src_real_1');
    recordSuccessForTest('emit_proposal', proposalBlock.input, { ok: true });

    // round 4: end_turn
    const r4 = await client.messages.stream(baseParams(history)).finalMessage();
    expect(r4.stop_reason).toBe('end_turn');
  });

  it('ไม่มี capture ของ search_catalog เลย (เช่น tool error) → ยังเรียก query_budget_lines ด้วย keyword fallback ได้ (ไม่ throw)', async () => {
    const scripted = buildGenericDryRunScript(1);
    const { client } = createFakeAnthropicClient({ turns: scripted });
    const history: Anthropic.MessageParam[] = [{ role: 'user', content: 'สวัสดี' }];

    await client.messages.stream(baseParams(history)).finalMessage();
    // ไม่เรียก recordSuccessForTest เลย — จำลองว่า search_catalog error/ยังไม่มีผล

    const r2 = await client.messages.stream(baseParams(history)).finalMessage();
    const queryBlock = toolUseBlockOf(r2);
    expect((queryBlock.input as { keywords?: string[] }).keywords).toEqual(['เครื่องปรับอากาศ']);
  });

  it('promptTurnCount=2 เพิ่ม end_turn อีก 1 รอบท้ายสคริปต์', () => {
    expect(buildGenericDryRunScript(2)).toHaveLength(5);
  });
});
