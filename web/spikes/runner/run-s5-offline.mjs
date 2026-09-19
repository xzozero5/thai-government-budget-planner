// S5 (ส่วนที่ไม่ใช้ API) — sanitizer + SVG→PNG ภายใต้ CSP + PNG ลง react-pdf
// รัน: npx vite build && node runner/run-s5-offline.mjs
import { startServer, launch, ORIGIN, saveResult, SPIKE_DIR } from './lib/harness.mjs';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const IN = join(SPIKE_DIR, 's5', 'in');
const OUT = join(SPIKE_DIR, 's5', 'out');

(async () => {
  await startServer();
  const browser = await launch();
  mkdirSync(OUT, { recursive: true });
  const cases = readdirSync(IN)
    .filter((f) => f.endsWith('.svg'))
    .map((f) => ({ name: f.replace('.svg', ''), svg: readFileSync(join(IN, f), 'utf8') }));

  const results = { spike: 'S5-offline', chromium: browser.version(), when: new Date().toISOString() };

  // 1) sanitizer (หน้า CSP ตาม D8 เป๊ะ)
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const cspViolations = [];
    page.on('console', (m) => {
      const t = m.text();
      if (/Content Security Policy/i.test(t) && !/frame-ancestors/.test(t)) cspViolations.push(t.slice(0, 200));
    });
    await page.goto(`${ORIGIN}/pages/s5/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__s5?.ready === true, null, { timeout: 60000 });
    results.sanitize = await page.evaluate((c) => window.__s5.sanitizeCases(c), cases);
    for (const r of results.sanitize.results) {
      writeFileSync(join(OUT, `${r.name}.clean.svg`), await page.evaluate((s) => window.__s5.sanitize(s), cases.find((c) => c.name === r.name).svg));
      console.log(
        `${r.name}: ${r.bytes_in}→${r.bytes_out} B · removed_tags=${JSON.stringify(r.removed_tags)} · leftovers=${JSON.stringify(r.after.suspicious)}`,
      );
    }
    console.log('DOMPurify', results.sanitize.dompurify_version);

    // 2) SVG → PNG (data: กับ blob:) ภายใต้ CSP img-src 'self' data:
    const clean = await page.evaluate((s) => window.__s5.sanitize(s), cases.find((c) => c.name === '07-clean-diagram').svg);
    results.png_dataurl = await page.evaluate(([s]) => window.__s5.svgToPng(s, { via: 'data', scale: 2, w: 400, h: 240 }), [clean]);
    results.png_blob_strictcsp = await page.evaluate(([s]) => window.__s5.svgToPng(s, { via: 'blob', scale: 2, w: 400, h: 240 }), [clean]);
    console.log('png via data:', JSON.stringify({ ...results.png_dataurl, png_head: undefined }));
    console.log('png via blob: (CSP img-src self data:):', JSON.stringify({ ...results.png_blob_strictcsp, png_head: undefined }));

    // 3) ฟอนต์ไทยใน SVG ตอน rasterize
    results.thai_font_in_svg = await page.evaluate(() => window.__s5.thaiFontInSvg());
    console.log('thai font in svg:', JSON.stringify(results.thai_font_in_svg));

    // 4) PNG → react-pdf
    const png = await page.evaluate(([s]) => window.__s5.svgToPng(s, { via: 'data', scale: 2, w: 400, h: 240 }), [clean]);
    void png;
    results.png_into_pdf = await page.evaluate(() => window.__s5.pngIntoPdf(window.__s5png));
    console.log('png into pdf:', JSON.stringify(results.png_into_pdf));
    const pdfB64 = await page.evaluate(() => {
      const u = new Uint8Array(window.__s5pdf);
      let s = '';
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      return btoa(s);
    });
    writeFileSync(join(OUT, 's5-illustration.pdf'), Buffer.from(pdfB64, 'base64'));
    const pngB64 = await page.evaluate(() => window.__s5png);
    writeFileSync(join(OUT, 's5-diagram-2x.png'), Buffer.from(pngB64.split(',')[1], 'base64'));
    results.csp_violations = cspViolations;
    await ctx.close();
  }

  // 5) blob: เมื่อ CSP อนุญาต blob: ใน img-src
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${ORIGIN}/pages/s5-blob/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__s5?.ready === true, null, { timeout: 60000 });
    const clean = await page.evaluate((s) => window.__s5.sanitize(s), cases.find((c) => c.name === '07-clean-diagram').svg);
    results.png_blob_relaxedcsp = await page.evaluate(([s]) => window.__s5.svgToPng(s, { via: 'blob', scale: 2, w: 400, h: 240 }), [clean]);
    console.log('png via blob: (CSP + blob:):', JSON.stringify({ ...results.png_blob_relaxedcsp, png_head: undefined }));
    await ctx.close();
  }

  await browser.close();
  saveResult('s5-offline', results);
  process.exit(0);
})();
