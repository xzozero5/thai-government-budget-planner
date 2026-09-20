/**
 * T-409 (ครอบ T-412/T-307) — SVG sanitizer ใน Chromium จริง (ต่างจาก unit test เดิมที่ยืนยันแค่ jsdom)
 *
 * ทุกเคสยิง `emit_illustration` ด้วย SVG โจมตีทีละแบบ ที่ชี้ไปโดเมนปลอม `EVIL_ORIGIN` แล้วยืนยันว่า:
 * (1) ไม่มี request ใดออกไปโดเมนนั้นเลย (route counter ของ `EVIL_ORIGIN/**`)
 * (2) DOM ของภาพที่ mount จริง (ถ้ามี) ไม่มี element/attribute อันตรายหลงเหลือ
 *
 * แต่ละ `test()` ใช้ browser context ใหม่ของตัวเอง (ค่าเริ่มต้นของ Playwright) จึงมี `ToolLog` ใหม่ทุกครั้ง
 * — ไม่ชนเพดาน "≤ 3 ภาพต่อ session" (`MAX_ILLUSTRATIONS_PER_PROPOSAL`, `ai/tools/emitIllustration.ts`)
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatLog, submitFakeKeyAndEnterWorkspace } from './helpers/appFlows';
import {
  createAnthropicMock,
  EVIL_ORIGIN,
  lastToolOutput,
  makeMessage,
  textBlock,
  toolUseBlock,
  type AnthropicMock,
  type AnthropicRequestBody,
} from './helpers/mockAnthropic';

interface EmitIllustrationOutputLike {
  ok: boolean;
  illustration_id?: string;
  warnings?: string[];
}

// `"type": "module"` (package.json) — ไม่มี `__dirname` ให้ใช้ (ต่างจาก `tsconfig.node.json` ที่ยังคง
// module:'ESNext'/moduleResolution:'Bundler' แต่รันจริงผ่าน tsx/esbuild แบบ ESM) ต้องเดา path จาก
// `import.meta.url` เสมอ
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOOD_SVG_PATH = path.resolve(HERE, '../../../docs/ui/illustrations/01-map-weir-village.svg');

function minimalProposalWithIllustration(illustrationId: string): Record<string, unknown> {
  return {
    version: 1,
    title: 'ทดสอบ sanitizer ภาพประกอบ (e2e)',
    summary: 'proposal ทดสอบสำหรับยืนยันว่าภาพประกอบที่ผ่าน sanitizer แล้วแสดงผลได้อย่างปลอดภัย',
    mode: 'draft',
    requester_context: { fiscal_year_be: 2569 },
    objectives: ['ทดสอบ sanitizer'],
    scope_and_specs: [{ section: 'ทั่วไป', items: ['ไม่มีรายละเอียดเฉพาะ'] }],
    assumptions: [{ text: 'ไม่มีสมมติฐานเพิ่มเติม', impact: 'low' }],
    // `ProposalSchema.boq` คือ `z.array(BoqLineSchema).min(1)` (ai/tools/proposal.ts) — ต้องมีอย่างน้อย
    // 1 บรรทัดเสมอ ใช้ basis:'estimate' (ไม่ต้องมี citation) เพื่อไม่ให้ต้องพึ่งข้อมูลจริงในเทสต์นี้
    boq: [
      {
        id: 'E2E-ILLUS-1',
        category: 'ทั่วไป',
        item: 'รายการทดสอบ (ไม่มีนัยสำคัญ)',
        qty: 1,
        unit: 'รายการ',
        unit_price_thb: 1,
        total_thb: 1,
        basis: 'estimate',
        confidence: 'low',
        rationale: 'บรรทัดทดสอบเพื่อให้ผ่าน schema ขั้นต่ำ ไม่ใช่ส่วนที่ทดสอบจริงของเคสนี้',
        citations: [],
      },
    ],
    totals: { subtotal_thb: 1, contingency_pct: 0, contingency_thb: 0, vat_included: true, grand_total_thb: 1 },
    comparables: [],
    risks: [],
    open_questions: [],
    citations_web: [],
    illustrations: [{ illustration_id: illustrationId, title: 'ภาพทดสอบ', caption: 'ภาพเชิงแผนผังทดสอบ ไม่ใช่แบบก่อสร้างจริง', kind: 'diagram' }],
    stat_cards: [],
  };
}

/** ส่ง `svg` ผ่าน `emit_illustration` แล้ว (ถ้า sanitizer ยอมรับ) ต่อด้วย `emit_proposal` ที่อ้างภาพนั้น
 * ให้ IllustrationFrame render จริง — คืน `{accepted}` ให้ผู้เรียกไป assert ต่อ */
