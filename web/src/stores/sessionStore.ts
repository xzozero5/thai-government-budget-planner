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
import type { VerifyKeyErrorKind, VerifyKeyResult } from '@/ai/client';
import { DEFAULT_EFFORT, DEFAULT_MODEL_ID, type EffortLevel, type ModelId } from '@/ai/models';
import type { ChatMode } from '@/ai/systemPrompt';
import * as keyHolder from '@/ai/session/keyHolder';
import { redactSecrets } from '@/ai/session/redactSecrets';

export type KeyStatus = 'idle' | 'verifying' | 'valid' | 'error';
export type ThemePreference = 'light' | 'dark';

/**
 * งานลดขนาด entry chunk (20 ก.ย. 2569, งานเร่ง): เดิม import `DEFAULT_MAX_COST_USD_PER_TURN`/
 * `DEFAULT_MAX_COST_USD_PER_SESSION` แบบ static จาก `@/ai/agent` — ไฟล์นั้นลาก `ai/tools/**` (ทุก tool +
 * zod schema, รวม DuckDB/MiniSearch repo ที่ tools อ้างถึง type) เข้ามาด้วยทั้งที่ store นี้ใช้แค่ตัวเลข
 * 2 ตัว และ store นี้ต้องพร้อมใช้ตั้งแต่ KeyGate (route "/") ก่อนผู้ใช้กด "ทดสอบและเริ่ม" ด้วยซ้ำ — คัดลอก
 * ค่ามาเป็น local constant แทน (ห้าม import `@/ai/agent` แบบ static จากไฟล์นี้อีก) ค่าต้องตรงกับ
 * `ai/agent.ts` เสมอ — มี `sessionStore.test.ts` (`dynamic import('@/ai/agent')` เทียบค่า, test-only จึงไม่
 * กระทบ production bundle) กันไม่ให้ค่าสองที่ไหลออกจากกัน
 */
const DEFAULT_MAX_COST_USD_PER_TURN = 0.5;
const DEFAULT_MAX_COST_USD_PER_SESSION = 3.0;

/** ค่าเริ่มต้นตามระบบของผู้ใช้ (06 §2: `prefers-color-scheme` + toggle) — ไม่อ่าน/เขียน storage ใด ๆ (N2) */
function initialTheme(): ThemePreference {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

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

  /** US-1.1 (T-410 ข้อ 2) — เคยแตะ 80% ของ `maxCostUsdPerSession` แล้วหรือยัง (กันเตือนซ้ำ) รีเซ็ตเมื่อ
   * ผู้ใช้เพิ่มเพดาน หรือ key ถูกล้าง (ไม่ว่าเหตุผลใด) */
  budgetWarningShown: boolean;
  /** timestamp (`Date.now()`) ของครั้งล่าสุดที่ระบบเพิ่ง trigger คำเตือน 80% — `null` เมื่อยังไม่เคย/ถูก
   * รีเซ็ต — UI (toast ใน `features/workspace`) subscribe ค่านี้เพื่อรู้ว่า "มีเหตุการณ์ใหม่เกิดขึ้น" ได้
   * (เทียบว่าเปลี่ยนจาก `null`/ค่าก่อนหน้าหรือไม่ — ตัว toast จริงไม่ได้ทำในไฟล์นี้) */
  budgetWarningAt: number | null;

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
  /** เพิ่มเพดาน session → รีเซ็ต flag เตือน 80% (US-1.1: ผู้ใช้ "ต่อ" งบแล้วไม่ควรถูกเตือนซ้ำทันที) */
  setMaxCostUsdPerSession: (usd: number) => void;
  setSpentUsd: (usd: number) => void;
  setTheme: (theme: ThemePreference) => void;

  /** เรียกโดย `ai/session/chatController.ts` ครั้งแรกที่ `spentUsd` ข้าม 80% ของ `maxCostUsdPerSession`
   * — idempotent (เรียกซ้ำแล้วไม่ทับ `budgetWarningAt` เดิม) เพื่อให้ "ครั้งแรก" มีความหมายจริง */
  markBudgetWarningShown: () => void;
  /** ล้าง flag/timestamp คำเตือน 80% — เรียกตอนผู้ใช้เพิ่มเพดาน หรือ key ถูกล้าง */
  resetBudgetWarning: () => void;
}

