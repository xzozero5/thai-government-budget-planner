/**
 * T-403 — ที่เก็บ instance `Anthropic` เดียวของ tab (module scope เท่านั้น)
 *
 * T-307 (security review H1) / N2 (CLAUDE.md §2): instance ของ `Anthropic` มี `apiKey` เป็น own
 * enumerable property (`client.ts`) — **ห้ามเก็บ client หรือค่าที่อ้างถึงมันใน Zustand store, React
 * state, หรืออะไรที่ serialize/persist/devtools ได้** ไฟล์นี้เป็นที่เดียวที่ถือ instance จริง (closure/
 * module scope) — ผู้เรียก (`stores/sessionStore.ts`, `ai/session/chatController.ts`) เห็นได้แค่
 * `hasKey()`/`getClient()` (คืน reference ให้ใช้เรียก SDK เท่านั้น ห้ามเก็บ reference นั้นไว้ที่อื่นนอกจาก
 * closure ชั่วคราวของ 1 การเรียก `runAgentTurn`)
 *
 * ล้าง key เมื่อ: ผู้ใช้กดออก (`clearKey('manual')`), idle เกิน `IDLE_TIMEOUT_MS` (09 §1: 60 นาที),
 * `pagehide` (listener ผูกตอน import โมดูลนี้), หรือ budget เกินและผู้ใช้ไม่ต่อ (ผู้เรียกเป็นคนตัดสินใจ
 * เรียก `clearKey('budget_exceeded')`) — ทุกกรณี abort งานที่ค้างทั้งหมดที่ลงทะเบียนไว้ผ่าน
 * `registerAbortController` ด้วย
 *
 * ห้าม import React/DOM API อื่นนอกจาก `window`/`AbortController`/`setTimeout` มาตรฐาน (module
 * boundary — docs/04-ARCHITECTURE.md §3)
 *
 * งานลดขนาด entry chunk (20 ก.ย. 2569, งานเร่ง): เดิมไฟล์นี้ `import Anthropic from '@anthropic-ai/sdk'`
 * + `createClient` แบบ static แล้วสร้าง client เองใน `setKey(apiKey)` — เพราะไฟล์นี้ถูก import แบบ static
 * จาก `stores/sessionStore.ts` (ใช้ตั้งแต่ KeyGate route "/") ทำให้ `@anthropic-ai/sdk` ทั้งก้อน (รวม
 * resource namespace ของ beta ที่ไม่เกี่ยวกับแอปนี้เลย) ติดเข้า entry bundle เสมอแม้ผู้ใช้ยังไม่กด "ทดสอบ
 * และเริ่ม" สักครั้ง → เปลี่ยนสัญญา: **ผู้เรียกเป็นคนสร้าง client เอง** (ผ่าน `await import('@/ai/client')`
 * ที่จุดเดียวคือ `sessionStore.submitKey`) แล้วส่ง instance ที่สร้างแล้วเข้ามาให้ `setKey(client)` เก็บไว้
 * เท่านั้น — โมดูลนี้ยังคงเป็นที่เดียวที่ถือ reference ต่อจากนั้น (module scope, N2/H1 ไม่เปลี่ยน) แค่ไม่ใช่
 * คนสร้างเองอีกต่อไป — import ของ `Anthropic` ที่เหลือเป็น `import type` ล้วน ๆ (ลบทิ้งตอน compile ไม่มี
 * โค้ด SDK จริงติดมาจากไฟล์นี้)
 */
import type Anthropic from '@anthropic-ai/sdk';

export type ClearKeyReason = 'manual' | 'idle' | 'pagehide' | 'budget_exceeded';

/** 09 §1: "tab ซ่อน > 60 นาที" — ใช้เป็นเพดาน idle เดียวกัน (ไม่แยก visible/hidden เพราะไม่มีทาง
 * ตรวจ "ซ่อน" ที่เชื่อถือได้ 100% จากโมดูลนี้เพียงลำพัง — ผู้เรียก UI เรียก `touchActivity()` เองตอนมี
 * กิจกรรมของผู้ใช้ (พิมพ์/คลิก/ส่งข้อความ) ส่วนตอนแท็บถูกซ่อนจริง ๆ ก็ไม่มีกิจกรรมมาเรียกอยู่แล้ว จึงครบ
 * เพดานเดิมพอดี) */
