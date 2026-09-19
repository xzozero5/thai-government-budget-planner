/**
 * T-403 — `sessionStore`: การตั้งค่า session ของ tab นี้ (04 §D7 slice `session`)
 *
 * T-307 (H1) / N2: store นี้เก็บได้แค่ `hasKey: boolean` + สถานะ/ตัวเลขล้วน ๆ **ห้ามเก็บ instance
 * `Anthropic` หรืออะไรที่อ้างถึง apiKey เด็ดขาด** — instance จริงอยู่ใน
 * `ai/session/keyHolder.ts` (module scope) เท่านั้น ไฟล์นี้เรียกผ่าน `keyHolder.setKey`/`clearKey`/
 * `onClear` ที่ export เป็นฟังก์ชันล้วน ๆ (ไม่คืน object ที่พก client ออกมาเก็บไว้ที่นี่)
 *
 * ไม่มี `persist`/`devtools` middleware ใด ๆ (09 §1) — ทุกอย่างหายเมื่อปิด/รีเฟรชแท็บ
 */
import { create } from 'zustand';
import { verifyKey, type VerifyKeyErrorKind, type VerifyKeyResult } from '@/ai/client';
import { DEFAULT_MAX_COST_USD_PER_SESSION, DEFAULT_MAX_COST_USD_PER_TURN } from '@/ai/agent';
import { DEFAULT_EFFORT, DEFAULT_MODEL_ID, type EffortLevel, type ModelId } from '@/ai/models';
import type { ChatMode } from '@/ai/systemPrompt';
import * as keyHolder from '@/ai/session/keyHolder';
import { redactSecrets } from '@/ai/session/redactSecrets';

export type KeyStatus = 'idle' | 'verifying' | 'valid' | 'error';
export type ThemePreference = 'light' | 'dark';

export interface SessionStoreState {
  hasKey: boolean;
  keyStatus: KeyStatus;
  keyErrorKind: VerifyKeyErrorKind | null;
  /** ข้อความ error ภาษาไทยที่ผ่าน `redactSecrets` แล้วเสมอก่อนเก็บ (T-307 §9 ข้อ 7) */
  keyErrorMessage: string | null;

  model: ModelId;
  effort: EffortLevel;
  mode: ChatMode;
  enableWebSearch: boolean;
  maxCostUsdPerTurn: number;
  maxCostUsdPerSession: number;
  spentUsd: number;
  theme: ThemePreference;

  /** ใส่ key ใหม่: สร้าง client ใน `keyHolder` แล้วทดสอบด้วย `verifyKey` — สำเร็จ → `hasKey=true`;
   * ล้มเหลว → ล้าง client ทิ้งทันทีและเก็บ error ที่ redact แล้ว คืนผลลัพธ์ให้ผู้เรียก (UI) ใช้แสดงผลต่อ */
  submitKey: (apiKey: string) => Promise<VerifyKeyResult>;
  /** ล้าง key ปัจจุบัน (ปุ่ม "ล้าง key และออก" หรือเหตุผลอื่น) — `keyHolder.clearKey` จะแจ้งกลับมาที่
   * `onClear` listener ด้านล่างเพื่ออัปเดต `hasKey`/`keyStatus` เอง ไม่ต้อง set ซ้ำที่นี่ */
  clearKey: (reason?: keyHolder.ClearKeyReason) => void;

  setModel: (model: ModelId) => void;
  setEffort: (effort: EffortLevel) => void;
  setMode: (mode: ChatMode) => void;
  setEnableWebSearch: (enabled: boolean) => void;
  setMaxCostUsdPerTurn: (usd: number) => void;
  setMaxCostUsdPerSession: (usd: number) => void;
  setSpentUsd: (usd: number) => void;
  setTheme: (theme: ThemePreference) => void;
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  hasKey: keyHolder.hasKey(),
  keyStatus: 'idle',
  keyErrorKind: null,
  keyErrorMessage: null,

  model: DEFAULT_MODEL_ID,
  effort: DEFAULT_EFFORT,
  mode: 'draft',
  enableWebSearch: true,
  maxCostUsdPerTurn: DEFAULT_MAX_COST_USD_PER_TURN,
  maxCostUsdPerSession: DEFAULT_MAX_COST_USD_PER_SESSION,
  spentUsd: 0,
  theme: 'light',

  async submitKey(apiKey) {
    set({ keyStatus: 'verifying', keyErrorKind: null, keyErrorMessage: null });
    const client = keyHolder.setKey(apiKey);
    const result = await verifyKey(client, get().model);
    if (result.ok) {
      set({ hasKey: true, keyStatus: 'valid', keyErrorKind: null, keyErrorMessage: null });
    } else {
      keyHolder.clearKey('manual');
      set({
        hasKey: false,
        keyStatus: 'error',
        keyErrorKind: result.kind,
        keyErrorMessage: redactSecrets(result.messageTh),
      });
    }
    return result;
  },

  clearKey(reason = 'manual') {
    keyHolder.clearKey(reason);
  },

  setModel(model) {
    set({ model });
  },
  setEffort(effort) {
    set({ effort });
  },
  setMode(mode) {
    set({ mode });
  },
  setEnableWebSearch(enabled) {
    set({ enableWebSearch: enabled });
  },
  setMaxCostUsdPerTurn(usd) {
    set({ maxCostUsdPerTurn: usd });
  },
  setMaxCostUsdPerSession(usd) {
    set({ maxCostUsdPerSession: usd });
  },
  setSpentUsd(usd) {
    set({ spentUsd: usd });
  },
  setTheme(theme) {
    set({ theme });
  },
}));

// เมื่อ `keyHolder` ล้าง client เอง (idle 60 นาที/pagehide/budget เกิน) ต้องสะท้อนกลับมาที่ store เสมอ
// (ผู้เรียก UI ไม่ควร import `ai/session/keyHolder` ตรง ๆ — อ่านผ่าน `useSessionStore` เท่านั้น)
keyHolder.onClear(() => {
  useSessionStore.setState({
    hasKey: false,
    keyStatus: 'idle',
    keyErrorKind: null,
    keyErrorMessage: null,
  });
});
