import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Skeleton } from '@/components/ui/Skeleton';

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

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

  it('motion.md #22: วนลูป shimmer เมื่อไม่ reduced-motion', () => {
    stubMatchMedia(false);
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild?.className).toContain('animate-skeleton-shimmer');
  });

  it('motion.md #22: reduced-motion → คงที่ที่ opacity-75 (ไม่ใช่ 1 หรือ 0.6)', () => {
    stubMatchMedia(true);
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild?.className).toContain('opacity-75');
    expect(container.firstElementChild?.className).not.toContain('animate-skeleton-shimmer');
  });
});
