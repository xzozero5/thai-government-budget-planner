/**
 * T-410 (ชุด A ข้อ 2, US-1.1) — ตรวจว่าค่าใช้จ่ายของ session ข้ามเกณฑ์ที่ต้องเตือนผู้ใช้แล้วหรือยัง
 *
 * แยกเป็น pure function เดี่ยว ๆ (ไม่แตะ store/React) เพื่อให้ `sessionStore`/`chatController` เรียกใช้และ
 * ทดสอบได้ง่าย — ตัว toast ที่แสดงจริงอยู่นอกขอบเขตนี้ (ทำโดย main thread ในโฟลเดอร์ `features/workspace`)
 * ที่นี่มีหน้าที่แค่ "ถึงเวลาเตือนหรือยัง" เท่านั้น
 *
 * ห้าม import React/DOM API (module boundary — docs/04-ARCHITECTURE.md §3)
 */

/** สัดส่วนของเพดาน session ที่ถือว่า "ใกล้หมด" ต้องเตือนผู้ใช้ครั้งแรก (US-1.1: เตือนที่ 80%) */
export const BUDGET_WARNING_RATIO = 0.8;

/**
 * true เมื่อ `spentUsd` ถึงหรือเกิน `BUDGET_WARNING_RATIO` ของ `maxCostUsdPerSession`
 * `maxCostUsdPerSession <= 0` ถือว่าไม่มีเพดานที่มีความหมาย จึงไม่เตือน (กันหารด้วยศูนย์/ค่าติดลบผิดปกติ)
 */
export function hasCrossedBudgetWarningThreshold(spentUsd: number, maxCostUsdPerSession: number): boolean {
  if (maxCostUsdPerSession <= 0) {
    return false;
  }
  return spentUsd >= maxCostUsdPerSession * BUDGET_WARNING_RATIO;
}
