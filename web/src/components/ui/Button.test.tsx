import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/Button';

describe('Button', () => {
  it('render children และเรียก onClick เมื่อกด', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>บันทึก</Button>);
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disabled ป้องกันการคลิก', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        บันทึก
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('status=loading แสดง spinner, aria-busy และปิดปุ่ม', () => {
    render(<Button status="loading">ส่ง</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status', { name: 'กำลังโหลด' })).toBeInTheDocument();
  });

  it('loadingLabel override ได้', () => {
    render(
      <Button status="loading" loadingLabel="กำลังส่งออก PDF">
        ส่งออก
      </Button>,
    );
    expect(screen.getByRole('status', { name: 'กำลังส่งออก PDF' })).toBeInTheDocument();
  });

  describe('status=success', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('แสดงเครื่องหมายถูกและเรียก onStatusTimeout หลัง 1.5 วินาที', () => {
      const onStatusTimeout = vi.fn();
      render(
        <Button status="success" onStatusTimeout={onStatusTimeout}>
          บันทึก
        </Button>,
      );
      expect(screen.getByRole('status')).toHaveTextContent('สำเร็จ');
      expect(onStatusTimeout).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1500);
      expect(onStatusTimeout).toHaveBeenCalledTimes(1);
    });

    it('successDurationMs ปรับเวลาได้', () => {
      const onStatusTimeout = vi.fn();
      render(
        <Button status="success" successDurationMs={500} onStatusTimeout={onStatusTimeout}>
          บันทึก
        </Button>,
      );
      vi.advanceTimersByTime(499);
      expect(onStatusTimeout).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onStatusTimeout).toHaveBeenCalledTimes(1);
    });
  });

  it('variant/size ใส่ class จาก theme เท่านั้น (ไม่มี hex ตรง ๆ)', () => {
    render(
      <Button variant="danger" size="sm">
        ลบ
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'ลบ' });
    expect(button.className).toContain('bg-danger');
    expect(button.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
