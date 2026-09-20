/**
 * main thread (QA รอบภาพของ T-501): กันถอยหลัง 2 บั๊กของการตัดบรรทัดไทยใน react-pdf ที่พิสูจน์ด้วยภาพจริง
 * 1) อักขระ soft-break ใด ๆ ในข้อความ → textkit เติม "-" ท้ายบรรทัด ⇒ จุดตัดต้องมาจาก hyphenation callback
 * 2) สระอำ (U+0E33) ถูกแตกเป็น 2 ตัวภายใน → ตำแหน่งตัดเลื่อน ("ห้|อง", "พิ|เศษ") ⇒ ต้องแตกเองก่อน
 */
import { describe, expect, it } from 'vitest';
import { splitForLineBreak, stripSoftBreaks, toPdfText } from './thaiText';

const SARA_AM = String.fromCharCode(0x0e33);
const DECOMPOSED = String.fromCharCode(0x0e4d) + String.fromCharCode(0x0e32);

describe('toPdfText', () => {
  it('แตกสระอำทุกตัว และไม่แทรก soft-break (U+200A/U+200B) ระหว่างคำ', () => {
    const out = toPdfText('สำหรับสำนักงานจำนวน 4 เครื่อง');
    expect(out).not.toContain(SARA_AM);
    expect(out.split(DECOMPOSED)).toHaveLength(4);
    const body = out.trimEnd();
    expect(body).not.toContain(String.fromCharCode(0x200a));
    expect(body).not.toContain(String.fromCharCode(0x200b));
  });

  it('stripSoftBreaks คืนข้อความต้นฉบับตรงตัว (ประกอบสระอำกลับ)', () => {
    const raw = 'สำหรับห้องประชุมสำนักงาน ราคา 1,234,567.89 บาท';
    expect(stripSoftBreaks(toPdfText(raw))).toBe(raw);
  });
});

describe('splitForLineBreak', () => {
  it('ตัดตามคำไทย และผลรวมของหน่วยต้องเท่ากับคำเดิมทุกตัวอักษร (ตำแหน่งตัดห้ามเลื่อน)', () => {
    const word = toPdfText('ไม่ใช่ห้องใหญ่พิเศษหรือห้องประชุมสำหรับสำนักงาน').trimEnd();
    const units = splitForLineBreak(word);
    expect(units.join('')).toBe(word);
    expect(units.map((u) => u.replaceAll(DECOMPOSED, SARA_AM))).toEqual(
      expect.arrayContaining(['ห้อง', 'ใหญ่', 'พิเศษ', 'สำหรับ', 'สำนักงาน']),
    );
  });

  it('ไม่มีหน่วยใดขึ้นต้นด้วยสระ/วรรณยุกต์ที่ต้องเกาะตัวอักษรก่อนหน้า', () => {
    const word = toPdfText(
      'ความไม่แน่นอนหรือปรึกษาคณะกรรมการการจัดซื้อและจัดจ้างท้องถิ่น',
    ).trimEnd();
    for (const unit of splitForLineBreak(word)) {
      expect(unit).not.toMatch(/^[ะ-ฺ็-๎]/u);
    }
  });

  it('ตัวเลข/URL ไม่ถูกแตก, วงเล็บเปิดเกาะกับคำถัดไป, วงเล็บปิดเกาะกับคำก่อนหน้า', () => {
    expect(splitForLineBreak('1,234,567.89')).toEqual(['1,234,567.89']);
    expect(splitForLineBreak('https://example.com/a?b=1')).toEqual(['https://example.com/a?b=1']);
    const units = splitForLineBreak('(ไม่ใช่ห้องใหญ่)');
    expect(units[0]?.startsWith('(')).toBe(true);
    expect(units[0]?.length).toBeGreaterThan(1);
    expect(units[units.length - 1]?.endsWith(')')).toBe(true);
    expect(units.join('')).toBe('(ไม่ใช่ห้องใหญ่)');
  });
});
