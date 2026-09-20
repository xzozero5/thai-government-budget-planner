/**
 * ภาพหน้าจอสำหรับ README — "เล่นซ้ำ" (replay) transcript ของการรันจริง 1 เคส (T-604 core8:
 * `construction-weir-low-specificity`, claude-sonnet-5) ผ่าน mock ระดับ HTTP ของ `/v1/messages`
 *
 * - ไม่เรียก API จริง (ไม่มีค่าใช้จ่าย, ไม่ใช้ key จริง) — mock ส่ง tool_use ชุดเดียวกับที่โมเดลเรียกจริงตามลำดับ
 *   round เดิม แล้วแอปรัน tool ทุกตัวกับข้อมูลจริงใน `web/public/data/` เอง → ตัวเลข/อ้างอิง/กราฟในภาพมาจาก
 *   ข้อมูลจริงและผ่าน validator ของ emit_proposal จริง (ไม่ใช่ fixture แต่งขึ้น)
 * - transcript จริงจบที่ emit_proposal (ครบเพดานรอบของ agent loop พอดี) จึงไม่มีข้อความปิดท้ายของผู้ช่วย —
 *   สคริปต์นี้ไม่แต่งข้อความใด ๆ แทนโมเดล
 * - ไม่อยู่ใน CI: รันเองด้วย `npx playwright test -c playwright.screenshots.config.ts` หลัง `npx vite build`
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import {
  createAnthropicMock,
  lastToolOutput,
  makeMessage,
  toolUseBlock,
  type AnthropicRequestBody,
  type ScriptedTurn,
} from '../e2e/helpers/mockAnthropic';
import { submitFakeKeyAndEnterWorkspace } from '../e2e/helpers/appFlows';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TRANSCRIPT_PATH = path.resolve(HERE, '../eval/real-runs/construction-weir-low-specificity.json');
const OUT_DIR = path.resolve(HERE, '../../../docs/screenshots');

/** ส่งเป็นสตริงให้ Playwright ประเมินในหน้าเว็บ (tsconfig ฝั่ง node ของ tests ไม่มี lib DOM) */
const SCROLL_TO_TOP_OF_VIEW = 'el => el.scrollIntoView({ block: "start" })';

interface TranscriptToolCall {
  name: string;
  round: number;
  input: Record<string, unknown> & { illustrations?: unknown };
}
interface Transcript {
  turns: { userText: string }[];
  toolCalls: TranscriptToolCall[];
}
interface IllustrationOutputLike {
  illustration_id?: string;
}

function loadTranscript(): Transcript {
  return JSON.parse(readFileSync(TRANSCRIPT_PATH, 'utf8')) as Transcript;
}

/** จัดกลุ่ม tool call ตาม round เดิม → 1 round = 1 ข้อความ assistant ที่มี tool_use หลายบล็อก (parallel) */
function buildTurns(transcript: Transcript): ScriptedTurn[] {
  const rounds = new Map<number, TranscriptToolCall[]>();
  for (const call of transcript.toolCalls) {
    const list = rounds.get(call.round) ?? [];
    list.push(call);
    rounds.set(call.round, list);
  }
  return [...rounds.keys()]
    .sort((a, b) => a - b)
    .map((round) => ({
      kind: 'dynamic' as const,
      build: (body: AnthropicRequestBody) => {
        const blocks = (rounds.get(round) ?? []).map((call) => {
          if (call.name !== 'emit_proposal') {
            return toolUseBlock(call.name, call.input);
          }
          // illustration_id ถูกสร้างตอนรัน emit_illustration — ต้องใช้ id ของรอบ replay นี้ ไม่ใช่ของ transcript
          const illustration = lastToolOutput(body, 'emit_illustration') as IllustrationOutputLike | undefined;
          const illustrations = Array.isArray(call.input.illustrations)
            ? (call.input.illustrations as Record<string, unknown>[]).map((item) =>
                illustration?.illustration_id
                  ? { ...item, illustration_id: illustration.illustration_id }
                  : item,
              )
            : [];
          return toolUseBlock(call.name, { ...call.input, illustrations });
        });
        return makeMessage({ content: blocks, stopReason: 'tool_use' });
      },
    }));
}

