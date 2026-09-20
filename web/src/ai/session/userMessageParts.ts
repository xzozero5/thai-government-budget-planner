/**
 * T-602 (NEW-M4) — helper เดียวสำหรับ "ข้อความที่ UI ฉีดเข้า user role" แทนที่จะพิมพ์เอง: ข้อมูลที่มา
 * จากผลลัพธ์ของโมเดล/ผลค้นเว็บ (URL เต็ม, ชื่อภาพประกอบที่โมเดลตั้ง, id ของ BOQ line ที่โมเดลกำหนด) แล้ว UI
 * เอาไปประกอบเป็นข้อความส่งกลับเข้า `user` role เอง (เช่นปุ่ม "ไม่เอาราคานี้"/"สร้างภาพใหม่"/"ให้ AI ทบทวน")
 * มีความเสี่ยง prompt injection แบบ blast-radius ต่ำ (ข้อเสนอเพี้ยน ไม่ใช่ key รั่ว — escaping หลักที่กัน
 * XSS/HTML injection จริงอยู่ที่ `ai/tools/toolKit.ts#wrapToolResultData` แล้ว) แต่ยังควรตัดช่องทางที่
 * ข้อความฝังคำสั่งแฝงข้ามบรรทัด/ปลอมเป็น code fence/tag ก่อนส่งเข้า user role
 *
 * ไม่ได้ทดลองกับโมเดลจริง (ประเมินความเสี่ยงล้วน ๆ ตาม T-602 security review) — ห้ามใช้ไฟล์นี้แทนการ
 * escape HTML/markdown ของข้อความที่ render กลับมาจากโมเดล (คนละชั้นกัน คนละปัญหากัน)
 *
 * หมายเหตุการเขียนโค้ด: ตรวจ/แทนที่อักขระควบคุมทีละตัวด้วย `charCodeAt` แทน regex character class ของ
 * อักขระควบคุม (แบบเดียวกับ `@/lib/safeUrl`/`data/manifest.ts#hasForbiddenPathChar`) เพื่อเลี่ยงปัญหา
 * control character ดิบปนอยู่ใน source ของ regex literal เอง
 */

const DEFAULT_MAX_CHARS = 120;

const MAX_C0_CONTROL_CODE = 0x1f;
const DEL_CODE = 0x7f;
const LINE_SEPARATOR_CODE = 0x2028;
const PARAGRAPH_SEPARATOR_CODE = 0x2029;

/** true เมื่อ `code` เป็นอักขระควบคุม C0 (0x00–0x1f), DEL (0x7f), หรือ U+2028/U+2029 (line/paragraph
 * separator) — รวม `\n`/`\r`/`\t` ทั้งหมดในช่วงนี้อยู่แล้ว */
function isControlOrSeparatorCode(code: number): boolean {
  return (
    code <= MAX_C0_CONTROL_CODE ||
    code === DEL_CODE ||
    code === LINE_SEPARATOR_CODE ||
    code === PARAGRAPH_SEPARATOR_CODE
  );
}

/** backtick (code fence ปลอม) และวงเล็บมุม (แสร้งเป็น tag/markup) — ตัดทิ้งเฉย ๆ ไม่แทนด้วยอย่างอื่น
 * เพราะไม่มีความหมายที่ต้องรักษาไว้ในข้อความอ้างอิง (ชื่อภาพ/URL/id) */
const DANGEROUS_MARKUP_CHARS = /[`<>]/g;

/** แทนที่อักขระควบคุม/separator ทุกตัวด้วยช่องว่างเดียว — กันข้อความหลายบรรทัดที่แสร้งเป็นข้อความ/คำสั่งใหม่ */
function replaceControlOrSeparatorChars(value: string): string {
  let result = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    result += isControlOrSeparatorCode(code) ? ' ' : value.charAt(i);
  }
  return result;
}

/**
 * ทำความสะอาดข้อความที่มาจากแหล่งที่คุมได้บางส่วน (โมเดล/ผลค้นเว็บ) ก่อนฉีดเข้าข้อความ user role เอง:
 * ตัดอักขระควบคุม/ขึ้นบรรทัดใหม่/backtick/วงเล็บมุม → collapse ช่องว่างซ้ำ → ตัดความยาวไม่เกิน `maxChars`
 * ตัวอักษร (เติม "…" ถ้าตัด) → ห่อด้วยเครื่องหมายคำพูดไทย “…” เพื่อให้เห็นชัดว่าเป็นข้อความอ้างอิง ไม่ใช่
 * ส่วนหนึ่งของประโยคคำสั่ง
 */
export function sanitizeInjectedText(value: string, maxChars: number = DEFAULT_MAX_CHARS): string {
  const cleaned = replaceControlOrSeparatorChars(value)
    .replace(DANGEROUS_MARKUP_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();

  const safeMax = Math.max(0, maxChars);
  const truncated =
    cleaned.length > safeMax ? `${cleaned.slice(0, Math.max(0, safeMax - 1))}…` : cleaned;

  return `“${truncated}”`;
}
