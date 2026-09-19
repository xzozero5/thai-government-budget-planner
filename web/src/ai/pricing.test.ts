import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { costFromUsage, hadCacheHit, sumCosts } from './pricing';

function usage(overrides: Partial<Anthropic.Usage> = {}): Anthropic.Usage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    cache_creation: null,
    inference_geo: null,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: null,
    ...overrides,
  };
}

describe('costFromUsage', () => {
  it('คิด input/output ตรงราคาต่อ MTok ของ sonnet-5 ($2/$10)', () => {
    const cost = costFromUsage('claude-sonnet-5', usage({ input_tokens: 1_000_000, output_tokens: 1_000_000 }));
    expect(cost.inputCostUsd).toBeCloseTo(2, 6);
    expect(cost.outputCostUsd).toBeCloseTo(10, 6);
    expect(cost.totalCostUsd).toBeCloseTo(12, 6);
  });

  it('รวม cache write (1.25x) และ cache read (0.1x) ของราคา input', () => {
    const cost = costFromUsage(
      'claude-sonnet-5',
      usage({ input_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 }),
    );
    expect(cost.cacheWriteCostUsd).toBeCloseTo(2 * 1.25, 6);
    expect(cost.cacheReadCostUsd).toBeCloseTo(2 * 0.1, 6);
  });

  it('รวมค่า web search จาก server_tool_use.web_search_requests', () => {
    const cost = costFromUsage(
      'claude-haiku-4-5-20251001',
      usage({ server_tool_use: { web_search_requests: 3, web_fetch_requests: 0 } }),
    );
    expect(cost.webSearchRequests).toBe(3);
    expect(cost.webSearchCostUsd).toBeCloseTo(0.03, 6);
  });

  it('hadCacheHit true เมื่อ cache_read_input_tokens > 0', () => {
    expect(hadCacheHit(usage({ cache_read_input_tokens: 10 }))).toBe(true);
    expect(hadCacheHit(usage({ cache_read_input_tokens: 0 }))).toBe(false);
    expect(hadCacheHit(usage())).toBe(false);
  });

  it('sumCosts รวมหลาย response เข้าด้วยกัน', () => {
    const a = costFromUsage('claude-sonnet-5', usage({ input_tokens: 1000 }));
    const b = costFromUsage('claude-sonnet-5', usage({ input_tokens: 2000 }));
    const total = sumCosts([a, b]);
    expect(total.inputCostUsd).toBeCloseTo(a.inputCostUsd + b.inputCostUsd, 9);
  });
});