let submitGeneration = 0;
const SUPERSEDED_MESSAGE_TH = 'การตรวจสอบ key ถูกยกเลิกเพราะมีการล้าง key ระหว่างทาง';

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
  theme: initialTheme(),
  budgetWarningShown: false,
  budgetWarningAt: null,

  async submitKey(apiKey) {
    set({ keyStatus: 'verifying', keyErrorKind: null, keyErrorMessage: null });
    // งานลดขนาด entry chunk: โหลด `@anthropic-ai/sdk` (ผ่าน `ai/client.ts`) เฉพาะตอนผู้ใช้กด "ทดสอบและ
    // เริ่ม" จริง ๆ — `client` ที่ได้ถูกส่งเข้า `keyHolder.setKey` ทันทีให้เก็บใน module scope ของ
    // keyHolder เท่านั้น (N2/H1 เดิม) ตัวแปรนี้เป็นแค่ reference ชั่วคราวสำหรับเรียก `verifyKey` ต่อในรอบ
    // เดียวกัน ไม่ถูกเก็บไว้ที่อื่น
    // T-602 NEW-L1: (ก) `clearKey()`/pagehide ที่เกิดระหว่างรอ dynamic import/verify ต้อง "ชนะ" — ห้ามให้ key ที่
    // ผู้ใช้เพิ่งสั่งล้างกลับมาถูกตั้งอีกครั้ง → จับ generation ไว้แล้วเช็คก่อน setKey/ก่อนประกาศ valid
    // (ข) import ล้ม (chunk 404 หลัง deploy ใหม่) ต้องคืน error ให้ผู้ใช้เห็น ไม่ค้างที่ 'verifying'
    submitGeneration += 1;
    const generation = submitGeneration;
    const superseded = (): boolean => generation !== submitGeneration;
    const fail = (kind: VerifyKeyErrorKind, messageTh: string): VerifyKeyResult => {
      keyHolder.clearKey('manual');
      set({
        hasKey: false,
        keyStatus: 'error',
        keyErrorKind: kind,
        keyErrorMessage: redactSecrets(messageTh),
      });
      return { ok: false, kind, messageTh };
    };
    try {
      const { createClient, verifyKey } = await import('@/ai/client');
      if (superseded()) {
        return { ok: false, kind: 'unknown', messageTh: SUPERSEDED_MESSAGE_TH };
      }
      const client = createClient(apiKey);
      keyHolder.setKey(client);
      const result = await verifyKey(client, get().model);
      if (superseded()) {
        return { ok: false, kind: 'unknown', messageTh: SUPERSEDED_MESSAGE_TH };
      }
      if (result.ok) {
        set({ hasKey: true, keyStatus: 'valid', keyErrorKind: null, keyErrorMessage: null });
        return result;
      }
      return fail(result.kind, result.messageTh);
    } catch (err) {
      if (superseded()) {
        return { ok: false, kind: 'unknown', messageTh: SUPERSEDED_MESSAGE_TH };
      }
      return fail('network', err instanceof Error ? err.message : String(err));
    }
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
    const increased = usd > get().maxCostUsdPerSession;
    set({
      maxCostUsdPerSession: usd,
      ...(increased ? { budgetWarningShown: false, budgetWarningAt: null } : {}),
    });
  },
  setSpentUsd(usd) {
    set({ spentUsd: usd });
  },
  setTheme(theme) {
    set({ theme });
  },

  markBudgetWarningShown() {
    if (get().budgetWarningShown) {
      return;
    }
    set({ budgetWarningShown: true, budgetWarningAt: Date.now() });
  },
  resetBudgetWarning() {
    set({ budgetWarningShown: false, budgetWarningAt: null });
  },
}));

// เมื่อ `keyHolder` ล้าง client เอง (idle 60 นาที/pagehide/budget เกิน) ต้องสะท้อนกลับมาที่ store เสมอ
// (ผู้เรียก UI ไม่ควร import `ai/session/keyHolder` ตรง ๆ — อ่านผ่าน `useSessionStore` เท่านั้น)
keyHolder.onClear(() => {
  // การล้าง key ทุกกรณีทำให้ submitKey ที่ค้างอยู่ (รอ import/verify) หมดสิทธิ์ตั้ง key กลับ — NEW-L1
  submitGeneration += 1;
  useSessionStore.setState({
    hasKey: false,
    keyStatus: 'idle',
    keyErrorKind: null,
    keyErrorMessage: null,
    // US-1.1 (T-410 ข้อ 2): key ถูกล้างไม่ว่าเหตุผลใด (manual/idle/pagehide/budget_exceeded) ถือเป็นจบ
    // session เชิงแนวคิด — เตือนใหม่ได้เมื่อเริ่มใช้งานอีกครั้ง
    budgetWarningShown: false,
    budgetWarningAt: null,
  });
});
