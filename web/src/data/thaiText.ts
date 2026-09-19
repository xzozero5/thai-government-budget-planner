/**
 * T-204 — การพับ/ตัดคำภาษาไทยสำหรับค้นหา (`foldThai`, `tokenizeThai`)
 *
 * ไฟล์นี้ต้อง **pure**: ไม่มี DOM API (`document`, `window`) และไม่มี Node API (`fs`, `process`, ...)
 * เพื่อให้ใช้ได้ทั้งใน browser (bundle ผ่าน Vite) และใน Node (รันตรงหรือผ่าน esbuild transform ใน
 * `web/scripts/build-search-index.mjs`) — โค้ดชุดเดียวกันต้องสร้างผลลัพธ์เดียวกันทั้งสองฝั่ง
 * (ดู `docs/decisions/SPIKES.md` §S2 ผล 6 และ `docs/BACKLOG.md` T-204/T-208)
 *
 * ห้าม import React (module boundary — `docs/04-ARCHITECTURE.md` §3)
 */

/**
 * เวอร์ชันของอัลกอริทึม fold+tokenize — ฝัง (embed) ลงใน wrapper ของ
 * `catalog/search-index.json.gz` ตอน build (`web/scripts/build-search-index.mjs`) แล้วเทียบกับ
 * ค่าคงที่นี้ตอนโหลดใน browser (`data/search.ts`) — ถ้าไม่ตรงแปลว่า indexถูกสร้างด้วยกฎ fold/tokenize
 * คนละเวอร์ชัน (โค้ดถูกแก้หลัง build) → ต้อง fallback ไป build index ใหม่ใน browser แทนที่จะเชื่อ
 * prebuilt index ที่อาจให้ผลลัพธ์ไม่ตรงกับ query ที่ fold ด้วยกฎเวอร์ชันใหม่
 *
 * เพิ่มเลขเวอร์ชันทุกครั้งที่แก้ตรรกะของ `foldThai`/`tokenizeThai` ในไฟล์นี้
 */
export const TOKENIZER_VERSION = 'thai-fold-v1';

// ช่วง unicode ของอักษร/สระ/วรรณยุกต์ไทยที่ "ประกอบเป็นคำ" (ไม่รวมเลขไทย ๐-๙ ซึ่งแปลงเป็นอารบิกไปแล้ว,
// ไม่รวมสัญลักษณ์ ฿/๏/๚/๛ ซึ่งเป็นสัญลักษณ์ไม่ใช่ตัวอักษร)
const THAI_WORD_CHAR = 'ก-ฺเ-๎';
const THAI_WORD_CHAR_RE = new RegExp(`[${THAI_WORD_CHAR}]`);

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/** แปลงเลขไทย (๐-๙) เป็นเลขอารบิก — ให้ query/ข้อความที่พิมพ์เลขไทยค้นเจอข้อมูลที่เป็นเลขอารบิก (และกลับกัน) */
function thaiDigitsToArabic(input: string): string {
  return input.replace(/[๐-๙]/g, (ch) => String(THAI_DIGITS.indexOf(ch)));
}

