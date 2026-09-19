/**
 * T-203 §4(ข) — integration test ใน browser จริง (Playwright) กับ build จริงที่เปิด harness route
 * ไว้ (`--mode e2e-harness`, ดู playwright.config.ts) และข้อมูลจริงใน `web/public/data/`
 *
 * เหตุผลที่ต้องใช้ `page.workers()` / `worker.evaluate()` แทน `page.on('response')` เพื่อดู request
 * ที่ DuckDB worker ยิงเอง: ยืนยันแล้วใน `docs/decisions/SPIKES.md` §S1 ว่า Network event ระดับ Page
 * ของ Playwright **ไม่เห็น** request ที่ worker ยิง (ได้ 0 เสมอ) ต้องอ่านจากภายใน worker context เอง
 * (`page.workers()` คืน `Worker[]` ที่มี `.evaluate()` รันโค้ดในบริบทของ worker นั้นตรง ๆ — เทคนิค
 * เดียวกับที่ใช้ใน `web/spikes/runner/lib/harness.mjs` (`workerXhrLog`))
 *
 * ส่วน `page.route()` **บล็อกได้จริง**แม้เป็น request ของ worker — ยืนยันจาก SPIKES.md §S1 ผล 5
 * ("worker เดิม + block cross-origin ที่ชั้น Playwright | query พัง")
 *
 * หมายเหตุ: ไฟล์นี้อยู่ภายใต้ tsconfig.node.json (lib: ES2023, ไม่มี DOM) — ห้ามอ้าง `window`/
 * `document`/`self` ตรง ๆ ในโค้ด TypeScript (ใช้ `globalThis` แทนสำหรับฝั่ง main thread และ string
 * source สำหรับโค้ดที่ต้องรันในบริบท worker เท่านั้น)
 */
import { expect, test, type Page, type Worker } from '@playwright/test';

interface QueryLinesResultLike {
  rows: { source_id: string }[];
  totalMatched: number;
  truncated: boolean;
  shardsScanned: number;
}

interface SafeResultLike<T> {
  ok: boolean;
  data?: T;
  errorName?: string;
  message?: string;
}

interface DataHarnessApiLike {
  queryLines: (params: Record<string, unknown>) => Promise<SafeResultLike<QueryLinesResultLike>>;
  prefetchDb: () => Promise<SafeResultLike<undefined>>;
}

async function openHarness(page: Page): Promise<void> {
  await page.goto('/#/__data-harness');
  // element ไม่มีขนาด/เนื้อหา (ไม่ใช่ UI จริง) จึงไม่ "visible" ตามนิยามของ Playwright — รอแค่ attach
  // เข้า DOM แล้วเช็ค attribute ต่อ (state: 'attached' แทน default 'visible')
  await page.waitForSelector('[data-testid="data-harness-root"][data-ready="true"]', {
    state: 'attached',
  });
}

function queryLinesViaHarness(
  page: Page,
  params: Record<string, unknown>,
): Promise<SafeResultLike<QueryLinesResultLike>> {
  return page.evaluate((p) => {
    const api = (globalThis as unknown as { __dataHarness: DataHarnessApiLike }).__dataHarness;
    return api.queryLines(p);
  }, params);
}

function prefetchViaHarness(page: Page): Promise<SafeResultLike<undefined>> {
  return page.evaluate(() => {
    const api = (globalThis as unknown as { __dataHarness: DataHarnessApiLike }).__dataHarness;
    return api.prefetchDb();
  });
}

function findDuckDbWorker(page: Page): Worker {
  // `tsconfig.node.json` (คุม tests/e2e) ไม่ได้เปิด `noUncheckedIndexedAccess` ต่างจาก
  // tsconfig.app.json จึงต้อง cast ชนิดของ index access เองตรงนี้ให้ตรวจ "ไม่พบ worker" ได้จริง
  const workers = page.workers() as (Worker | undefined)[];
  const worker = workers[0];
  if (!worker) {
    throw new Error('ไม่พบ DuckDB worker (ต้อง prefetchDb()/queryLines() ให้เสร็จก่อนเสมอ)');
  }
  return worker;
}