async function shot(page: Page, name: string): Promise<void> {
  // รอ animation/transition จบก่อนถ่าย
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT_DIR, name), animations: 'disabled' });
}

test('README screenshots (replay ของการรันจริง)', async ({ page }) => {
  test.setTimeout(420_000);
  const transcript = loadTranscript();
  const userText = transcript.turns[0]?.userText ?? '';
  expect(userText.length).toBeGreaterThan(0);

  const mock = createAnthropicMock(page);
  await mock.install();
  mock.setMessagesTurns(buildTurns(transcript));

  // 1) KeyGate
  await page.goto('/');
  await expect(page.getByLabel('API key ของ Anthropic')).toBeVisible();
  await shot(page, '01-keygate.png');

  // 2) Workspace — ส่งโจทย์จริงของเคส แล้วรอข้อเสนอ
  await submitFakeKeyAndEnterWorkspace(page);
  await page.getByLabel('ช่องพิมพ์ข้อความ').fill(userText);
  await page.getByRole('button', { name: 'ส่ง' }).click();
  await expect(
    page.locator('[data-testid="tool-activity"][data-tool="emit_proposal"][data-status="done"]').first(),
  ).toBeVisible({ timeout: 300_000 });
  await expect(page.getByRole('button', { name: 'ทำต่อ' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('ยอดรวม:').first()).toBeVisible();
  // เลื่อนแชทกลับขึ้นบนสุดให้เห็นโจทย์ของผู้ใช้ + การ์ด tool ชุดแรก
  await page.getByLabel('ประวัติข้อความ').getByText(userText.slice(0, 40)).first().scrollIntoViewIfNeeded();
  await shot(page, '02-workspace.png');

  // 3) ย่อแชทให้ข้อเสนอเต็มความกว้าง → ภาพประกอบ/กราฟแนวโน้ม แล้วตาราง BOQ + ชิปอ้างอิง
  await page.getByRole('button', { name: 'ย่อบทสนทนา' }).click();
  await shot(page, '03-proposal-overview.png');
  await page.getByRole('button', { name: 'ขยายภาพ' }).evaluate(SCROLL_TO_TOP_OF_VIEW);
  await shot(page, '04-illustration.png');
  const desktopTable = page.getByTestId('boq-table-desktop');
  await page.getByRole('button', { name: 'รายการค่าใช้จ่าย (BOQ)' }).evaluate(SCROLL_TO_TOP_OF_VIEW);
  await shot(page, '05-boq.png');

  // 4) Citation drawer ของแถวงบจริง
  await desktopTable.getByRole('button', { name: /^งบที่เบิกจ่ายจริง/ }).first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText(/ฝายน้ำล้น/).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, '06-citation-drawer.png');
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // 5) ส่งออก PDF (dialog)
  await page.getByRole('button', { name: 'ส่งออก PDF' }).click();
  await expect(page.getByRole('dialog', { name: 'ส่งออกเป็น PDF' })).toBeVisible();
  await shot(page, '07-export-dialog.png');
  await page.getByRole('dialog', { name: 'ส่งออกเป็น PDF' }).getByRole('button', { name: 'ปิด', exact: true }).last().click();

  // 6) บันทึก .tgbp.json → เปิดที่ /load (ไม่ต้องใช้ key) → กดชิปอ้างอิงแล้วต้องเห็นแถวต้นทางจริง (sourceShards)
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'บันทึกไฟล์' }).click();
  const download = await downloadPromise;
  const savedPath = path.join(OUT_DIR, '..', '..', 'web', 'test-results', 'readme-session.tgbp.json');
  await download.saveAs(savedPath);
  await page.goto('/#/load');
  await page.locator('input[type="file"]').setInputFiles(savedPath);
  await expect(page.getByText('อ่านอย่างเดียว')).toBeVisible();
  // บน /load ชิปใช้ label แบบไม่มี hint ของแถว (ข้อความ note ของ citation) — เลือกชิปแรกของบรรทัดหลัก
  await page.getByTestId('boq-table-desktop').getByRole('button', { name: /มข\.2527/ }).first().click();
  const loadDrawer = page.getByRole('dialog');
  await expect(loadDrawer.getByText(/PBO\/2566\.xlsx/).first()).toBeVisible({ timeout: 60_000 });
  await shot(page, '08-load-readonly-drawer.png');
});
