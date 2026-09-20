import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrendChartLazy } from './TrendChartLazy';

describe('TrendChartLazy', () => {
  it('โหลด TrendChart จริงแบบ lazy แล้ว render กราฟ (ผ่าน Suspense) โดยไม่พัง', async () => {
    render(
      <TrendChartLazy
        points={[{ yearBe: 2566, n: 5, median: 100 }]}
        basis="amount_per_line"
        ariaLabel="แนวโน้มราคาแบบ lazy"
      />,
    );
    // ระหว่างโหลด chunk อาจเห็น skeleton ก่อน แล้วค่อยเห็นกราฟจริง (role=img ของ TrendChart)
    // timeout ยาวกว่าปกติ — การ transform `recharts` (ไลบรารีใหญ่) ครั้งแรกใน vitest ช้ากว่าปกติมาก
    expect(
      await screen.findByRole('img', { name: 'แนวโน้มราคาแบบ lazy' }, { timeout: 15000 }),
    ).toBeInTheDocument();
  }, 20000);
});
