import { expect, test } from '@playwright/test';

test('หน้าแรกโหลดได้และแสดงชื่อโปรเจกต์ภาษาไทย', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('เครื่องมือวางแผนงบประมาณภาครัฐ (TGBP)');
  await expect(
    page.getByRole('heading', { name: 'เครื่องมือวางแผนงบประมาณภาครัฐ (TGBP)' }),
  ).toBeVisible();
  await expect(page.getByText('กำลังพัฒนา')).toBeVisible();
});
