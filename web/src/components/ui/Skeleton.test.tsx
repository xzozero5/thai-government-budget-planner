import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from '@/components/ui/Skeleton';

describe('Skeleton', () => {
  it('aria-hidden เสมอ (ไม่มีเนื้อหาจริงให้ประกาศ)', () => {
    const { container } = render(<Skeleton width={120} height={16} />);
    const el = container.firstElementChild;
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el).toHaveStyle({ width: '120px', height: '16px' });
  });

  it('รองรับ rounded variant', () => {
    const { container } = render(<Skeleton rounded="full" />);
    expect(container.firstElementChild?.className).toContain('rounded-full');
  });
});
