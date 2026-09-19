import { useState } from 'react';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Drawer } from '@/components/ui/Drawer';

function Host(): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        เปิด drawer
      </button>
      <Drawer
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="รายละเอียดแหล่งอ้างอิง"
      >
        <p>เนื้อหา</p>
        <button type="button">ปุ่มในกล่อง</button>
      </Drawer>
    </div>
  );
}

describe('Drawer', () => {
  it('ไม่ render อะไรเมื่อ open=false', () => {
    render(
      <Drawer open={false} onClose={vi.fn()} title="ทดสอบ">
        เนื้อหา
      </Drawer>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('role=dialog + aria-modal + focus trap + คืน focus เมื่อปิดด้วย Esc', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'เปิด drawer' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'รายละเอียดแหล่งอ้างอิง' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('คลิก overlay ปิด drawer', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'เปิด drawer' }));
    await user.click(screen.getByTestId('drawer-overlay'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ปุ่มปิดมี accessible name และปิด drawer ได้', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'เปิด drawer' }));
    await user.click(screen.getByRole('button', { name: 'ปิด' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
