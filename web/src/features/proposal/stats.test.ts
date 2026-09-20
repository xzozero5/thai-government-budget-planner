import { describe, expect, it } from 'vitest';
import type { BoqLine } from '@/ai/tools/proposal';
import { computeBasisMix } from './stats';

function line(basis: BoqLine['basis'], total_thb: number): BoqLine {
  return {
    id: basis + String(total_thb),
    category: 'c',
    item: 'i',
    qty: 1,
    unit: 'u',
    unit_price_thb: total_thb,
    total_thb,
    basis,
    confidence: 'high',
    rationale: 'r',
    citations: [],
  };
}

describe('computeBasisMix', () => {
  it('คืน 0 ทั้งหมดเมื่อไม่มีบรรทัด', () => {
    expect(computeBasisMix([])).toEqual({
      historicalPercent: 0,
      marketPercent: 0,
      estimatePercent: 0,
    });
  });

  it('คำนวณสัดส่วนตามยอดรวม (ไม่ใช่จำนวนบรรทัด)', () => {
    const boq = [line('historical', 800), line('market', 100), line('estimate', 100)];
    const mix = computeBasisMix(boq);
    expect(mix.historicalPercent).toBeCloseTo(80, 5);
    expect(mix.marketPercent).toBeCloseTo(10, 5);
    expect(mix.estimatePercent).toBeCloseTo(10, 5);
  });

  it('บรรทัดเดียว basis เดียว = 100%', () => {
    const mix = computeBasisMix([line('estimate', 500)]);
    expect(mix.estimatePercent).toBe(100);
    expect(mix.historicalPercent).toBe(0);
  });
});
