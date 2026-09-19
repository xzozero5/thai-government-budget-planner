// S4 เสริม — ตรวจความถูกต้องของข้อความไทยระดับสตริง (render → extract กลับมาเทียบ)
import { startServer, launch, ORIGIN, saveResult } from './lib/harness.mjs';
await startServer();
const b = await launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
await p.goto(`${ORIGIN}/pages/s4/index.html`);
await p.waitForFunction(() => window.__s4?.ready === true);
const CTRL = new RegExp('[' + String.fromCharCode(0x1c) + '-' + String.fromCharCode(0x1f) + ']', 'g');
const norm = (s) => s.replace(CTRL, 'า');
const results = { spike: 'S4-probe', chromium: b.version(), when: new Date().toISOString(), runs: [] };
for (const [sfx, pfx] of [['', false], ['|', false], ['', true]]) {
  const r = await p.evaluate(([a, c]) => window.__s4.renderProbe(a, c), [sfx, pfx]);
  let diffs = 0;
  for (let i = 0; i < r.expected.length; i++) {
    const e = r.expected[i];
    const a = norm(r.extracted[i] || '');
    if (e !== a) { diffs++; console.log('  DIFF', JSON.stringify(e), '->', JSON.stringify(a)); }
  }
  results.runs.push({ suffix: sfx, prefix: pfx, diffs, total: r.expected.length, expected: r.expected, extracted: r.extracted });
  console.log('prefix=', pfx, 'suffix=', JSON.stringify(sfx), 'diffs', diffs, '/', r.expected.length);
}
saveResult('s4-probe', results);
await b.close();
process.exit(0);
