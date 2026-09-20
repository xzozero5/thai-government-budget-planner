/**
 * T-501 — register ฟอนต์ Sarabun (OFL, bundle ใน repo) เข้า `@react-pdf/renderer`
 *
 * `source` inject ได้เสมอ (ไม่ hard-code URL ในฟังก์ชัน) เพราะ:
 * - production/browser: URL same-origin `${import.meta.env.BASE_URL}fonts/…` (ดู `defaultFontSource`)
 * - test (Node, ไม่มี HTTP server): ต้อง register จาก path ไฟล์จริงบนดิสก์ (`web/public/fonts/*.ttf`)
 *
 * ปิด hyphenation callback ของ react-pdf เสมอ (S4: ตัดคำแบบ Latin ทำให้คำไทยแตกกลางคำ, ไม่ช่วยอะไร) —
 * เราแทรก soft break ของเราเองแทนทั้งหมด (`thaiText.ts`) **ต้องใช้คู่กับ soft-break character
 * ที่ `thaiText.ts` เลือก (U+200A HAIR SPACE ไม่ใช่ ZWSP)** มิฉะนั้นจะโผล่เครื่องหมาย "-" ที่ทุกจุดตัด
 * แม้ตั้ง callback นี้แล้วก็ตาม — ดูเหตุผลเต็มในคอมเมนต์หัวไฟล์ `thaiText.ts`
 */
import { splitForLineBreak } from './thaiText';
import { Font } from '@react-pdf/renderer';

export const SARABUN_FONT_FAMILY = 'Sarabun';

export interface FontSource {
  regular: string;
  bold: string;
  italic: string;
}

/** URL ฟอนต์ที่ deploy จริงบน GitHub Pages (same-origin, ตรงกับ CSP `font-src 'self'` — docs/09) */
export function defaultFontSource(): FontSource {
  const base: string = import.meta.env.BASE_URL;
  return {
    regular: `${base}fonts/Sarabun-Regular.ttf`,
    bold: `${base}fonts/Sarabun-Bold.ttf`,
    italic: `${base}fonts/Sarabun-Italic.ttf`,
  };
}

let registeredSource: FontSource | null = null;

/**
 * register ฟอนต์ครั้งเดียวต่อ `source` — เรียกซ้ำด้วย `source` เดิม (`===` ทุก field) จะไม่ทำอะไรซ้ำ
 * (react-pdf ไม่ deduplicate ให้เอง เรียกซ้ำจะ throw/สร้างปัญหา cache ของ fontkit)
 */
export function registerFonts(source: FontSource = defaultFontSource()): void {
  if (
    registeredSource !== null &&
    registeredSource.regular === source.regular &&
    registeredSource.bold === source.bold &&
    registeredSource.italic === source.italic
  ) {
    return;
  }
  Font.register({
    family: SARABUN_FONT_FAMILY,
    fonts: [
      { src: source.regular, fontWeight: 'normal' },
      { src: source.bold, fontWeight: 'bold' },
      { src: source.italic, fontStyle: 'italic' },
    ],
  });
  // S4: hyphenation ของ react-pdf (ตัดคำแบบ Latin) ไม่ช่วยคำไทยและทำให้ผลลัพธ์ไม่แน่นอน — ปิดทั้งหมด
  // แล้วพึ่ง soft break ของเราเอง (`thaiText.ts`) แทน
  // main thread (QA รอบภาพ): ตัดคำไทยที่นี่ (ไม่ใช่ด้วยอักขระ soft-break ในข้อความ — ดูเหตุผลใน
  // `thaiText.ts#toPdfText`) คั่นแต่ละหน่วยด้วยสตริงว่าง: textkit จะได้ glue กว้าง 0 เป็นจุดตัดที่ไม่เติม "-"
  Font.registerHyphenationCallback((word: string) => {
    const units = splitForLineBreak(word);
    return units.length <= 1 ? [word] : units.flatMap((unit) => [unit, '']);
  });
  registeredSource = source;
}
