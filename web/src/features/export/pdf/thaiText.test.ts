import { describe, expect, it } from 'vitest';
import {
  insertSoftBreaks,
  normalizeToUnicodeArtifacts,
  stripSoftBreaks,
  toPdfText,
} from './thaiText';

const SOFT_BREAK = String.fromCharCode(0x200a);

describe('insertSoftBreaks', () => {
  it('แทรก SOFT_BREAK ระหว่างคำไทยที่ติดกันไม่มีช่องว่างคั่น (คำยาวที่ react-pdf ตัดกลางคำ — S4 บั๊ก 1)', () => {
    const input = 'จังหวัดเชียงใหม่';
    const out = insertSoftBreaks(input);
    expect(out).not.toBe(input);
    expect(out.includes(SOFT_BREAK)).toBe(true);
    // ต้องไม่เพิ่ม/ลบอักขระที่มองเห็นจริง
    expect(stripSoftBreaks(out)).toBe(input);
  });

  it('ไม่แทรก SOFT_BREAK ในตัวเลขที่มีตัวคั่นหลักพัน/ทศนิยม', () => {
    const input = 'ยอดรวม 1,234,567.89 บาท';
    const out = insertSoftBreaks(input);
    expect(out).toContain('1,234,567.89');
  });

  it('ไม่แทรก SOFT_BREAK ในเลขไทย', () => {
    const input = 'จำนวน ๑,๒๓๔,๕๖๗.๘๙ บาท';
    const out = insertSoftBreaks(input);
    expect(out).toContain('๑,๒๓๔,๕๖๗.๘๙');
  });

  it('ไม่แทรก SOFT_BREAK ภายใน URL', () => {
    const input = 'ดูที่ https://shopee.co.th/สินค้าราคาถูก/12345?x=1 ก่อน';
    const out = insertSoftBreaks(input);
    expect(out).toContain('https://shopee.co.th/สินค้าราคาถูก/12345?x=1');
  });

  it('ข้อความผสมไทย/ตัวเลข/URL — protected span คงเดิมทุกจุด, ส่วนไทยได้ SOFT_BREAK', () => {
    const input = 'โครงการก่อสร้างฝายน้ำล้นงบประมาณ 2,450,000 บาท อ้างอิง https://example.go.th/doc/1';
    const out = insertSoftBreaks(input);
    expect(stripSoftBreaks(out)).toBe(input);
    expect(out).toContain('2,450,000');
    expect(out).toContain('https://example.go.th/doc/1');
    expect(out.includes(SOFT_BREAK)).toBe(true);
  });

  it('ข้อความว่างคืนค่าว่าง', () => {
    expect(insertSoftBreaks('')).toBe('');
  });

  it('คำที่แยกด้วยช่องว่างอยู่แล้ว (แต่ละคำ segmenter ไม่แบ่งย่อยอีก) ไม่มี SOFT_BREAK เพิ่ม', () => {
    const input = 'บ้าน ของ ฉัน';
    const out = insertSoftBreaks(input);
    // ไม่มีคำสองคำใดติดกันแบบไม่มีตัวคั่น จึงไม่ควรมี SOFT_BREAK เกิดขึ้นเลย
    expect(out).toBe(input);
  });
});

describe('toPdfText', () => {
  it('เท่ากับ insertSoftBreaks บวกอักขระเสียสละท้ายข้อความ (ทางเลี่ยงบั๊ก 2 ของ S4)', () => {
    const input = 'ฯลฯ';
    const out = toPdfText(input);
    expect(out.startsWith(insertSoftBreaks(input))).toBe(true);
    expect(out.length).toBeGreaterThan(insertSoftBreaks(input).length);
    expect(stripSoftBreaks(out)).toBe(input);
  });

  it('ข้อความว่างคืนค่าว่าง (ไม่เติมอักขระเสียสละให้ข้อความที่ไม่มีเนื้อหา)', () => {
    expect(toPdfText('')).toBe('');
  });
});

describe('stripSoftBreaks', () => {
  it('ลบ SOFT_BREAK ทุกตัวออกจนเหลือข้อความต้นฉบับ', () => {
    const input = `จังหวัด${SOFT_BREAK}เชียงใหม่${SOFT_BREAK}${SOFT_BREAK}`;
    expect(stripSoftBreaks(input)).toBe('จังหวัดเชียงใหม่');
  });
});

describe('normalizeToUnicodeArtifacts', () => {
  // สร้างอักขระควบคุมด้วย String.fromCharCode แทนการฝัง raw control byte ปนอักษรไทยตรง ๆ ในซอร์ส
  // (กันปัญหาการเข้ารหัสตอนแก้ไฟล์ — control byte ปน UTF-8 หลายไบต์เสี่ยงเพี้ยนตอน copy/edit)
  const CTRL_1E = String.fromCharCode(0x1e);
  const CTRL_1F = String.fromCharCode(0x1f);

  it('แทนอักขระควบคุม U+001C–U+001F กลับเป็น า', () => {
    expect(normalizeToUnicodeArtifacts(`ปฏิญ${CTRL_1F}ณ`)).toBe('ปฏิญาณ');
    expect(normalizeToUnicodeArtifacts(`ส${CTRL_1E}นักง${CTRL_1F}น`)).toBe('สานักงาน');
  });

  it('ยุบ ำา ที่ซ้อนกันทันที (glyph เดียวกันของ ำ ถูก map เป็น 2 codepoint) เหลือ ำ ตัวเดียว', () => {
    expect(normalizeToUnicodeArtifacts('สำานักงา')).toBe('สำนักงา');
    expect(normalizeToUnicodeArtifacts('ประจำาปี')).toBe('ประจำปี');
  });

  it('ไม่แตะข้อความที่ไม่มีสิ่งผิดปกติ', () => {
    expect(normalizeToUnicodeArtifacts('ขั้นต่ำ')).toBe('ขั้นต่ำ');
  });
});
