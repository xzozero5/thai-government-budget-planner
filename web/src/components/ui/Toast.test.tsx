import { act } from 'react';
import type { ReactElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '@/components/ui/Toast';

function PushButton({ title, durationMs }: { title: string; durationMs?: number }): ReactElement {
  const { push } = useToast();
  return (
    <button
      type="button"
      onClick={() => push(durationMs === undefined ? { title } : { title, durationMs })}
    >
      แจ้งเตือน
    </button>
  );
}

describe('Toast', () => {
  it('useToast นอก ToastProvider โยน error', () => {
    // ปิด console.error/window error ชั่วคราว (React re-throw ทำให้ jsdom log "Uncaught" เพิ่ม)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onWindowError = (event: ErrorEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('error', onWindowError);
    function Bad(): ReactElement {
      useToast();
      return <div />;
    }
    expect(() => render(<Bad />)).toThrow('useToast ต้องถูกเรียกภายใน <ToastProvider>');
    window.removeEventListener('error', onWindowError);
    consoleSpy.mockRestore();
  });

  it('push แสดง toast และมี aria-live=polite ครอบ', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PushButton title="บันทึกสำเร็จ" />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'แจ้งเตือน' }));
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('บันทึกสำเร็จ');
    expect(toast.closest('[aria-live="polite"]')).not.toBeNull();
  });

  describe('auto-dismiss', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('หายเองหลังครบเวลา', () => {
      render(
        <ToastProvider>
          <PushButton title="งบใกล้หมด" durationMs={1000} />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'แจ้งเตือน' }));
      expect(screen.getByRole('status')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('durationMs=0 ไม่หายเอง จนกว่าจะกดปิด', () => {
      render(
        <ToastProvider>
          <PushButton title="key ใช้ไม่ได้" durationMs={0} />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'แจ้งเตือน' }));
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByRole('status')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'ปิดข้อความแจ้งเตือน' }));
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });
});
