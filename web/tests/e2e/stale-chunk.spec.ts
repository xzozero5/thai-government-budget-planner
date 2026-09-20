/**
 * แท็บที่เปิดค้างข้าม deploy: lazy chunk ของเวอร์ชันเดิมถูกแทนที่บนเซิร์ฟเวอร์ (พบจริง 2 ครั้งระหว่าง demo) — จำลองด้วยการ
 * ให้ไฟล์ใน `assets/` ที่ "ไม่ได้อยู่ใน index.html" (= lazy chunk ทั้งหมด) ตอบ 404 แล้วยืนยันว่าผู้ใช้ได้ทางออกที่ใช้ได้จริง
 */
import { expect, test } from '@playwright/test';

test('lazy chunk หาย (deploy ทับ) → ข้อความ "เว็บเพิ่งอัปเดต" + รีเฟรชได้ + ย้อนกลับแล้วหน้าเดิมยังใช้ได้', async ({ page }) => {
  const indexHtml = await (await page.request.get('./')).text();
  await page.route('**/assets/**', async (route) => {
    const fileName = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    if (indexHtml.includes(fileName)) {
      await route.continue();
    } else {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'gone' });
    }
  });

  await page.goto('/');
  await expect(page.getByLabel('API key ของ Anthropic')).toBeVisible();

  await page.goto('/#/load');
  await expect(page.getByRole('heading', { name: 'เว็บเพิ่งอัปเดตเป็นเวอร์ชันใหม่' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ลองใหม่' })).toHaveCount(0);

  // ย้อนกลับ → boundary ต้องล้างสถานะ error ตาม route (เดิมค้างหน้า error)
  await page.getByRole('link', { name: 'ย้อนกลับ' }).click();
  await expect(page.getByLabel('API key ของ Anthropic')).toBeVisible();

  // ปุ่ม "รีเฟรชหน้าเว็บ" ต้อง reload เอกสารจริง (ระหว่างที่ไฟล์ยังหายอยู่ → กลับมาหน้าเดิม)
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'เว็บเพิ่งอัปเดตเป็นเวอร์ชันใหม่' })).toBeVisible();
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'รีเฟรชหน้าเว็บ' }).click();
  await reloaded;
  await expect(page.getByRole('heading', { name: 'เว็บเพิ่งอัปเดตเป็นเวอร์ชันใหม่' })).toBeVisible();

  // เมื่อไฟล์ของเวอร์ชันใหม่พร้อม (เลิกบล็อก) รีเฟรชแล้วหน้า /load ใช้ได้ตามปกติ
  await page.unroute('**/assets/**');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'เปิดไฟล์ข้อเสนอ' })).toBeVisible();
});
