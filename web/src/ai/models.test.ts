import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_ID,
  getModelCapability,
  isModelId,
  MODEL_CAPABILITIES,
  MODEL_IDS,
  MODEL_LIST,
} from './models';

describe('models', () => {
  it('default model is claude-sonnet-5 (ADR-006 ข้อ 1)', () => {
    expect(DEFAULT_MODEL_ID).toBe('claude-sonnet-5');
  });

  it('MODEL_LIST เรียงคงที่ตาม MODEL_IDS (deterministic)', () => {
    expect(MODEL_LIST.map((m) => m.id)).toEqual([...MODEL_IDS]);
  });

  it('Haiku 4.5 ไม่รองรับ effort/adaptive thinking (ADR-006 ข้อ 2)', () => {
    const haiku = getModelCapability('claude-haiku-4-5-20251001');
    expect(haiku.supportsEffort).toBe(false);
    expect(haiku.supportsAdaptiveThinking).toBe(false);
    expect(haiku.webSearchToolType).toBe('web_search_20250305');
  });

  it('Sonnet 5 และ Opus 5 รองรับ effort + adaptive thinking + web_search_20260209', () => {
    for (const id of ['claude-sonnet-5', 'claude-opus-5'] as const) {
      const cap = getModelCapability(id);
      expect(cap.supportsEffort).toBe(true);
      expect(cap.supportsAdaptiveThinking).toBe(true);
      expect(cap.webSearchToolType).toBe('web_search_20260209');
    }
  });

  it('ทุกรุ่นมีวันที่ตรวจราคา (pricingCheckedAt) และราคา > 0', () => {
    for (const cap of Object.values(MODEL_CAPABILITIES)) {
      expect(cap.pricingCheckedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(cap.pricePerMTokIn).toBeGreaterThan(0);
      expect(cap.pricePerMTokOut).toBeGreaterThan(0);
    }
  });

  it('ขั้นต่ำของ cache prefix ตรงตามที่ตรวจจาก reference (Opus5=512, Sonnet5=1024, Haiku4.5=4096)', () => {
    expect(getModelCapability('claude-opus-5').minCacheablePrefixTokens).toBe(512);
    expect(getModelCapability('claude-sonnet-5').minCacheablePrefixTokens).toBe(1024);
    expect(getModelCapability('claude-haiku-4-5-20251001').minCacheablePrefixTokens).toBe(4096);
  });

  it('isModelId แยกแยะ id ที่ไม่รู้จักได้', () => {
    expect(isModelId('claude-sonnet-5')).toBe(true);
    expect(isModelId('claude-sonnet-4-5')).toBe(false);
  });
});
