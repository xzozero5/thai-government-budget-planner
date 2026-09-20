/**
 * T-501 — จัดรูปแบบวันที่เป็น พ.ศ. สำหรับหน้าปก/footer ของ PDF (CLAUDE.md §7: ปีงบประมาณ/วันที่ใช้ พ.ศ.)
 *
 * อยู่ในไฟล์ของ pdf feature เอง (ไม่ใช่ `@/lib/format.ts`) เพราะ agent นี้ห้ามแก้ไฟล์นอก
 * `features/export/pdf/**` — `lib/format.ts` มีแต่ตัวช่วยตัวเลข/เงิน ไม่มีตัวช่วยวันที่พ.ศ.
 *
 * T-602 (NEW-H1 ส่วนที่เหลือ) — เดิม `Intl.DateTimeFormat#format` โยน `RangeError` เมื่อได้ `Date` ที่
 * invalid (เช่น `new Date(1e16)` จาก `createdAt` ของไฟล์ `.tgbp.json` ที่ยังไม่ได้จำกัดขอบเขต — ดู
 * `features/export/tgbpFile.ts`) ระหว่าง render ตรง ๆ ไม่ผ่าน error boundary ก่อน (component tree ทั้ง
 * ก้อนถูก React unmount กลางทาง) การ์ดค่า invalid ไว้ที่นี่เป็นชั้นป้องกันที่สองอีกชั้น (นอกเหนือจากขอบเขต
 * ของ schema + ErrorBoundary รอบ `ProposalPane`)
 */
import { t } from '@/i18n';

const THAI_BUDDHIST_LOCALE = 'th-TH-u-ca-buddhist';

/** เช่น `20 กันยายน 2569` — วัน เดือนเต็มภาษาไทย ปี พ.ศ. — คืน `common.unknownDate` ("ไม่ระบุวันที่")
 * แทนการโยน `RangeError` เมื่อ `date` ไม่ใช่วันที่ที่ valid */
export function formatThaiBuddhistDate(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return t('common.unknownDate');
  }
  return new Intl.DateTimeFormat(THAI_BUDDHIST_LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/** เช่น `20 กันยายน 2569 เวลา 14:05 น.` — ใช้ใน footer ที่ต้องการเวลาด้วย — คืน `common.unknownDate`
 * เมื่อ `date` ไม่ valid (เหมือน `formatThaiBuddhistDate`) */
export function formatThaiBuddhistDateTime(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return t('common.unknownDate');
  }
  const datePart = formatThaiBuddhistDate(date);
  const timePart = new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${datePart} เวลา ${timePart} น.`;
}
