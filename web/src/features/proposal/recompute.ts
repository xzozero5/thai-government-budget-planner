/**
 * T-406 — คำนวณ BOQ ใหม่แบบ pure function หลังผู้ใช้แก้ qty/ราคาต่อหน่วยในตาราง (US-3.2)
 *
 * ไฟล์นี้เป็นของ `features/proposal/**` ล้วน ๆ (ไม่แตะ `src/ai/**`) จึง import จาก
 * `@/ai/tools/proposal` แบบ **type-only** เท่านั้น (ตามขอบเขตงาน T-406) — เพดานค่า
 * (`QTY_MAX`/`UNIT_PRICE_MAX_THB`) จึงต้อง **คัดลอกให้ตรงกับ `BoqLineSchema`** ใน
 * `src/ai/tools/proposal.ts` (`qty: z.number().positive().max(1e9)`,
 * `unit_price_thb: z.number().nonnegative().max(1e13)`) ด้วยมือ — ถ้าไฟล์นั้นเปลี่ยนเพดาน
 * ต้องแก้ที่นี่ตามด้วย (มี comment ไขว้ไว้ทั้งสองฝั่ง)
 *
 * หมายเหตุ: `web/src/stores/boqMath.ts` (T-403, เจ้าของ `stores/**`) มีฟังก์ชันลักษณะเดียวกัน
 * (`recomputeBoqLine`/`recomputeTotals`) และ validate ผ่าน `BoqLineSchema`/`TotalsSchema` จริงได้
 * เพราะไฟล์นั้นไม่ติดข้อจำกัด type-only import — ฟังก์ชันในไฟล์นี้ตั้งใจให้ "หลักการเดียวกัน" (ไม่แก้
 * basis/confidence/citations/rationale เอง, ลำดับความสำคัญของ contingency เหมือนกัน) เพื่อให้ผลลัพธ์
 * สอดคล้องกัน แต่เป็นคนละ implementation — main thread ตัดสินใจได้ภายหลังว่าจะรวมเป็นไฟล์เดียวหรือไม่
 * เมื่อ container ต่อ store เสร็จ (ดูรายงานปิดงาน T-406)
 */
import type { BoqLine, Proposal, Totals } from '@/ai/tools/proposal';

/** ต้องตรงกับ `BoqLineSchema.qty` ใน `src/ai/tools/proposal.ts` */
export const QTY_MAX = 1e9;
/** ต้องตรงกับ `BoqLineSchema.unit_price_thb` ใน `src/ai/tools/proposal.ts` */
export const UNIT_PRICE_MAX_THB = 1e13;

export interface LineEditPatch {
  qty?: number;
  unit_price_thb?: number;
}

/** โยนเมื่อ `applyLineEdit` ได้รับค่าที่ไม่ผ่านกติกา (≤ 0 หรือเกินเพดาน) — ข้อความไม่ใช่สิ่งที่จะเอาไป
 * แสดงตรง ๆ กับผู้ใช้ (UI ใช้ `t('proposal.boq.invalidNumber')` ของตัวเอง), มีไว้ช่วย debug/test */
export class InvalidLineEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLineEditError';
  }
}

/**
 * ค่าที่ผู้ใช้แก้ต้อง "มากกว่า 0 และไม่เกินเพดานของ schema" เสมอ (T-406 AC) — แม้ว่า
 * `unit_price_thb` ใน `BoqLineSchema` จริงจะยอมรับ 0 ก็ตาม (ของบริจาค/ไม่มีค่าใช้จ่าย) การแก้ "ราคา"
 * เป็น 0 ผ่านตารางนี้แทบทุกกรณีเป็นการพิมพ์ผิด — ฝั่ง UI (`BoqTable`) จึงเข้มกว่า schema เดิมโดยเจตนา
 */
export function isValidLineEditValue(value: number, max: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= max;
}

function assertValid(value: number, max: number, fieldLabel: string): void {
  if (!isValidLineEditValue(value, max)) {
    throw new InvalidLineEditError(`${fieldLabel} ต้องมากกว่า 0 และไม่เกิน ${String(max)}`);
  }
}

/**
 * คำนวณ `totals.subtotal_thb`/`grand_total_thb` ใหม่จากผลรวม `boq[].total_thb`
 * คง `contingency_pct`/`contingency_thb` เดิมไว้เป๊ะ (ไม่แก้ค่าที่ AI ตั้งไว้เอง) — ลำดับความสำคัญของ
 * contingency ตรงกับ `validateAndNormalizeProposal` ใน `ai/tools/proposal.ts`: ใช้ `contingency_thb`
 * (ค่าคงที่) ก่อนเสมอถ้ามี ไม่งั้นคำนวณจาก `contingency_pct`, ไม่มีทั้งคู่ = ไม่มี contingency
 */
export function recomputeTotals(boq: readonly BoqLine[], totals: Totals): Totals {
  const subtotalThb = boq.reduce((sum, line) => sum + line.total_thb, 0);
  const contingencyAmount =
    totals.contingency_thb ??
    (totals.contingency_pct !== undefined ? (subtotalThb * totals.contingency_pct) / 100 : 0);
  const grandTotalThb = subtotalThb + contingencyAmount;

  return {
    ...totals,
    subtotal_thb: subtotalThb,
    grand_total_thb: grandTotalThb,
  };
}

/**
 * แก้ qty/unit_price_thb ของบรรทัด BOQ หนึ่งบรรทัด แล้วคำนวณ `total_thb = qty × unit_price_thb`
 * ใหม่ พร้อม totals ทั้งก้อน — **ไม่ mutate** `proposal` เดิม, **ไม่แตะ** basis/confidence/citations/
 * rationale/spec ของบรรทัดนั้น (นั่นเป็นข้อมูล/เหตุผลจาก AI — ฟังก์ชันนี้คำนวณแค่เลขคณิต ไม่ตัดสิน
 * ความน่าเชื่อถือใหม่)
 *
 * `lineId` ที่ไม่พบใน `proposal.boq` → คืน `proposal` เดิมอ้างอิงเดิมเป๊ะ (no-op, ไม่ throw เพราะอาจเกิด
 * จาก race เล็กน้อยระหว่าง UI กับ state ของ store ที่กำลังจะต่อภายหลัง)
 *
 * ค่าที่ส่งมา ≤ 0 หรือเกินเพดาน → throw `InvalidLineEditError` (ดู `isValidLineEditValue`)
 */
export function applyLineEdit(proposal: Proposal, lineId: string, patch: LineEditPatch): Proposal {
  if (patch.qty !== undefined) {
    assertValid(patch.qty, QTY_MAX, 'จำนวน (qty)');
  }
  if (patch.unit_price_thb !== undefined) {
    assertValid(patch.unit_price_thb, UNIT_PRICE_MAX_THB, 'ราคาต่อหน่วย (unit_price_thb)');
  }

  const index = proposal.boq.findIndex((line) => line.id === lineId);
  const target = index === -1 ? undefined : proposal.boq[index];
  if (target === undefined) {
    return proposal;
  }

  const qty = patch.qty ?? target.qty;
  const unitPriceThb = patch.unit_price_thb ?? target.unit_price_thb;
  const totalThb = qty * unitPriceThb;

  const updatedLine: BoqLine = {
    ...target,
    qty,
    unit_price_thb: unitPriceThb,
    total_thb: totalThb,
  };
  const boq = proposal.boq.map((line, i) => (i === index ? updatedLine : line));

  return {
    ...proposal,
    boq,
    totals: recomputeTotals(boq, proposal.totals),
  };
}
