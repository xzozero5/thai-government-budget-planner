import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { MODEL_IDS } from './models';
import { buildRequestParams, OPUS_5_FALLBACK_BETA_HEADER } from './requestBuilder';

const FORBIDDEN_KEYS = ['temperature', 'top_p', 'top_k'] as const;

const sampleTools: Anthropic.Tool[] = [
  { name: 'search_catalog', description: 'd1', input_schema: { type: 'object' }, eager_input_streaming: true },
  { name: 'query_budget_lines', description: 'd2', input_schema: { type: 'object' }, eager_input_streaming: true },
];

const sampleMessages: Anthropic.MessageParam[] = [{ role: 'user', content: 'สวัสดี ช่วยดูงบให้หน่อย' }];

/** `Anthropic.ToolUnion` มีสมาชิกบางตัว (เช่น toolset ของ browser/computer) ที่ไม่มี field `name`
 * เลย (มีแค่ `type`) — narrow ด้วย `in` แทนการเข้าถึง `.name` ตรง ๆ ซึ่ง TS มองว่าไม่มีอยู่ในทุกสมาชิก */
function toolIdentifier(t: Anthropic.ToolUnion): string {
  return 'name' in t ? t.name : t.type;
}

function countCacheControlBreakpoints(params: Anthropic.MessageCreateParams): number {
  let count = 0;
  const system = params.system;
  if (Array.isArray(system)) {
    for (const block of system) {
      if (block.cache_control != null) count += 1;
    }
  }
  for (const tool of params.tools ?? []) {
    if ('cache_control' in tool && tool.cache_control != null) count += 1;
  }
  for (const message of params.messages) {
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if ('cache_control' in block && block.cache_control != null) count += 1;
      }
    }
  }
  return count;
}

describe.each(MODEL_IDS)('buildRequestParams (%s)', (model) => {
  it('ไม่มีพารามิเตอร์ต้องห้าม (temperature/top_p/top_k) หลุดออกไป', () => {
    const { params } = buildRequestParams({ model, system: 'system prompt คงที่', messages: sampleMessages, tools: sampleTools });
    for (const key of FORBIDDEN_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(params, key)).toBe(false);
    }
  });

  it('ไม่ประกาศ thinking.budget_tokens เด็ดขาด', () => {
    const { params } = buildRequestParams({ model, system: 'x', messages: sampleMessages, tools: sampleTools });
    if (params.thinking !== undefined) {
      expect('budget_tokens' in params.thinking).toBe(false);
      expect(params.thinking).toEqual({ type: 'adaptive' });
    }
  });

  it('max_tokens คงที่ 16000', () => {
    const { params } = buildRequestParams({ model, system: 'x', messages: sampleMessages, tools: sampleTools });
    expect(params.max_tokens).toBe(16_000);
  });

  it('ไม่ประกาศ code_execution คู่กับ web_search', () => {
    const { params } = buildRequestParams({ model, system: 'x', messages: sampleMessages, tools: sampleTools });
    const hasCodeExecution = (params.tools ?? []).some((t) => t.type?.startsWith('code_execution') === true);
    expect(hasCodeExecution).toBe(false);
  });

  it('เรียงลำดับ tools คงที่ (deterministic) — เรียกซ้ำได้ผลเหมือนเดิม', () => {
    const first = buildRequestParams({ model, system: 'x', messages: sampleMessages, tools: sampleTools });
    const second = buildRequestParams({ model, system: 'x', messages: sampleMessages, tools: sampleTools });
    const names1 = (first.params.tools ?? []).map(toolIdentifier);
    const names2 = (second.params.tools ?? []).map(toolIdentifier);
    expect(names1).toEqual(names2);
    expect(names1).toEqual(['search_catalog', 'query_budget_lines', 'web_search']);
  });

  it('breakpoint cache_control ≤ 4 จุด', () => {
    const { params } = buildRequestParams({ model, system: 'x', messages: sampleMessages, tools: sampleTools });
    expect(countCacheControlBreakpoints(params)).toBeLessThanOrEqual(4);
    expect(countCacheControlBreakpoints(params)).toBeGreaterThan(0);
  });

  it('ปิด web search ได้ (enableWebSearch:false)', () => {
    const { params } = buildRequestParams({
      model,
      system: 'x',
      messages: sampleMessages,
      tools: sampleTools,
      enableWebSearch: false,
    });
    expect((params.tools ?? []).some((t) => toolIdentifier(t) === 'web_search')).toBe(false);
  });
});

