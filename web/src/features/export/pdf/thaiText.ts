/**
 * T-501 — มาตรการแก้บั๊กภาษาไทยของ `@react-pdf/renderer` ตาม `docs/decisions/SPIKES.md` §S4
 * (pure functions ล้วน ๆ ไม่ import react-pdf — เทสได้โดยไม่ต้อง render จริง)
 *
 * บั๊ก 1 (S4 "การตัดบรรทัดภาษาไทยไม่รู้จักขอบเขตคำ"): react-pdf ตัดคำกลางคำ (`จังหวัดเชียงใ`/`หม่`)
 * และเมื่อ "คำ" ยาวกว่าความกว้างบรรทัด ส่วนเกินจะถูกตัดทิ้งเงียบ ๆ — แก้ด้วยการแทรกอักขระ soft-break
 * ที่ขอบเขตคำจาก `Intl.Segmenter('th', {granularity:'word'})` ก่อนส่งเข้า `<Text>` เสมอ (ดู
 * `insertSoftBreaks`) — ต้อง**ไม่**แทรกกลางตัวเลข (`1,234,567.89`) หรือ URL เพราะจะทำให้ copy/แสดงผลผิด
 * เพี้ยนหรือ URL ใช้งานไม่ได้
 *
 * ทำไมใช้อักขระโค้ดพอยต์ U+200A (HAIR SPACE) แทน U+200B (ZERO WIDTH SPACE) ตามที่ spike เสนอไว้ตอนแรก
 * — **สำคัญ พบระหว่าง QA รอบภาพจริงของ T-501**: ตอนแรกใช้ U+200B ตามที่ spike เสนอ แล้วพบว่าจุดตัดบรรทัด
 * ทุกจุดมีเครื่องหมาย "-" (hyphen) โผล่ขึ้นมาเสมอ แม้จะปิด
 * `Font.registerHyphenationCallback((word) => [word])` แล้วก็ตาม — ไล่โค้ดของ `@react-pdf/textkit`
 * (`wrapWords`/`getNodes` ใน textkit.js) พบว่า:
 * 1. ตัวคั่น "คำ" ของ textkit ใช้ regex ตัดที่อักขระ ASCII space เท่านั้น แต่อักขระโค้ดพอยต์ที่ font ไม่มี
 *    glyph ให้ (เช่น U+200B ไม่อยู่ใน cmap ของ Sarabun) จะถูกแยกเป็น "run" ของตัวเองก่อนถึงจุดนี้แล้ว
 *    (font-substitution/script-itemizer) — แต่ละ run ของข้อความไทยระหว่างจุดแทรกจึงถูกเรียก
 *    `hyphenationCallback(word)` แยกรายตัวจริง (ตรวจแล้วด้วย `console.log` ใน callback ระหว่างสืบสาเหตุ)
 * 2. ผลจาก callback (คืนคำเดิมทั้งคำ ไม่แยกพยางค์) ถูกเก็บเป็น "syllable" หนึ่งหน่วยใน `getNodes()` ซึ่ง
 *    เช็คว่าค่าที่ได้ เมื่อผ่าน `String.prototype.trim()` ของ JavaScript แล้วว่างเปล่าหรือไม่ เพื่อตัดสินว่า
 *    เป็น "glue" (ช่องว่างจริง ไม่มี hyphen ตอนตัดบรรทัด) หรือ "box+penalty" (จุดตัดคำ ใส่ hyphen เสมอ
 *    ระหว่าง box กับ box) — **โค้ดพอยต์ U+200B เมื่อผ่าน `trim()` ของ JavaScript แล้วไม่ถูกตัดออก**
 *    (ECMAScript spec ไม่นับ U+200B เป็น WhiteSpace) ดังนั้น U+200B จึงถูกจัดเป็น "box" เล็ก ๆ ตามด้วย
 *    penalty node (จุด hyphenation) เสมอ — เป็นที่มาของเครื่องหมาย "-" ที่โผล่ทุกจุดตัด แม้ตั้ง callback แล้ว
 * 3. **โค้ดพอยต์ U+200A (HAIR SPACE) เมื่อผ่าน `trim()` ของ JavaScript แล้วถูกตัดออกจริง** (อยู่ในกลุ่ม
 *    Unicode "Space Separator" ที่ ECMAScript spec นับเป็น WhiteSpace) จึงถูกจัดเป็น "glue" (ช่องว่าง
 *    ธรรมชาติ ไม่มี hyphen) และมีความกว้างแคบมากจนแทบมองไม่เห็นในเอกสารจริง (ยืนยันด้วยภาพจริงที่ scale
 *    ปกติระหว่าง QA) — เปลี่ยนอักขระ soft-break ทั้งหมดในไฟล์นี้จาก U+200B เป็น U+200A แล้ว
 *
 * บั๊ก 2 (S4 "ตัวอักษรท้าย block หายในเอกสารเต็ม" — เดิมระบุสาเหตุ `[UNVERIFIED]`): main thread ของ
 * T-501 หาสาเหตุ/ยืนยันด้วยการ render จริงแล้วอ่าน content stream ของ PDF ตรง ๆ (`pdfProbe.ts`,
 * ไม่ผ่าน ToUnicode ที่ไม่น่าเชื่อถือ) พบว่า: **glyph code 1-2 ตัวสุดท้ายของ text run สุดท้ายในแต่ละก้อน
 * `<Text>` ที่ตัดขึ้นบรรทัดใหม่ หายไปจริงจาก content stream** (ไม่ใช่แค่ mapping ผิด) — เกิดกับข้อความ
 * สั้นบรรทัดเดียวและย่อหน้ายาวหลายบรรทัดเหมือนกัน ไม่ขึ้นกับหน้า/`fixed`/`render(totalPages)` (ทดสอบแล้ว
 * ว่าเกิดใน `<Page>` เดี่ยว ๆ ที่มี `<Text>` เดียวโดยไม่มีองค์ประกอบอื่นเลย) จุดกำเนิดที่แท้จริงอยู่ใน
 * text-layout engine ของ pdfkit/fontkit (นอก repo, แก้ไม่ได้โดยไม่ patch dependency ซึ่ง CLAUDE.md/brief
 * ห้าม) จึงยังเป็น **`[UNVERIFIED]` ในระดับกลไกภายในไลบรารี** แต่ตำแหน่ง/เงื่อนไขที่เกิดยืนยันแล้วแน่นอน
 * ⇒ **ทางเลี่ยง**: เติมอักขระ "เสียสละ" ที่มองไม่เห็น 3 ตัว (โค้ดพอยต์ U+200A ซ้ำ 3 ครั้ง — ใช้ตัวเดียวกับ
 * บั๊ก 1 เพื่อไม่เพิ่มความเสี่ยงใหม่) ต่อท้ายทุกข้อความก่อนส่งเข้า `<Text>` เสมอ เพื่อให้ตัวที่ถูกตัดทิ้งเป็น
 * อักขระที่ไม่มีความหมายแทนเนื้อหาจริง — ยืนยันด้วยการ render จริงว่าเนื้อหาจริงไม่หายอีกต่อไป (ดู
 * `ProposalDocument.test.tsx` / `pdfProbe.ts`)
 *
 * บั๊ก 3 (S4 "ToUnicode ของข้อความไทยเชื่อถือไม่ได้"): กระทบแค่การค้นหา/คัดลอกข้อความในตัว PDF (ไม่กระทบ
 * ภาพที่มองเห็น) — สระ/วรรณยุกต์บางตัว (โดยเฉพาะที่เกี่ยวกับ `ำ` และอักขระที่ font ใช้ glyph ร่วมกัน)
 * มี ToUnicode ที่ไม่ตรงกับต้นฉบับ 100% (ตัวอย่างจริงจาก T-501: `สำนักงาน` ถูก decode กลับมาเป็น
 * `สำานักงา` — CID ของ `ำ` map เป็น 2 codepoint `ำ`+`า` เพราะแชร์ glyph กับบริบทอื่นตอน subset ฟอนต์)
 * spike เสนอให้ "normalize ก่อนเทียบ" ใน test — ทำที่ `normalizeToUnicodeArtifacts` (ใช้เฉพาะฝั่งตรวจสอบ
 * ผลลัพธ์ ไม่ใช้แปลงข้อความก่อน render เพราะจะทำให้ข้อความที่แสดงผิดไปจากต้นฉบับ)
 */

