/**
 * T-409 — Happy path แบบ end-to-end กับ mock Anthropic API (07 §3.3 ข้อ 2) รวม storage/egress audit
 * (07 §3.3 ข้อ 1/3) หลัง flow เดียวกันนี้ทั้งหมด ตามที่ main thread สั่ง (ลดจำนวนรอบ init DuckDB-WASM
 * ที่มีต้นทุนคงที่สูงต่อ browser context)
 *
 * รันกับ production build ปกติ (project `chromium` — `npm run preview` ของ `dist` จริง) เพื่อให้ CSP
 * meta ที่ inject ตอน `npm run build` มีผลจริง (ตรงตาม 04 §D8/09 §2)
 *
 * รอบ 1 search_catalog → รอบ 2 query_budget_lines (รันจริงกับข้อมูลจริงใน `web/public/data/` ผ่าน
 * DuckDB-WASM) → รอบ 3 emit_proposal (citation อ้าง source_id จริงที่อ่านจาก tool_result ของรอบ 2 —
 * ดู `helpers/mockAnthropic.ts#lastToolOutput`) → รอบ 4 ข้อความสรุป end_turn
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs/promises';
import {
  assertNoSecretLeak,
  captureStorageSnapshot,
  FAKE_API_KEY,
  installNetworkAudit,
  submitFakeKeyAndEnterWorkspace,
} from './helpers/appFlows';
import {
  createAnthropicMock,
  lastToolOutput,
  makeMessage,
  textBlock,
  toolUseBlock,
  type AnthropicRequestBody,
} from './helpers/mockAnthropic';

interface QueryBudgetLinesRowLike {
  source_id: string;
  item_name_raw: string;
  item_qty: number | null;
  item_unit: string | null;
  unit_price_thb: number | null;
  amount_thb: number | null;
  max_confidence?: 'medium';
}
interface QueryBudgetLinesOutputLike {
  rows: QueryBudgetLinesRowLike[];
  total: number;
}

const CITATION_NOTE = 'อ้างอิงงบจริง (e2e)';

test.describe('T-409 happy path', () => {
  test('KeyGate → workspace → proposal (citation ข้อมูลจริง) → แก้ qty → export PDF/JSON → /load อ่านอย่างเดียว + storage/egress audit', async ({
    page,
  }) => {
    // real DuckDB-WASM init (~38 MB ไม่บีบอัดตอน preview local) + query จริง + render PDF ต้นทุนคงที่สูง
    // (เหตุผลเดียวกับ `chromium-data` project ใน `playwright.config.ts` ที่ใช้ timeout 120_000ms ต่อ
    // 1 query เดียว — ที่นี่มีมากกว่านั้นทั้ง UI flow เต็ม + export PDF)
    test.setTimeout(240_000);

    const audit = await installNetworkAudit(page);
    const mock = createAnthropicMock(page);
    await mock.install();

    let capturedRow: QueryBudgetLinesRowLike | undefined;

    mock.setMessagesTurns([
      // รอบ 1: search_catalog (รันจริง ผลลัพธ์ไม่ถูกใช้ต่อ แค่ยืนยันว่า tool card ตัวแรกปรากฏถูกลำดับ)
      {
        kind: 'message',
        message: makeMessage({
          content: [
            textBlock('กำลังค้นข้อมูลโครงการที่คล้ายกันในคลังข้อมูลก่อนครับ'),
            toolUseBlock('search_catalog', { query: 'เครื่องปรับอากาศ', limit: 5 }),
          ],
          stopReason: 'tool_use',
        }),
      },
      // รอบ 2: query_budget_lines จริง — ministry_code+fiscal_years แคบพอ (1 shard) ไม่ชน QueryTooBroadError
      {
        kind: 'message',
        message: makeMessage({
          content: [
            textBlock('พบข้อมูลแล้ว กำลังดึงรายการงบจริงมาเทียบราคาครับ'),
            toolUseBlock('query_budget_lines', { ministry_code: '01000', fiscal_years: [2570], limit: 5 }),
          ],
          stopReason: 'tool_use',
        }),
      },
      // รอบ 3: emit_proposal — อ่าน source_id/ราคาจริงจากผล query_budget_lines ของรอบ 2 (ห้ามแต่งขึ้นเอง)
      {
        kind: 'dynamic',
        build: (body: AnthropicRequestBody) => {
          const result = lastToolOutput(body, 'query_budget_lines') as QueryBudgetLinesOutputLike;
          const row = result.rows.at(0);
          if (!row) {
            throw new Error(
              'mock e2e: query_budget_lines (ministry_code=01000, fiscal_years=[2570]) คืนแถวว่าง — ตรวจว่า web/public/data ยังมี budget_lines/act2570/01000.parquet',
            );
          }
          capturedRow = row;
          const unitPrice = row.unit_price_thb ?? row.amount_thb ?? 1;
          const proposal = {
            version: 1,
            title: 'ข้อเสนอทดสอบอัตโนมัติ (e2e T-409)',
            summary:
              'ข้อเสนอที่สร้างโดย mock Anthropic ของชุดทดสอบ e2e เพื่อยืนยันว่า citation ในบรรทัด BOQ ชี้กลับไปยังแถวข้อมูลจริงในระบบได้ตลอดสาย ตั้งแต่ tool call ไปจนถึง citation drawer',
            mode: 'draft',
            requester_context: { fiscal_year_be: 2570 },
            objectives: ['ทดสอบ pipeline citation แบบ end-to-end ด้วยข้อมูลจริง'],
            scope_and_specs: [{ section: 'ทั่วไป', items: ['อ้างอิงจากรายการงบจริง 1 บรรทัดที่ระบบค้นเจอ'] }],
            assumptions: [{ text: 'ใช้ราคาต่อรายการจริงจากระบบโดยไม่ปรับเงินเฟ้อ', impact: 'low' }],
            boq: [
              {
                id: 'E2E-1',
                category: 'ครุภัณฑ์ทดสอบ',
                item: row.item_name_raw,
                qty: 1,
                unit: row.item_unit ?? 'รายการ',
                unit_price_thb: unitPrice,
                total_thb: unitPrice,
                basis: 'historical',
                confidence: row.max_confidence === 'medium' ? 'medium' : 'high',
                rationale: 'ราคาอ้างอิงจากรายการงบจริงที่ระบบค้นเจอในบทสนทนานี้โดยตรง (query_budget_lines รอบก่อนหน้า)',
                citations: [{ kind: 'budget_line', source_id: row.source_id, note: CITATION_NOTE }],
              },
            ],
            totals: {
              subtotal_thb: unitPrice,
              contingency_pct: 0,
              contingency_thb: 0,
              vat_included: true,
              grand_total_thb: unitPrice,
            },
            comparables: [],
            risks: [{ text: 'ราคาจริงอาจเปลี่ยนแปลงตามสภาวะตลาด ณ เวลาจัดซื้อจริง' }],
            open_questions: [],
            citations_web: [],
            illustrations: [],
            stat_cards: [],
          };
          return makeMessage({
            content: [textBlock('นี่คือข้อเสนอเบื้องต้นครับ อ้างอิงจากรายการงบจริงที่พบ'), toolUseBlock('emit_proposal', proposal)],
            stopReason: 'tool_use',
          });
        },
      },
      // รอบ 4: จบ turn ปกติ
      {
        kind: 'message',
        message: makeMessage({
          content: [textBlock('สรุป: ได้ข้อเสนอ 1 บรรทัดที่อ้างอิงข้อมูลจริงแล้วครับ')],
          stopReason: 'end_turn',
        }),
      },
    ]);

    // ----- 1) KeyGate -----
    await submitFakeKeyAndEnterWorkspace(page);

    // ----- 2) ส่งโจทย์ -----
    const composer = page.getByLabel('ช่องพิมพ์ข้อความ');
    await composer.fill('อบต. จะซื้อเครื่องปรับอากาศ ช่วยประเมินราคาจากงบจริงให้หน่อยครับ');
    await page.getByRole('button', { name: 'ส่ง' }).click();

    // ----- 3) tool activity cards ตามลำดับ -----
    await expect(page.locator('[data-testid="tool-activity"][data-tool="search_catalog"][data-status="done"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="tool-activity"][data-tool="query_budget_lines"][data-status="done"]').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="tool-activity"][data-tool="emit_proposal"][data-status="done"]').first()).toBeVisible({ timeout: 15_000 });

    // ----- 4) proposal pane แสดง BOQ + ยอดรวม -----
    await expect(page.getByRole('heading', { name: 'ข้อเสนอทดสอบอัตโนมัติ (e2e T-409)' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('ยอดรวม:')).toBeVisible();
    if (capturedRow === undefined) {
      throw new Error('mock ต้องเคยอ่าน tool_result ของ query_budget_lines จริงได้ก่อนถึงจุดนี้');
    }
    const row = capturedRow;
    expect(row.item_name_raw.trim().length).toBeGreaterThan(0);

    const totalBefore = await page.getByText('ยอดรวม:').locator('..').textContent();

    // ----- 5) คลิก citation chip → drawer เปิด + โหลดแถวจริงจาก parquet (item_name_raw ไม่ว่าง) -----
    // หมายเหตุ: ป้าย chip ของ citation ไม่ได้ใช้ `citation.note` ที่ตั้งไว้ตรง ๆ เสมอไป —
    // `ProposalPaneContainer#resolveCitationLabel` (workspace/slots.tsx) จะ "resolve" เป็นป้ายละเอียด
    // (dataset · ปี · หน่วยงาน) แทนเมื่อมี `SourceFingerprint` ของ source_id นั้นจริง (ซึ่งมีเสมอเพราะ
    // query_budget_lines เพิ่งบันทึกไว้) จึงต้องหา chip แบบโครงสร้าง (แถวของ BOQ นี้ → ปุ่มตัวสุดท้าย =
    // คอลัมน์ "อ้างอิง" ซึ่งเป็นคอลัมน์ท้ายสุดของตาราง) แทนการอ้าง label ข้อความตรง ๆ
    const boqRow = page.getByRole('row', { name: row.item_name_raw.slice(0, 40) });
    await boqRow.getByRole('button').last().click();
    const drawer = page.getByRole('dialog', { name: 'งบที่เบิกจ่ายจริง' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(row.item_name_raw)).toBeVisible({ timeout: 15_000 });
    await drawer.getByRole('button', { name: 'ปิดแหล่งอ้างอิง' }).click();
    await expect(drawer).toBeHidden();

    // ----- 6) แก้ qty ในตาราง → ยอดรวมเปลี่ยน + ป้ายแก้โดยผู้ใช้ -----
    // ต้อง scope ใต้ `boq-table-desktop` เสมอ — `BoqTable` render ทั้งตาราง desktop และการ์ดมือถือ
    // พร้อมกันในหน้าเดียว (สลับด้วย CSS `hidden`/`md:hidden` ล้วน ๆ ไม่ใช่ conditional render) จึงมี 2
    // element ที่ aria-label ตรงกันเป๊ะเสมอในทุก viewport
    const desktopTable = page.getByTestId('boq-table-desktop');
    const qtyButton = desktopTable.getByRole('button', { name: `แก้จำนวนของ ${row.item_name_raw}` });
    await qtyButton.click();
    const qtyInput = desktopTable.getByLabel(`แก้จำนวนของ ${row.item_name_raw}`);
    await qtyInput.fill('3');
    await qtyInput.press('Enter');
    await expect(desktopTable.getByText('แก้โดยผู้ใช้')).toBeVisible();
    await expect(async () => {
      const totalAfter = await page.getByText('ยอดรวม:').locator('..').textContent();
      expect(totalAfter).not.toBe(totalBefore);
    }).toPass({ timeout: 5_000 });

    // ----- 7) Export PDF -----
    await page.getByRole('button', { name: 'ส่งออก PDF' }).click();
    const exportDialog = page.getByRole('dialog', { name: 'ส่งออกเป็น PDF' });
    await expect(exportDialog).toBeVisible();
    const pdfDownloadPromise = page.waitForEvent('download');
    await exportDialog.getByRole('button', { name: 'ดาวน์โหลด PDF' }).click();
    const pdfDownload = await pdfDownloadPromise;
    const pdfPath = await pdfDownload.path();
    const pdfBuffer = await fs.readFile(pdfPath);
    expect(pdfBuffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdfBuffer.byteLength).toBeGreaterThan(10 * 1024);
    expect(pdfBuffer.toString('latin1')).not.toContain(FAKE_API_KEY);
    // `Dialog` มีปุ่มปิด (ไอคอน X มุมขวาบน) accessible name "ปิด" เหมือนกับปุ่ม "ปิด" ใน footer เป๊ะ —
    // ปุ่ม footer มาทีหลังใน DOM เสมอ (`.last()`)
    await exportDialog.getByRole('button', { name: 'ปิด', exact: true }).last().click();

    // ----- 8) Save .tgbp.json -----
    const jsonDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'บันทึกไฟล์' }).click();
    const jsonDownload = await jsonDownloadPromise;
    expect(jsonDownload.suggestedFilename()).toMatch(/\.tgbp\.json$/);
    const jsonPath = await jsonDownload.path();
    const jsonText = await fs.readFile(jsonPath, 'utf8');
    expect(jsonText).not.toContain(FAKE_API_KEY);
    expect(jsonText).not.toContain('sk-ant-');
    const savedFile = JSON.parse(jsonText) as { proposalVersions: { proposal: { title: string } }[] };
    expect(savedFile.proposalVersions.at(-1)?.proposal.title).toBe('ข้อเสนอทดสอบอัตโนมัติ (e2e T-409)');

    // ----- 9) storage audit ระหว่างทาง (ก่อน reload) — key/แชท ต้องไม่ปรากฏใน storage ใด ๆ (07 §3.3/N2) -----
    const snapshotBeforeReload = await captureStorageSnapshot(page);
    expect(snapshotBeforeReload.localStorageEntries).toEqual([]);
    expect(snapshotBeforeReload.sessionStorageEntries).toEqual([]);
    expect(snapshotBeforeReload.cookie).toBe('');
    assertNoSecretLeak(snapshotBeforeReload, FAKE_API_KEY);
    // DOM ทั้งหน้าไม่มี key หลุดอยู่เลย (เช็คหลัง submit ไปแล้วหลายรอบ) — string ดิบ (ไม่ใช่ TS function)
    // เพราะ `tsconfig.node.json` ของ `tests/e2e/**` ไม่มี DOM lib (เหตุผลเดียวกับ `helpers/appFlows.ts`)
    const domHtml = await page.evaluate<string>('document.documentElement.outerHTML');
    expect(domHtml).not.toContain(FAKE_API_KEY);

    // ----- 10) reload → กลับ KeyGate (key หาย, N2/US-1.1) -----
    await page.reload();
    await expect(page).toHaveURL(/#\/$|#\/?$/);
    await expect(page.getByLabel('API key ของ Anthropic')).toBeVisible();
    const snapshotAfterReload = await captureStorageSnapshot(page);
    assertNoSecretLeak(snapshotAfterReload, FAKE_API_KEY);

    // ----- 11) เปิด /load แล้วอัปโหลดไฟล์ที่บันทึกไว้ → อ่านอย่างเดียว -----
    await page.goto('/#/load');
    await page.locator('input[type="file"]').setInputFiles(jsonPath);
    await expect(page.getByText('อ่านอย่างเดียว')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ข้อเสนอทดสอบอัตโนมัติ (e2e T-409)' })).toBeVisible();
    // ช่องแก้ qty ต้องถูกปิดใช้งานจริง (ไม่ใช่แค่ไม่มีผล) — ตาม `ProposalReadOnlyContext` (scope ใต้
    // `boq-table-desktop` เหมือนขั้นตอน 6 — หน้านี้ใช้ `BoqTable` เดียวกันจึง render ทั้ง 2 เลย์เอาต์ด้วย)
    await expect(
      page.getByTestId('boq-table-desktop').getByRole('button', { name: `แก้จำนวนของ ${row.item_name_raw}` }),
    ).toBeDisabled();

    // ----- 12) egress audit (N5/09 §5 C2/C3) — origin ทั้งหมดต้องเป็น same-origin หรือ anthropic เท่านั้น -----
    expect(mock.getUnhandledAnthropicRequests()).toEqual([]);
    expect(audit.foreignOriginRequests(), JSON.stringify(audit.foreignOriginRequests())).toEqual([]);
    for (const call of mock.getMessagesCalls()) {
      expect(call.headers['x-api-key']).toBeTruthy();
    }

    // B-001 (docs/qa/bugs.md): ต้นตอจริง = (ก) Zod 4 probe `new Function` → แก้แล้วด้วย `lib/zodConfig.ts` (jitless)
    // (ข) yoga-layout ใน react-pdf `fetch(data:…wasm)` ตอน export → อนุญาต `data:` ใน connect-src แล้ว
    // (data: URI ส่งข้อมูลออกนอกเครื่องไม่ได้ — ดู vite-plugins/cspMeta.ts) จากนี้ต้องไม่มี violation เลย
    expect(audit.cspViolations(), JSON.stringify(audit.cspViolations())).toEqual([]);
  });
});
