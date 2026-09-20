/**
 * T-405 — flag ชั่วคราวบอกว่า "ผู้ใช้เพิ่งกดล้าง key เอง" (จากปุ่มใน header/settings)
 *
 * เหตุผลที่ต้องมี: `WorkspaceRoute` เฝ้าดู `sessionStore.hasKey` เปลี่ยนจาก true→false เพื่อโชว์ toast
 * "ไม่ได้ใช้งานนาน ระบบล้าง key" (idle/pagehide) — แต่ต้อง **ไม่** โชว์ toast นั้นซ้ำเมื่อผู้ใช้กดล้างเอง
 * (ปุ่มนั้นมี toast/ข้อความยืนยันของตัวเองอยู่แล้ว) เก็บ reason จริงไม่ได้เพราะ `sessionStore`/`keyHolder`
 * ไม่ export reason ออกมาให้ UI อ่าน (และงานนี้ห้ามแก้ไฟล์เหล่านั้น) — ใช้ module-scope flag ธรรมดาแทน
 * (ไม่ใช่ข้อมูลลับ ไม่เกี่ยว N2)
 */
let manualClearIntent = false;

export function markManualClear(): void {
  manualClearIntent = true;
}

/** อ่านค่าแล้วรีเซ็ตทันที (consume once) */
export function consumeManualClear(): boolean {
  const value = manualClearIntent;
  manualClearIntent = false;
  return value;
}
