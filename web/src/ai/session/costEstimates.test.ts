import { describe, expect, it } from 'vitest';
import { getModelCapability } from '@/ai/models';
import {
  COST_ESTIMATE_CHECKED_AT_TH,
  USD_TO_THB_RATE_APPROX,
  getCostEstimate,
  usdToThbApprox,
} from './costEstimates';

describe('costEstimates — T-410 ข้อ 1/4 (US-1.2, หลัง demo จริง 2569-09-20)', () => {
  it('Haiku 4.5: ช่วงที่วัดจริง 0.15–0.55 USD และไม่ติดป้าย unverified', () => {
    const estimate = getCostEstimate('claude-haiku-4-5-20251001');
    expect(estimate.minUsd).toBeCloseTo(0.15, 5);
    expect(estimate.maxUsd).toBeCloseTo(0.55, 5);
    expect(estimate.unverified).toBe(false);
  });

  it('Haiku: ช่วงที่แสดงครอบคลุมค่าที่วัดจริงล่าสุด (demo จริงครั้งแรก 0.52 USD) พร้อมขอบเผื่อ', () => {
    const estimate = getCostEstimate('claude-haiku-4-5-20251001');
    // docs/api-budget.md: วัดจริง 0.1202/0.1283 USD (eval รอบแรก) และ 0.52 USD (demo จริงกับผู้ใช้จริง —
    // โจทย์ยาวกว่า) ขอบล่าง (0.15) ปัดขึ้นจากเคส eval เล็กน้อยเพื่อกันแสดงตัวเลขต่ำเกินจริงสำหรับผู้ใช้จริง
    // ที่บทสนทนามักยาวกว่า eval — ขอบบน (0.55) ต้องครอบคลุมค่าที่แพงที่สุดที่วัดได้จริง (0.52) เสมอ
    expect(0.52).toBeLessThanOrEqual(estimate.maxUsd);
    expect(estimate.minUsd).toBeLessThan(estimate.maxUsd);
  });

  it('Sonnet 5: คำนวณจากอัตราส่วนราคาเทียบ Haiku และต้องติดป้าย unverified (N3 — ยังไม่ได้วัดจริง)', () => {
    const sonnet = getModelCapability('claude-sonnet-5');
    const haiku = getModelCapability('claude-haiku-4-5-20251001');
    const ratio = (sonnet.pricePerMTokIn / haiku.pricePerMTokIn + sonnet.pricePerMTokOut / haiku.pricePerMTokOut) / 2;

    const estimate = getCostEstimate('claude-sonnet-5');

    expect(estimate.minUsd).toBeCloseTo(0.15 * ratio, 5);
    expect(estimate.maxUsd).toBeCloseTo(0.55 * ratio, 5);
    expect(estimate.unverified).toBe(true);
    expect(estimate.minUsd).toBeLessThan(estimate.maxUsd);
  });

  it('Opus 5: คำนวณจากอัตราส่วนราคาเทียบ Haiku และต้องติดป้าย unverified', () => {
    const opus = getModelCapability('claude-opus-5');
    const haiku = getModelCapability('claude-haiku-4-5-20251001');
    const ratio = (opus.pricePerMTokIn / haiku.pricePerMTokIn + opus.pricePerMTokOut / haiku.pricePerMTokOut) / 2;

    const estimate = getCostEstimate('claude-opus-5');

    expect(estimate.minUsd).toBeCloseTo(0.15 * ratio, 5);
    expect(estimate.maxUsd).toBeCloseTo(0.55 * ratio, 5);
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
