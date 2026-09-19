// S1 runner — DuckDB-WASM (eh build, ไม่มี threads) + parquet ผ่าน HTTP range
// รัน: npx vite build && node runner/run-s1.mjs
// วัดทุก query แบบ "เย็นจริง" (browser context ใหม่ + duckdb instance ใหม่ทุกครั้ง)
import {
  startServer,
  serverStats,
  launch,
  ORIGIN,
  PAGES_BASE,
  saveResult,
  sleep,
  workerXhrLog,
  summarizeXhr,
} from './lib/harness.mjs';

// ค้นพบใน spike: duckdb-wasm 1.32.0 ตั้ง forceFullHTTPReads = true เป็นค่าเริ่มต้น → ต้องปิดเองถึงจะใช้ range
// extensionRepo = self-host ของ parquet extension (ไม่งั้น duckdb ยิงไป extensions.duckdb.org → ผิด N5)
const EXT = { extensionRepo: `${ORIGIN}/duckdb-ext` };
const FS_RANGE = { ...EXT, forceFullHTTPReads: false, allowFullHTTPReads: true, reliableHeadRequests: true };
const FS_RANGE_STRICT = { ...EXT, forceFullHTTPReads: false, allowFullHTTPReads: false, reliableHeadRequests: true };
const FS_DEFAULT = { ...EXT }; // = full-file read (ค่าเริ่มต้นของ library)

const AC_KEYS = [
  'เครื่องปรับอากาศ แบบแยกส่วนชนิดตั้งพื้นหรือชนิดแขวน มีระบบฟอกอากาศ ขนาด 24000 บีทียู',
  'เครื่องปรับอากาศ แบบแยกส่วนชนิดติดผนัง มีระบบฟอกอากาศ ขนาด 24000 บีทียู',
  'เครื่องปรับอากาศ แบบแยกส่วนชนิดตั้งพื้นหรือชนิดแขวน มีระบบฟอกอากาศ ขนาด 30000 บีทียู',
];

const queries = (base) => {
  const f = (y) => `${base}/budget_lines/pbo/${y}/20000.parquet`;
  const inList = AC_KEYS.map((k) => `'${k.replace(/'/g, "''")}'`).join(', ');
  return {
    Q0_count: `SELECT count(*) AS n FROM read_parquet('${f(2564)}')`,
    Q1_in_keys: `SELECT source_id, agency, item_name_raw, item_qty, amount_thb, unit_price_thb, source_row FROM read_parquet('${f(2564)}') WHERE item_key IN (${inList}) LIMIT 50`,
    Q1b_in_keys_narrow: `SELECT source_id, amount_thb, unit_price_thb FROM read_parquet('${f(2564)}') WHERE item_key IN (${inList}) LIMIT 50`,
    Q2_like: `SELECT item_key, count(*) AS n, median(unit_price_thb) AS med_unit_price FROM read_parquet('${f(2564)}') WHERE item_key LIKE '%เครื่องปรับอากาศ%' GROUP BY 1 ORDER BY n DESC LIMIT 20`,
    Q3_agg_3shards: `SELECT fiscal_year_be, count(*) AS n, sum(amount_thb) AS total FROM read_parquet(['${f(2564)}', '${f(2565)}', '${f(2566)}']) GROUP BY 1 ORDER BY 1`,
  };
};

async function coldQuery(browser, { pagePath, base, fs, sql, warmRepeat = 3 }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${ORIGIN}${pagePath}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__s1?.ready === true, null, { timeout: 60000 });
  await serverStats({ reset: true });

  const init = await page.evaluate((o) => window.__s1.init(o), fs);
  await sleep(200);
  const initServer = await serverStats({ reset: true });
  await workerXhrLog(page, { clear: true });

  let cold;
  try {
    cold = await page.evaluate(([s]) => window.__s1.runSql(s, 1), [sql]);
  } catch (e) {
    cold = { error: String(e).split('\n')[0].slice(0, 200) };
  }
  await sleep(250);
  const coldXhr = summarizeXhr(await workerXhrLog(page, { clear: true }));
  const coldServer = await serverStats({ reset: true });

  const warm = [];
  for (let i = 0; i < warmRepeat; i++) {
    const r = await page.evaluate(([s]) => window.__s1.runSql(s, 0), [sql]).catch((e) => ({ error: String(e).slice(0, 100) }));
    await sleep(120);
    warm.push({ ms: r.ms, xhr: summarizeXhr(await workerXhrLog(page, { clear: true })) });
  }

  const out = {
    init_ms: init.ms_total,
    init_instantiate_ms: init.ms_instantiate,
    init_open_ms: init.ms_open,
    init_server_bytes: initServer.bytes,
    heap_after_init: init.heap_after_init,
    cold_ms: cold.ms,
    cold_rows: cold.num_rows,
    cold_sample: cold.rows?.[0] ?? null,
    cold_error: cold.error,
    cold_xhr: coldXhr,
    cold_server: coldServer.requests ? { requests: coldServer.requests, bytes: coldServer.bytes } : null,
    warm: warm.map((w) => ({ ms: w.ms, requests: w.xhr.requests, bytes: w.xhr.bytes })),
    duckdb_memory: await page.evaluate(() => window.__s1.memoryStats()),
    heap_end: await page.evaluate(() => window.__s1.heap()),
    page_errors: errors,
  };
  await context.close();
  return out;
}

