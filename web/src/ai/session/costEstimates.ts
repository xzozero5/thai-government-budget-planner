/**
 * T-410 (ชุด A ข้อ 1, US-1.2) — ประมาณการต้นทุน API ต่อ "ข้อเสนอหนึ่งฉบับ" แยกตามโมเดล
 *
 * แหล่งอ้างอิง: `docs/api-budget.md` §"ข้อค้นพบรอบ 2" — Haiku 4.5 วัดจริง 2 ครั้ง (T-306 case แรก
 * 0.1202 USD, T-308 รอบ 1 หลังลด token 0.1283 USD) สรุปเป็นค่าประมาณ **0.13 USD** ที่ใช้แสดงผล; ค่าของ
 * Sonnet 5 (**0.40 USD**) เป็นตัวเลขคูณจากอัตราส่วนราคาที่บันทึกไว้ในเอกสารเดียวกัน (ยังไม่มีงบทดสอบจริง
 * กับ Sonnet — ดูคำตัดสินของคุณนิว "ห้ามเรียก API จริง" ในเอกสารเดียวกัน) ส่วน Opus 5 ไม่มีเลขอ้างอิงจาก
 * eval เลย จึงคำนวณสดจากอัตราส่วนราคาต่อโทเค็นใน `ai/models` เทียบกับ Haiku (proxy เดียวที่มี)
 *
 * N3: ตัวเลขที่ "ประมาณเอง" (ไม่ได้วัดจริง) ต้องติดป้ายชัดเจนในโค้ดและ UI — `unverified: true` ของ
 * Sonnet/Opus ต้องถูกแสดงเป็นป้าย "ยังไม่ได้วัดจริง" เสมอ ห้ามนำไปพิมพ์เป็นข้อเท็จจริงเฉย ๆ
 *
 * ห้าม import React/DOM API (module boundary — docs/04-ARCHITECTURE.md §3)
 */
import { getModelCapability, type ModelId } from '@/ai/models';

/** โมเดลอ้างอิงที่มีตัวเลขวัดจริง (docs/api-budget.md) — ใช้เป็นฐานคำนวณ Opus ด้วยอัตราส่วนราคา */
const BASELINE_MODEL_ID: ModelId = 'claude-haiku-4-5-20251001';

const SONNET_MODEL_ID: ModelId = 'claude-sonnet-5';
const OPUS_MODEL_ID: ModelId = 'claude-opus-5';

/** วัดจริง 2 ครั้งกับ Haiku 4.5 (docs/api-budget.md: 0.1202 USD, 0.1283 USD) — ค่าคงที่เดียวที่ "ยืนยัน
 * แล้ว" ในไฟล์นี้ ห้ามคำนวณค่านี้จากอัตราส่วน */
const HAIKU_MEASURED_COST_USD = 0.13;

/** [UNVERIFIED] คูณจากอัตราราคาต่อโทเค็นเทียบ Haiku ตาม docs/api-budget.md (ยังไม่ได้วัดจริงกับ Sonnet
 * — ดู N3) — เก็บเป็นค่าคงที่ตามที่ระบุไว้ในเอกสาร ไม่คำนวณสดเพื่อให้ตรงกับตัวเลขที่รายงานไว้เป๊ะ */
const SONNET_ESTIMATED_COST_USD = 0.4;

/** อัตราแลกเปลี่ยนคงที่โดยประมาณ (ไม่ดึงจากอินเทอร์เน็ต — N5 ห้าม fetch ข้าม origin) ใช้เพื่อแสดงผลเป็น
 * บาทคร่าว ๆ เท่านั้น — ข้อความ UI ที่ใช้ค่านี้ต้องมีคำว่า "ราว" นำหน้าเสมอ (ไม่ใช่อัตราตลาด ณ ขณะนั้น) */
export const USD_TO_THB_RATE_APPROX = 36;

/** วันที่ตรวจตัวเลขต้นทุนล่าสุด (docs/api-budget.md "ข้อค้นพบรอบ 2") — ใส่ใน placeholder `{date}` ของ
 * key `common.costPerProposalEstimate` */
export const COST_ESTIMATE_CHECKED_AT_TH = '20 ก.ย. 2569';

export interface ModelCostEstimate {
  /** ประมาณการต้นทุนต่อข้อเสนอหนึ่งฉบับ (USD) */
  usd: number;
  /** true = ยังไม่ได้วัดจริงกับโมเดลนี้ (คำนวณ/คัดลอกจากอัตราส่วนราคาเทียบ Haiku ที่วัดจริงเท่านั้น) —
   * N3: UI ต้องแสดงป้าย "ยังไม่ได้วัดจริง" เสมอเมื่อค่านี้เป็น true */
  unverified: boolean;
}

/** คำนวณประมาณการของ Opus 5 จากอัตราส่วนราคาต่อโทเค็น (input/output เฉลี่ยแบบง่าย) เทียบ Haiku 4.5 —
 * ไม่มีตัวเลขวัดจริงเลยสำหรับรุ่นนี้ จึงต้อง `unverified: true` เสมอ */
function computeOpusEstimateUsd(): number {
  const opus = getModelCapability(OPUS_MODEL_ID);
  const baseline = getModelCapability(BASELINE_MODEL_ID);
  const ratio =
    (opus.pricePerMTokIn / baseline.pricePerMTokIn + opus.pricePerMTokOut / baseline.pricePerMTokOut) / 2;
  return HAIKU_MEASURED_COST_USD * ratio;
}

const MODEL_COST_ESTIMATES: Record<ModelId, ModelCostEstimate> = {
  [BASELINE_MODEL_ID]: { usd: HAIKU_MEASURED_COST_USD, unverified: false },
  [SONNET_MODEL_ID]: { usd: SONNET_ESTIMATED_COST_USD, unverified: true },
  [OPUS_MODEL_ID]: { usd: computeOpusEstimateUsd(), unverified: true },
};

/** ประมาณการต้นทุนต่อข้อเสนอหนึ่งฉบับของโมเดลที่ระบุ — ดูคอมเมนต์หัวไฟล์เรื่องแหล่งที่มาของแต่ละค่า */
export function getCostEstimate(model: ModelId): ModelCostEstimate {
  return MODEL_COST_ESTIMATES[model];
}

/** แปลง USD → บาทโดยประมาณด้วยอัตราคงที่ (`USD_TO_THB_RATE_APPROX`) — ผู้เรียกต้องใส่คำว่า "ราว" เมื่อ
 * แสดงผล (ไม่ใช่อัตราแลกเปลี่ยนจริง ณ ขณะนั้น) */
export function usdToThbApprox(usd: number): number {
  return usd * USD_TO_THB_RATE_APPROX;
}
