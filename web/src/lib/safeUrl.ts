/**
 * T-602 (NEW-M5) — ตัวตรวจ "https ปลอดภัย" เดียวทั้งแอป แทนที่โค้ดที่กระจายกัน 3 แบบไม่เท่ากันเดิม
 * (`ExternalLink#parseHttpsUrl`, `citationLabel#isHttpsUrl` ที่ไม่ปฏิเสธ userinfo, และ PDF ที่ใช้
 * `startsWith('https://')` ดิบ ๆ) — ทุกจุดที่ต้องตัดสินว่า URL หนึ่งปลอดภัยพอจะ render เป็นลิงก์ที่กดได้
 * หรือส่งต่อเป็น `<Link>` ของ PDF ต้องเรียกผ่านไฟล์นี้เท่านั้น
 *
 * เกณฑ์ (เข้มกว่า "ขึ้นต้นด้วย https://" เฉย ๆ):
 * - protocol ต้องเป็น `https:` เท่านั้น (ปฏิเสธ http/javascript:/data:/relative ฯลฯ)
 * - ปฏิเสธ URL ที่มี userinfo (`https://user:pass@host/` หรือ `https://bank.example@evil.example/` —
 *   รูปแบบหลอกตาให้ดูเหมือนโดเมนที่น่าเชื่อถือ) — URL จากโมเดล/ผลค้นเว็บไม่มีเหตุให้ต้องมี user:pass
 * - ปฏิเสธสตริงที่มีอักขระควบคุม/ช่องว่างควบคุมที่ใดก็ตามในสตริง (ไม่ใช่แค่ตัวนำหน้า) — กัน trick ของ
 *   WHATWG URL parser ที่ลบ tab/newline ทั่วทั้งสตริงก่อน parse จริง (เช่น `"java" + newline + "script:alert(1)"`
 *   จะถูก parse เป็น `javascript:alert(1)` เงียบ ๆ ถ้าไม่กันไว้ชั้นนี้ก่อน)
 * - parse ไม่ได้ (`new URL()` throw) → ไม่ปลอดภัย
 *
 * หมายเหตุการเขียนโค้ด: ตรวจทีละอักขระด้วย `charCodeAt`/`codePointAt` แทน regex character class ของ
 * อักขระควบคุม (แบบเดียวกับ `data/manifest.ts#hasForbiddenPathChar`) เพื่อเลี่ยงปัญหา control character
 * ดิบปนอยู่ใน source ของ regex literal เอง (อ่าน/แก้ยาก, ESLint `no-control-regex` ก็ไม่ชอบเช่นกัน)
 */

const MAX_C0_CONTROL_CODE = 0x1f;
const DEL_CODE = 0x7f;
const LINE_SEPARATOR_CODE = 0x2028;
const PARAGRAPH_SEPARATOR_CODE = 0x2029;

/** true เมื่อพบอักขระควบคุม C0 (0x00–0x1f) หรือ DEL (0x7f) หรือ U+2028/U+2029 (line/paragraph separator)
 * ที่ตำแหน่งใดก็ได้ในสตริง — ดูหมายเหตุหัวไฟล์ว่าทำไมต้องตรวจทั้งสตริง ไม่ใช่แค่ตัวนำหน้า */
function hasControlOrSeparatorChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (
      code <= MAX_C0_CONTROL_CODE ||
      code === DEL_CODE ||
      code === LINE_SEPARATOR_CODE ||
      code === PARAGRAPH_SEPARATOR_CODE
    ) {
      return true;
    }
  }
  return false;
}

/** true เมื่อมีช่องว่าง (0x20) นำหน้า/ปิดท้าย — WHATWG URL parser ตัดอักขระนี้ทิ้งที่ตำแหน่งต้น/ท้ายก่อน
 * parse จริง (ต่างจาก C0 control ที่ถูกตัดทุกตำแหน่งซึ่งจับด้วย `hasControlOrSeparatorChar` แล้ว) เช่น
 * `" https://evil.example"` จะถูกตัด space ทิ้งแล้ว parse เป็น URL ปกติเงียบ ๆ ถ้าไม่กันไว้ชั้นนี้ก่อน */
function hasLeadingOrTrailingSpace(value: string): boolean {
  return value.startsWith(' ') || value.endsWith(' ');
}

/** parse `href` เป็น `URL` เฉพาะเมื่อเป็น https ที่ปลอดภัยเท่านั้น — คืน `null` ในทุกกรณีอื่น (parse ไม่ได้,
 * ไม่ใช่ https, มี userinfo, มีอักขระควบคุม/ช่องว่างนำหน้าหรือแฝงอยู่) */
export function parseSafeHttpsUrl(href: string): URL | null {
  if (typeof href !== 'string' || href.length === 0) {
    return null;
  }
  if (hasControlOrSeparatorChar(href) || hasLeadingOrTrailingSpace(href)) {
    return null;
  }
  // main thread (โจมตีซ้ำหลัง T-602): WHATWG URL parser "ซ่อม" รูปแปลกให้เอง — `https:/\evil.example` และ
  // `https:///a` กลายเป็น `https://evil.example/` / `https://a/` ได้ → ยอมรับเฉพาะรูปมาตรฐาน
  // `https://<host…>` ตรงตัว และไม่มี backslash ที่ใดเลย (ข้อความที่เห็นต้องตรงกับที่ที่ลิงก์พาไป)
  if (!/^https:\/\/[^/\\]/i.test(href) || href.includes('\\')) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    return null;
  }
  return url;
}

/** true เฉพาะเมื่อ `parseSafeHttpsUrl` ผ่าน — ใช้ตรงจุดที่ต้องการแค่ boolean (เช่นตัดสินใจว่าจะ render
 * เป็นลิงก์หรือ text) */
export function isSafeHttpsUrl(href: string): boolean {
  return parseSafeHttpsUrl(href) !== null;
}
