import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from '@/components/ui/Switch';

describe('Switch', () => {
  it('role=switch, aria-checked ตรงกับ checked', () => {
    render(<Switch checked={true} onChange={vi.fn()} label="เปิดใช้ web search" />);
    const el = screen.getByRole('switch', { name: 'เปิดใช้ web search' });
    expect(el).toHaveAttribute('aria-checked', 'true');
  });

  it('คลิกเรียก onChange ด้วยค่าใหม่', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="เปิดใช้ web search" />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('กด Space/Enter สลับสถานะได้ (ปุ่ม native)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="สลับโหมด" />);
    screen.getByRole('switch').focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
