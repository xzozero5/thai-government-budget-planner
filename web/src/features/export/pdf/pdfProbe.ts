/**
 * T-501 — เครื่องมือตรวจสอบ PDF ที่ render จริง "ตรง ๆ จาก bytes" สำหรับ test เท่านั้น (ไม่ export
 * ไปใช้ใน production UI) เขียนเองด้วย Node built-in (`zlib`) ล้วน ๆ — **ไม่เพิ่ม dependency** (ห้ามใช้
 * pdfjs-dist ตาม brief ของงานนี้)
 *
 * ขอบเขต: รองรับเฉพาะโครงสร้างที่ `@react-pdf/renderer@4.9.0` (มาจาก pdfkit) สร้างจริง (ยืนยันด้วยการ
 * render ตัวอย่างจริงหลายแบบระหว่างพัฒนา T-501) — ไม่ใช่ PDF parser ทั่วไป:
 * - object ระดับบนไม่ถูกอัดเป็น object stream (compressed xref) จึงอ่าน dict เป็น text ธรรมดาได้ตรง ๆ
 * - เฉพาะ content stream / ToUnicode CMap / image XObject เท่านั้นที่ถูก `/Filter /FlateDecode`
 * - ฟอนต์ทุกตัวเป็น Type0/Identity-H (CID 2 ไบต์ต่อ glyph)
 *
 * ใช้พิสูจน์บั๊กของ S4 (docs/decisions/SPIKES.md §S4) จริงระหว่างพัฒนา (ดู thaiText.ts หัวไฟล์สำหรับ
 * สรุปผล): bug "ตัวอักษรท้าย block หาย" เป็นการที่ glyph code 1-2 ตัวสุดท้ายของ text run ท้ายสุดใน
 * `<Text>` **หายไปจริงจาก content stream** (ไม่ใช่แค่ ToUnicode ผิด) — ทำให้ยืนยันได้ว่าการแทรก
 * "ตัวป้องกัน" (zero-width space) 2 ตัวท้ายข้อความช่วยได้จริง เพราะตัวที่หายไปกลายเป็นตัวป้องกันที่ไม่มี
 * ความหมายแทนที่จะเป็นเนื้อหาจริง
 */

import { inflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// ระดับล่างสุด: แกะ "N 0 obj ... endobj" ทั้งไฟล์ เป็น dict text + stream bytes (ถอด Flate ให้แล้ว)
// ---------------------------------------------------------------------------

interface PdfObject {
  /** เนื้อหาของ dict (ไม่รวม `<<`/`>>` รอบนอก) */
  dict: string;
  /** stream ที่ decompress แล้ว (null ถ้า object นี้ไม่มี stream) */
  stream: Buffer | null;
}

/** หา index ของ `>>` ที่ปิดคู่กับ `<<` ที่ตำแหน่ง `openIdx` (นับความลึกของ `<<`/`>>` ที่ซ้อนกัน) */
function findMatchingDictEnd(text: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  while (i < text.length) {
    if (text.startsWith('<<', i)) {
      depth += 1;
      i += 2;
      continue;
    }
    if (text.startsWith('>>', i)) {
      depth -= 1;
      i += 2;
      if (depth === 0) return i;
      continue;
    }
    i += 1;
  }
  throw new Error('malformed PDF: unterminated dict');
}

/** parse ไฟล์ PDF ทั้งก้อนเป็น map ของ object number -> {dict, stream} */
function parsePdfObjects(buf: Buffer): Map<number, PdfObject> {
  const latin1 = buf.toString('latin1');
  const objects = new Map<number, PdfObject>();
  const objRe = /(\d+)\s+0\s+obj/g;
  let match: RegExpExecArray | null;
  while ((match = objRe.exec(latin1)) !== null) {
    const num = Number(match[1]);
    const afterHeader = objRe.lastIndex;

    // ไม่ใช่ทุก object จะเป็น dict — pdfkit เก็บค่าของ Info dict (Producer/Creator/CreationDate/
    // Title/Author/Subject) เป็น indirect object แยกที่เป็น **literal string ล้วน ๆ**
    // (เช่น `22 0 obj\n(react-pdf)\nendobj`) ไม่มี `<<` เลย — ถ้าใช้ `indexOf('<<', afterHeader)`
    // ตรง ๆ จะเลื่อนไปเจอ `<<` ของ object dict ตัวถัดไปที่อยู่ไกลออกไปผิดจุด (ยืนยันจากการรัน T-501 จริง)
    // ⇒ ต้องดูว่าตัวอักษรที่ไม่ใช่ช่องว่างตัวแรกหลัง "N 0 obj" คือ `<<` จริงหรือไม่ก่อนเสมอ
    const afterHeaderTrim = /^\s*/.exec(latin1.slice(afterHeader));
    const leadingWs = afterHeaderTrim?.[0].length ?? 0;
    const valueStart = afterHeader + leadingWs;
    if (!latin1.startsWith('<<', valueStart)) {
      // object ที่ไม่ใช่ dict (string/number/array/reference ตรง ๆ) — เราไม่ต้องอ่านเนื้อหา แค่ข้าม
      // ไปที่ "endobj" ของมันให้ถูกต้อง เพื่อไม่ให้ regex object header ตัวถัดไปเพี้ยน
      const endobjIdx = latin1.indexOf('endobj', valueStart);
      if (endobjIdx === -1) continue;
      objects.set(num, { dict: '', stream: null });
      objRe.lastIndex = Math.max(objRe.lastIndex, endobjIdx + 'endobj'.length);
      continue;
    }
    const dictOpen = valueStart;
    const dictEnd = findMatchingDictEnd(latin1, dictOpen);
    const dict = latin1.slice(dictOpen + 2, dictEnd - 2);

    // สำคัญ: ต้องรู้ตำแหน่งจบของ stream **ก่อน** หา `endobj` เสมอ — ห้ามใช้ `indexOf('endobj', ...)`
    // ตรง ๆ ข้าม stream เพราะข้อมูล binary ที่ถูกบีบอัด (FlateDecode) มีโอกาสสูงที่จะบังเอิญมีลำดับไบต์
    // ตรงกับ ASCII "endobj"/"endstream" ปนอยู่จริง (ยืนยันจากการรัน T-501 กับเอกสารที่มีหลายหน้า) — ใช้
    // ค่า `/Length` ที่ pdfkit ใส่มาให้เสมอ (เป็นจำนวนไบต์ตรง ๆ ไม่ใช่ indirect reference) แทนการค้นหา
    // "endstream" ด้วยสตริง
    let stream: Buffer | null = null;
    let cursor = dictEnd;
    const afterDict = /^\s*/.exec(latin1.slice(dictEnd));
    const whitespaceLen = afterDict?.[0].length ?? 0;
    const streamKeywordIdx = dictEnd + whitespaceLen;
    if (latin1.startsWith('stream', streamKeywordIdx)) {
      const lengthMatch = /\/Length\s+(\d+)/.exec(dict);
      if (lengthMatch?.[1] === undefined) {
        throw new Error(`object ${String(num)} มี stream แต่ไม่มี /Length เป็นจำนวนเต็มตรง ๆ`);
      }
      const length = Number(lengthMatch[1]);
      // "stream" ตามด้วย CRLF หรือ LF อย่างใดอย่างหนึ่งเสมอ (สเปก PDF) ก่อนไบต์แรกของข้อมูลจริง
      let bodyStart = streamKeywordIdx + 'stream'.length;
      if (latin1.startsWith('\r\n', bodyStart)) bodyStart += 2;
      else if (latin1.startsWith('\n', bodyStart)) bodyStart += 1;
      const bodyEnd = bodyStart + length;
      const rawBuf = Buffer.from(latin1.slice(bodyStart, bodyEnd), 'latin1');
      stream = /\/Filter\s*\/FlateDecode/.test(dict) ? inflateSync(rawBuf) : rawBuf;
      cursor = bodyEnd;
    }
    const endobjIdx = latin1.indexOf('endobj', cursor);
    if (endobjIdx === -1) continue; // ไม่ควรเกิด — กันไว้เผื่อไฟล์ผิดรูป
    objects.set(num, { dict, stream });
    // เลื่อน cursor ของ regex ข้าม stream/endobj ที่เพิ่งอ่านไปแล้ว กัน "N 0 obj" ปลอมที่อาจบังเอิญ
    // ปรากฏในข้อมูล binary ของ stream ถูกตีความเป็น object header ซ้ำ
    objRe.lastIndex = Math.max(objRe.lastIndex, endobjIdx + 'endobj'.length);
  }
  return objects;
}

/**
 * แกะ dict text (เนื้อหาระดับบนสุด ไม่รวม `<<`/`>>`) เป็น key -> raw value text (ยังไม่ parse ชนิดข้อมูล)
 * รองรับ nested `<<>>`/`[]`/`(...)` (คุมความลึกไม่ให้ตัด value กลางคัน)
 */
function scanDictEntries(dictBody: string): Map<string, string> {
  const entries = new Map<string, string>();
  let i = 0;
  const n = dictBody.length;
  while (i < n) {
    while (i < n && /\s/.test(dictBody[i] ?? '')) i += 1;
    if (i >= n) break;
    if (dictBody[i] !== '/') {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < n && !/[\s/<>[\]()]/.test(dictBody[j] ?? '')) j += 1;
    const key = dictBody.slice(i + 1, j);
    i = j;
    while (i < n && /\s/.test(dictBody[i] ?? '')) i += 1;
    const valueStart = i;
    let depth = 0;
    // ค่าที่เป็น Name (ขึ้นต้นด้วย `/` เช่น `/Type /Pages`) ต้องกลืนตัวมันเองก่อนเสมอ — มิฉะนั้นเงื่อนไข
    // "เจอ `/` ที่ depth 0 แปลว่าคีย์ถัดไป" ด้านล่างจะตัดค่านี้ทิ้งทันทีตั้งแต่ตัวอักษรแรก (เคยพัง: ตีความ
    // `/Type /Pages` เป็นคีย์ "Type" ค่าว่าง แล้วคีย์ "Pages" ค่าว่าง แยกกันผิด ๆ)
    if (i < n && dictBody[i] === '/') {
      i += 1;
      while (i < n && !/[\s/<>[\]()]/.test(dictBody[i] ?? '')) i += 1;
    }
    while (i < n) {
      if (dictBody.startsWith('<<', i)) {
        depth += 1;
        i += 2;
        continue;
      }
      if (dictBody.startsWith('>>', i)) {
        depth -= 1;
        i += 2;
        continue;
      }
      const ch = dictBody[i];
      if (ch === '[') {
        depth += 1;
        i += 1;
        continue;
      }
      if (ch === ']') {
        depth -= 1;
        i += 1;
        continue;
      }
      if (ch === '(') {
        i += 1;
        let strDepth = 1;
        while (i < n && strDepth > 0) {
          if (dictBody[i] === '\\') {
            i += 2;
            continue;
          }
          if (dictBody[i] === '(') strDepth += 1;
          else if (dictBody[i] === ')') strDepth -= 1;
          i += 1;
        }
        continue;
      }
      if (depth === 0 && ch === '/') break;
      i += 1;
    }
    entries.set(key, dictBody.slice(valueStart, i).trim());
  }
  return entries;
}

/** `/Foo 12 0 R` -> `12`; คืน `null` ถ้าไม่ใช่ indirect reference */
function parseRef(value: string): number | null {
  const m = /^(\d+)\s+0\s+R$/.exec(value.trim());
  return m?.[1] !== undefined ? Number(m[1]) : null;
}

/** `/Name` (นำหน้าด้วย `/`) -> `Name` */
function parseNameValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.startsWith('/') ? trimmed.slice(1) : null;
}

