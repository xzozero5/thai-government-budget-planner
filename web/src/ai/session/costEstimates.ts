/**
 * T-410 (ชุด A ข้อ 1, US-1.2) — ประมาณการต้นทุน API ต่อ "ข้อเสนอหนึ่งฉบับ" แยกตามโมเดล
 *
 * แหล่งอ้างอิงเดิม: `docs/api-budget.md` §"ข้อค้นพบรอบ 2" — Haiku 4.5 วัดจริง 2 ครั้งกับ 1 โจทย์
 * (0.1202 USD, 0.1283 USD) สรุปเป็นค่าประมาณจุดเดียว 0.13 USD
 *
 * main thread (หลัง demo จริงครั้งแรก 2569-09-20, `docs/api-budget.md` หัวข้อ "demo จริงครั้งแรก") —
 * demo จริงกับผู้ใช้จริง (โจทย์ 2 รายการ + ปรับเงินเฟ้อ) วัดได้ **0.52 USD** สูงกว่าตัวเลขจุดเดียวเดิมมาก
 * (ต้นทุนขึ้นกับความยาว/ความซับซ้อนของบทสนทนาจริง ไม่ใช่ค่าคงที่) → เปลี่ยนมาแสดงเป็น **ช่วง** แทนตัวเลข
 * จุดเดียวเพื่อไม่ให้ผู้ใช้เข้าใจผิดว่า 0.13 USD คือเพดานสูงสุด ค่า Haiku ด้านล่าง (0.15–0.55 USD) เป็นช่วงที่
 * ครอบคลุมตัวเลขวัดจริงทั้ง 3 ครั้ง (0.1202, 0.1283, 0.52) พร้อมขอบเผื่อเล็กน้อยทั้งสองด้าน — ค่าของ
 * Sonnet/Opus คำนวณจากอัตราส่วนราคาต่อโทเค็นเทียบ Haiku (ยังไม่มีงบทดสอบจริงกับรุ่นเหล่านี้เลย — ดูคำตัดสิน
 * ของคุณนิว "ห้ามเรียก API จริง" ใน `docs/api-budget.md`)
 *
 * N3: ตัวเลขที่ "ประมาณเอง" (ไม่ได้วัดจริง) ต้องติดป้ายชัดเจนในโค้ดและ UI — `unverified: true` ของ
 * Sonnet/Opus ต้องถูกแสดงเป็นป้าย "ยังไม่ได้วัดจริง" เสมอ ห้ามนำไปพิมพ์เป็นข้อเท็จจริงเฉย ๆ
 *
 * ห้าม import React/DOM API (module boundary — docs/04-ARCHITECTURE.md §3)
 */
import { getModelCapability, type ModelId } from '@/ai/models';

/** โมเดลอ้างอิงที่มีตัวเลขวัดจริง (docs/api-budget.md) — ใช้เป็นฐานคำนวณ Sonnet/Opus ด้วยอัตราส่วนราคา */
const BASELINE_MODEL_ID: ModelId = 'claude-haiku-4-5-20251001';

const SONNET_MODEL_ID: ModelId = 'claude-sonnet-5';
const OPUS_MODEL_ID: ModelId = 'claude-opus-5';

/** [UNVERIFIED — ปัดเผื่อขอบ] ช่วงที่อ้างอิงตัวเลขวัดจริง 3 ครั้งกับ Haiku 4.5 (docs/api-budget.md):
 * 0.1202 USD / 0.1283 USD (T-306/T-308 — eval 1 รายการ, โจทย์สั้น) และ **0.52 USD** (demo จริงครั้งแรกกับ
 * ผู้ใช้จริง 2569-09-20 — โจทย์ 2 รายการ + ปรับเงินเฟ้อ, บทสนทนายาวกว่า) ขอบบนปัดขึ้นจาก 0.52 → 0.55 เพื่อ
 * กันความผันผวน ส่วนขอบล่างปัดขึ้นจาก 0.12 → 0.15 โดยตั้งใจ (สูงกว่าเคส eval สั้นที่สุดเล็กน้อย) เพราะ
 * บทสนทนาของผู้ใช้จริงมักยาว/ซับซ้อนกว่าโจทย์ eval ขั้นต่ำ — ห้ามคำนวณค่าเหล่านี้จากอัตราส่วน (เป็นค่าที่วัดจริง) */
