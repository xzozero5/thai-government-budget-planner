import { afterEach, describe, expect, it, vi } from 'vitest';
import * as keyHolder from '@/ai/session/keyHolder';

const verifyKeyMock = vi.fn();

vi.mock('@/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ai/client')>();
  return {
    ...actual,
    // mock เฉพาะ verifyKey (ห้ามเรียก Anthropic API จริงในเทสต์ — createClient ของจริงไม่แตะ network)
    verifyKey: (...args: Parameters<typeof actual.verifyKey>) =>
      verifyKeyMock(...args) as ReturnType<typeof actual.verifyKey>,
  };
});

const FAKE_KEY = 'fake-key-for-unit-test';

afterEach(() => {
  // หมายเหตุ: ใช้ `clearKey` (ไม่ใช่ `__resetForTests`) เพราะ `sessionStore.ts` เป็นโมดูล singleton ที่
  // ลงทะเบียน `keyHolder.onClear(...)` แค่ครั้งเดียวตอน import ครั้งแรก — `__resetForTests()` จะล้าง
  // listener นั้นทิ้งไปด้วยและไม่มีทางลงทะเบียนใหม่ได้อีก (โมดูลถูก cache แล้ว) ทำให้เทสต์ถัดไปที่พึ่งพา
  // การ sync อัตโนมัติจาก keyHolder → store พังทั้งไฟล์
  keyHolder.clearKey('manual');
  verifyKeyMock.mockReset();
});

describe('sessionStore', () => {
  it('ค่าเริ่มต้นตรงตาม 04 §D7 (hasKey=false, model/effort/mode/budget default)', async () => {
    const { useSessionStore } = await import('./sessionStore');
    const state = useSessionStore.getState();
    expect(state.hasKey).toBe(false);
    expect(state.keyStatus).toBe('idle');
    expect(state.model).toBe('claude-sonnet-5');
    expect(state.mode).toBe('draft');
    expect(state.enableWebSearch).toBe(true);
    expect(state.maxCostUsdPerTurn).toBeCloseTo(0.5);
    expect(state.maxCostUsdPerSession).toBeCloseTo(3.0);
    expect(state.spentUsd).toBe(0);
  });

  it('submitKey สำเร็จ → hasKey=true, keyStatus=valid, ไม่มี error', async () => {
    verifyKeyMock.mockResolvedValue({ ok: true });
    const { useSessionStore } = await import('./sessionStore');

    const result = await useSessionStore.getState().submitKey(FAKE_KEY);

    expect(result).toEqual({ ok: true });
    expect(useSessionStore.getState().hasKey).toBe(true);
    expect(useSessionStore.getState().keyStatus).toBe('valid');
    expect(keyHolder.hasKey()).toBe(true);
  });

  it('submitKey ล้มเหลว → hasKey=false, keyStatus=error, เก็บ kind/message ที่ redact แล้ว, keyHolder ว่าง', async () => {
    verifyKeyMock.mockResolvedValue({
      ok: false,
      kind: 'auth',
      messageTh: 'API key ไม่ถูกต้องหรือถูกเพิกถอน กรุณาตรวจสอบแล้วลองใหม่อีกครั้ง',
    });
    const { useSessionStore } = await import('./sessionStore');

    const result = await useSessionStore.getState().submitKey(FAKE_KEY);

    expect(result.ok).toBe(false);
    expect(useSessionStore.getState().hasKey).toBe(false);
    expect(useSessionStore.getState().keyStatus).toBe('error');
    expect(useSessionStore.getState().keyErrorKind).toBe('auth');
    expect(useSessionStore.getState().keyErrorMessage).toContain('API key ไม่ถูกต้อง');
    expect(keyHolder.hasKey()).toBe(false);
    expect(keyHolder.getClient()).toBeNull();
  });

  it('clearKey เรียก keyHolder.clearKey แล้ว state สะท้อนกลับผ่าน onClear listener', async () => {
    verifyKeyMock.mockResolvedValue({ ok: true });
    const { useSessionStore } = await import('./sessionStore');
    await useSessionStore.getState().submitKey(FAKE_KEY);
    expect(useSessionStore.getState().hasKey).toBe(true);

    useSessionStore.getState().clearKey('manual');

    expect(useSessionStore.getState().hasKey).toBe(false);
    expect(useSessionStore.getState().keyStatus).toBe('idle');
    expect(keyHolder.getClient()).toBeNull();
  });

  it('keyHolder ล้าง key เอง (เช่น idle/pagehide) → store สะท้อนตามโดยไม่ต้องเรียก action ใด ๆ', async () => {
    verifyKeyMock.mockResolvedValue({ ok: true });
    const { useSessionStore } = await import('./sessionStore');
    await useSessionStore.getState().submitKey(FAKE_KEY);

    keyHolder.clearKey('idle');

    expect(useSessionStore.getState().hasKey).toBe(false);
    expect(useSessionStore.getState().keyStatus).toBe('idle');
  });

  it('setter ทั้งหมดอัปเดต field ที่เกี่ยวข้องเท่านั้น', async () => {
    const { useSessionStore } = await import('./sessionStore');
    useSessionStore.getState().setModel('claude-opus-5');
    useSessionStore.getState().setEffort('high');
    useSessionStore.getState().setMode('audit');
    useSessionStore.getState().setEnableWebSearch(false);
    useSessionStore.getState().setMaxCostUsdPerTurn(1.5);
    useSessionStore.getState().setMaxCostUsdPerSession(9);
    useSessionStore.getState().setSpentUsd(0.42);
    useSessionStore.getState().setTheme('dark');

    const state = useSessionStore.getState();
    expect(state.model).toBe('claude-opus-5');
    expect(state.effort).toBe('high');
    expect(state.mode).toBe('audit');
    expect(state.enableWebSearch).toBe(false);
    expect(state.maxCostUsdPerTurn).toBe(1.5);
    expect(state.maxCostUsdPerSession).toBe(9);
    expect(state.spentUsd).toBe(0.42);
    expect(state.theme).toBe('dark');
  });

  it('N2: JSON.stringify ของ state ทุกครั้งไม่มี field ที่เป็น client/apiKey (หลัง setKey)', async () => {
    verifyKeyMock.mockResolvedValue({ ok: true });
    const { useSessionStore } = await import('./sessionStore');
    await useSessionStore.getState().submitKey(FAKE_KEY);

    const serialized = JSON.stringify(useSessionStore.getState());
    expect(serialized).not.toContain(FAKE_KEY);
    expect(serialized).not.toMatch(/"apiKey"|"_options"|"client"/);
  });
});

describe('sessionStore — ไม่มีการเรียก Storage API ตลอด flow ตั้ง key', () => {
  it('submitKey (สำเร็จและล้มเหลว) ไม่แตะ localStorage/sessionStorage', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');

    verifyKeyMock.mockResolvedValueOnce({ ok: true });
    const { useSessionStore } = await import('./sessionStore');
    await useSessionStore.getState().submitKey(FAKE_KEY);

    verifyKeyMock.mockResolvedValueOnce({ ok: false, kind: 'auth', messageTh: 'ผิดพลาด' });
    await useSessionStore.getState().submitKey(FAKE_KEY);

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
  });
});
