/**
 * T-404 — ตรวจรูปแบบ API key เบื้องต้น (06 §4.1: "validate รูปแบบเบื้องต้น inline ... ก่อนยิง verify")
 *
 * Pure function ล้วน ๆ (ไม่แตะ storage/network) — แยกจาก component เพื่อ unit test ตรง ๆ ตาม CLAUDE.md §7
 */
import { t } from '@/i18n';

const KEY_PREFIX = 'sk-ant-';
/** ความยาวขั้นต่ำแบบหยาบ (prefix + ส่วนที่เหลืออย่างน้อยพอสมเหตุสมผล) — ไม่ตรวจรูปแบบละเอียดเพราะ
 * รูปแบบจริงของ Anthropic อาจเปลี่ยนได้ การตรวจเข้มไปจะทำให้ key ที่ถูกต้องบางแบบถูกปฏิเสธ */
const MIN_KEY_LENGTH = 20;

/**
 * คืน `null` เมื่อผ่านการตรวจรูปแบบเบื้องต้น (ยังไม่รับประกันว่า key ใช้ได้จริง — ต้องยิง `verifyKey` ต่อ)
 * คืนข้อความ error (จาก `docs/ui/copy.th.json`) เมื่อไม่ผ่าน
 */
export function validateApiKeyFormat(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return t('keygate.apiKeyEmpty');
  }
  if (!trimmed.startsWith(KEY_PREFIX) || trimmed.length < MIN_KEY_LENGTH) {
    return t('keygate.apiKeyFormat');
  }
  return null;
}