const HAIKU_MEASURED_MIN_USD = 0.15;
const HAIKU_MEASURED_MAX_USD = 0.55;

/** อัตราแลกเปลี่ยนคงที่โดยประมาณ (ไม่ดึงจากอินเทอร์เน็ต — N5 ห้าม fetch ข้าม origin) ใช้เพื่อแสดงผลเป็น
 * บาทคร่าว ๆ เท่านั้น — ข้อความ UI ที่ใช้ค่านี้ต้องมีคำว่า "ราว" นำหน้าเสมอ (ไม่ใช่อัตราตลาด ณ ขณะนั้น) */
export const USD_TO_THB_RATE_APPROX = 36;

/** วันที่ตรวจตัวเลขต้นทุนล่าสุด (docs/api-budget.md "demo จริงครั้งแรก 2569-09-20") — ใส่ใน placeholder
 * `{date}` ของ key `common.costPerProposalRange` */
export const COST_ESTIMATE_CHECKED_AT_TH = '20 ก.ย. 2569';

export interface ModelCostEstimate {
  /** ขอบล่างของประมาณการต้นทุนต่อข้อเสนอหนึ่งฉบับ (USD) */
  minUsd: number;
  /** ขอบบนของประมาณการต้นทุนต่อข้อเสนอหนึ่งฉบับ (USD) */
  maxUsd: number;
  /** true = ยังไม่ได้วัดจริงกับโมเดลนี้ (คำนวณ/คัดลอกจากอัตราส่วนราคาเทียบ Haiku ที่วัดจริงเท่านั้น) —
   * N3: UI ต้องแสดงป้าย "ยังไม่ได้วัดจริง" เสมอเมื่อค่านี้เป็น true */
  unverified: boolean;
}

/** อัตราส่วนราคาต่อโทเค็น (เฉลี่ยแบบง่ายของ input/output) ของ `modelId` เทียบกับ Haiku 4.5 (baseline ที่มี
 * ตัวเลขวัดจริง) — ใช้คำนวณประมาณการของโมเดลที่ยังไม่เคยวัดจริง */
function priceRatioVsBaseline(modelId: ModelId): number {
  const model = getModelCapability(modelId);
  const baseline = getModelCapability(BASELINE_MODEL_ID);
  return (
    (model.pricePerMTokIn / baseline.pricePerMTokIn + model.pricePerMTokOut / baseline.pricePerMTokOut) / 2
  );
}

/** คำนวณช่วงประมาณการของโมเดลที่ยังไม่มีตัวเลขวัดจริง โดยคูณช่วงที่วัดจริงของ Haiku ด้วยอัตราส่วนราคา —
 * ไม่มีตัวเลขวัดจริงเลยสำหรับรุ่นเหล่านี้ จึงต้อง `unverified: true` เสมอ */
function computeRatioEstimate(modelId: ModelId): ModelCostEstimate {
  const ratio = priceRatioVsBaseline(modelId);
  return {
    minUsd: HAIKU_MEASURED_MIN_USD * ratio,
    maxUsd: HAIKU_MEASURED_MAX_USD * ratio,
    unverified: true,
  };
}

const MODEL_COST_ESTIMATES: Record<ModelId, ModelCostEstimate> = {
  [BASELINE_MODEL_ID]: { minUsd: HAIKU_MEASURED_MIN_USD, maxUsd: HAIKU_MEASURED_MAX_USD, unverified: false },
  [SONNET_MODEL_ID]: computeRatioEstimate(SONNET_MODEL_ID),
  [OPUS_MODEL_ID]: computeRatioEstimate(OPUS_MODEL_ID),
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
