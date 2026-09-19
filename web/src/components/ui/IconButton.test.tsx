import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from '@/components/ui/IconButton';

describe('IconButton', () => {
  it('มี accessible name จาก label แม้ไม่มีข้อความมองเห็น', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton label="ปิด" icon={<span aria-hidden="true">x</span>} onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'ปิด' });
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('ขนาดแตะขั้นต่ำ 40px (h-10 w-10)', () => {
    render(<IconButton label="คัดลอก" icon={<span />} />);
    const button = screen.getByRole('button', { name: 'คัดลอก' });
    expect(button.className).toContain('h-10');
    expect(button.className).toContain('w-10');
  });
});
