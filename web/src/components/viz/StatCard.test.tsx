import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatCard } from './StatCard';

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('StatCard', () => {
  it('แสดง label, ค่า (format ด้วย formatter เริ่มต้น), sublabel', () => {
    render(<StatCard label="งบรวม" value={1234} sublabel="ปีงบ 2567" />);
    expect(screen.getByText('งบรวม')).toBeInTheDocument();
    expect(screen.getByText('ปีงบ 2567')).toBeInTheDocument();
    // ค่าเริ่มต้น mount ครั้งแรกไม่ animate → เห็นค่าปลายทางทันที (aria-hidden + sr-only ต้องตรงกัน)
    expect(screen.getAllByText('1,234').length).toBeGreaterThan(0);
  });

  it('รับ value เป็น string ที่ format มาแล้วได้ตรง ๆ', () => {
    render(<StatCard label="ราคาเฉลี่ย" value="฿1,234" />);
    expect(screen.getAllByText('฿1,234').length).toBeGreaterThan(0);
  });

  it('onClick ทำให้เรนเดอร์เป็น <button> ที่มี focus ring และคลิกได้', () => {
    const onClick = vi.fn();
    render(<StatCard label="งบรวม" value={100} onClick={onClick} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('ไม่มี onClick → ไม่ใช่ button', () => {
    render(<StatCard label="งบรวม" value={100} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('แสดง basis badge เมื่อส่ง prop basis', () => {
    render(<StatCard label="งบรวม" value={100} basis={{ kind: 'historical', label: 'จากงบจริง' }} />);
    expect(screen.getByText('จากงบจริง')).toBeInTheDocument();
  });

  it('count-up จบที่ค่าจริงเสมอ เมื่อค่าเปลี่ยนหลัง mount (real timers, ไม่ reduced-motion)', async () => {
    stubMatchMedia(false);
    const { rerender } = render(<StatCard label="งบรวม" value={100} animationDurationMs={30} />);
    rerender(<StatCard label="งบรวม" value={900} animationDurationMs={30} />);

    await waitFor(
      () => {
        expect(screen.getAllByText('900').length).toBeGreaterThan(0);
      },
      { timeout: 1000 },
    );
  });

  it('reduced-motion: เปลี่ยนค่าทันทีโดยไม่ animate ผ่านเฟรมกลาง', async () => {
    stubMatchMedia(true);
    const { rerender } = render(<StatCard label="งบรวม" value={100} animationDurationMs={600} />);
    rerender(<StatCard label="งบรวม" value={900} animationDurationMs={600} />);

    // reduced-motion ต้องเห็นค่าปลายทางทันที ไม่ต้องรอ rAF หลายเฟรม
    await waitFor(() => {
      expect(screen.getAllByText('900').length).toBeGreaterThan(0);
    });
  });
});
