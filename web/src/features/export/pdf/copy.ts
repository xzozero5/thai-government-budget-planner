/**
 * T-501 — ข้อความ UI ภาษาไทยของ PDF export
 *
 * CLAUDE.md §7 บังคับ "ใช้ข้อความ UI จาก `docs/ui/copy.th.json`" — โมดูลนั้นถูกสร้างแล้วโดย agent อื่น
 * (T-401, ขนานกับงานนี้) ที่ `web/src/i18n/` (`import { t } from '@/i18n'`) ดังนั้น `ProposalDocument.tsx`
 * **เรียก `t(...)` เป็นหลักสำหรับ key ที่มีอยู่แล้ว** (หัวข้อ section, คอลัมน์ BOQ, ป้าย basis/confidence,
 * ป้าย "แก้โดยผู้ใช้", label ของ citation ฯลฯ) ไฟล์นี้เก็บเฉพาะข้อความที่ **เป็นของ PDF ล้วน ๆ และไม่มีใน
 * `copy.th.json`** (ปก, footer, ภาคผนวก citations, ยอดรวมย่อย, ป้ายผลกระทบ/ความรุนแรง) — ถ้าในอนาคต
 * มีการเพิ่ม key เหล่านี้ใน `copy.th.json` ควรย้ายมาเรียก `t()` แทนแล้วลบออกจากที่นี่
 */

export const pdfCopy = {
  cover: {
    // ข้อความจาก BACKLOG.md T-501 เป๊ะ ("ป้าย 'ร่างโดย AI — ต้องตรวจสอบก่อนใช้จริง'") — ไม่มีใน copy.th.json
    aiDraftBadge: 'ร่างโดย AI — ต้องตรวจสอบก่อนใช้จริง',
    generatedAtLabel: 'จัดทำเมื่อ',
    // N9 (CLAUDE.md §2): ภาพประกอบต้องระบุชัดว่าไม่ใช่แบบก่อสร้างจริง — ไม่มี key นี้ใน copy.th.json
    illustrationCaption: 'ภาพประกอบโดย AI — ไม่ใช่แบบก่อสร้างจริง',
  },
  section: {
    // PDF มีส่วน "สรุปยอดรวม"/"แนวโน้มราคา" (รูปกราฟ PNG)/"ภาคผนวก citations"/"คำเตือน" ที่ copy.th.json
    // ยังไม่มี key เฉพาะ (มีแค่ proposal.boq.grandTotal ซึ่งเป็นแค่บรรทัดเดียวในส่วนนี้)
    totals: 'สรุปยอดรวม',
    trendImages: 'แนวโน้มราคาที่เกี่ยวข้อง',
    citationsAppendix: 'ภาคผนวก — แหล่งอ้างอิง',
    validatorWarnings: 'คำเตือนจากระบบตรวจสอบ',
  },
  boqTable: {
    // ไม่มี key "ลำดับ" (เลขบรรทัด) ใน copy.th.json ปัจจุบัน
    no: 'ลำดับ',
  },
  severity: {
    // audit_findings.severity ไม่มี key ใน copy.th.json (มีแต่หัวข้อ section "ข้อสังเกตจากการตรวจสอบ")
    info: 'ข้อสังเกต',
    warn: 'เฝ้าระวัง',
    high: 'รุนแรง',
  } as const,
  totals: {
    // copy.th.json มีแค่ proposal.boq.grandTotal — ยอดย่อยอื่น ๆ ของ PDF ยังไม่มี key
    subtotal: 'ยอดรวมก่อนสำรอง',
    contingency: 'ค่าสำรองเผื่อเหลือเผื่อขาด',
    vatIncluded: 'รวมภาษีมูลค่าเพิ่มแล้ว',
    vatNotIncluded: 'ยังไม่รวมภาษีมูลค่าเพิ่ม',
  },
  comparablesTable: {
    amount: 'จำนวนเงิน',
    similarity: 'ความคล้ายคลึง/ข้อสังเกต',
  },
  impact: {
    // assumptions[].impact ไม่มี key ใน copy.th.json
    high: 'ผลกระทบสูง',
    medium: 'ผลกระทบปานกลาง',
    low: 'ผลกระทบต่ำ',
  } as const,
  citations: {
    amountPrefix: 'จำนวนเงิน',
  },
  // T-504 (US-8.3) — คำบรรยายใต้กราฟแนวโน้ม: ป้าย basis มาจาก `proposal.trend.*` (copy.th.json, มีอยู่แล้ว)
  // ส่วน "n รวม" ไม่มี key เฉพาะใน copy.th.json (มีแต่ `proposal.boq.trendTooltip` ที่ผูกกับปีเดียว)
  trend: {
    nTotal: (n: number) => `รวมตัวอย่างที่พบทั้งหมด ${String(n)} รายการ`,
  },
  noData: 'ไม่มีข้อมูล',
  footer: {
    pageOf: (pageNumber: number, totalPages: number) => `หน้า ${String(pageNumber)} / ${String(totalPages)}`,
    // ข้อความจาก BACKLOG.md T-501 เป๊ะ — ต่างจาก `export.footerNote` ของ copy.th.json (นั่นคือ note ใน
    // export dialog บนเว็บ ไม่ใช่ข้อความ footer ที่พิมพ์ลงทุกหน้าของตัว PDF)
    disclaimer: 'สร้างด้วย Thai Government Budget Planner — ตัวเลขประมาณการต้องตรวจสอบกับแหล่งข้อมูล',
    dataVersionPrefix: 'ชุดข้อมูล',
  },
} as const;
