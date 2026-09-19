import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyButton } from '@/components/ui/CopyButton';

describe('CopyButton', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('เรียก navigator.clipboard.writeText ด้วยค่าที่กำหนด', async () => {
    render(<CopyButton value="https://shopee.co.th/x">คัดลอกลิงก์</CopyButton>);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'คัดลอกลิงก์' }));
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith('https://shopee.co.th/x');
  });

  it('แสดง ✓ ค้าง 1.5 วินาทีแล้วกลับข้อความเดิม', async () => {
    render(<CopyButton value="x">คัดลอก</CopyButton>);
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
      await Promise.resolve();
    });
    expect(screen.getByText('คัดลอกแล้ว')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByText('คัดลอก')).toBeInTheDocument();
  });

  it('copiedLabel override ได้', async () => {
    render(
      <CopyButton value="x" copiedLabel="คัดลอก URL แล้ว">
        คัดลอก URL
      </CopyButton>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
      await Promise.resolve();
    });
    expect(screen.getByText('คัดลอก URL แล้ว')).toBeInTheDocument();
  });
});