async function fallbackScenario(browser, { name, base, pagePath }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${ORIGIN}${pagePath}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__s1?.ready === true, null, { timeout: 60000 });
  await page.evaluate((o) => window.__s1.init(o), FS_RANGE);
  const reg = await page.evaluate(
    ([n, u]) => window.__s1.registerBuffer(n, u),
    ['s2564.parquet', `${base}/budget_lines/pbo/2564/20000.parquet`],
  );
  const heapAfterRegister = await page.evaluate(() => window.__s1.heap());
  const local = queries('MEM');
  const res = {};
  for (const [qn, sql] of Object.entries(local)) {
    if (qn === 'Q3_agg_3shards') continue;
    const s = sql.replace(/read_parquet\('MEM[^']*'\)/g, "read_parquet('s2564.parquet')");
    const r = await page.evaluate(([x]) => window.__s1.runSql(x, 1), [s]);
    res[qn] = { ms: r.ms, num_rows: r.num_rows, sample: r.rows?.[0] ?? null };
    console.log(`  ${name}/${qn}: ${r.ms.toFixed(0)} ms (in-memory)`);
  }
  const out = {
    name,
    base,
    register: reg,
    heap_after_register: heapAfterRegister,
    queries: res,
    duckdb_memory: await page.evaluate(() => window.__s1.memoryStats()),
    heap_end: await page.evaluate(() => window.__s1.heap()),
  };
  await context.close();
  return out;
}

(async () => {
  await startServer();
  const browser = await launch();
  const results = { spike: 'S1', chromium: browser.version(), when: new Date().toISOString(), matrix: {}, fallback: [] };
  const L = `${ORIGIN}/data`;
  const P = `${PAGES_BASE}/data`;

  const plan = [
    { name: 'A-local-range', pagePath: '/pages/s1/index.html', base: L, fs: FS_RANGE },
    { name: 'B-local-range-strict', pagePath: '/pages/s1/index.html', base: L, fs: FS_RANGE_STRICT },
    { name: 'C-local-default-fullread', pagePath: '/pages/s1/index.html', base: L, fs: FS_DEFAULT },
    { name: 'D-pages-range', pagePath: '/pages/s1-remote/index.html', base: P, fs: FS_RANGE },
    { name: 'E-pages-default-fullread', pagePath: '/pages/s1-remote/index.html', base: P, fs: FS_DEFAULT },
  ];

  for (const p of plan) {
    console.log(`== ${p.name} ==`);
    results.matrix[p.name] = { fs: p.fs, base: p.base, queries: {} };
    for (const [qname, sql] of Object.entries(queries(p.base))) {
      const r = await coldQuery(browser, { ...p, sql });
      results.matrix[p.name].queries[qname] = { sql: sql.slice(0, 160), ...r };
      console.log(
        `  ${qname}: cold ${r.cold_ms?.toFixed(0) ?? 'ERR'} ms · xhr ${r.cold_xhr.requests} req / ${r.cold_xhr.bytes} B (206=${r.cold_xhr.status_206})` +
          (r.cold_server ? ` · server ${r.cold_server.requests}/${r.cold_server.bytes}` : '') +
          ` · warm ${r.warm.map((w) => Math.round(w.ms ?? -1)).join('/')} ms`,
      );
    }
  }

  console.log('== F-fallback registerFileBuffer (local) ==');
  results.fallback.push(await fallbackScenario(browser, { name: 'F-local', base: L, pagePath: '/pages/s1/index.html' }));
  console.log('== G-fallback registerFileBuffer (Pages) ==');
  results.fallback.push(
    await fallbackScenario(browser, { name: 'G-pages', base: P, pagePath: '/pages/s1-remote/index.html' }),
  );

  await browser.close();
  saveResult('s1', results);
  process.exit(0);
})();