async function runIllustrationCase(
  page: import('@playwright/test').Page,
  mock: AnthropicMock,
  svg: string,
): Promise<{ accepted: boolean }> {
  let accepted = false;

  mock.setMessagesTurns([
    {
      kind: 'message',
      message: makeMessage({
        content: [
          toolUseBlock('emit_illustration', {
            title: 'ภาพทดสอบ',
            caption: 'ภาพเชิงแผนผังทดสอบ ไม่ใช่แบบก่อสร้างจริง',
            kind: 'diagram',
            svg,
          }),
        ],
        stopReason: 'tool_use',
      }),
    },
    {
      kind: 'dynamic',
      build: (body: AnthropicRequestBody) => {
        const result = lastToolOutput(body, 'emit_illustration') as EmitIllustrationOutputLike;
        if (!result.ok || !result.illustration_id) {
          return makeMessage({
            content: [textBlock('ภาพนี้ไม่ผ่านการตรวจสอบความปลอดภัย ขอข้ามภาพประกอบไปก่อนครับ')],
            stopReason: 'end_turn',
          });
        }
        accepted = true;
        return makeMessage({
          content: [
            textBlock('สร้างภาพประกอบสำเร็จ นี่คือข้อเสนอครับ'),
            toolUseBlock('emit_proposal', minimalProposalWithIllustration(result.illustration_id)),
          ],
          stopReason: 'tool_use',
        });
      },
    },
    {
      kind: 'message',
      message: makeMessage({ content: [textBlock('เสร็จแล้วครับ')], stopReason: 'end_turn' }),
    },
  ]);

  const composer = page.getByLabel('ช่องพิมพ์ข้อความ');
  await composer.fill('ขอภาพประกอบโครงการหน่อยครับ');
  await page.getByRole('button', { name: 'ส่ง' }).click();
  await expect(chatLog(page).getByText(/emit_illustration: /)).toBeVisible({ timeout: 20_000 });
  // จบ turn แล้ว (ปุ่ม "หยุด" หาย กลับเป็นปุ่ม "ส่ง") — ใช้สัญญาณนี้แทนข้อความสุดท้ายตรง ๆ เพราะ path ที่
  // sanitizer ปฏิเสธภาพ (DOCTYPE ฯลฯ) จบด้วยข้อความคนละประโยคกับ path ที่สร้างภาพสำเร็จ (2 รอบ vs 3 รอบ)
  await expect(page.getByRole('button', { name: 'ส่ง', exact: true })).toBeVisible({ timeout: 20_000 });
  return { accepted };
}

// string ดิบ (ไม่ใช่ TS function) — `tests/e2e/**` type-check ด้วย `tsconfig.node.json` (ไม่มี DOM lib)
// เหมือนเหตุผลใน `helpers/appFlows.ts` (`document`/`Element` ไม่มีให้ TS อ้างในไฟล์นี้)
const ASSERT_MOUNT_SAFE_SCRIPT = `(function () {
  var forbiddenTags = ['script', 'foreignobject', 'use', 'image', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'a'];
  var found = [];
  var mount = document.querySelector('[data-testid="illustration-svg-mount"]');
  if (!mount) return ['no-mount-found'];
  var all = mount.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var node = all[i];
    var tag = node.tagName.toLowerCase();
    if (forbiddenTags.indexOf(tag) !== -1) found.push('tag:' + tag);
    var attrs = node.attributes;
    for (var j = 0; j < attrs.length; j++) {
      var name = attrs[j].name.toLowerCase();
      if (name.indexOf('on') === 0) found.push('attr:' + name);
      if (name === 'href' || name === 'xlink:href') found.push('attr:' + name);
      if (name === 'style') found.push('attr:style');
    }
  }
  return found;
})();`;

async function assertMountIsSafe(page: import('@playwright/test').Page): Promise<void> {
  const mount = page.locator('[data-testid="illustration-svg-mount"]').first();
  await expect(mount).toBeVisible({ timeout: 15_000 });
  const dangerReport = await page.evaluate<string[]>(ASSERT_MOUNT_SAFE_SCRIPT);
  expect(dangerReport).toEqual([]);
}

