/**
 * T-403 — ตัวสร้าง id แบบสุ่มสำหรับ entity ภายใน (ข้อความแชท/เวอร์ชันของ proposal) ไม่ใช้เป็น
 * capability/secret ใด ๆ (เทียบ T-307 §1 แถว L5 — เกณฑ์เดียวกับ `proposal_id`/`illustration_id`
 * ของ `ai/tools/*`)
 */
export function createId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
}
