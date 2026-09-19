/**
 * T-402 — ตัวช่วยจัดรูปแบบตัวเลข/เงิน/วันที่ ใช้ `Intl.NumberFormat('th-TH')` ทั้งหมด (CLAUDE.md §7)
 * ตัวเงินในระบบเก็บเป็น "บาท" จำนวนเต็มเสมอ (§7) — `formatThb` จึงไม่ใส่ทศนิยมเมื่อค่าที่รับมาเป็นจำนวนเต็ม
 * แต่ยังรองรับค่าที่มีเศษ (เช่น ผลคำนวณ qty × unit_price) เพื่อไม่ปัดข้อมูลทิ้งเงียบ ๆ
 */

const THAI_LOCALE = 'th-TH';

export interface FormatNumberOptions {
  /** จำนวนตำแหน่งทศนิยม (คงที่ทั้ง min/max) — ค่าเริ่มต้นให้ Intl ตัดสินเอง (0 ถ้าเป็นจำนวนเต็ม) */
  fractionDigits?: number;
}

/** จัดรูปแบบตัวเลขทั่วไปด้วยตัวคั่นหลักพันแบบไทย */
export function formatNumber(value: number, options: FormatNumberOptions = {}): string {
  const { fractionDigits } = options;
  if (fractionDigits === undefined) {
    return new Intl.NumberFormat(THAI_LOCALE).format(value);
  }
  return new Intl.NumberFormat(THAI_LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** จัดรูปแบบจำนวนเงินบาท: `฿` นำหน้า + ตัวคั่นหลักพัน; ไม่มีทศนิยมเมื่อเป็นจำนวนเต็ม */
export function formatThb(amountBaht: number): string {
  const isInteger = Number.isInteger(amountBaht);
  const formatted = new Intl.NumberFormat(THAI_LOCALE, {
    minimumFractionDigits: isInteger ? 0 : 2,
    maximumFractionDigits: isInteger ? 0 : 2,
  }).format(amountBaht);
  return `฿${formatted}`;
}

export interface FormatUsdOptions {
  /** จำนวนตำแหน่งทศนิยม — ค่าเริ่มต้น 4 (ต้นทุน token เป็นเศษส่วนดอลลาร์เล็กมาก) */
  fractionDigits?: number;
}

/** จัดรูปแบบจำนวนเงินดอลลาร์ (ต้นทุน API) — ทศนิยม 4 ตำแหน่งเป็นค่าเริ่มต้น */
export function formatUsd(amountUsd: number, options: FormatUsdOptions = {}): string {
  const fractionDigits = options.fractionDigits ?? 4;
  const formatted = new Intl.NumberFormat(THAI_LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amountUsd);
  return `$${formatted}`;
}

export interface FormatPercentOptions {
  /** `true` = ค่าที่ส่งมาเป็นเปอร์เซ็นต์อยู่แล้ว (เช่น 5.5 หมายถึง 5.5%); ค่าเริ่มต้น `false` = สัดส่วน 0–1 */
  alreadyPercent?: boolean;
  /** จำนวนตำแหน่งทศนิยม — ค่าเริ่มต้น 1 */
  fractionDigits?: number;
  /** ใส่เครื่องหมาย `+` หน้าเลขบวก (ใช้กับ Δ%) — ค่าเริ่มต้น `false` */
  showSign?: boolean;
}

/** จัดรูปแบบสัดส่วนเป็นเปอร์เซ็นต์ไทย เช่น `0.055` → `"5.5%"` */
export function formatPercent(value: number, options: FormatPercentOptions = {}): string {
  const { alreadyPercent = false, fractionDigits = 1, showSign = false } = options;
  const percentValue = alreadyPercent ? value : value * 100;
  const formatted = new Intl.NumberFormat(THAI_LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    signDisplay: showSign ? 'exceptZero' : 'auto',
  }).format(percentValue);
  return `${formatted}%`;
}

export interface FormatFiscalYearBeOptions {
  /** `true` = ค่าที่รับมาเป็นปี ค.ศ. ต้อง +543 ก่อนแสดงผล — ค่าเริ่มต้น `false` (ข้อมูลเก็บเป็น พ.ศ. อยู่แล้ว) */
  fromCe?: boolean;
  /** เติมคำว่า "พ.ศ. " นำหน้า — ค่าเริ่มต้น `false` (คืนเฉพาะตัวเลข) */
  withEra?: boolean;
}

/**
 * จัดรูปแบบปีงบประมาณเป็น พ.ศ. — ตัวเลขปีไม่ใส่ตัวคั่นหลักพัน (ปีไม่ใช่ปริมาณ)
 * ค่าเริ่มต้นรับปี พ.ศ. ตรง ๆ ตาม schema `fiscal_year_be` (CLAUDE.md §7)
 */
export function formatFiscalYearBe(year: number, options: FormatFiscalYearBeOptions = {}): string {
  const { fromCe = false, withEra = false } = options;
  const beYear = fromCe ? year + 543 : year;
  const digits = String(beYear);
  return withEra ? `พ.ศ. ${digits}` : digits;
}