describe('buildRequestParams — system เป็น Anthropic.TextBlockParam[] (T-305 buildSystemBlocks)', () => {
  it('ส่งต่อบล็อกตรง ๆ โดยไม่แตะ cache_control ที่ผู้เรียกตั้งมาแล้ว', () => {
    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: 'ส่วนคงที่', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'โหมด: draft วันที่: 20 กันยายน 2569' },
    ];
    const { params } = buildRequestParams({
      model: 'claude-sonnet-5',
      system,
      messages: sampleMessages,
      tools: sampleTools,
    });
    expect(params.system).toEqual(system);
  });

  it('ไม่ mutate array ของบล็อก system ที่ผู้เรียกส่งมา', () => {
    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: 'ส่วนคงที่', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'ท้าย' },
    ];
    const snapshot = JSON.parse(JSON.stringify(system)) as unknown;
    buildRequestParams({ model: 'claude-sonnet-5', system, messages: sampleMessages, tools: sampleTools });
    expect(JSON.parse(JSON.stringify(system))).toEqual(snapshot);
  });

  it('breakpoint รวมยังคง ≤ 4 เมื่อ system เป็น array ที่มี cache_control 1 จุด', () => {
    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: 'ส่วนคงที่', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'ท้าย' },
    ];
    const { params } = buildRequestParams({
      model: 'claude-sonnet-5',
      system,
      messages: sampleMessages,
      tools: sampleTools,
    });
    expect(countCacheControlBreakpoints(params)).toBeLessThanOrEqual(4);
  });
});

describe('buildRequestParams — ต่อรุ่น', () => {
  it('Haiku 4.5: ไม่ส่ง thinking และไม่ส่ง output_config.effort (ADR-006 ข้อ 2)', () => {
    const { params, betaHeaders, useBetaMessages } = buildRequestParams({
      model: 'claude-haiku-4-5-20251001',
      system: 'x',
      messages: sampleMessages,
      tools: sampleTools,
    });
    expect(params.thinking).toBeUndefined();
    expect(params.output_config).toBeUndefined();
    expect(useBetaMessages).toBe(false);
    expect(betaHeaders).toEqual([]);
    expect((params.tools ?? []).find((t) => toolIdentifier(t) === 'web_search')?.type).toBe(
      'web_search_20250305',
    );
  });

  it('Sonnet 5: ส่ง thinking adaptive + effort default medium + web_search_20260209', () => {
    const { params, useBetaMessages } = buildRequestParams({
      model: 'claude-sonnet-5',
      system: 'x',
      messages: sampleMessages,
      tools: sampleTools,
    });
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.output_config).toEqual({ effort: 'medium' });
    expect(useBetaMessages).toBe(false);
    expect((params.tools ?? []).find((t) => toolIdentifier(t) === 'web_search')?.type).toBe(
      'web_search_20260209',
    );
  });

  it('รับ effort ที่ผู้ใช้เลือกได้ (เมื่อรุ่นรองรับ)', () => {
    const { params } = buildRequestParams({
      model: 'claude-sonnet-5',
      effort: 'high',
      system: 'x',
      messages: sampleMessages,
      tools: sampleTools,
    });
    expect(params.output_config).toEqual({ effort: 'high' });
  });

  it('Opus 5: เปิด server-side refusal fallback (fallbacks:"default" + beta header) — [UNVERIFIED] รูปร่าง request เท่านั้น', () => {
    const { params, useBetaMessages, betaHeaders } = buildRequestParams({
      model: 'claude-opus-5',
      system: 'x',
      messages: sampleMessages,
      tools: sampleTools,
    });
    expect(useBetaMessages).toBe(true);
    expect(betaHeaders).toEqual([OPUS_5_FALLBACK_BETA_HEADER]);
    expect(params.fallbacks).toBe('default');
  });

  it('Sonnet/Haiku ไม่มี fallbacks', () => {
    for (const model of ['claude-sonnet-5', 'claude-haiku-4-5-20251001'] as const) {
      const { params } = buildRequestParams({ model, system: 'x', messages: sampleMessages, tools: sampleTools });
      expect(params.fallbacks).toBeUndefined();
    }
  });
});
