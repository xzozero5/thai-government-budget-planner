/**
 * T-301 — SDK client (browser mode) + ตรวจ key (F1)
 *
 * N2 (CLAUDE.md §2): key รับเป็น argument เท่านั้น ห้ามอ่าน/เขียน storage ใด ๆ ในไฟล์นี้ และห้าม
 * `console.*` ค่า key หรือ headers ใด ๆ — caller (feature/keygate, Phase 4) เป็นคนถือ key ใน Zustand
 * store ที่ไม่ persist (04 §D7) แล้วส่งเข้ามาทาง argument ของฟังก์ชันในไฟล์นี้เท่านั้น
 *
 * ADR-006 ข้อ 9: ตรวจ key ด้วย `messages.countTokens` (ไม่คิดเงินจริงตามเอกสาร token-counting) แทน
 * `models.list`; error เป็น typed exception chain เท่านั้น (ห้าม string-match ข้อความ error)
 *
 * ห้าม import React/DOM API (module boundary — docs/04-ARCHITECTURE.md §3)
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ModelId } from './models';

/**
 * สร้าง client ใหม่ — `dangerouslyAllowBrowser: true` ตาม 04 §D2 (SDK ใส่ header
 * `anthropic-dangerous-direct-browser-access` ให้เองเมื่อเปิดตัวเลือกนี้) ไม่ตั้ง `baseURL` จาก
 * argument ใด ๆ (N2/09 §1: "baseURL เป็นค่าคงที่ ห้าม config จาก UI/URL") — ใช้ค่า default ของ SDK เสมอ
 */
export function createClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

export type VerifyKeyErrorKind = 'auth' | 'permission' | 'rate_limit' | 'network' | 'unknown';

export type VerifyKeyResult =
  | { ok: true }
  | { ok: false; kind: VerifyKeyErrorKind; messageTh: string };

const MESSAGE_TH: Record<VerifyKeyErrorKind, string> = {
  auth: 'API key ไม่ถูกต้องหรือถูกเพิกถอน กรุณาตรวจสอบแล้วลองใหม่อีกครั้ง',
  permission: 'บัญชีนี้ไม่มีสิทธิ์เรียกใช้โมเดลที่เลือก กรุณาตรวจสอบสิทธิ์ในบัญชี Anthropic ของคุณ',
  rate_limit: 'ถูกจำกัดอัตราการเรียกใช้ (rate limit) กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
  network: 'เชื่อมต่อ api.anthropic.com ไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต',
  unknown: 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุขณะตรวจสอบ API key กรุณาลองใหม่อีกครั้ง',
};

/**
 * ทดสอบว่า key ใช้งานได้กับ `model` ที่เลือกหรือไม่ ด้วย `messages.countTokens` (F1 US-1.1)
 *
 * ใช้ typed exception chain ของ SDK เท่านั้น (ADR-006 ข้อ 4/9, `shared/error-codes.md`
 * "Always use the SDK's typed exception classes") — ห้าม string-match `error.message`
 */
export async function verifyKey(client: Anthropic, model: ModelId): Promise<VerifyKeyResult> {
  try {
    await client.messages.countTokens({
      model,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return { ok: true };
  } catch (err) {
    const kind = classifyVerifyKeyError(err);
    return { ok: false, kind, messageTh: MESSAGE_TH[kind] };
  }
}

/** แยกชนิด error จาก typed exception ของ SDK — export แยกไว้เพื่อ unit test ตรง ๆ โดยไม่ต้อง mock ทั้ง client */
export function classifyVerifyKeyError(err: unknown): VerifyKeyErrorKind {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'auth';
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return 'permission';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'rate_limit';
  }
  // ต้องเช็คก่อน APIError ทั่วไป — ใน TS SDK เป็น subclass ของ APIError (shared/error-codes.md)
  if (err instanceof Anthropic.APIConnectionError) {
    return 'network';
  }
  return 'unknown';
}
