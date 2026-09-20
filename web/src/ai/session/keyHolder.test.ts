import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../client';
import * as keyHolder from './keyHolder';

const FAKE_KEY = 'fake-key-for-unit-test';

/**
 * งานลดขนาด entry chunk (20 ก.ย. 2569): `keyHolder.setKey` เปลี่ยนสัญญาจากรับ `apiKey: string` (สร้าง
 * client เอง) เป็นรับ `Anthropic` instance ที่ผู้เรียกสร้างไว้แล้ว (ผู้เรียกจริงคือ `sessionStore.submitKey`
 * ที่ dynamic-import `ai/client.ts`) — helper นี้จำลองสิ่งที่ผู้เรียกทำก่อนหน้า `setKey`
 */
function setKeyFromApiKey(apiKey: string): Anthropic {
  return keyHolder.setKey(createClient(apiKey));
}

afterEach(() => {
  keyHolder.__resetForTests();
  vi.useRealTimers();
});

describe('keyHolder — module scope เท่านั้น (T-307 H1 / N2)', () => {
  it('setKey เก็บ Anthropic client ที่ได้รับมาไว้ใน closure — getClient คืน instance เดิม', () => {
    const client = setKeyFromApiKey(FAKE_KEY);
    expect(client).toBeInstanceOf(Anthropic);
    expect(keyHolder.getClient()).toBe(client);
    expect(keyHolder.hasKey()).toBe(true);
  });

  it('clearKey ล้าง client และแจ้ง listener ด้วยเหตุผลที่ระบุ', () => {
    setKeyFromApiKey(FAKE_KEY);
    const reasons: keyHolder.ClearKeyReason[] = [];
    keyHolder.onClear((reason) => reasons.push(reason));

    keyHolder.clearKey('manual');

    expect(keyHolder.getClient()).toBeNull();
    expect(keyHolder.hasKey()).toBe(false);
    expect(reasons).toEqual(['manual']);
  });

  it('clearKey abort ทุก AbortController ที่ลงทะเบียนไว้', () => {
    setKeyFromApiKey(FAKE_KEY);
    const ac1 = new AbortController();
    const ac2 = new AbortController();
    keyHolder.registerAbortController(ac1);
    keyHolder.registerAbortController(ac2);

    keyHolder.clearKey('manual');

    expect(ac1.signal.aborted).toBe(true);
    expect(ac2.signal.aborted).toBe(true);
  });

  it('unregister (คืนค่าจาก registerAbortController) กันไม่ให้ controller ที่งานเสร็จแล้วถูก abort ซ้ำ', () => {
    setKeyFromApiKey(FAKE_KEY);
    const ac = new AbortController();
    const unregister = keyHolder.registerAbortController(ac);
    unregister();

    keyHolder.clearKey('manual');

    expect(ac.signal.aborted).toBe(false);
  });

  it('idle เกิน 60 นาทีโดยไม่มีกิจกรรม → clearKey อัตโนมัติด้วยเหตุผล idle', () => {
    vi.useFakeTimers();
    setKeyFromApiKey(FAKE_KEY);
    const reasons: keyHolder.ClearKeyReason[] = [];
    keyHolder.onClear((reason) => reasons.push(reason));

    vi.advanceTimersByTime(keyHolder.IDLE_TIMEOUT_MS - 1);
    expect(keyHolder.hasKey()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(keyHolder.hasKey()).toBe(false);
    expect(reasons).toEqual(['idle']);
  });

  it('touchActivity รีเซ็ต idle timer — กิจกรรมต่อเนื่องกันไม่ให้ถูกล้าง', () => {
    vi.useFakeTimers();
    setKeyFromApiKey(FAKE_KEY);

    // จำลองกิจกรรมทุก ๆ 50 นาที เป็นเวลา 3 รอบ (รวม 150 นาที > เพดาน 60 นาทีถ้าไม่รีเซ็ต)
    vi.advanceTimersByTime(50 * 60 * 1000);
    keyHolder.touchActivity();
    vi.advanceTimersByTime(50 * 60 * 1000);
    keyHolder.touchActivity();
    vi.advanceTimersByTime(50 * 60 * 1000);

    expect(keyHolder.hasKey()).toBe(true);
  });

  it('touchActivity ไม่เริ่มนับถอยหลังถ้ายังไม่มี key', () => {
    vi.useFakeTimers();
    keyHolder.touchActivity();
    vi.advanceTimersByTime(keyHolder.IDLE_TIMEOUT_MS + 1);
    expect(keyHolder.hasKey()).toBe(false);
  });

  it('pagehide → clearKey อัตโนมัติด้วยเหตุผล pagehide', () => {
    setKeyFromApiKey(FAKE_KEY);
    const reasons: keyHolder.ClearKeyReason[] = [];
    keyHolder.onClear((reason) => reasons.push(reason));

    window.dispatchEvent(new Event('pagehide'));

    expect(keyHolder.hasKey()).toBe(false);
    expect(reasons).toEqual(['pagehide']);
  });

  it('onClear คืนฟังก์ชัน unsubscribe ที่ใช้งานได้จริง', () => {
    setKeyFromApiKey(FAKE_KEY);
    const reasons: keyHolder.ClearKeyReason[] = [];
    const unsubscribe = keyHolder.onClear((reason) => reasons.push(reason));
    unsubscribe();

    keyHolder.clearKey('manual');

    expect(reasons).toEqual([]);
  });
});

describe('keyHolder — ไม่มีการเรียก Storage API ใด ๆ ตลอด lifecycle', () => {
  it('setKey → clearKey ไม่แตะ localStorage/sessionStorage', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');

    setKeyFromApiKey(FAKE_KEY);
    keyHolder.clearKey('manual');

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
  });
});