/** `(literal string)` -> เนื้อหาข้างใน (unescape `\(`, `\)`, `\\` พื้นฐาน) */
function parseLiteralString(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return null;
  return trimmed
    .slice(1, -1)
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

// ---------------------------------------------------------------------------
// Public: ตรวจสอบระดับไฟล์
// ---------------------------------------------------------------------------

/** PDF ทุกไฟล์ต้องขึ้นต้นด้วย `%PDF` (magic bytes) */
export function pdfHasValidHeader(buf: Buffer): boolean {
  return buf.subarray(0, 4).toString('latin1') === '%PDF';
}

/** จำนวนหน้าทั้งหมด จาก `/Type /Pages` ต้นไม้หลัก (`/Count`) */
export function pdfPageCount(buf: Buffer): number {
  const objects = parsePdfObjects(buf);
  for (const obj of objects.values()) {
    const entries = scanDictEntries(obj.dict);
    if (parseNameValue(entries.get('Type') ?? '') === 'Pages') {
      const count = entries.get('Count');
      if (count !== undefined) return Number(count.trim());
    }
  }
  throw new Error('ไม่พบ object /Type /Pages ใน PDF นี้');
}

/** ชื่อฟอนต์ที่ embed จริงทั้งหมด (`/BaseFont`, ตัด subset tag `ABCDEF+` ออกให้) ไม่ซ้ำ */
export function pdfEmbeddedFontNames(buf: Buffer): string[] {
  const objects = parsePdfObjects(buf);
  const names = new Set<string>();
  for (const obj of objects.values()) {
    const entries = scanDictEntries(obj.dict);
    const baseFont = entries.get('BaseFont');
    if (baseFont === undefined) continue;
    const name = parseNameValue(baseFont);
    if (name === null) continue;
    names.add(name.replace(/^[A-Z]{6}\+/, ''));
  }
  return [...names];
}

/** URL ทั้งหมดจาก link annotation (`/Subtype /Link` -> `/A` -> `/URI`) */
export function pdfLinkUris(buf: Buffer): string[] {
  const objects = parsePdfObjects(buf);
  const uris: string[] = [];
  for (const obj of objects.values()) {
    const entries = scanDictEntries(obj.dict);
    if (parseNameValue(entries.get('Subtype') ?? '') !== 'Link') continue;
    const actionRefValue = entries.get('A');
    if (actionRefValue === undefined) continue;
    const actionRef = parseRef(actionRefValue);
    const actionDict = actionRef !== null ? objects.get(actionRef) : undefined;
    if (actionDict === undefined) continue;
    const actionEntries = scanDictEntries(actionDict.dict);
    const uriValue = actionEntries.get('URI');
    if (uriValue === undefined) continue;
    const uri = parseLiteralString(uriValue);
    if (uri !== null) uris.push(uri);
  }
  return uris;
}

/** มี image XObject อย่างน้อยหนึ่งชิ้นหรือไม่ (`/Subtype /Image`) */
export function pdfHasImageObject(buf: Buffer): boolean {
  const objects = parsePdfObjects(buf);
  for (const obj of objects.values()) {
    const entries = scanDictEntries(obj.dict);
    if (parseNameValue(entries.get('Subtype') ?? '') === 'Image') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public: decode ข้อความจาก content stream ผ่าน ToUnicode CMap ของฟอนต์ที่ active ตอนวาด
// (ใช้เฉพาะใน test เพื่อยืนยัน mitigation ของบั๊ก "ตัวอักษรท้าย block หาย" — ดูหัวไฟล์)
// ---------------------------------------------------------------------------

/** แกะ `beginbfrange ... endbfrange` (1 ช่วง — พอสำหรับฟอนต์ subset เดียวของ react-pdf) เป็น CID -> string
 * (บาง CID แทน "กลุ่มอักขระ" มากกว่า 1 codepoint เช่น ligature ของฟอนต์ — ดูหัวไฟล์) */
function parseToUnicodeCMap(cmapText: string): Map<number, string> {
  const map = new Map<number, string>();
  const rangeRe = /beginbfrange\s*\n((?:<[0-9a-fA-F]+>\s*<[0-9a-fA-F]+>\s*\[[^\]]*\]\s*\n?)+)endbfrange/g;
  let rangeMatch: RegExpExecArray | null;
  while ((rangeMatch = rangeRe.exec(cmapText)) !== null) {
    const block = rangeMatch[1] ?? '';
    const entryRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]*)\]/g;
    let entryMatch: RegExpExecArray | null;
    while ((entryMatch = entryRe.exec(block)) !== null) {
      const startCid = parseInt(entryMatch[1] ?? '0', 16);
      const values = [...(entryMatch[3] ?? '').matchAll(/<([0-9a-fA-F]+(?:\s+[0-9a-fA-F]+)*)>/g)].map(
        (m) => m[1] ?? '',
      );
      values.forEach((hexSeq, offset) => {
        const codePoints = hexSeq.split(/\s+/).map((h) => String.fromCodePoint(parseInt(h, 16)));
        map.set(startCid + offset, codePoints.join(''));
      });
    }
  }
  return map;
}

