import { describe, expect, it } from 'vitest';
import { MODEL_IDS } from '../models';
import { TOOL_REGISTRY, toApiTools } from './index';

describe('tools/index', () => {
  it('TOOL_REGISTRY เรียงลำดับคงที่ (10 tools)', () => {
    expect(TOOL_REGISTRY.map((t) => t.name)).toEqual([
      'search_catalog',
      'query_budget_lines',
      'get_budget_line',
      'find_documents',
      'read_document',
      'get_econ_indicator',
      'adjust_for_inflation',
      'get_price_trend',
      'emit_illustration',
      'emit_proposal',
    ]);
  });

  it.each(MODEL_IDS)('toApiTools(%s) คืนลำดับเดิมทุกครั้ง (deterministic ตาม ADR-006 ข้อ 7)', (model) => {
    const first = toApiTools(model).map((t) => t.name);
    const second = toApiTools(model).map((t) => t.name);
    expect(first).toEqual(second);
    expect(first).toEqual(TOOL_REGISTRY.map((t) => t.name));
  });

  it('ทุก tool มี eager_input_streaming:true และ input_schema.additionalProperties:false', () => {
    for (const tool of toApiTools('claude-sonnet-5')) {
      expect(tool.eager_input_streaming).toBe(true);
      expect((tool.input_schema as Record<string, unknown>)['additionalProperties']).toBe(false);
    }
  });
});