export const IDLE_TIMEOUT_MS = 60 * 60 * 1000;

let client: Anthropic | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const pendingAbortControllers = new Set<AbortController>();
const clearListeners = new Set<(reason: ClearKeyReason) => void>();

function clearIdleTimer(): void {
  if (idleTimer !== undefined) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
}

function scheduleIdleClear(): void {
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    clearKey('idle');
  }, IDLE_TIMEOUT_MS);
}

/** เก็บ `Anthropic` instance ที่ผู้เรียกสร้างมาแล้ว (ผ่าน `createClient` ของ `ai/client.ts` — ปกติเรียก
 * ผ่าน dynamic `import('@/ai/client')` ใน `sessionStore.submitKey` เพื่อไม่ให้ SDK ติด entry bundle)
 * ไว้ในโมดูลนี้ — คืน instance เดิมกลับให้ผู้เรียกใช้ต่อทันที (เช่น `verifyKey(client, model)`) แต่ผู้เรียก
 * ห้ามเก็บ reference นี้ไว้เอง (ใช้แล้วทิ้ง อ่านซ้ำผ่าน `getClient()` เสมอ) */
export function setKey(newClient: Anthropic): Anthropic {
  client = newClient;
  scheduleIdleClear();
  return client;
}

/** `null` เมื่อยังไม่ได้ตั้ง key หรือถูกล้างไปแล้ว */
export function getClient(): Anthropic | null {
  return client;
}

export function hasKey(): boolean {
  return client !== null;
}

/** ล้าง client ปัจจุบัน + abort งานที่ค้างทั้งหมด + แจ้ง listener (สำหรับ store ที่ต้องอัปเดต `hasKey`) */
export function clearKey(reason: ClearKeyReason = 'manual'): void {
  client = null;
  clearIdleTimer();
  const controllers = [...pendingAbortControllers];
  pendingAbortControllers.clear();
  for (const ac of controllers) {
    ac.abort();
  }
  for (const listener of [...clearListeners]) {
    listener(reason);
  }
}

/** เรียกตอนมีกิจกรรมของผู้ใช้ (ส่งข้อความ/แก้ไข proposal ฯลฯ) เพื่อรีเซ็ต idle timer — no-op ถ้ายังไม่มี
 * key (ไม่ต้องเริ่มนับถอยหลังสำหรับ key ที่ไม่มีอยู่) */
export function touchActivity(): void {
  if (client !== null) {
    scheduleIdleClear();
  }
}

/** ลงทะเบียน `AbortController` ของงานที่กำลังทำ (เช่น 1 การเรียก `runAgentTurn`) ให้ถูก abort อัตโนมัติ
 * เมื่อ key ถูกล้างไม่ว่าด้วยเหตุผลใด — คืนฟังก์ชัน unregister (เรียกตอนงานเสร็จตามปกติ) */
export function registerAbortController(ac: AbortController): () => void {
  pendingAbortControllers.add(ac);
  return () => {
    pendingAbortControllers.delete(ac);
  };
}

/** สมัครรับแจ้งเมื่อ key ถูกล้าง (ทุกเหตุผล) — ใช้โดย `stores/sessionStore.ts` เพื่ออัปเดต `hasKey`/
 * `keyStatus` คืนฟังก์ชัน unsubscribe */
export function onClear(listener: (reason: ClearKeyReason) => void): () => void {
  clearListeners.add(listener);
  return () => {
    clearListeners.delete(listener);
  };
}

/** ทดสอบเท่านั้น — คืนสถานะภายในเป็นค่าเริ่มต้นโดยไม่ยิง listener/abort (กันเทสต์ไฟล์อื่นเห็น state
 * ค้างจากเทสต์ก่อนหน้าในกรณีที่ vitest ไม่แยก module registry ต่อไฟล์) ห้ามเรียกจากโค้ด production */
export function __resetForTests(): void {
  client = null;
  clearIdleTimer();
  pendingAbortControllers.clear();
  clearListeners.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    clearKey('pagehide');
  });
}
