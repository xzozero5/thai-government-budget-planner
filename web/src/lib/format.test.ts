import { describe, expect, it } from 'vitest';
import {
  formatFiscalYearBe,
  formatNumber,
  formatPercent,
  formatThb,
  formatUsd,
} from '@/lib/format';

describe('formatNumber', () => {
  it('ใส่ตัวคั่นหลักพันแบบไทย', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('รองรับ fractionDigits คงที่', () => {
    expect(formatNumber(1234.5, { fractionDigits: 2 })).toBe('1,234.50');
  });
});

describe('formatThb', () => {
  it('ไม่มีทศนิยมเมื่อเป็นจำนวนเต็ม และมี ฿ นำหน้า', () => {
    expect(formatThb(3_185_000_000_000)).toBe('฿3,185,000,000,000');
  });

  it('มีทศนิยม 2 ตำแหน่งเมื่อค่ามีเศษ', () => {
    expect(formatThb(1500.5)).toBe('฿1,500.50');
  });

  it('รองรับ 0', () => {
    expect(formatThb(0)).toBe('฿0');
  });
});

describe('formatUsd', () => {
  it('ทศนิยม 4 ตำแหน่งเป็นค่าเริ่มต้น', () => {
    expect(formatUsd(0.145321)).toBe('$0.1453');
  });

  it('ปรับจำนวนตำแหน่งทศนิยมได้', () => {
    expect(formatUsd(2, { fractionDigits: 2 })).toBe('$2.00');
  });
});

describe('formatPercent', () => {
  it('ค่าเริ่มต้นตีความว่าเป็นสัดส่วน 0–1', () => {
    expect(formatPercent(0.055)).toBe('5.5%');
  });

  it('alreadyPercent:true ใช้ค่าตรง ๆ', () => {
    expect(formatPercent(5.5, { alreadyPercent: true })).toBe('5.5%');
  });

  it('showSign ใส่เครื่องหมาย + ให้ค่าบวก', () => {
    expect(formatPercent(0.02, { showSign: true })).toBe('+2.0%');
    expect(formatPercent(-0.02, { showSign: true })).toBe('-2.0%');
    expect(formatPercent(0, { showSign: true })).toBe('0.0%');
  });
});

describe('formatFiscalYearBe', () => {
  it('ค่าเริ่มต้น: รับปี พ.ศ. ตรง ๆ ไม่มีตัวคั่นหลักพัน', () => {
    expect(formatFiscalYearBe(2567)).toBe('2567');
  });

  it('fromCe:true บวก 543', () => {
    expect(formatFiscalYearBe(2024, { fromCe: true })).toBe('2567');
  });

  it('withEra:true เติม "พ.ศ. " นำหน้า', () => {
    expect(formatFiscalYearBe(2567, { withEra: true })).toBe('พ.ศ. 2567');
  });
});
