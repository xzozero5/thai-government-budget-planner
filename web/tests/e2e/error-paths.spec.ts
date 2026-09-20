/**
 * T-409 — Error paths (07 §3.3 ข้อ 4 / 05-FEATURES US-1.1, US-2.3)
 * key ผิด (401) / 429 / network fail กลางสตรีม / ยกเลิกกลางสตรีม
 *
 * T-602 (NEW-H1 ส่วนที่เหลือ) — เพิ่มเคส `.tgbp.json` ที่ schema ผ่านทุกอย่างยกเว้น `createdAt` เกินขอบเขต
 * ที่ `new Date()` รับได้อย่างปลอดภัย (`1e16`) — หลังแก้ (ก) จำกัดขอบเขต `createdAt` ใน `tgbpFile.ts`
 * และ (ข) การ์ด `formatThaiBuddhistDate` ไม่ให้ throw แล้ว ไม่มีเคสที่ schema ผ่านแต่ยังทำให้ render พังอีก
 * (ตามที่บรีฟยอมรับให้ทดสอบ fallback นี้แทน) — ยืนยันว่าไฟล์ถูกปฏิเสธพร้อมข้อความไทยที่เข้าใจได้ และหน้า
 * `/load` ยังใช้งานได้ปกติ (ไม่ขาว) หลังจากนั้น
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { chatLog, FAKE_API_KEY, submitFakeKeyAndEnterWorkspace } from './helpers/appFlows';
import { createAnthropicMock, makeMessage, textBlock, toolUseBlock } from './helpers/mockAnthropic';

/** BOQ line ขั้นต่ำที่ผ่าน `BoqLineSchema` (`@/ai/tools/proposal.ts`) */
function minimalBoqLine(): Record<string, unknown> {
  return {
    id: 'line1',
    category: 'ครุภัณฑ์',
    item: 'เครื่องปรับอากาศ',
    qty: 1,
    unit: 'เครื่อง',
    unit_price_thb: 20000,
    total_thb: 20000,
    basis: 'estimate',
    confidence: 'low',
    rationale: 'ทดสอบ',
    citations: [],
  };
}

/** `.tgbp.json` ที่ผ่าน `TgbpFileSchema` ทุกอย่าง ยกเว้น `createdAt` ของเวอร์ชันเดียวที่เกินขอบเขต
 * (`1e16`) — ใช้ทดสอบว่า `parseTgbpFile` ปฏิเสธไฟล์นี้ด้วยข้อความไทยที่เข้าใจได้ (ไม่ผ่านเข้าไป render
 * แล้วพังกลางทาง) */
function buildTgbpFileWithHugeCreatedAt(): string {
  return JSON.stringify({
    format: 'tgbp',
    version: 1,
    savedAt: new Date().toISOString(),
    app_data_version: 'e2e-test',
    currentProposalIndex: 0,
    proposalVersions: [
      {
        id: 'propver_1',
        createdAt: 1e16,
        source: 'ai',
        warnings: [],
        userEditedLineIds: [],
        proposal: {
          version: 1,
          title: 'ไฟล์ทดสอบ createdAt ผิดปกติ',
          summary: 'สรุปทดสอบ',
          mode: 'draft',
          requester_context: { fiscal_year_be: 2569 },
          objectives: [],
          scope_and_specs: [],
          assumptions: [],
          boq: [minimalBoqLine()],
          totals: { subtotal_thb: 20000, vat_included: false, grand_total_thb: 20000 },
          comparables: [],
          risks: [],
          open_questions: [],
          citations_web: [],
          illustrations: [],
          stat_cards: [],
        },
      },
    ],
    chat: [],
  });
}

