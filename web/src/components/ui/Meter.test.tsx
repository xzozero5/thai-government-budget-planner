import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Meter } from '@/components/ui/Meter';

describe('Meter', () => {
  it('role=meter พร้อม aria-valuenow/min/max', () => {
    render(<Meter value={0.5} max={2} label="ค่าใช้จ่าย session นี้" valueText="$0.50 / $2.00" />);
    const meter = screen.getByRole('meter', { name: 'ค่าใช้จ่าย session นี้' });
    expect(meter).toHaveAttribute('aria-valuenow', '0.5');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '2');
    expect(screen.getByText('$0.50 / $2.00')).toBeInTheDocument();
  });

  it('ใกล้เพดาน (≥80%) ใช้สี warn', () => {
    const { container } = render(<Meter value={1.8} max={2} label="x" />);
    const fill = container.querySelector('[style*="width"]');
    expect(fill?.className).toContain('bg-warn');
  });

  it('เกินเพดานใช้สี danger', () => {
    const { container } = render(<Meter value={3} max={2} label="x" />);
    const fill = container.querySelector('[style*="width"]');
    expect(fill?.className).toContain('bg-danger');
    expect(fill).toHaveStyle({ width: '100%' });
  });
});