/** หา object number ของฟอนต์ต่าง ๆ ที่ผูกกับชื่อ resource (เช่น `/F1`) จาก `/Resources -> /Font` ของหน้า
 * (ใช้ resource dict ตรง ๆ ของแต่ละหน้า — react-pdf ไม่แชร์ resource dict ข้ามหน้า) */
function resolveFontResourceMap(
  objects: Map<number, PdfObject>,
  resourcesRef: number,
): Map<string, number> {
  const result = new Map<string, number>();
  const resourcesObj = objects.get(resourcesRef);
  if (resourcesObj === undefined) return result;
  const resourceEntries = scanDictEntries(resourcesObj.dict);
  const fontDictValue = resourceEntries.get('Font');
  if (fontDictValue === undefined) return result;
  const fontRefMatch = parseRef(fontDictValue);
  const fontDictText =
    fontRefMatch !== null
      ? (objects.get(fontRefMatch)?.dict ?? '')
      : fontDictValue.replace(/^<<|>>$/g, '');
  const fontEntries = scanDictEntries(fontDictText);
  for (const [name, refValue] of fontEntries) {
    const ref = parseRef(refValue);
    if (ref !== null) result.set(`/${name}`, ref);
  }
  return result;
}

/** ToUnicode CMap (decode แล้ว) ของ font object number หนึ่งตัว — `null` ถ้าไม่มี/หาไม่เจอ */
function getToUnicodeMap(objects: Map<number, PdfObject>, fontObjNum: number): Map<number, string> | null {
  const fontObj = objects.get(fontObjNum);
  if (fontObj === undefined) return null;
  const entries = scanDictEntries(fontObj.dict);
  const toUnicodeRefValue = entries.get('ToUnicode');
  if (toUnicodeRefValue === undefined) return null;
  const ref = parseRef(toUnicodeRefValue);
  if (ref === null) return null;
  const cmapObj = objects.get(ref);
  if (cmapObj?.stream == null) return null;
  return parseToUnicodeCMap(cmapObj.stream.toString('latin1'));
}

