/**
 * T-604(A) — main thread (รายงานปัญหาจาก eval จริง 2569-09-20, `web/tests/eval/real-runs/
 * fiscal-year-2562-gap.json`): โมเดลบางครั้งส่ง `item_key`/`get_price_trend{kind:'item'}` เป็น
 * ข้อความที่ลอกมาจาก `item_name_raw` ตรง ๆ (มีวงเล็บ/คำเพิ่มติดมา) ซึ่งไม่ตรงกับ key ตัวแทนหรือ variant
 * ใดใน catalog เลย (แม้ normalize ช่องว่างแล้ว — ดู `data/search.ts#getCatalogItemByKey`) เมื่อเกิดกรณี
 * นี้ tool เดิม (`query_budget_lines`/`get_price_trend`) เงียบ (คืน total=0 หรือ series:null) โดยไม่บอก
 * สาเหตุ ทำให้โมเดิลสรุปผิดว่า "ไม่มีข้อมูล" ทั้งที่ key สะกดผิดเท่านั้น (ขัด N3 — "ตัวเลข/ผลลัพธ์ต้องซื่อสัตย์
 * ไม่ทิ้งเงียบ")
 *
 * ไฟล์นี้เป็น helper ร่วมของทั้งสอง tool: เมื่อ resolve แบบตรงเป๊ะไม่เจอ ให้ค้น `search_catalog`
 * (MiniSearch ที่ fold/tokenize ภาษาไทยอยู่แล้ว ทนวงเล็บ/วรรคตอนต่างรูปแบบ — N7 ค้นก่อนสร้าง ไม่เขียน
 * fuzzy matcher ใหม่) หา key ที่ใกล้เคียงที่สุด แล้วคืนเป็นคำเตือนภาษาไทยชัดเจนให้โมเดลเลือกเอง
 * (ห้ามเดาแทนโมเดล — แค่เสนอตัวเลือก)
 *
 * ห้าม import React/DOM API (module boundary — docs/04-ARCHITECTURE.md §3)
 */
import type { ToolContext } from './toolKit';

/** จำนวน key ที่แนะนำสูงสุดต่อครั้ง (ตามที่ระบุ: 3–5 ตัว) */
export const CATALOG_KEY_SUGGESTION_LIMIT = 5;

/** ค้น key ที่ใกล้เคียง `rawKey` ที่สุดจาก catalog (เรียงตามความเกี่ยวข้องจาก `search_catalog`) —
 * คืน `[]` เมื่อไม่มีอะไรใกล้เคียงเลย (ไม่ throw — เป็นแค่ตัวช่วยแนะนำ) */
export async function suggestCatalogKeys(ctx: ToolContext, rawKey: string): Promise<string[]> {
  const trimmed = rawKey.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const { matches } = await ctx.data.searchCatalog(trimmed, { limit: CATALOG_KEY_SUGGESTION_LIMIT });
  return matches.map((m) => m.item.key);
}

/** ข้อความไทยอธิบายว่า `rawKey` ไม่ตรงกับ catalog เป๊ะ พร้อม key ที่ใกล้เคียง (ถ้ามี) — ใช้ทั้งใน
 * `query_budget_lines` (warnings[]) และ `get_price_trend` (warnings[] เมื่อ kind='item' และ series:null) */
export function itemKeyNotFoundWarning(rawKey: string, suggestions: readonly string[]): string {
  const suggestionText =
    suggestions.length > 0
      ? `key ที่ใกล้เคียงที่สุดจาก catalog: ${suggestions.map((k) => `"${k}"`).join(', ')} — ลองใช้ ` +
        'key เหล่านี้ตรง ๆ หรือเรียก search_catalog ก่อนเพื่อยืนยัน item_key ที่ถูกต้อง'
      : 'ไม่พบ key ที่ใกล้เคียงใน catalog เลย — รายการนี้อาจไม่อยู่ใน catalog ' +
        '(ลอง query_budget_lines ด้วย keywords ร่วมกับปี/กระทรวงแทน)';
  return (
    `item_key "${rawKey}" ไม่ตรงกับ key ใดใน catalog พอดี (แม้ normalize ช่องว่างแล้ว) — ` + suggestionText
  );
}