/** โค้ดพอยต์ U+200A (HAIR SPACE) — ดูเหตุผลที่เลือกตัวนี้แทน U+200B ในคอมเมนต์หัวไฟล์ (บั๊ก 1) สร้างด้วย
 * `String.fromCharCode` เสมอ (ไม่ฝัง raw character ตรง ๆ ในซอร์ส — กันปัญหาการเข้ารหัสตอนแก้ไฟล์ที่เคย
 * พบระหว่างพัฒนา T-501 จริงกับอักขระโค้ดพอยต์พิเศษหลายตัวในไฟล์นี้) */
const SOFT_BREAK = String.fromCharCode(0x200a);
/** สระอำ (U+0E33) และรูปแตก นิคหิต (U+0E4D) + สระอา (U+0E32) — ดูเหตุผลใน `toPdfText` */
const SARA_AM = String.fromCharCode(0x0e33);
const SARA_AM_DECOMPOSED = String.fromCharCode(0x0e4d) + String.fromCharCode(0x0e32);
/** จำนวนอักขระ "เสียสละ" ท้ายข้อความ — มากกว่าจำนวนตัวอักษรสูงสุดที่เคยพบว่าหาย (2 ตัว) 1 ตัวเผื่อไว้ */
const TRAILING_GUARD = SOFT_BREAK.repeat(3);

