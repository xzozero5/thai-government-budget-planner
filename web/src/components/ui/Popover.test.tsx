import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Popover } from '@/components/ui/Popover';

describe('Popover', () => {
  it('คลิก trigger เปิด/ปิด และตั้ง aria-expanded', async () => {
    const user = userEvent.setup();
    render(<Popover triggerLabel="ⓘ">เหตุผล: อ้างอิงราคาเฉลี่ยปี 2566</Popover>);
    const trigger = screen.getByRole('button', { name: 'ⓘ' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('เหตุผล: อ้างอิงราคาเฉลี่ยปี 2566')).toBeInTheDocument();
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('ปิดเมื่อกด Esc', async () => {
    const user = userEvent.setup();
    render(<Popover triggerLabel="ⓘ">เนื้อหา</Popover>);
    await user.click(screen.getByRole('button', { name: 'ⓘ' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ปิดเมื่อคลิกนอกกล่อง', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Popover triggerLabel="ⓘ">เนื้อหา</Popover>
        <button type="button">นอกกล่อง</button>
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'ⓘ' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'นอกกล่อง' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
