import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCountUp } from './useCountUp';

describe('useCountUp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mount ครั้งแรกไม่ animate — แสดงค่าเป้าหมายทันที', () => {
    const { result } = renderHook(() => useCountUp(1000, 200, false));
    expect(result.current).toBe(1000);
  });

  it('reduced-motion: เปลี่ยนค่าทันทีโดยไม่ผ่านเฟรมกลาง', () => {
    const { result, rerender } = renderHook(({ target }) => useCountUp(target, 200, true), {
      initialProps: { target: 100 },
    });
    expect(result.current).toBe(100);

    rerender({ target: 900 });
    // ไม่ต้อง advance timer เลย — ต้องเห็นค่าปลายทางทันที
    expect(result.current).toBe(900);
  });

  it('ค่าไม่เปลี่ยน → ไม่เข้ารอบ animate (ยังเป็นค่าเดิม)', () => {
    const { result, rerender } = renderHook(({ target }) => useCountUp(target, 200, false), {
      initialProps: { target: 100 },
    });
    rerender({ target: 100 });
    expect(result.current).toBe(100);
  });

  it('ไม่ reduced-motion: ไล่ค่าเป็นเฟรม ๆ ด้วย rAF แล้วจบที่ค่าเป้าหมายเป๊ะเสมอ', () => {
    const { result, rerender } = renderHook(({ target }) => useCountUp(target, 100, false), {
      initialProps: { target: 0 },
    });
    expect(result.current).toBe(0);

    rerender({ target: 1000 });
    // กลางทาง: ค่าต้องอยู่ระหว่าง 0 กับ 1000 (ยังไม่ครบเวลา)
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(1000);

    // ครบเวลา (เผื่อเฟรมสุดท้าย) → ต้องจบที่ค่าเป้าหมายเป๊ะ ไม่ค้างเป็นทศนิยม
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(1000);
  });

  it('ปรับ maxDurationMs เพื่อจำกัดเพดานระยะเวลาได้ (ไม่พึ่ง DEFAULT_MAX_COUNT_UP_MS เดียว)', () => {
    const { result, rerender } = renderHook(({ target }) => useCountUp(target, 5000, false, 50), {
      initialProps: { target: 0 },
    });
    rerender({ target: 100 });
    act(() => {
      // เผื่อคลาดเคลื่อนของ rAF ปลอม vs performance.now() จริง — เวลาผ่านไปเกิน maxDurationMs (50ms) มาก ๆ
      // ต้องจบที่ค่าเป้าหมายเป๊ะเสมอ (ไม่ใช่ duration เดิม 5000ms ที่ส่งมา)
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe(100);
  });
});
