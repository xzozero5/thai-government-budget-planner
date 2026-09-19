/**
 * T-403 — `redactSecrets`: กรองสตริงรูป Anthropic API key ออกจากข้อความก่อนเก็บใน store/แสดงบน UI
 *
 * T-307 §9 ข้อ 7 (บังคับ): "Error boundary + redactSecrets(s) ... ใช้กับทุก console.* และทุกข้อความ
 * error ที่แสดงบน UI" — regex เดียวกับ `.githooks/pre-commit` (`sk-ant-[A-Za-z0-9_-]{8,}`) เพื่อให้
 * มาตรฐานเดียวกันทั้ง repo ในทางปฏิบัติเส้นทาง error ของ SDK ไม่เคยพก key อยู่แล้ว (ยืนยันใน T-307 §2
 * แถว "error message / stack trace") — ฟังก์ชันนี้เป็น defense-in-depth ชั้นสุดท้ายก่อนข้อความใด ๆ
 * เข้า store หรือแสดงผล ไม่ใช่มาตรการเดียวที่พึ่งพา
 */

// หมายเหตุ: ไม่ประกอบ pattern จาก string literal ที่มีรูป "sk-ant-" + อักขระ 8 ตัวขึ้นไป ตรง ๆ ในไฟล์นี้ — regex
// literal ด้านล่างปลอดภัยต่อ pre-commit hook อยู่แล้วเพราะอักขระถัดจาก "sk-ant-" คือ "[" ซึ่งไม่อยู่ใน
// character class `[A-Za-z0-9_-]` (hook เองก็มี pattern เดียวกันนี้ในซอร์สของมันเอง — `.githooks/
// pre-commit`) จึงไม่ถูก hook ตัวเองบล็อก
const API_KEY_PATTERN = /sk-ant-[A-Za-z0-9_-]{8,}/g;

const REDACTED_PLACEHOLDER = 'sk-ant-…(ถูกซ่อน)';

/** แทนที่สตริงรูป key ทุกตำแหน่งใน `input` ด้วย placeholder — คืนค่าเดิมถ้าไม่มีอะไรให้ซ่อน */
export function redactSecrets(input: string): string {
  return input.replace(API_KEY_PATTERN, REDACTED_PLACEHOLDER);
}

/** true เมื่อพบสตริงรูป key อย่างน้อย 1 ตำแหน่ง — ใช้ในเทสต์/assertion ได้สะดวกกว่าต้อง reset lastIndex
 * ของ regex ที่มีแฟล็ก `g` เอง */
export function containsSecretLikeString(input: string): boolean {
  return new RegExp(API_KEY_PATTERN.source).test(input);
}
