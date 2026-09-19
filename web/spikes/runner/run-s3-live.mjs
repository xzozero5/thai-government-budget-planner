// S3 runner (live) — ยิง API จริงด้วย Haiku 4.5 ภายใต้งบ ≤ $0.10
// รัน: npx vite build && node runner/run-s3-live.mjs
// N2: key อ่านฝั่ง Node แล้วส่งเข้า page เป็น argument ของ evaluate — ไม่ log, ไม่เขียนไฟล์, ไม่ใส่ URL
import { startServer, launch, ORIGIN, saveResult, sleep } from './lib/harness.mjs';
import { readApiKey } from './lib/key.mjs';
import { record, total } from './lib/ledger.mjs';

const MODEL = 'claude-haiku-4-5-20251001';
const BUDGET = 0.1;
const SYSTEM_LONG = ('คุณคือผู้ช่วยวางแผนงบประมาณภาครัฐไทย ต้องอ้างอิงแหล่งที่มาทุกตัวเลข ห้ามเดา. ' +
  'กฎ: (1) ตัวเลขจากข้อมูลจริงต้องมี source_id (2) ตัวเลขที่ประมาณเองต้องติดป้าย estimate (3) ตอบภาษาไทย. ').repeat(120);

const scrub = (o) => JSON.parse(JSON.stringify(o ?? null));

(async () => {
  const key = readApiKey();
  await startServer();
  const browser = await launch();
  const ctx = await browser.newContext(); // ไม่เปิด trace/video/HAR
  const page = await ctx.newPage();
  const cspViolations = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/Content Security Policy/i.test(t) && !/frame-ancestors/.test(t)) cspViolations.push(t.slice(0, 200));
  });
  await page.goto(`${ORIGIN}/pages/s3/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__s3?.ready === true, null, { timeout: 60000 });

  const results = { spike: 'S3', model: MODEL, chromium: browser.version(), when: new Date().toISOString(), steps: {} };
  const guard = (label) => {
    if (total() >= BUDGET) throw new Error(`งบ S3 ถึงเพดานแล้ว (${total()} USD) — หยุดก่อน ${label}`);
  };

  // (ก) CORS + header
  guard('ping');
  results.steps.ping = await page.evaluate(([k, m]) => window.__s3.ping(k, m), [key, MODEL]);
  console.log('ping:', JSON.stringify(scrub(results.steps.ping)));
  if (!results.steps.ping.ok) {
    console.log('หยุด: ping ไม่ผ่าน');
    results.aborted = 'ping failed';
  }

  if (results.steps.ping.ok) {
    // (ข) streaming
    guard('stream');
    results.steps.stream = await page.evaluate(([k, m]) => window.__s3.streamTest(k, m), [key, MODEL]);
    if (results.steps.stream.usage) record('S3', MODEL, 'stream', results.steps.stream.usage);
    console.log('stream:', JSON.stringify({ ...scrub(results.steps.stream), text_head: undefined }));
    await sleep(300);

    // (ค) client tool loop
    guard('toolLoop');
    results.steps.toolLoop = await page.evaluate(([k, m]) => window.__s3.toolLoop(k, m), [key, MODEL]);
    for (const r of results.steps.toolLoop.rounds ?? []) record('S3', MODEL, `toolLoop r${r.round}`, r.usage);
    console.log('toolLoop:', JSON.stringify({ ...scrub(results.steps.toolLoop), final_text: undefined }));
    console.log('  final_text:', (results.steps.toolLoop.final_text ?? '').slice(0, 160));
    await sleep(300);

    // (จ) prompt caching (ทำก่อน web search เพราะถูกกว่า)
    guard('caching');
    results.steps.caching = await page.evaluate(([k, m, s]) => window.__s3.caching(k, m, s), [key, MODEL, SYSTEM_LONG]);
    for (const c of results.steps.caching.calls ?? []) record('S3', MODEL, `caching call${c.call}`, c.usage);
    console.log('caching:', JSON.stringify(scrub(results.steps.caching)));
    await sleep(300);

    // (ง) server tool web search — 1 ครั้ง ($0.01/ครั้ง)
    guard('webSearch');
    if (total() + 0.02 <= BUDGET) {
      results.steps.webSearch = await page.evaluate(
        ([k, m, t]) => window.__s3.webSearch(k, m, t),
        [key, MODEL, 'web_search_20250305'],
      );
      if (results.steps.webSearch.usage) record('S3', MODEL, 'webSearch', results.steps.webSearch.usage);
      console.log('webSearch:', JSON.stringify({ ...scrub(results.steps.webSearch), text_head: undefined }));
      console.log('  citations:', JSON.stringify(results.steps.webSearch.citations));
    } else {
      results.steps.webSearch = { skipped: 'งบไม่พอ' };
    }
  }

  results.storage_audit = await page.evaluate(() => window.__s3.storageAudit());
  results.csp_violations = cspViolations;
  results.total_usd = total();
  console.log('storage audit:', JSON.stringify(results.storage_audit));
  console.log('CSP violations:', cspViolations.length ? cspViolations : '(none)');
  console.log('TOTAL USD so far:', total());

  await browser.close();
  saveResult('s3', results);
  process.exit(0);
})();
