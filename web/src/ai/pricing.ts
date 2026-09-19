/**
 * T-301 — `costFromUsage`: คิดต้นทุนจริงจาก `usage` ที่ Anthropic API คืนมาเท่านั้น (ADR-006 ข้อ 1)
 * รวม cache write/read และ `server_tool_use.web_search_requests` — ห้ามประมาณ token เอง (ใช้
 * `usage` ของ response จริงเสมอ ไม่ใช่ผลจาก `messages.countTokens` ซึ่งไม่มีราคา)
 *
 * ห้าม import React/DOM API (module boundary — docs/04-ARCHITECTURE.md §3)
 */
import type Anthropic from '@anthropic-ai/sdk';
import { getModelCapability, type ModelId, WEB_SEARCH_COST_PER_REQUEST_USD } from './models';

export interface CostBreakdown {
  inputCostUsd: number;
  outputCostUsd: number;
  cacheWriteCostUsd: number;
  cacheReadCostUsd: number;
  webSearchCostUsd: number;
  webSearchRequests: number;
  totalCostUsd: number;
}

const USD_PER_TOKEN = (pricePerMTok: number): number => pricePerMTok / 1_000_000;

/** คิดต้นทุนของ 1 response — รับ `Anthropic.Usage` ตรง ๆ (ห้ามนิยาม type ซ้ำตาม ADR-006 ข้อ 4) */
export function costFromUsage(model: ModelId, usage: Anthropic.Usage): CostBreakdown {
  const cap = getModelCapability(model);
  const perTokenIn = USD_PER_TOKEN(cap.pricePerMTokIn);
  const perTokenOut = USD_PER_TOKEN(cap.pricePerMTokOut);

  const inputCostUsd = usage.input_tokens * perTokenIn;
  const outputCostUsd = usage.output_tokens * perTokenOut;
  const cacheWriteCostUsd =
    (usage.cache_creation_input_tokens ?? 0) * perTokenIn * cap.cacheWriteMultiplier;
  const cacheReadCostUsd = (usage.cache_read_input_tokens ?? 0) * perTokenIn * cap.cacheReadMultiplier;
  const webSearchRequests = usage.server_tool_use?.web_search_requests ?? 0;
  const webSearchCostUsd = webSearchRequests * WEB_SEARCH_COST_PER_REQUEST_USD;

  return {
    inputCostUsd,
    outputCostUsd,
    cacheWriteCostUsd,
    cacheReadCostUsd,
    webSearchCostUsd,
    webSearchRequests,
    totalCostUsd: inputCostUsd + outputCostUsd + cacheWriteCostUsd + cacheReadCostUsd + webSearchCostUsd,
  };
}

/** รวมต้นทุนของหลาย response (เช่น ทุก turn ใน session) — ใช้เทียบ budget ต่อ session (F1 US-1.1) */
export function sumCosts(costs: CostBreakdown[]): CostBreakdown {
  return costs.reduce<CostBreakdown>(
    (acc, c) => ({
      inputCostUsd: acc.inputCostUsd + c.inputCostUsd,
      outputCostUsd: acc.outputCostUsd + c.outputCostUsd,
      cacheWriteCostUsd: acc.cacheWriteCostUsd + c.cacheWriteCostUsd,
      cacheReadCostUsd: acc.cacheReadCostUsd + c.cacheReadCostUsd,
      webSearchCostUsd: acc.webSearchCostUsd + c.webSearchCostUsd,
      webSearchRequests: acc.webSearchRequests + c.webSearchRequests,
      totalCostUsd: acc.totalCostUsd + c.totalCostUsd,
    }),
    {
      inputCostUsd: 0,
      outputCostUsd: 0,
      cacheWriteCostUsd: 0,
      cacheReadCostUsd: 0,
      webSearchCostUsd: 0,
      webSearchRequests: 0,
      totalCostUsd: 0,
    },
  );
}

/** true เมื่อ response นี้มี cache hit จริง (ไว้ใช้วัด cache hit % ใน eval — ADR-006 ข้อ 7) */
export function hadCacheHit(usage: Anthropic.Usage): boolean {
  return (usage.cache_read_input_tokens ?? 0) > 0;
}
