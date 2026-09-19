import { useState } from 'react';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '@/components/ui/Dialog';

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
        เปิด export dialog
      </button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="ส่งออก PDF"
      >
        <button type="button">ดาวน์โหลด</button>
      </Dialog>
    </div>
  );
}

describe('Dialog', () => {
  it('ไม่ render เมื่อ open=false', () => {
    render(
      <Dialog open={false} onClose={vi.fn()} title="x">
        y
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('เปิดแล้ว role=dialog + aria-modal, Esc ปิดและคืน focus', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'เปิด export dialog' });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'ส่งออก PDF' })).toHaveAttribute(
      'aria-modal',
      'true',
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('คลิก overlay ปิด dialog', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'เปิด export dialog' }));
    await user.click(screen.getByTestId('dialog-overlay'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