/**
 * `foldThai` — ทำให้ข้อความไทยที่เขียน/สแกนมาต่างรูปแบบกันกลายเป็นรูปเดียวกันสำหรับเปรียบเทียบ/ค้นหา
 * **ห้ามใช้ผลลัพธ์นี้เป็นข้อความที่แสดงเป็นหลักฐาน (citation)** — ใช้ได้เฉพาะฝั่งค้นหาเท่านั้น
 * (`docs/02-DATA-INVENTORY.md` §B, `docs/decisions/SPIKES.md` §S2 ผล 6)
 *
 * ลำดับขั้นตอน (สมมาตร — ต้องใช้ชุดเดียวกันทั้ง index และ query):
 * 1. Unicode NFC normalize
 * 2. lower-case
 * 3. เลขไทย → เลขอารบิก
 * 4. ตัดช่องว่างระหว่างอักษรไทย (เช่น "ส านักงาน" → "สานักงาน" — เกิดจากสระ/วรรณยุกต์หลุดตำแหน่งตอน
 *    extract PDF ที่ไม่มี text layer เต็ม — ดู 02 §B; **ไม่ใช่การเดาว่าช่องว่างนั้นคือ ำ ที่หายไป**)
 * 5. พับ `ำ` (U+0E33) และรูปแตก `ํ`+`า` (นิคหิต U+0E4D ตามด้วยสระอา U+0E32) → `า` เดี่ยว
 * 6. ตัดวรรคตอน โดยคงตัวเลข/ทศนิยมไว้: ตัดตัวคั่นหลักพันในตัวเลข ("18,000" → "18000"),
 *    ตัดจุดที่ไม่ได้อยู่ระหว่างตัวเลข (ทศนิยมจริง เช่น "3.5" คงไว้), ตัด punctuation/symbol ที่เหลือ
 *    เป็นช่องว่าง (กันคำสองฝั่งมาติดกัน)
 * 7. รวบช่องว่างซ้ำ + trim
 */
export function foldThai(input: string): string {
  let s = input.normalize('NFC').toLowerCase();
  s = thaiDigitsToArabic(s);

  // 4. ตัดช่องว่างระหว่างอักษรไทย — จับคู่ (อักษรไทย)(ช่องว่าง)(lookahead อักษรไทย) แบบ global เพียง
  // รอบเดียวก็ครอบคลุมช่องว่างต่อเนื่องหลายจุด เพราะ match แต่ละอันกิน "อักษร+ช่องว่าง" แล้วปล่อยอักษรที่
  // เป็น lookahead ไว้ให้เป็นจุดเริ่มของ match ถัดไป (ตรวจแล้วด้วยเคสจริงจาก 02 §B)
  const thaiWhitespaceRe = new RegExp(`([${THAI_WORD_CHAR}])[ \\t\\u00A0]+(?=[${THAI_WORD_CHAR}])`, 'gu');
  s = s.replace(thaiWhitespaceRe, '$1');

  // 5. พับ ำ / รูปแตก ํ+า → า
  s = s.replace(/ํา/g, 'า');
  s = s.replace(/ำ/g, 'า');

  // 6a. ตัวคั่นหลักพันในตัวเลข: comma ระหว่างตัวเลข → ตัดทิ้งเลย (ไม่ใช่แทนด้วยช่องว่าง) เพื่อให้
  // "18,000" กลายเป็น "18000" ตัวเดียวกันกับ query ที่ไม่มี comma
  s = s.replace(/(?<=\d),(?=\d)/g, '');
  // 6b. จุดที่ไม่ได้อยู่ระหว่างตัวเลขสองข้าง (ไม่ใช่ทศนิยม) → ตัดเป็นช่องว่าง
  s = s.replace(/(?<!\d)\.|\.(?!\d)/g, ' ');
  // 6c. punctuation/symbol ที่เหลือ (ยกเว้นจุดทศนิยมที่รอดจาก 6b เพราะอยู่ระหว่างตัวเลขแล้ว) → ช่องว่าง
  s = s.replace(/[\p{P}\p{S}]/gu, (ch) => (ch === '.' ? ch : ' '));

  // 7. รวบช่องว่างซ้ำ + trim
  return s.replace(/\s+/g, ' ').trim();
}

/** ตัด n-gram ความยาว `n` จากสตริงต่อเนื่อง (ใช้เฉพาะช่วงที่เป็นอักษรไทย — ตัวเลข/ละติน คงเป็นก้อนเดียว) */
function ngramsOf(chunk: string, n: number): string[] {
  if (chunk.length <= n) return [chunk];
  const grams: string[] = [];
  for (let i = 0; i + n <= chunk.length; i += 1) {
    grams.push(chunk.slice(i, i + n));
  }
  return grams;
}

