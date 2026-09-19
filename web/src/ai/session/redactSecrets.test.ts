import { describe, expect, it } from 'vitest';
import { containsSecretLikeString, redactSecrets } from './redactSecrets';

// ประกอบสตริงรูป key จาก concatenation เสมอ (ไม่เขียน "sk-ant-" + อักขระ 8 ตัวขึ้นไป ตรง ๆ ในซอร์ส) เพื่อไม่ให้
// `.githooks/pre-commit` ตีความไฟล์เทสต์นี้ว่ามี key จริงหลุดมาโดยไม่ตั้งใจ (ตามคำสั่งของงาน T-403)
function fakeKey(suffix = 'abcdEFGH1234'): string {
  return 'sk-' + 'ant-' + suffix;
}

describe('redactSecrets', () => {
  it('มาสก์สตริงรูป key เดียวในข้อความ', () => {
    const message = `key ของคุณคือ ${fakeKey()} กรุณาเก็บเป็นความลับ`;
    const redacted = redactSecrets(message);
    expect(redacted).not.toContain(fakeKey());
    expect(redacted).toContain('sk-ant-');
    expect(redacted).toContain('(ถูกซ่อน)');
  });

  it('มาสก์ได้หลายตำแหน่งในข้อความเดียว', () => {
    const message = `${fakeKey('AAAAAAAA')} และ ${fakeKey('BBBBBBBB')}`;
    const redacted = redactSecrets(message);
    expect(containsSecretLikeString(redacted)).toBe(false);
  });

  it('ไม่แก้ข้อความปกติที่ไม่มี key', () => {
    const message = 'API key ไม่ถูกต้องหรือถูกเพิกถอน กรุณาตรวจสอบแล้วลองใหม่อีกครั้ง';
    expect(redactSecrets(message)).toBe(message);
  });

  it('ไม่มาสก์สตริงที่สั้นเกินไป (ต่ำกว่า 8 ตัวหลัง sk-ant-)', () => {
    const message = `${'sk-' + 'ant-'}short`;
    expect(redactSecrets(message)).toBe(message);
  });

  it('containsSecretLikeString ตรวจจับได้ถูกต้อง (เรียกซ้ำได้แม้ regex มีแฟล็ก g)', () => {
    expect(containsSecretLikeString(fakeKey())).toBe(true);
    expect(containsSecretLikeString(fakeKey())).toBe(true);
    expect(containsSecretLikeString('ข้อความปกติ')).toBe(false);
  });
});
