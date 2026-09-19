import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Chip } from '@/components/ui/Chip';

describe('Chip', () => {
  it('คลิกได้และเรียก onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Chip onClick={onClick}>PBO 2566 · กรมพลังงาน</Chip>);
    await user.click(screen.getByRole('button', { name: 'PBO 2566 · กรมพลังงาน' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('aria-pressed สะท้อนสถานะ selected', () => {
    render(<Chip selected>เลือกแล้ว</Chip>);
    expect(screen.getByRole('button', { name: 'เลือกแล้ว' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