/**
 * fallback tokenizer แบบ n-gram (n=3) เมื่อ runtime ไม่มี `Intl.Segmenter` — ใช้กับข้อความที่ผ่าน
 * `foldThai` มาแล้วเท่านั้น (ตัดวรรคตอนออกหมดแล้ว เหลือช่องว่างเป็นตัวแบ่ง chunk)
 * อิงจาก `web/spikes/src/s2.ts` (อ่านอย่างเดียว ไม่ import) — คุณภาพ query แย่กว่า Intl.Segmenter
 * มาก (~50×, ดู SPIKES §S2 ผล 3) แต่ยังใช้งานได้เมื่อไม่มีทางเลือกอื่น
 */
export function tokenizeThaiNgramFallback(folded: string, n = 3): string[] {
  const tokens: string[] = [];
  for (const chunk of folded.split(/\s+/)) {
    if (chunk.length === 0) continue;
    if (!THAI_WORD_CHAR_RE.test(chunk)) {
      tokens.push(chunk);
      continue;
    }
    tokens.push(...ngramsOf(chunk, n));
  }
  return tokens;
}

/** subset ของ `Intl.Segmenter` ที่เราต้องใช้จริง — เขียนเป็น interface ของเราเองเพื่อให้ inject mock ใน
 * test ได้ง่าย (ไม่ต้องสร้าง `Intl.Segmenter` จริง) */
export interface WordSegmenterLike {
  segment: (input: string) => Iterable<{ segment: string; isWordLike?: boolean }>;
}

export interface TokenizeThaiOptions {
  /**
   * โรงงานสร้าง segmenter — ค่าเริ่มต้นใช้ `Intl.Segmenter('th', {granularity:'word'})` ของ runtime
   * จริง; inject ฟังก์ชันที่คืน `null` เพื่อทดสอบ path fallback n-gram โดยไม่ต้องพึ่งว่า runtime ที่รัน
   * test มี/ไม่มี `Intl.Segmenter` จริง (Node/Chromium ปัจจุบันมีทั้งคู่ — ดู SPIKES §S2)
   */
  getSegmenter?: () => WordSegmenterLike | null;
}

function defaultGetSegmenter(): WordSegmenterLike | null {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
    return null;
  }
  return new Intl.Segmenter('th', { granularity: 'word' });
}

/**
 * `tokenizeThai` — fold ก่อนเสมอ แล้วค่อยตัดคำด้วย `Intl.Segmenter('th', {granularity:'word'})`
 * (fallback เป็น n-gram 3 เมื่อไม่มี) กรอง token ว่าง/ที่ไม่ใช่ word-like (ช่องว่าง/วรรคตอนที่เหลือ) ทิ้ง
 *
 * ต้อง fold **ก่อน** tokenize เสมอ (ไม่ใช่ทำใน `processTerm` ของ MiniSearch หลัง tokenize แล้ว) —
 * มิฉะนั้นช่องว่างที่หลุดอยู่ในข้อความต้นฉบับ (เช่น "ส านักงาน") จะทำให้ segmenter ตัดคำผิดไปก่อนแล้ว
 * (ยืนยันจาก `docs/decisions/SPIKES.md` §S2)
 */
export function tokenizeThai(input: string, options: TokenizeThaiOptions = {}): string[] {
  const folded = foldThai(input);
  if (folded.length === 0) return [];

  const getSegmenter = options.getSegmenter ?? defaultGetSegmenter;
  const segmenter = getSegmenter();
  if (!segmenter) {
    return tokenizeThaiNgramFallback(folded);
  }

  const tokens: string[] = [];
  for (const part of segmenter.segment(folded)) {
    if (part.isWordLike === false) continue;
    const trimmed = part.segment.trim();
    if (trimmed.length === 0) continue;
    tokens.push(trimmed);
  }
  return tokens;
}
