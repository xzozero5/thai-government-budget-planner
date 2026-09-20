/**
 * T-406 — สถิติสรุปของ BOQ ที่ header ของ `ProposalPane` ต้องใช้ (06 §4.3: "สัดส่วน
 * historical/market/estimate") — pure function ล้วน ๆ, ไม่มี side effect
 */
import type { BoqLine } from '@/ai/tools/proposal';

export interface BasisMix {
  historicalPercent: number;
  marketPercent: number;
  estimatePercent: number;
}

const EMPTY_MIX: BasisMix = { historicalPercent: 0, marketPercent: 0, estimatePercent: 0 };

/** สัดส่วนของ "ยอดรวม" (total_thb) แยกตาม basis เป็นเปอร์เซ็นต์ (0–100) — ไม่ใช่สัดส่วนจำนวนบรรทัด
 * เพราะ 06 §4.3 อธิบายว่าเป็น "สัดส่วนของยอดรวม" (`mixTooltip`) ผลรวม 3 ค่าอาจไม่เท่า 100 เป๊ะจากการปัด
 * ทศนิยม — ยอมรับได้เพราะเป็นตัวเลขสรุปแบบคร่าว ไม่ใช่ตัวเลข BOQ ที่ต้องมี citation */
export function computeBasisMix(boq: readonly BoqLine[]): BasisMix {
  const total = boq.reduce((sum, line) => sum + line.total_thb, 0);
  if (total <= 0) {
    return EMPTY_MIX;
  }
  const sums = { historical: 0, market: 0, estimate: 0 };
  for (const line of boq) {
    sums[line.basis] += line.total_thb;
  }
  return {
    historicalPercent: (sums.historical / total) * 100,
    marketPercent: (sums.market / total) * 100,
    estimatePercent: (sums.estimate / total) * 100,
  };
}
