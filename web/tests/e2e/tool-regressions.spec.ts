/**
 * T-603 — regression ของ tool กับ **ข้อมูล production จริง** ด้วย input คำต่อคำจาก transcript ของ eval จริง (T-604)
 * ที่เคยล้ม (mock เฉพาะ HTTP ของ Anthropic — tool ทุกตัวรันกับ DuckDB/catalog จริงในเบราว์เซอร์ ไม่มีค่า API):
 *  (ก) query_budget_lines ที่มีแต่ keywords + 3 ปี เคยล้มด้วย "คำค้นกว้างเกินไป (97 ไฟล์)" ทุกครั้ง
 *  (ข) item_key ที่โมเดลพิมพ์มีวงเล็บ (ลอกจาก item_name_raw) เคยได้ 0 แถว "เงียบ ๆ" → ต้องมีคำเตือน + key ใกล้เคียง
 *  (ค) sample_source_ids จาก search_catalog เคยเปิดด้วย get_budget_line ไม่ได้ (ไม่มี shard hint)
 */
import { expect, test } from '@playwright/test';
import {
  createAnthropicMock,
  findToolResultContent,
  lastToolOutput,
  makeMessage,
  parseWrappedToolResult,
  textBlock,
  toolUseBlock,
  type AnthropicRequestBody,
} from './helpers/mockAnthropic';
import { submitFakeKeyAndEnterWorkspace } from './helpers/appFlows';

const TRUCK_ITEM_KEY_AS_TYPED_BY_MODEL =
  'รถบรรทุก (ดีเซล) ขนาด 1 ตัน ปริมาตรกระบอกสูบไม่ต่ำกว่า 2400 ซีซี ขับเคลื่อน 2 ล้อ แบบดับเบิ้ลแค็บ';

interface QueryOutputLike {
  rows: unknown[];
  total: number;
  warnings?: string[];
}
interface SearchCatalogOutputLike {
  items: { sample_source_ids: string[] }[];
}
interface GetBudgetLineOutputLike {
  lines: { source_id: string }[];
  not_found: unknown[];
}

function toolUseIdsByName(body: AnthropicRequestBody, name: string): string[] {
  const ids: string[] = [];
  for (const message of body.messages) {
    if (message.role !== 'assistant' || typeof message.content === 'string') continue;
    for (const block of message.content) {
      if (block.type === 'tool_use' && block.name === name && typeof block.id === 'string') {
        ids.push(block.id);
      }
    }
  }
  return ids;
}

test('input จริงจาก eval ที่เคยล้ม: keywords กว้าง / item_key มีวงเล็บ / sample id จาก catalog', async ({ page }) => {
  test.setTimeout(240_000);
  const mock = createAnthropicMock(page);
  await mock.install();

  let sampleIds: string[] = [];
  let finalBody: AnthropicRequestBody | undefined;

  mock.setMessagesTurns([
    {
      kind: 'message',
      message: makeMessage({
        content: [
          toolUseBlock('search_catalog', { query: 'รถบรรทุก', fiscal_years: [2562, 2563, 2564], limit: 20 }),
        ],
        stopReason: 'tool_use',
      }),
    },
    {
      kind: 'dynamic',
      build: (body) => {
        const catalog = lastToolOutput(body, 'search_catalog') as SearchCatalogOutputLike;
        sampleIds = catalog.items.flatMap((item) => item.sample_source_ids).slice(0, 3);
        return makeMessage({
          content: [toolUseBlock('get_budget_line', { source_ids: sampleIds })],
          stopReason: 'tool_use',
        });
      },
    },
    {
      kind: 'message',
      message: makeMessage({
        content: [
          toolUseBlock('query_budget_lines', {
            keywords: ['Total Station'],
            fiscal_years: [2568, 2567, 2566],
            limit: 15,
          }),
        ],
        stopReason: 'tool_use',
      }),
    },
    {
      kind: 'message',
      message: makeMessage({
        content: [
          toolUseBlock('query_budget_lines', {
            item_key: TRUCK_ITEM_KEY_AS_TYPED_BY_MODEL,
            fiscal_years: [2563],
            ministry_code: '01000',
            limit: 50,
          }),
        ],
        stopReason: 'tool_use',
      }),
    },
    {
      kind: 'dynamic',
      build: (body) => {
        finalBody = body;
        return makeMessage({ content: [textBlock('จบการทดสอบ regression ของเครื่องมือ')], stopReason: 'end_turn' });
      },
    },
  ]);

  await submitFakeKeyAndEnterWorkspace(page);
  await page.getByLabel('ช่องพิมพ์ข้อความ').fill('ทดสอบเครื่องมือกับข้อมูลจริง');
  await page.getByRole('button', { name: 'ส่ง' }).click();
  await expect(page.getByText('จบการทดสอบ regression ของเครื่องมือ').first()).toBeVisible({ timeout: 200_000 });

  if (finalBody === undefined) throw new Error('mock ไม่ได้รับ request รอบสุดท้าย');

  // (ค) sample id จาก catalog ต้องเปิดแถวจริงได้
  expect(sampleIds.length).toBeGreaterThan(0);
  const budgetLine = lastToolOutput(finalBody, 'get_budget_line') as GetBudgetLineOutputLike;
  expect(budgetLine.lines.map((l) => l.source_id).sort()).toEqual([...sampleIds].sort());
  expect(budgetLine.not_found).toEqual([]);

  // ผลของ query_budget_lines 2 ครั้ง — เรียงตามลำดับที่เรียก (ครั้งสุดท้าย = item_key มีวงเล็บ)
  const queryIds = toolUseIdsByName(finalBody, 'query_budget_lines');
  expect(queryIds).toHaveLength(2);
  const lastQuery = lastToolOutput(finalBody, 'query_budget_lines') as QueryOutputLike;

  // (ก) keywords กว้าง (เดิม: error สแกน 97 ไฟล์) → ต้องได้แถวจริง + warning บอกว่าค้นไม่ครบทุกไฟล์
  const firstQueryContent = findToolResultContent(finalBody.messages, queryIds[0] ?? '');
  if (firstQueryContent === undefined) throw new Error('ไม่พบผลของ query_budget_lines ครั้งแรก');
  const firstQuery = parseWrappedToolResult(firstQueryContent) as QueryOutputLike;
  expect(firstQuery.rows.length).toBeGreaterThan(0);
  expect((firstQuery.warnings ?? []).join(' ')).toContain('ไม่ครบทุกไฟล์');

  // (ข) item_key ไม่ตรง catalog → ห้ามเงียบ: ต้องมี warning ที่เสนอ key ใกล้เคียง
  expect(lastQuery.total).toBe(0);
  expect((lastQuery.warnings ?? []).join(' ')).toContain('ไม่ตรงกับ key ใดใน catalog');
  expect((lastQuery.warnings ?? []).join(' ')).toContain('รถบรรทุก ดีเซล ขนาด 1 ตัน');

  // ไม่มีการ์ด error เลยทั้งบทสนทนา
  await expect(page.locator('[data-testid="tool-activity"][data-tool="query_budget_lines"][data-status="done"]')).toHaveCount(2);
  await expect(page.locator('[data-testid="tool-activity"][data-status="error"]')).toHaveCount(0);
});
