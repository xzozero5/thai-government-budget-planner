import { describe, expect, it } from 'vitest';
import { BUDGET_WARNING_RATIO, hasCrossedBudgetWarningThreshold } from './budgetWarning';

describe('hasCrossedBudgetWarningThreshold — T-410 ข้อ 2 (US-1.1)', () => {
  it('ต่ำกว่า 80% ของเพดาน → false', () => {
    expect(hasCrossedBudgetWarningThreshold(2.39, 3)).toBe(false);
  });

  it('เท่ากับ 80% ของเพดานพอดี → true (นับรวมขอบเขต)', () => {
    expect(hasCrossedBudgetWarningThreshold(3 * 0.8, 3)).toBe(true);
  });

  it('เกิน 80% ของเพดาน → true', () => {
    expect(hasCrossedBudgetWarningThreshold(2.9, 3)).toBe(true);
  });

  it('เพดานเป็น 0 หรือติดลบ (ผิดปกติ) → ไม่เตือน', () => {
    expect(hasCrossedBudgetWarningThreshold(1, 0)).toBe(false);
    expect(hasCrossedBudgetWarningThreshold(1, -3)).toBe(false);
  });

  it('BUDGET_WARNING_RATIO คือ 0.8 ตาม US-1.1', () => {
    expect(BUDGET_WARNING_RATIO).toBe(0.8);
  });
});
