import { afterEach, describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, prefetchWhenIdle } from './chunkLoad';

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://x.github.io/app/assets/index-C8wFBVW8.js',
    'error loading dynamically imported module: https://x/assets/a.js',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/a.css',
  ])('จับข้อความของเบราว์เซอร์: %s', (message) => {
    expect(isChunkLoadError(message)).toBe(true);
  });

  it('error ทั่วไปไม่ถูกนับ', () => {
    expect(isChunkLoadError('Cannot read properties of undefined')).toBe(false);
    expect(isChunkLoadError('Failed to fetch')).toBe(false);
  });
});

describe('prefetchWhenIdle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('เรียก loader ทุกตัวเมื่อว่าง และไม่ throw แม้ loader ล้ม', async () => {
    vi.useFakeTimers();
    const ok = vi.fn().mockResolvedValue(undefined);
    const bad = vi.fn().mockRejectedValue(new Error('offline'));
    prefetchWhenIdle([ok, bad]);
    await vi.runAllTimersAsync();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it('ยกเลิกก่อนถึงคิว → ไม่เรียก loader', async () => {
    vi.useFakeTimers();
    const loader = vi.fn().mockResolvedValue(undefined);
    const cancel = prefetchWhenIdle([loader]);
    cancel();
    await vi.runAllTimersAsync();
    expect(loader).not.toHaveBeenCalled();
  });
});
