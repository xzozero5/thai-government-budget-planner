import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConfidenceDots } from '@/components/ui/ConfidenceDots';

describe('ConfidenceDots', () => {
  it('มี aria-label ภาษาไทยตามระดับเป็นค่าเริ่มต้น', () => {
    render(<ConfidenceDots level="high" />);
    expect(screen.getByRole('img', { name: 'ความเชื่อมั่นสูง' })).toBeInTheDocument();
  });

  it('override label ได้', () => {
    render(<ConfidenceDots level="low" label="unit_price n=1" />);
    expect(screen.getByRole('img', { name: 'unit_price n=1' })).toBeInTheDocument();
  });

  it('จำนวนจุดที่ทึบตรงกับระดับ', () => {
    const { container } = render(<ConfidenceDots level="medium" />);
    const dots = container.querySelectorAll('[aria-hidden="true"]');
    expect(dots).toHaveLength(3);
    expect(dots[0]?.className).toContain('opacity-100');
    expect(dots[1]?.className).toContain('opacity-100');
    expect(dots[2]?.className).toContain('opacity-30');
  });
});
