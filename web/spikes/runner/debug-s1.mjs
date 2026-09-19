import { startServer, launch, ORIGIN, sleep, serverStats } from './lib/harness.mjs';

const COMBOS = [
  { label: 'default {}', fs: {} },
  { label: 'allowFullHTTPReads:false', fs: { allowFullHTTPReads: false } },
  { label: 'reliableHeadRequests:true', fs: { reliableHeadRequests: true } },
  {
    label: 'reliableHeadRequests:true + allowFullHTTPReads:false',
    fs: { reliableHeadRequests: true, allowFullHTTPReads: false },
  },
  { label: 'forceFullHTTPReads:true', fs: { forceFullHTTPReads: true } },
  { label: 'forceFullHTTPReads:false', fs: { forceFullHTTPReads: false } },
  { label: 'force:false + reliableHead:true', fs: { forceFullHTTPReads: false, reliableHeadRequests: true } },
  { label: 'force:false + allowFull:false', fs: { forceFullHTTPReads: false, allowFullHTTPReads: false } },
  { label: 'force:false + allowFull:false + reliableHead:true', fs: { forceFullHTTPReads: false, allowFullHTTPReads: false, reliableHeadRequests: true } },
];

await startServer();
const browser = await launch();
for (const c of COMBOS) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (!t.includes('frame-ancestors')) console.log(`  [console:${m.type()}]`, t.slice(0, 200));
  });
  await page.goto(`${ORIGIN}/pages/s1/index.html`);
  await page.waitForFunction(() => window.__s1?.ready === true);
  await page.evaluate((o) => window.__s1.init(o), c.fs);
  console.log('\n###', c.label);
  await serverStats({ reset: true });
  try {
    const r = await page.evaluate(
      (s) => window.__s1.runSql(s, 1),
      `SELECT count(*) AS n FROM read_parquet('${ORIGIN}/data/budget_lines/pbo/2564/20000.parquet')`,
    );
    console.log('  OK', r.ms.toFixed(0), 'ms', JSON.stringify(r.rows));
  } catch (e) {
    console.log('  FAIL', String(e).split('\n')[0].slice(0, 160));
  }
  await sleep(200);
  const st = await serverStats({ reset: true, log: true });
  console.log('  requests', st.requests, 'bytes', st.bytes);
  for (const l of st.log ?? []) console.log('   ', l.method, l.status, 'reqRange=' + l.reqRange, 'bytes=' + l.bytes);
  await ctx.close();
}
await browser.close();
process.exit(0);
