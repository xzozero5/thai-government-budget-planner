/**
 * T-501 — BOQ สังเคราะห์ 60 แถวสำหรับทดสอบการข้ามหน้าของตาราง (`ProposalDocument.test.tsx`)
 * แยกเป็น fixture generator (pure function) ไม่ปนกับไฟล์ test ตาม CLAUDE.md §7 "logic pure แยกจาก component"
 */
import type { BoqLine, Citation } from '@/ai/tools/proposal';

const SAMPLE_ITEMS: readonly {
  item: string;
  spec?: string;
  unit: string;
  unitPrice: number;
}[] = [
  {
    item: 'เครื่องปรับอากาศ แบบแยกส่วนชนิดติดผนัง มีระบบฟอกอากาศ ขนาด 18,000 บีทียู',
    spec: 'ประหยัดไฟเบอร์ 5, รับประกัน 5 ปี',
    unit: 'เครื่อง',
    unitPrice: 28_500,
  },
  {
    item: 'รถบรรทุก (ดีเซล) ขนาด 1 ตัน ขับเคลื่อน 4 ล้อ แบบดับเบิ้ลแค็บ',
    unit: 'คัน',
    unitPrice: 868_000,
  },
  { item: 'กล้องโทรทัศน์วงจรปิด (CCTV) ชนิดเครือข่าย แบบมุมมองคงที่', unit: 'ชุด', unitPrice: 23_800 },
  { item: 'เครื่องวิทยุสื่อสาร ระบบ VHF/FM ชนิดมือถือ 5 วัตต์', unit: 'เครื่อง', unitPrice: 12_000 },
  {
    item: 'ฝายน้ำล้น (คอนกรีตเสริมเหล็ก) สันฝายสูง 1.50 เมตร กว้าง 8.00 เมตร ฯลฯ',
    unit: 'แห่ง',
    unitPrice: 2_450_000,
  },
  { item: 'ค่าจ้างเหมาปรับปรุงซ่อมแซมอาคารเรียน อาคารประกอบและสิ่งก่อสร้างอื่น', unit: 'รายการ', unitPrice: 185_000 },
  { item: 'โต๊ะ-เก้าอี้นักเรียน ระดับมัธยมศึกษา แบบ มอก.', unit: 'ชุด', unitPrice: 1_650 },
  { item: 'เครื่องคอมพิวเตอร์โน้ตบุ๊ก สำหรับงานประมวลผล', unit: 'เครื่อง', unitPrice: 22_000 },
];

const BASES: readonly BoqLine['basis'][] = ['historical', 'market', 'estimate'];
const CONFIDENCES: readonly BoqLine['confidence'][] = ['high', 'medium', 'low'];

/** สร้าง BOQ สังเคราะห์ `count` แถว — id/citation ไม่ชนกัน, basis/confidence วนสลับ, total = qty*unit_price เป๊ะ */
export function buildSyntheticBoq(count: number): BoqLine[] {
  return Array.from({ length: count }, (_, i) => {
    const sample = SAMPLE_ITEMS[i % SAMPLE_ITEMS.length];
    if (sample === undefined) throw new Error('unreachable');
    const qty = (i % 5) + 1;
    const basis = BASES[i % BASES.length] ?? 'estimate';
    const confidence = CONFIDENCES[i % CONFIDENCES.length] ?? 'low';
    const citations: Citation[] =
      basis === 'estimate'
        ? []
        : basis === 'market'
          ? [{ kind: 'web', url: `https://shopee.co.th/item-${String(i)}`, retrieved_at: '2569-09-20' }]
          : [{ kind: 'budget_line', source_id: `synthetic-src-${String(i)}` }];
    return {
      id: `SYN-${String(i + 1).padStart(3, '0')}`,
      category: `หมวดที่ ${String((i % 4) + 1)}`,
      item: `${String(i + 1)}. ${sample.item}`,
      ...(sample.spec !== undefined ? { spec: sample.spec } : {}),
      qty,
      unit: sample.unit,
      unit_price_thb: sample.unitPrice,
      total_thb: qty * sample.unitPrice,
      basis,
      confidence,
      rationale: `รายการทดสอบการข้ามหน้าอัตโนมัติ ลำดับที่ ${String(i + 1)}`,
      citations,
    };
  });
}