const DIGIT_CLASS = '0-9\\u0E50-\\u0E59';
/** เลขอารบิก/เลขไทย พร้อมตัวคั่นหลักพัน/จุดทศนิยม เช่น `1,234,567.89`, `๑,๒๓๔` — ไม่แทรก soft-break ข้างใน */
const NUMBER_SOURCE = `[${DIGIT_CLASS}]+(?:[.,][${DIGIT_CLASS}]+)*`;
/** URL http(s) แบบหยาบ (พอสำหรับกันไม่ให้แทรก soft-break กลาง URL ที่ปรากฏในเนื้อความ) */
const URL_SOURCE = String.raw`https?:\/\/[^\s"'<>)]+`;
const PROTECTED_RE = new RegExp(`(${URL_SOURCE})|(${NUMBER_SOURCE})`, 'gu');

const OPENING_ONLY_RE = /^[([{“‘"']+$/u;

let cachedSegmenter: Intl.Segmenter | undefined;
function getSegmenter(): Intl.Segmenter | null {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;
  cachedSegmenter ??= new Intl.Segmenter('th', { granularity: 'word' });
  return cachedSegmenter;
}

/** แทรก soft-break ระหว่างคู่ "คำ" (`isWordLike`) ที่อยู่ติดกันโดยไม่มีตัวคั่นธรรมชาติ (เช่น เว้นวรรค) คั่นอยู่
 * — ช่องว่าง/เครื่องหมายวรรคตอนที่มีอยู่แล้วเป็นจุดตัดบรรทัดตามธรรมชาติอยู่แล้ว ไม่ต้องแทรกซ้ำ */
function segmentWithSoftBreak(text: string, segmenter: Intl.Segmenter): string {
  let out = '';
  let prevWordLike = false;
  for (const seg of segmenter.segment(text)) {
    const isWordLike = seg.isWordLike ?? false;
    if (prevWordLike && isWordLike) out += SOFT_BREAK;
    out += seg.segment;
    prevWordLike = isWordLike;
  }
  return out;
}

/**
 * แทรกอักขระ soft-break (โค้ดพอยต์ U+200A) ตามขอบเขตคำภาษาไทยจาก `Intl.Segmenter` — ไม่แทรกภายใน
 * ตัวเลข/URL (แก้บั๊ก 1 ของ S4) ถ้า runtime ไม่มี `Intl.Segmenter` (เบราว์เซอร์เก่ามาก) จะคืนข้อความเดิม
 * โดยไม่แทรกอะไร (เสื่อมสภาพแบบปลอดภัย — ตัดบรรทัดผิดเหมือนเดิม แต่ไม่ throw)
 */
export function insertSoftBreaks(text: string): string {
  if (text.length === 0) return text;
  const segmenter = getSegmenter();
  if (segmenter === null) return text;

  let result = '';
  let lastIndex = 0;
  for (const m of text.matchAll(PROTECTED_RE)) {
    const idx = m.index;
    if (idx > lastIndex) result += segmentWithSoftBreak(text.slice(lastIndex, idx), segmenter);
    result += m[0];
    lastIndex = idx + m[0].length;
  }
  if (lastIndex < text.length) result += segmentWithSoftBreak(text.slice(lastIndex), segmenter);
  return result;
}

/**
 * ตัวช่วยหลักที่ควรใช้ก่อนส่งข้อความไทยทุกก้อนเข้า `<Text>` ของ react-pdf: `insertSoftBreaks` (บั๊ก 1)
 * + เติมอักขระเสียสละท้ายข้อความ (ทางเลี่ยงบั๊ก 2) ข้อความว่างคืนค่าว่างเดิม (ไม่ต้องป้องกันข้อความว่าง)
 */
export function toPdfText(text: string): string {
  if (text.length === 0) return text;
  // main thread (QA รอบภาพ): **ไม่แทรก soft-break ลงในข้อความแล้ว** — textkit ของ react-pdf ใส่ penalty node
  // (จุดตัดแบบมี hyphen) หลังทุก box ที่ syllable ถัดไปไม่ใช่ช่องว่างปกติ U+0020 เป๊ะ ๆ (`getNodes`:
  // `hyphenated = syllables[index + 1] !== ' '`) อักขระ soft-break ใด ๆ (U+200A/U+200B) จึงทำให้เกิด "-" ท้าย
  // บรรทัดเสมอ ("ใหญ่พิเศษ-", "ราคา-") จุดตัดคำไทยย้ายไปทำใน hyphenation callback (`splitForLineBreak`
  // + คั่นด้วยสตริงว่าง — ดู `fonts.ts`) ซึ่งพิสูจน์แล้วว่าตัดตามคำได้โดยไม่มี hyphen แปลกปลอม
  //
  // และ **แตกสระอำเป็น นิคหิต + สระอา ก่อนเสมอ**: react-pdf/fontkit แตก U+0E33 เป็น 2 ตัวภายในหลังจากที่
  // textkit คำนวณตำแหน่ง syllable จากสตริงเดิมไปแล้ว → จุดตัดบรรทัดเลื่อนไป 1 ตัวอักษรต่อ "ำ" หนึ่งตัว
  // ("ห้|อง", "พิ|เศษ" — ยืนยันด้วยการทดลอง 3 แบบ: ไม่มีอำ = ตัดถูก, อำรูปเดิม = เลื่อน, แตกเอง = ตัดถูก)
  // ภาพที่ได้เหมือนเดิมทุกประการ (ฟอนต์วาดจากคู่ นิคหิต+อา อยู่แล้ว)
  return text.replaceAll(SARA_AM, SARA_AM_DECOMPOSED) + TRAILING_GUARD;
}

/**
 * แตก "คำ" (ก้อนข้อความที่ไม่มี whitespace — หน่วยที่ textkit ส่งเข้า hyphenation callback) เป็นหน่วยย่อยที่
 * ยอมให้ตัดบรรทัดระหว่างกันได้: ขอบเขตคำไทยจาก `Intl.Segmenter`; ตัวเลข/URL ไม่ถูกแตก; เครื่องหมายวรรคตอน
 * เกาะกับหน่วยก่อนหน้า (ไม่ขึ้นต้นบรรทัดด้วย ")" หรือ ","); ไม่มี Segmenter → คืนทั้งคำ (ไม่ throw)
 */
export function splitForLineBreak(word: string): string[] {
  // คำที่มาถึงตรงนี้ผ่าน `toPdfText` แล้ว (สระอำถูกแตก) — Intl.Segmenter ตัดคำจากรูปแตกได้แย่ จึงประกอบกลับ
  // ก่อนตัด แล้วแตกคืนต่อหน่วย; ถ้าผลรวมความยาวไม่ตรงกับคำเดิม (รูปผสมที่ไม่คาดคิด) → ไม่ตัด ดีกว่าตัดผิดที่
  if (word.includes(SARA_AM_DECOMPOSED)) {
    const units = splitComposedWord(word.replaceAll(SARA_AM_DECOMPOSED, SARA_AM)).map((unit) =>
      unit.replaceAll(SARA_AM, SARA_AM_DECOMPOSED),
    );
    return units.join('') === word ? units : [word];
  }
  return splitComposedWord(word);
}

function splitComposedWord(word: string): string[] {
  const segmenter = getSegmenter();
  if (segmenter === null || word.length === 0) return [word];

  const units: string[] = [];
  const pushSegments = (chunk: string): void => {
    for (const seg of segmenter.segment(chunk)) {
      const isWordLike = seg.isWordLike ?? false;
      const last = units[units.length - 1];
      if (last !== undefined && OPENING_ONLY_RE.test(last)) {
        // วงเล็บ/อัญประกาศเปิดเกาะกับหน่วยถัดไป (ไม่ทิ้ง "(" ไว้ท้ายบรรทัด)
        units[units.length - 1] = `${last}${seg.segment}`;
      } else if (isWordLike || units.length === 0) {
        units.push(seg.segment);
      } else if (OPENING_ONLY_RE.test(seg.segment)) {
        units.push(seg.segment);
      } else {
        units[units.length - 1] = `${units[units.length - 1] ?? ''}${seg.segment}`;
      }
    }
  };

  let lastIndex = 0;
  for (const m of word.matchAll(PROTECTED_RE)) {
    const idx = m.index;
    if (idx > lastIndex) pushSegments(word.slice(lastIndex, idx));
    units.push(m[0]);
    lastIndex = idx + m[0].length;
  }
  if (lastIndex < word.length) pushSegments(word.slice(lastIndex));
  return units.length === 0 ? [word] : units;
}

/** ลบอักขระ soft-break (HAIR SPACE) ทั้งหมดออก — ใช้เทียบ "ข้อความจริง" กับสตริงต้นฉบับ (เช่นใน test snapshot) */
export function stripSoftBreaks(text: string): string {
  // และประกอบสระอำกลับ (toPdfText แตกไว้ — ดูเหตุผลที่นั่น) เพื่อให้เทียบกับข้อความต้นฉบับได้ตรงตัว
  return text.replaceAll(SOFT_BREAK, '').replaceAll(SARA_AM_DECOMPOSED, SARA_AM);
}

// สร้างด้วย String.fromCharCode แทนการฝัง raw control byte ตรง ๆ ในซอร์ส (กันปัญหาการเข้ารหัสตอน
// แก้ไฟล์ — ยืนยันจริงระหว่างพัฒนาว่า control byte ปนอักษรไทย/regex literal เสี่ยงเพี้ยนตอน write/edit)
const CONTROL_ARTIFACT_RANGE = new RegExp(
  `[${String.fromCharCode(0x1c)}-${String.fromCharCode(0x1f)}]`,
  'g',
);

/**
 * มาตรการสำหรับบั๊ก 3 (ToUnicode ไม่น่าเชื่อถือ): normalize ผลลัพธ์ที่ decode ได้จาก PDF ก่อนเทียบกับ
 * ข้อความต้นฉบับใน test เท่านั้น — **ไม่ใช้แปลงข้อความก่อน render**
 * - อักขระควบคุมโค้ดพอยต์ U+001C ถึง U+001F ที่เครื่องมือ extract บางตัว (เช่น pdf.js ตามที่ S4 พบ)
 *   ใช้แทน `า` ที่ map ผิด → แทนกลับเป็น `า`
 * - CID ของ `ำ` ที่ font แชร์ glyph กับบริบทอื่นทำให้ ToUnicode ยาวเกิน 1 ตัวอักษร (เช่น `ำ`+`า` ซ้อนกัน
 *   ทันทีหลัง `ำ` ตัวจริง) → ยุบ `ำา` ที่ซ้ำกันเหลือ `ำ` ตัวเดียว (ไม่กระทบ `ำ` ที่ตามด้วย `า` จริงในคำอื่น
 *   เพราะกรณีนั้นไม่ได้เกิดจาก glyph เดียวกันซ้อนกัน — แยกไม่ได้ 100% จากข้อความล้วน ๆ จึงรับเป็นเพดาน
 *   ความแม่นยำของ mitigation นี้ ตามที่ spike ระบุว่าเป็นเรื่องของการตรวจสอบเท่านั้น ไม่ใช่การแก้ที่ต้นเหตุ)
 */
export function normalizeToUnicodeArtifacts(text: string): string {
  return text
    .replace(CONTROL_ARTIFACT_RANGE, 'า')
    .replaceAll(SARA_AM_DECOMPOSED, SARA_AM)
    .replace(/ำา/g, 'ำ');
}
