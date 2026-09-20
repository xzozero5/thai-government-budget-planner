/**
 * T-404 — แปลง `VerifyKeyErrorKind` เป็นข้อความไทยจาก `docs/ui/copy.th.json` (06 §4.1)
 *
 * Pure function — ไม่รับ/คืน object ใดที่อาจพก key; ผู้เรียก (KeyGatePage) ต้องส่งผ่าน `redactSecrets`
 * ก่อนแสดงบน UI เสมอ (defense-in-depth ตาม T-307 §9 ข้อ 7) แม้ข้อความเหล่านี้เป็นค่าคงที่จาก copy อยู่แล้ว
 */
import { t } from '@/i18n';
import type { VerifyKeyErrorKind } from '@/ai/client';

export interface KeyGateErrorParams {
  /** ป้ายภาษาไทยของโมเดลที่เลือกตอน verify (ใช้กับ error kind `permission`) */
  modelLabel: string;
  /** รายละเอียดเพิ่มเติมที่ไม่มีรูปแบบ key (ใช้กับ error kind `unknown` เท่านั้น) */
  detail?: string;
}

export function getKeyGateErrorMessage(
  kind: VerifyKeyErrorKind,
  params: KeyGateErrorParams,
): string {
  switch (kind) {
    case 'auth':
      return t('keygate.errorAuth');
    case 'permission':
      return t('keygate.errorPermission', { model: params.modelLabel });
    case 'rate_limit':
      return t('keygate.errorRateLimit');
    case 'network':
      return t('keygate.errorNetwork');
    case 'unknown':
    default:
      return t('keygate.errorUnknown', { detail: params.detail ?? t('common.unknown') });
  }
}
