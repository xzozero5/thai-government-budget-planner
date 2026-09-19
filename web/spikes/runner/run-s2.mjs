// S2 runner — Intl.Segmenter + MiniSearch กับ catalog ตัวจริง
// รัน: npx vite build && node runner/run-s2.mjs
import { startServer, launch, ORIGIN, saveResult, sleep } from './lib/harness.mjs';

const CATALOG = `${ORIGIN}/data/catalog/items.json.gz`;
const DOCS = [
  `${ORIGIN}/data/docs/d_1b50f9faf276.json.gz`,
  `${ORIGIN}/data/docs/d_1f490878307e.json.gz`,
  `${ORIGIN}/data/docs/d_1000a15a98f5.json.gz`,
];

async function newPage(browser, { cpuThrottle = 1 } = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (cpuThrottle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
  await page.goto(`${ORIGIN}/pages/s2/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__s2?.ready === true, null, { timeout: 60000 });
  return { ctx, page };
}

async function variantRun(browser, variant, { cpuThrottle = 1, serialize = false } = {}) {
  const { ctx, page } = await newPage(browser, { cpuThrottle });
  const load = await page.evaluate((u) => window.__s2.loadCatalog(u), CATALOG);
  const build = await page.evaluate((v) => window.__s2.buildIndex(v), variant);
  const q1 = await page.evaluate(() => window.__s2.runQueries());
  await sleep(50);
  const q2 = await page.evaluate(() => window.__s2.runQueries());
  const strictAnd = await page.evaluate(() => window.__s2.runQueries({ combineWith: 'AND', fuzzy: 0 }));
  const ser = serialize ? await page.evaluate(() => window.__s2.serializeIndex()) : null;
  const heapEnd = await page.evaluate(() => window.__s2.gcHeap());
  await ctx.close();
  return { variant, cpuThrottle, load, build, queries_cold: q1, queries_warm: q2, queries_and_nofuzzy: strictAnd, serialize: ser, heap_end: heapEnd };
}

(async () => {
  await startServer();
  const browser = await launch();
  const results = { spike: 'S2', chromium: browser.version(), when: new Date().toISOString(), runs: [], probe: null, folding: null };

  // Intl.Segmenter probe
  {
    const { ctx, page } = await newPage(browser);
    await page.evaluate((u) => window.__s2.loadCatalog(u), CATALOG);
    results.probe = await page.evaluate(() => window.__s2.segmenterProbe());
    console.log('Segmenter available:', results.probe.available, '| 1000 keys:', results.probe.ms_1000_keys_segmenter.toFixed(1), 'ms (segmenter) vs', results.probe.ms_1000_keys_ngram.toFixed(1), 'ms (ngram3)');
    console.log('  example tokens:', JSON.stringify(results.probe.example));
    await ctx.close();
  }

  // folding
  {
    const { ctx, page } = await newPage(browser);
    results.folding = await page.evaluate(async (urls) => {
      const corpus = await window.__s2.loadDocCorpus(urls);
      return window.__s2.foldingTest(corpus);
    }, DOCS);
    console.log('folding:', JSON.stringify(results.folding.without_folding), '→', JSON.stringify(results.folding.with_folding));
    await ctx.close();
  }

  const plan = [
    { variant: 'full', serialize: true },
    { variant: 'key_only', serialize: true },
    { variant: 'key_keys' },
    { variant: 'ngram_full' },
    { variant: 'full', cpuThrottle: 4 },
    { variant: 'key_only', cpuThrottle: 4 },
  ];
  for (const p of plan) {
    const r = await variantRun(browser, p.variant, p);
    results.runs.push(r);
    console.log(
      `${p.variant}${p.cpuThrottle ? ' x' + p.cpuThrottle : ''}: load ${r.load.ms_total.toFixed(0)} ms (fetch ${r.load.ms_fetch.toFixed(0)}/gunzip ${r.load.ms_gunzip.toFixed(0)}/parse ${r.load.ms_parse.toFixed(0)}) · index ${r.build.ms_index.toFixed(0)} ms · heapΔ ${(r.build.heap_delta / 1048576).toFixed(1)} MB · heapEnd ${(r.heap_end.used / 1048576).toFixed(1)} MB · q cold ${r.queries_cold.total_ms.toFixed(1)} ms warm ${r.queries_warm.total_ms.toFixed(1)} ms`,
    );
    if (r.serialize)
      console.log(`   serialize: json ${(r.serialize.bytes_json / 1048576).toFixed(2)} MB, gz ${(r.serialize.bytes_gz / 1048576).toFixed(2)} MB, loadJSON ${r.serialize.ms_loadJSON.toFixed(0)} ms, probe ${r.serialize.probe_hits}`);
  }

  await browser.close();
  saveResult('s2', results);
  process.exit(0);
})();
