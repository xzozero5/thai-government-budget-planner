import { describe, expect, it } from 'vitest';
import { normalizeForQuoteMatch } from './textNormalize';

describe('normalizeForQuoteMatch (T-307 H2)', () => {
  it('พับช่องว่างที่หลุดอยู่ระหว่างอักษรไทย (OCR) ให้เท่ากับข้อความปกติ', () => {
    expect(normalizeForQuoteMatch('ส านักงาน')).toBe(normalizeForQuoteMatch('สำนักงาน'));
  });

  it('lower-case อักษรละติน', () => {
    expect(normalizeForQuoteMatch('CCTV')).toBe('cctv');
  });

  it('ตัดวรรคตอนเป็นช่องว่างและรวบช่องว่างซ้ำ', () => {
    expect(normalizeForQuoteMatch('เครื่องปรับอากาศ (แบบแยกส่วน)')).toBe('เครื่องปรับอากาศ แบบแยกส่วน');
  });

  it('deterministic — normalize ซ้ำได้ผลเดิม', () => {
    const input = 'งบประมาณของสำนักงานปลัดกระทรวง 2567';
    expect(normalizeForQuoteMatch(input)).toBe(normalizeForQuoteMatch(input));
  });
});
