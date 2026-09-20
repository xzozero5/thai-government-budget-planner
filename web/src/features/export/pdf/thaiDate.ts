/**
 * T-501 — จัดรูปแบบวันที่เป็น พ.ศ. สำหรับหน้าปก/footer ของ PDF (CLAUDE.md §7: ปีงบประมาณ/วันที่ใช้ พ.ศ.)
 *
 * อยู่ในไฟล์ของ pdf feature เอง (ไม่ใช่ `@/lib/format.ts`) เพราะ agent นี้ห้ามแก้ไฟล์นอก
 * `features/export/pdf/**` — `lib/format.ts` มีแต่ตัวช่วยตัวเลข/เงิน ไม่มีตัวช่วยวันที่พ.ศ.
 */

const THAI_BUDDHIST_LOCALE = 'th-TH-u-ca-buddhist';

/** เช่น `20 กันยายน 2569` — วัน เดือนเต็มภาษาไทย ปี พ.ศ. */
export function formatThaiBuddhistDate(date: Date): string {
  return new Intl.DateTimeFormat(THAI_BUDDHIST_LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/** เช่น `20 กันยายน 2569 เวลา 14:05 น.` — ใช้ใน footer ที่ต้องการเวลาด้วย */
export function formatThaiBuddhistDateTime(date: Date): string {
  const datePart = formatThaiBuddhistDate(date);
  const timePart = new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${datePart} เวลา ${timePart} น.`;
}
