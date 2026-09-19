/**
 * T-307 (H2 — security review, citation ต้องตรวจ "ค่า" ไม่ใช่แค่ "id เคยปรากฏ") —
 * normalize ข้อความภาษาไทยแบบง่าย สำหรับเทียบว่า `quote` ที่โมเดลอ้างเป็น substring ของ chunk เอกสารที่
 * เคยอ่านจริงหรือไม่ (ไม่ใช่ข้อความที่จะแสดงเป็นหลักฐาน — ใช้ได้เฉพาะฝั่งเปรียบเทียบเท่านั้น)
 *
 * ทำซ้ำเฉพาะบางส่วนของ `web/src/data/thaiText.ts#foldThai` (NFC normalize, lower-case, ตัดช่องว่างที่
 * หลุดอยู่ระหว่างอักษรไทยจากการ extract PDF เช่น "ส านักงาน" → "สานักงาน", พับ `ำ`/`ํ`+`า` → `า`,
 * ตัดวรรคตอนเหลือเป็นช่องว่าง, รวบช่องว่างซ้ำ) — **ไม่ import จาก `@/data`** เพราะ `foldThai` ยังไม่ถูก
 * export ผ่าน facade (`web/src/data/index.ts`) ณ วันที่เขียนไฟล์นี้ (รายงานไว้ในผลปิดงาน T-307:
 * แนะนำให้ export `foldThai` ผ่าน facade ในอนาคตแทนการก็อปโค้ดซ้ำ) จึงต้องมี normalize แบบง่ายของ
 * ตัวเองใน `ai/` ชั่วคราวตามที่ระบุไว้ในสเปกงานนี้
 *
 * ห้าม import React/DOM API (module boundary — docs/04-ARCHITECTURE.md §3)
 */

const THAI_WORD_CHAR = 'ก-ฺเ-๎';

/** normalize สำหรับเทียบ substring เท่านั้น — **ห้าม** ใช้ผลลัพธ์นี้เป็นข้อความที่แสดงเป็นหลักฐาน */
export function normalizeForQuoteMatch(input: string): string {
  let s = input.normalize('NFC').toLowerCase();

  // ตัดช่องว่างที่หลุดอยู่ระหว่างอักษรไทย (เช่น "ส านักงาน" → "สานักงาน")
  const thaiWhitespaceRe = new RegExp(
    `([${THAI_WORD_CHAR}])[ \\t\\u00A0]+(?=[${THAI_WORD_CHAR}])`,
    'gu',
  );
  s = s.replace(thaiWhitespaceRe, '$1');

  // พับ ำ / รูปแตก ํ+า → า
  s = s.replace(/ํา/g, 'า');
  s = s.replace(/ำ/g, 'า');

  // วรรคตอน/สัญลักษณ์ที่เหลือ → ช่องว่าง (กันคำสองฝั่งมาติดกัน)
  s = s.replace(/[\p{P}\p{S}]/gu, ' ');

  return s.replace(/\s+/g, ' ').trim();
}
