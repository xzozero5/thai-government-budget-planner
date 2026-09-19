/**
 * T-403 — คำนวณ BOQ ใหม่แบบ pure function (US-3.2: "แก้ qty/unit price → ยอดรวมคำนวณใหม่ทันที")
 *
 * แยกจาก `proposalStore.ts` โดยตั้งใจเพื่อให้ทดสอบ logic เลขคณิตล้วน ๆ ได้โดยไม่ต้องพึ่ง Zustand —
 * ใช้ schema ของจริงจาก `ai/tools/proposal.ts` (`BoqLineSchema`/`TotalsSchema`) ซ้ำ (N7: ไม่นิยาม
 * เพดาน qty/ราคาซ้ำเอง) เพื่อให้ค่าที่ผู้ใช้แก้ในตารางผ่านเกณฑ์เดียวกับที่ `emit_proposal` ใช้ตรวจ AI
 *
 * กติกา: ห้ามแก้ `basis`/`confidence`/`citations`/`rationale` อัตโนมัติ (spec T-403: "แถวที่ผู้ใช้แก้
 * ติดธง user_edited และ basis ไม่เปลี่ยนเอง") — ธง `user_edited` เก็บแยกที่ระดับเวอร์ชันใน
 * `proposalStore.ts` (`ProposalVersion.userEditedLineIds`) ไม่ใช่ field ใน `BoqLine` เอง เพราะ
 * `BoqLineSchema` เป็น wire format ของ `ai/tools/proposal.ts` (ไม่ใช่ไฟล์ที่งานนี้เป็นเจ้าของ) การเพิ่ม
 * field ใหม่เข้า schema นั้นจะไม่ตรงกับสิ่งที่ `emit_proposal`/validator รู้จัก
 */
import { BoqLineSchema, TotalsSchema, type BoqLine, type Totals } from '@/ai/tools/proposal';

export interface BoqLineEditInput {
  qty?: number;
  unitPriceThb?: number;
}

export type RecomputeBoqLineResult =
  | { ok: true; line: BoqLine }
  | { ok: false; error: string };

/** คำนวณ `total_thb = qty * unit_price_thb` ใหม่ตาม field ที่ผู้ใช้แก้ (ไม่แก้ field ที่เหลือ) แล้ว
 * validate ด้วย `BoqLineSchema` เดิม (เพดาน/ช่วงค่าเดียวกับที่ `emit_proposal` ใช้) */
export function recomputeBoqLine(line: BoqLine, edit: BoqLineEditInput): RecomputeBoqLineResult {
  const qty = edit.qty ?? line.qty;
  const unitPriceThb = edit.unitPriceThb ?? line.unit_price_thb;
  const totalThb = qty * unitPriceThb;

  const candidate: BoqLine = {
    ...line,
    qty,
    unit_price_thb: unitPriceThb,
    total_thb: totalThb,
  };

  const parsed = BoqLineSchema.safeParse(candidate);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      ok: false,
      error: `ค่าที่แก้ไม่ถูกต้อง: ${firstIssue?.message ?? 'รูปแบบไม่ตรงตามที่กำหนด'}`,
    };
  }
  return { ok: true, line: parsed.data };
}

/** คำนวณ `totals.subtotal_thb`/`grand_total_thb` ใหม่จากผลรวม `boq[].total_thb` — คง
 * `contingency_pct`/`contingency_thb` เดิมไว้ (ไม่แก้ค่าที่ AI ตั้งไว้เอง) ลำดับความสำคัญของ
 * contingency เดียวกับ `validateAndNormalizeProposal` ใน `ai/tools/proposal.ts`: ใช้
 * `contingency_thb` (ค่าคงที่) ก่อนเสมอถ้ามี ไม่งั้นคำนวณจาก `contingency_pct` */
export function recomputeTotals(boq: BoqLine[], totals: Totals): Totals {
  const subtotalThb = boq.reduce((sum, line) => sum + line.total_thb, 0);
  const contingencyAmount =
    totals.contingency_thb ??
    (totals.contingency_pct !== undefined ? (subtotalThb * totals.contingency_pct) / 100 : 0);
  const grandTotalThb = subtotalThb + contingencyAmount;

  return TotalsSchema.parse({
    ...totals,
    subtotal_thb: subtotalThb,
    grand_total_thb: grandTotalThb,
  });
}
