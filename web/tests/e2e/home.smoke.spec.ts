import { expect, test } from '@playwright/test';

// T-405: "/" เปลี่ยนจาก placeholder เดิมเป็นหน้า KeyGate จริง (06 §3) — KeyGate/About (`features/keygate`,
// `features/about`) กำลังพัฒนาขนานกันในอีก task จึงเช็กเฉพาะโครง App shell ที่ T-405 รับผิดชอบ (title,
// skip link, #main-content) แทนเนื้อหาของ KeyGate เอง เพื่อไม่ผูก smoke test นี้กับ UI ที่ยังไม่นิ่ง
test('หน้าแรกโหลดได้, มี title ภาษาไทย และมี app shell (skip link + #main-content) ตาม 06 §3/§6', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('เครื่องมือวางแผนงบประมาณภาครัฐ (TGBP)');
  await expect(page.locator('#main-content')).toBeAttached();
  await expect(page.getByText('ข้ามไปยังเนื้อหาหลัก')).toBeAttached();
});
