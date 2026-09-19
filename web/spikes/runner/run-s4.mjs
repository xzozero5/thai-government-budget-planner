// S4 runner — react-pdf + Sarabun
// รัน: npx vite build && node runner/run-s4.mjs → results/s4.json + s4/out/*.png
import { startServer, launch, ORIGIN, saveResult, SPIKE_DIR } from './lib/harness.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(SPIKE_DIR, 's4', 'out');

(async () => {
  await startServer();
  const browser = await launch();
  mkdirSync(OUT, { recursive: true });
  const results = { spike: 'S4', chromium: browser.version(), when: new Date().toISOString(), runs: [] };

  for (const disableHyphenation of [true, false]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('frame-ancestors')) errors.push('console: ' + m.text().slice(0, 200));
    });
    await page.goto(`${ORIGIN}/pages/s4/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__s4?.ready === true, null, { timeout: 60000 });

    const r = await page.evaluate((o) => window.__s4.render(o), { disableHyphenation });
    const insp = await page.evaluate(() => window.__s4.inspect(1.6));
    const tag = disableHyphenation ? 'nohyphen' : 'hyphen';
    insp.images.forEach((dataUrl, i) => {
      writeFileSync(join(OUT, `s4-${tag}-p${i + 1}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
    });
    // เก็บไฟล์ PDF ไว้ตรวจด้วย viewer จริง
    const pdfB64 = await page.evaluate(() => {
      const buf = window.__s4pdf;
      let s = '';
      const u = new Uint8Array(buf);
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      return btoa(s);
    });
    writeFileSync(join(OUT, `s4-${tag}.pdf`), Buffer.from(pdfB64, 'base64'));

    delete insp.images;
    results.runs.push({ tag, render: r, inspect: insp, errors });
    console.log(
      `${tag}: render ${r.ms_render.toFixed(0)} ms, ${(r.bytes / 1024).toFixed(0)} KB, ${insp.num_pages} pages, links=${JSON.stringify(insp.links)}`,
    );
    for (const p of insp.pages) console.log(`   p${p.page}: ${p.chars} chars`);
    if (errors.length) console.log('   errors:', errors.slice(0, 3));
    await ctx.close();
  }

  await browser.close();
  saveResult('s4', results);
  process.exit(0);
})();
