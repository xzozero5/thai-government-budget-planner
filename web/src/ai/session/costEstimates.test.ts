import { describe, expect, it } from 'vitest';
import { getModelCapability } from '@/ai/models';
import {
  COST_ESTIMATE_CHECKED_AT_TH,
  USD_TO_THB_RATE_APPROX,
  getCostEstimate,
  usdToThbApprox,
} from './costEstimates';

describe('costEstimates — T-410 ข้อ 1 (US-1.2)', () => {
  it('Haiku 4.5: ใช้ค่าที่วัดจริง 0.13 USD และไม่ติดป้าย unverified', () => {
    const estimate = getCostEstimate('claude-haiku-4-5-20251001');
    expect(estimate.usd).toBeCloseTo(0.13, 5);
    expect(estimate.unverified).toBe(false);
  });

  it('Sonnet 5: ค่าคงที่ 0.40 USD และต้องติดป้าย unverified (N3 — ยังไม่ได้วัดจริง)', () => {
    const estimate = getCostEstimate('claude-sonnet-5');
    expect(estimate.usd).toBeCloseTo(0.4, 5);
    expect(estimate.unverified).toBe(true);
  });

  it('Opus 5: คำนวณจากอัตราส่วนราคาเทียบ Haiku และต้องติดป้าย unverified', () => {
    const opus = getModelCapability('claude-opus-5');
    const haiku = getModelCapability('claude-haiku-4-5-20251001');
    const expectedRatio = (opus.pricePerMTokIn / haiku.pricePerMTokIn + opus.pricePerMTokOut / haiku.pricePerMTokOut) / 2;

    const estimate = getCostEstimate('claude-opus-5');

    expect(estimate.usd).toBeCloseTo(0.13 * expectedRatio, 5);
    expect(estimate.unverified).toBe(true);
  });

  it('usdToThbApprox คูณด้วยอัตราคงที่ USD_TO_THB_RATE_APPROX', () => {
    expect(usdToThbApprox(1)).toBe(USD_TO_THB_RATE_APPROX);
    expect(usdToThbApprox(0.13)).toBeCloseTo(0.13 * 36, 5);
  });

  it('COST_ESTIMATE_CHECKED_AT_TH เป็นสตริงไม่ว่างเปล่า (ใช้แทน {date} ใน copy)', () => {
    expect(COST_ESTIMATE_CHECKED_AT_TH.length).toBeGreaterThan(0);
  });
});
