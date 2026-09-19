// ตรวจ: duckdb-wasm ยิงไป extensions.duckdb.org หรือไม่ (N5) และ self-host repo ใช้ได้ไหม
import { startServer, launch, ORIGIN, sleep, serverStats, workerXhrLog, summarizeXhr } from './lib/harness.mjs';

const SQL = `SELECT count(*) AS n FROM read_parquet('${ORIGIN}/data/budget_lines/pbo/2564/20000.parquet')`;
const FS = { forceFullHTTPReads: false, allowFullHTTPReads: true, reliableHeadRequests: true };

async function run(label, { instrument, extensionRepo, blockExt }) {
  const browser = await launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const external = [];
  // ดัก request ข้าม origin ทุกตัวจากทั้ง page และ worker
  await ctx.route('**/*', async (route) => {
    const u = route.request().url();
    if (!u.startsWith(ORIGIN) && !u.startsWith('blob:') && !u.startsWith('data:')) {
      external.push(u);
      if (blockExt) return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${ORIGIN}/pages/s1/index.html`);
  await page.waitForFunction(() => window.__s1?.ready === true);
  const init = await page.evaluate((o) => window.__s1.init(o), { ...FS, instrument, extensionRepo });
  let res;
  try {
    const r = await page.evaluate((s) => window.__s1.runSql(s, 1), SQL);
    res = `OK ${r.ms.toFixed(0)} ms rows=${JSON.stringify(r.rows)}`;
  } catch (e) {
    res = 'FAIL ' + String(e).split('\n')[0].slice(0, 180);
  }
  await sleep(300);
  const xhr = instrument === false ? null : summarizeXhr(await workerXhrLog(page), /./);
  console.log(`\n### ${label}`);
  console.log('  extension:', JSON.stringify(init.extension));
  console.log('  query:', res);
  console.log('  cross-origin requests seen:', external.length ? [...new Set(external)].join(', ') : '(none)');
  if (xhr) console.log('  worker xhr:', xhr.requests, 'req', xhr.bytes, 'B', JSON.stringify(xhr.detail.slice(0, 8)));
  await browser.close();
}

await startServer();
await run('1. worker same-origin (ไม่ instrument) — ปล่อยให้ยิงออกได้', { instrument: false });
await run('2. worker same-origin + block cross-origin', { instrument: false, blockExt: true });
await run('3. blob worker (สืบทอด CSP ของหน้า) — ไม่มี custom repo', { instrument: true });
await run('4. blob worker + custom_extension_repository (self-host)', {
  instrument: true,
  extensionRepo: `${ORIGIN}/duckdb-ext`,
});
await run('5. worker same-origin + self-host repo + block cross-origin', {
  instrument: false,
  extensionRepo: `${ORIGIN}/duckdb-ext`,
  blockExt: true,
});
process.exit(0);