export interface PageTextRun {
  /** ชื่อ font resource ที่ active ตอนวาด (เช่น `/F2`) */
  fontResource: string;
  /** ข้อความที่ decode ได้ (อาจมีอักขระเพี้ยนจากบั๊ก ToUnicode ของ S4 — ใช้ normalizeToUnicodeArtifacts ก่อนเทียบ) */
  text: string;
}

/**
 * decode ข้อความทั้งหมดที่วาดจริงในหน้าเดียว เรียงตามลำดับที่ปรากฏใน content stream — best-effort
 * (พอสำหรับ regression test ของบั๊ก S4 เท่านั้น ไม่ใช่ text extraction ทั่วไป: ไม่จัดการ TJ ที่มี
 * ตัวเลข kerning แทรกกลาง glyph run เป็นคำละคำ, ไม่รองรับ vertical writing mode ฯลฯ)
 */
export function decodePageTextRuns(buf: Buffer, pageIndex: number): PageTextRun[] {
  const objects = parsePdfObjects(buf);
  const pageObjNums: number[] = [];
  for (const [num, obj] of objects) {
    const entries = scanDictEntries(obj.dict);
    if (parseNameValue(entries.get('Type') ?? '') === 'Page') pageObjNums.push(num);
  }
  pageObjNums.sort((a, b) => a - b);
  const pageNum = pageObjNums[pageIndex];
  if (pageNum === undefined) throw new Error(`ไม่พบหน้าที่ index ${String(pageIndex)}`);
  const pageEntries = scanDictEntries(objects.get(pageNum)?.dict ?? '');

  const resourcesRefValue = pageEntries.get('Resources');
  const resourcesRef = resourcesRefValue !== undefined ? parseRef(resourcesRefValue) : null;
  const fontResourceMap =
    resourcesRef !== null ? resolveFontResourceMap(objects, resourcesRef) : new Map<string, number>();

  const contentsValue = pageEntries.get('Contents');
  const contentRefs: number[] = [];
  if (contentsValue !== undefined) {
    const single = parseRef(contentsValue);
    if (single !== null) contentRefs.push(single);
    else {
      for (const m of contentsValue.matchAll(/(\d+)\s+0\s+R/g)) contentRefs.push(Number(m[1]));
    }
  }
  const contentText = contentRefs
    .map((ref) => objects.get(ref)?.stream?.toString('latin1') ?? '')
    .join('\n');

  const runs: PageTextRun[] = [];
  let activeFontResource: string | null = null;
  let activeMap: Map<number, string> | null = null;
  const tokenRe = /\/(F\w+)\s+[\d.]+\s+Tf|\[((?:<[0-9a-fA-F]+>\s*-?[\d.]+\s*)+)\]\s*TJ/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(contentText)) !== null) {
    const fontName = m[1];
    const tjArray = m[2];
    if (fontName !== undefined) {
      activeFontResource = `/${fontName}`;
      const fontObjNum = fontResourceMap.get(activeFontResource);
      activeMap = fontObjNum !== undefined ? getToUnicodeMap(objects, fontObjNum) : null;
      continue;
    }
    if (tjArray !== undefined && activeMap !== null && activeFontResource !== null) {
      let text = '';
      for (const g of tjArray.matchAll(/<([0-9a-fA-F]+)>/g)) {
        const hex = g[1] ?? '';
        for (let i = 0; i < hex.length; i += 4) {
          const cid = parseInt(hex.slice(i, i + 4), 16);
          text += activeMap.get(cid) ?? '�';
        }
      }
      runs.push({ fontResource: activeFontResource, text });
    }
  }
  return runs;
}
