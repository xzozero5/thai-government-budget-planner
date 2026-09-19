import { useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useFocusTrap } from '@/components/ui/hooks/useFocusTrap';

function TestHost({ onClose }: { onClose: () => void }): ReactElement {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap({
    active: open,
    containerRef,
    onClose: () => {
      setOpen(false);
      onClose();
    },
  });

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        เปิด
      </button>
      {open && (
        <div ref={containerRef} tabIndex={-1} data-testid="trap-box">
          <button type="button">ปุ่มแรก</button>
          <button type="button">ปุ่มสุดท้าย</button>
        </div>
      )}
    </div>
  );
}

describe('useFocusTrap', () => {
  it('โฟกัส element แรกในกล่องเมื่อเปิด', async () => {
    const user = userEvent.setup();
    render(<TestHost onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'เปิด' }));
    expect(screen.getByRole('button', { name: 'ปุ่มแรก' })).toHaveFocus();
  });

  it('Tab จากปุ่มสุดท้ายวนกลับไปปุ่มแรก', async () => {
    const user = userEvent.setup();
    render(<TestHost onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'เปิด' }));
    screen.getByRole('button', { name: 'ปุ่มสุดท้าย' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'ปุ่มแรก' })).toHaveFocus();
  });

  it('Shift+Tab จากปุ่มแรกวนไปปุ่มสุดท้าย', async () => {
    const user = userEvent.setup();
    render(<TestHost onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'เปิด' }));
    screen.getByRole('button', { name: 'ปุ่มแรก' }).focus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'ปุ่มสุดท้าย' })).toHaveFocus();
  });

  it('Escape เรียก onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TestHost onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'เปิด' }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('คืน focus ให้ element ที่โฟกัสอยู่ก่อนเปิด เมื่อปิดด้วย Escape', async () => {
    const user = userEvent.setup();
    render(<TestHost onClose={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'เปิด' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });
});