test.describe('T-409/T-412 SVG sanitizer — Chromium จริง', () => {
  test('CSS escape (\\000075rl() ใน fill) → attribute ถูกตัด, ภาพยังแสดงได้ปลอดภัย', async ({ page }) => {
    const mock = createAnthropicMock(page);
    await mock.install();
    await submitFakeKeyAndEnterWorkspace(page);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="\\000075rl(${EVIL_ORIGIN}/x.png)"/></svg>`;
    const { accepted } = await runIllustrationCase(page, mock, svg);
    expect(accepted).toBe(true);
    await assertMountIsSafe(page);
    expect(mock.getEvilOriginHitCount()).toBe(0);
  });

  test('image-set() ใน attribute อ้างสี (fill) → ค่าไม่อยู่ใน allowlist ถูกตัดทิ้ง', async ({ page }) => {
    const mock = createAnthropicMock(page);
    await mock.install();
    await submitFakeKeyAndEnterWorkspace(page);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="image-set('${EVIL_ORIGIN}/x.png')"/></svg>`;
    const { accepted } = await runIllustrationCase(page, mock, svg);
    expect(accepted).toBe(true);
    await assertMountIsSafe(page);
    expect(mock.getEvilOriginHitCount()).toBe(0);
  });

  test('<feImage href=...> → href ถูกตัด ไม่มี request ออก', async ({ page }) => {
    const mock = createAnthropicMock(page);
    await mock.install();
    await submitFakeKeyAndEnterWorkspace(page);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><filter id="f"><feImage href="${EVIL_ORIGIN}/x.png"/></filter><rect width="100" height="100" filter="url(#f)"/></svg>`;
    const { accepted } = await runIllustrationCase(page, mock, svg);
    expect(accepted).toBe(true);
    await assertMountIsSafe(page);
    expect(mock.getEvilOriginHitCount()).toBe(0);
  });

  test('<image href=https://…> → element ถูกตัดทั้งก้อน', async ({ page }) => {
    const mock = createAnthropicMock(page);
    await mock.install();
    await submitFakeKeyAndEnterWorkspace(page);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><image href="${EVIL_ORIGIN}/x.png" width="100" height="100"/></svg>`;
    const { accepted } = await runIllustrationCase(page, mock, svg);
    expect(accepted).toBe(true);
    await assertMountIsSafe(page);
    expect(mock.getEvilOriginHitCount()).toBe(0);
  });

  test('entity/DOCTYPE (XXE) → ถูกปฏิเสธทั้งก้อน (is_error) ไม่มีภาพให้แสดง', async ({ page }) => {
    const mock = createAnthropicMock(page);
    await mock.install();
    await submitFakeKeyAndEnterWorkspace(page);
    const svg = `<!DOCTYPE svg [<!ENTITY xxe "${EVIL_ORIGIN}/x">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>&xxe;</title></svg>`;
    const { accepted } = await runIllustrationCase(page, mock, svg);
    expect(accepted).toBe(false);
    await expect(page.getByText('emit_illustration: เรียกใช้ไม่สำเร็จ')).toBeVisible();
    expect(mock.getEvilOriginHitCount()).toBe(0);
  });

  test('<script> → tag ถูกตัดทั้งก้อน ไม่ทำงาน', async ({ page }) => {
    const mock = createAnthropicMock(page);
    await mock.install();
    await submitFakeKeyAndEnterWorkspace(page);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><script>fetch('${EVIL_ORIGIN}/x')</script><rect width="100" height="100"/></svg>`;
    const { accepted } = await runIllustrationCase(page, mock, svg);
    expect(accepted).toBe(true);
    await assertMountIsSafe(page);
    expect(mock.getEvilOriginHitCount()).toBe(0);
  });

  test('onload attribute → ถูกตัด ไม่ทำงานตอน mount', async ({ page }) => {
    const mock = createAnthropicMock(page);
    await mock.install();
    await submitFakeKeyAndEnterWorkspace(page);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="fetch('${EVIL_ORIGIN}/x')"><rect width="100" height="100"/></svg>`;
    const { accepted } = await runIllustrationCase(page, mock, svg);
    expect(accepted).toBe(true);
    await assertMountIsSafe(page);
    expect(mock.getEvilOriginHitCount()).toBe(0);
  });

  test('<foreignObject><iframe>...</iframe></foreignObject> → ถูกตัดทั้งก้อน', async ({ page }) => {
    const mock = createAnthropicMock(page);
    await mock.install();
    await submitFakeKeyAndEnterWorkspace(page);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><foreignObject width="100" height="100"><iframe xmlns="http://www.w3.org/1999/xhtml" src="${EVIL_ORIGIN}/x"></iframe></foreignObject></svg>`;
    const { accepted } = await runIllustrationCase(page, mock, svg);
    expect(accepted).toBe(true);
    await assertMountIsSafe(page);
    expect(mock.getEvilOriginHitCount()).toBe(0);
  });

  test('<use href=//evil...> → element ถูกตัดทั้งก้อน', async ({ page }) => {
    const mock = createAnthropicMock(page);
    await mock.install();
    await submitFakeKeyAndEnterWorkspace(page);
    const evilHost = EVIL_ORIGIN.replace('https://', '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><use href="//${evilHost}/sprite.svg#x"/></svg>`;
    const { accepted } = await runIllustrationCase(page, mock, svg);
    expect(accepted).toBe(true);
    await assertMountIsSafe(page);
    expect(mock.getEvilOriginHitCount()).toBe(0);
  });

  test('SVG ดีจาก docs/ui/illustrations/*.svg → แสดงได้ปกติไม่มี warning', async ({ page }) => {
    const mock = createAnthropicMock(page);
    await mock.install();
    await submitFakeKeyAndEnterWorkspace(page);
    const svg = await fs.readFile(GOOD_SVG_PATH, 'utf8');
    const { accepted } = await runIllustrationCase(page, mock, svg);
    expect(accepted).toBe(true);
    await assertMountIsSafe(page);
    await expect(page.locator('[data-testid="illustration-svg-mount"] svg')).toBeVisible();
    expect(mock.getEvilOriginHitCount()).toBe(0);
  });
});
