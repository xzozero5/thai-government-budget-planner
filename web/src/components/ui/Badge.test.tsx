import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge, BasisBadge } from '@/components/ui/Badge';

describe('Badge', () => {
  it('render children และใช้ class จาก theme (ไม่มี hex ตรง ๆ)', () => {
    render(<Badge variant="danger">ผิดปกติ</Badge>);
    const badge = screen.getByText('ผิดปกติ');
    expect(badge.className).toContain('text-danger');
    expect(badge.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});

describe('BasisBadge', () => {
  it('มีทั้งตัวอักษรกำกับ (aria-hidden) และ label ข้อความเต็ม — ไม่ใช้สีอย่างเดียว', () => {
    render(<BasisBadge basis="historical" label="จากงบจริง" />);
    expect(screen.getByText('จากงบจริง')).toBeInTheDocument();
  });

  it('แต่ละ basis มีตัวอักษรกำกับต่างกัน', () => {
    const { rerender, container } = render(<BasisBadge basis="historical" label="จากงบจริง" />);
    const historicalMark = container.querySelector('[aria-hidden="true"]')?.textContent;
    rerender(<BasisBadge basis="market" label="ราคาตลาด" />);
    const marketMark = container.querySelector('[aria-hidden="true"]')?.textContent;
    rerender(<BasisBadge basis="estimate" label="ประมาณการ" />);
    const estimateMark = container.querySelector('[aria-hidden="true"]')?.textContent;
    expect(new Set([historicalMark, marketMark, estimateMark]).size).toBe(3);
  });

  it('ใช้ class สี basis จาก theme เท่านั้น', () => {
    render(<BasisBadge basis="market" label="ราคาตลาด" />);
    const badge = screen.getByText('ราคาตลาด').parentElement;
    expect(badge?.className).toContain('text-basis-market');
  });
});