test.describe('data/repo.ts + data/duckdb.ts — integration จริงกับ GitHub-Pages-like build', () => {
  test('query จริง 3 แบบคืนผลถูกต้องตรงกับ manifest.json (ground truth)', async ({ page }) => {
    await openHarness(page);

    const q1 = await queryLinesViaHarness(page, {
      dataset: 'act_2570_draft',
      ministryCodes: ['01000'],
      excludeFlags: [],
    });
    expect(q1.ok).toBe(true);
    expect(q1.data?.totalMatched).toBe(1844);
    expect(q1.data?.shardsScanned).toBe(1);
    expect(q1.data?.rows).toHaveLength(20);
    expect(q1.data?.truncated).toBe(true);

    const q2 = await queryLinesViaHarness(page, {
      dataset: 'act_2570_draft',
      ministryCodes: ['02000'],
      excludeFlags: [],
    });
    expect(q2.ok).toBe(true);
    expect(q2.data?.totalMatched).toBe(754);

    // aggregate ข้าม 3 shard (เหมือน SPIKES.md §S1 Q3_agg_3shards) — 29,145 + 30,843 + 31,092
    const q3 = await queryLinesViaHarness(page, {
      dataset: 'pbo_disbursement',
      ministryCodes: ['15000'],
      fiscalYears: [2566, 2567, 2568],
      excludeFlags: [],
    });
    expect(q3.ok).toBe(true);
    expect(q3.data?.totalMatched).toBe(29145 + 30843 + 31092);
    expect(q3.data?.shardsScanned).toBe(3);
  });

  test('คำค้นกว้างเกินไป (ไม่ใส่ filter เลย) → QueryTooBroadError', async ({ page }) => {
    await openHarness(page);
    const result = await queryLinesViaHarness(page, {});
    expect(result.ok).toBe(false);
    expect(result.errorName).toBe('QueryTooBroadError');
  });

  test('เห็น HTTP 206 (range request) จริงจาก DuckDB worker', async ({ page }) => {
    await openHarness(page);
    // เริ่ม init ให้เสร็จก่อน (SET/INSTALL/LOAD ของ extension ไม่แตะ budget_lines/*.parquet เลย)
    // แล้วค่อย patch XHR ของ worker ก่อนยิง query จริง เพื่อให้จับได้เฉพาะ request ของ shard
    const prefetch = await prefetchViaHarness(page);
    expect(prefetch.ok).toBe(true);

    const worker = findDuckDbWorker(page);
    await worker.evaluate(`(function () {
      self.__xhrLog = [];
      var O = XMLHttpRequest.prototype.open, S = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return O.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function () {
        var r = S.apply(this, arguments);
        var xhr = this;
        var push = function () { self.__xhrLog.push({ u: xhr.__u, status: xhr.status }); };
        if (xhr.readyState === 4) push(); else xhr.addEventListener('loadend', push);
        return r;
      };
    })();`);

    const result = await queryLinesViaHarness(page, {
      dataset: 'act_2570_draft',
      ministryCodes: ['03000'],
      excludeFlags: [],
    });
    expect(result.ok).toBe(true);

    const xhrLog = await worker.evaluate<{ u: string; status: number }[]>(
      '(function () { return self.__xhrLog; })()',
    );
    const parquetLog = xhrLog.filter((e) => e.u.includes('.parquet'));
    expect(parquetLog.length).toBeGreaterThan(0);
    expect(parquetLog.some((e) => e.status === 206)).toBe(true);
  });

  test('block cross-origin request ทุกตัว แล้ว query ยังผ่าน (กัน N5 regression)', async (
    { page },
    testInfo,
  ) => {
    const expectedOrigin = new URL(String(testInfo.project.use.baseURL)).origin;
    const blockedCrossOrigin: string[] = [];
    await page.route('**/*', (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin !== expectedOrigin) {
        blockedCrossOrigin.push(requestUrl.href);
        return route.abort();
      }
      return route.continue();
    });

    await openHarness(page);
    const result = await queryLinesViaHarness(page, {
      dataset: 'act_2570_draft',
      ministryCodes: ['04000'],
      excludeFlags: [],
    });

    expect(result.ok).toBe(true);
    expect(result.data?.totalMatched).toBeGreaterThan(0);
    // ต้องไม่มี request ข้าม origin เกิดขึ้นเลย (ไม่ใช่แค่ "ถ้าเกิดจะถูกบล็อก")
    expect(blockedCrossOrigin).toEqual([]);
  });

  test('mode:"full" (fallback fetch ทั้งไฟล์) ให้ผลเท่ากับ mode:"range" (ค่าเริ่มต้น)', async ({
    page,
  }) => {
    const params = {
      dataset: 'act_2570_draft',
      ministryCodes: ['05000'],
      excludeFlags: [],
      limit: 50,
    };

    await openHarness(page);
    const rangeResult = await queryLinesViaHarness(page, params);
    expect(rangeResult.ok).toBe(true);

    // ใช้ page ใหม่ (instance ของ DuckDB ใหม่) เพื่อให้ mode:'full' เป็นการอ่านที่ "เย็น" จริง
    // ไม่ปนกับ cache ของ instance ก่อนหน้า
    const fullPage = await page.context().newPage();
    await openHarness(fullPage);
    const fullResult = await queryLinesViaHarness(fullPage, { ...params, mode: 'full' });
    expect(fullResult.ok).toBe(true);

    expect(fullResult.data?.totalMatched).toBe(rangeResult.data?.totalMatched);
    // T-206 B1: ต้องเทียบ "ลำดับจริง" (ไม่ sort ก่อนเทียบ) — ORDER BY มี source_id ASC เป็น
    // tiebreaker เสมอ ทำให้ range/full mode ต้องคืนแถวเรียงเหมือนกันเป๊ะ ไม่ใช่แค่ชุดข้อมูลเดียวกัน
    expect(fullResult.data?.rows.map((r) => r.source_id)).toEqual(
      rangeResult.data?.rows.map((r) => r.source_id),
    );
    await fullPage.close();
  });

  test('ไม่มี CSP violation ใน console ระหว่าง init + query', async ({ page }) => {
    const cspViolations: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('Content Security Policy')) {
        cspViolations.push(msg.text());
      }
    });

    await openHarness(page);
    const result = await queryLinesViaHarness(page, {
      dataset: 'act_2570_draft',
      ministryCodes: ['06000'],
      excludeFlags: [],
    });
    expect(result.ok).toBe(true);
    expect(cspViolations).toEqual([]);
  });
});
