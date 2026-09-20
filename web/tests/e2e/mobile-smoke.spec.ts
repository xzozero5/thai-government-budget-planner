/**
 * T-409 — Mobile smoke (07 §3.3 ข้อ 5): viewport 390×844, KeyGate → workspace → สลับแท็บแชท/ข้อเสนอได้
 */
import { expect, test } from '@playwright/test';
import { submitFakeKeyAndEnterWorkspace } from './helpers/appFlows';
import { createAnthropicMock } from './helpers/mockAnthropic';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('T-409 mobile smoke (390×844)', () => {
  test('KeyGate → workspace → สลับแท็บ บทสนทนา/ข้อเสนอ ได้', async ({ page }) => {
    const mock = createAnthropicMock(page);
    await mock.install();

    await submitFakeKeyAndEnterWorkspace(page);

    const chatTab = page.getByRole('tab', { name: 'บทสนทนา' });
    const proposalTab = page.getByRole('tab', { name: 'ข้อเสนอ' });
    await expect(chatTab).toBeVisible();
    await expect(proposalTab).toBeVisible();

    // เริ่มที่แท็บแชท (defaultTabId ไม่ระบุ = แท็บแรก) — เห็น composer
    await expect(page.getByLabel('ช่องพิมพ์ข้อความ')).toBeVisible();

    await proposalTab.click();
    await expect(proposalTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'ข้อเสนอโครงการ' })).toBeVisible();

    await chatTab.click();
    await expect(chatTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'บทสนทนากับผู้ช่วย' })).toBeVisible();
  });
});