test.describe('T-409 error paths', () => {
  test('key ผิด (401) → ข้อความไทยชัดเจน + ช่อง key ถูกล้าง', async ({ page }) => {
    const mock = createAnthropicMock(page);
    await mock.install();
    mock.setCountTokensMode({
      kind: 'httpError',
      status: 401,
      errorType: 'authentication_error',
      message: 'invalid x-api-key',
    });

    await page.goto('/');
    const keyInput = page.getByLabel('API key ของ Anthropic');
    await keyInput.fill(FAKE_API_KEY);
    await page.getByRole('button', { name: 'ทดสอบและเริ่ม' }).click();

    await expect(page.getByRole('alert')).toContainText('key ใช้ไม่ได้', { timeout: 15_000 });
    await expect(keyInput).toHaveValue('');
    // ยังอยู่หน้า KeyGate (ไม่ถูกพาไป workspace) — เช็คจากฟอร์ม key แทน URL/hash ตรง ๆ (HashRouter ไม่ใส่
    // `#/` ต่อท้ายเมื่ออยู่ path root ว่าง จึง match URL ตรง ๆ ได้ไม่เสถียรเท่า)
    await expect(keyInput).toBeVisible();
  });

  test('429 → ข้อความ rate limit ภาษาไทย', async ({ page }) => {
    const mock = createAnthropicMock(page);
    await mock.install();
    mock.setCountTokensMode({
      kind: 'httpError',
      status: 429,
      errorType: 'rate_limit_error',
      message: 'rate limited',
      headers: { 'retry-after': '0' },
    });

    await page.goto('/');
    await page.getByLabel('API key ของ Anthropic').fill(FAKE_API_KEY);
    await page.getByRole('button', { name: 'ทดสอบและเริ่ม' }).click();

    await expect(page.getByRole('alert')).toContainText('ถูกจำกัดอัตราการเรียก', { timeout: 20_000 });
  });

  test('network fail กลางสตรีม → ข้อความ error + ส่งข้อความใหม่ได้ (ประวัติยังใช้ต่อได้)', async ({ page }) => {
    const mock = createAnthropicMock(page);
    await mock.install();
    await submitFakeKeyAndEnterWorkspace(page);

    mock.setMessagesTurns([
      {
        kind: 'message',
        message: makeMessage({
          content: [toolUseBlock('search_catalog', { query: 'ทดสอบ', limit: 3 })],
          stopReason: 'tool_use',
        }),
      },
      // รอบ 2 (หลัง tool_result ของ search_catalog) → network failure — ถ้า SDK retry เองอีก (maxRetries:1)
      // mock จะค้างตอบ networkFail ซ้ำ (ดูคอมเมนต์ `setMessagesTurns` ใน `mockAnthropic.ts`) จึงไม่ต้องรู้
      // จำนวน retry ที่แน่นอน
      { kind: 'networkFail' },
    ]);

    const composer = page.getByLabel('ช่องพิมพ์ข้อความ');
    await composer.fill('ทดสอบโครงการหนึ่ง');
    await page.getByRole('button', { name: 'ส่ง' }).click();
    await expect(page.locator('[data-testid="tool-activity"][data-tool="search_catalog"][data-status="done"]').first()).toBeVisible({ timeout: 20_000 });

    await expect(chatLog(page).getByText('เชื่อมต่อ api.anthropic.com ไม่สำเร็จ')).toBeVisible({ timeout: 20_000 });

    // ส่งข้อความใหม่ได้ต่อ — สคริปต์ใหม่ที่จบ turn ปกติทันที (ตรวจว่าประวัติที่ส่งมายัง valid ไปในตัว)
    mock.setMessagesTurns([
      {
        kind: 'dynamic',
        build: (body) => {
          // ประวัติที่ส่งมาต้อง valid เสมอ: ทุก tool_use ต้องมี tool_result คู่กัน (ไม่มีค้าง)
          for (const message of body.messages) {
            if (!Array.isArray(message.content)) continue;
            for (const block of message.content) {
              if (block.type === 'tool_use') {
                const hasResult = body.messages.some(
                  (m) =>
                    Array.isArray(m.content) &&
                    m.content.some((b) => b.type === 'tool_result' && b.tool_use_id === block.id),
                );
                expect(hasResult, `tool_use id=${String(block.id)} ต้องมี tool_result คู่กันใน history`).toBe(true);
              }
            }
          }
          return makeMessage({ content: [textBlock('รับทราบครับ ลองใหม่ให้แล้ว')], stopReason: 'end_turn' });
        },
      },
    ]);

    await composer.fill('ลองอีกครั้งครับ');
    await page.getByRole('button', { name: 'ส่ง' }).click();
    await expect(chatLog(page).getByText('รับทราบครับ ลองใหม่ให้แล้ว')).toBeVisible({ timeout: 15_000 });
  });

  test('กดยกเลิกกลางสตรีม → สถานะยกเลิก + ส่งข้อความถัดไปได้ (tool_use ทุกตัวมี tool_result)', async ({ page }) => {
    const mock = createAnthropicMock(page);
    await mock.install();
    await submitFakeKeyAndEnterWorkspace(page);

    mock.setMessagesTurns([
      {
        kind: 'message',
        message: makeMessage({
          content: [toolUseBlock('search_catalog', { query: 'ทดสอบยกเลิก', limit: 3 })],
          stopReason: 'tool_use',
        }),
      },
      // รอบ 2 หน่วงเวลาให้พอกดยกเลิกทัน (หลัง tool_result ของรอบ 1 ถูกบันทึกในประวัติแล้ว)
      {
        kind: 'message',
        message: makeMessage({ content: [textBlock('ไม่ควรมาถึงตรงนี้')], stopReason: 'end_turn' }),
        delayMs: 4000,
      },
    ]);

    const composer = page.getByLabel('ช่องพิมพ์ข้อความ');
    await composer.fill('ทดสอบยกเลิกกลางคัน');
    await page.getByRole('button', { name: 'ส่ง' }).click();
    await expect(page.locator('[data-testid="tool-activity"][data-tool="search_catalog"][data-status="done"]').first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'หยุด' }).click();
    await expect(chatLog(page).getByText('หยุดกลางคันแล้ว')).toBeVisible({ timeout: 10_000 });

    // ส่งข้อความถัดไปได้ทันที (composer ต้องกลับมาใช้งานได้)
    mock.setMessagesTurns([
      { kind: 'message', message: makeMessage({ content: [textBlock('รับทราบ ดำเนินการต่อครับ')], stopReason: 'end_turn' }) },
    ]);
    await composer.fill('ไปต่อได้เลย');
    await page.getByRole('button', { name: 'ส่ง' }).click();
    await expect(chatLog(page).getByText('รับทราบ ดำเนินการต่อครับ')).toBeVisible({ timeout: 15_000 });

    // request ของข้อความถัดไปต้องมี tool_use ทุกตัวจับคู่ tool_result ครบ (ประวัติยัง valid)
    const lastCall = mock.getMessagesCalls().at(-1);
    expect(lastCall).toBeDefined();
    for (const message of lastCall?.body.messages ?? []) {
      if (!Array.isArray(message.content)) continue;
      for (const block of message.content) {
        if (block.type === 'tool_use') {
          const hasResult = (lastCall?.body.messages ?? []).some(
            (m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result' && b.tool_use_id === block.id),
          );
          expect(hasResult).toBe(true);
        }
      }
    }
  });

  test('T-602 (NEW-H1): เปิดไฟล์ .tgbp.json ที่ createdAt ผิดปกติ (1e16) → ถูกปฏิเสธด้วยข้อความไทย + หน้าไม่ขาว', async ({
    page,
  }) => {
    const tmpPath = path.join(os.tmpdir(), `tgbp-huge-createdat-${String(Date.now())}.tgbp.json`);
    await fs.writeFile(tmpPath, buildTgbpFileWithHugeCreatedAt(), 'utf8');

    try {
      await page.goto('/#/load');
      await page.locator('input[type="file"]').setInputFiles(tmpPath);

      // ปฏิเสธด้วยข้อความไทยที่เข้าใจได้ (ไม่ใช่ error ดิบของ React/RangeError)
      await expect(page.getByRole('alert')).toContainText('ไม่ใช่ไฟล์ของ TGBP หรือเสียหาย', {
        timeout: 10_000,
      });

      // หน้าไม่ขาว — dropzone ยังใช้งานได้ปกติหลังจากนั้น (ไม่มี error boundary ขึ้นแทนทั้งหน้า) — ใช้ข้อความ
      // ของ dropzone แทน role="button" ตรง ๆ เพราะ `<input type="file" aria-label="เลือกไฟล์">` ที่ซ่อนอยู่
      // ก็ map เป็น role="button" เหมือนกัน (strict mode ของ Playwright จะเจอ 2 ตัว)
      await expect(page.getByText('ลากไฟล์ .tgbp.json มาวางที่นี่')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'เปิดไฟล์ข้อเสนอ' })).toBeVisible();
    } finally {
      await fs.rm(tmpPath, { force: true });
    }
  });
});
