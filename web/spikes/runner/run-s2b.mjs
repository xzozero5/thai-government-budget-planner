// S2 เสริม — ทางเลือก T-208: prebuilt MiniSearch index + ไฟล์ catalog แบบผอม
// รัน: npx vite build && node runner/run-s2b.mjs
import { startServer, launch, ORIGIN, saveResult, sleep } from './lib/harness.mjs';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPIKE = fileURLToPath(new URL('..', import.meta.url));
const CATALOG = `${ORIGIN}/data/catalog/items.json.gz`;

async function newPage(browser, cpuThrottle = 1) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (cpuThrottle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
  await page.goto(`${ORIGIN}/pages/s2/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__s2?.ready === true, null, { timeout: 60000 });
  return { ctx, page };
}

(async () => {
  await startServer();
  const browser = await launch();
  const out = { spike: 'S2b', chromium: browser.version(), when: new Date().toISOString(), artifacts: {}, loads: [] };
  mkdirSync(join(SPIKE, 'dist', 'prebuilt'), { recursive: true });

  // 1) สร้าง artifact: prebuilt index (2 variant) + catalog แบบผอม
  for (const variant of ['full', 'key_only']) {
    const { ctx, page } = await newPage(browser);
    await page.evaluate((u) => window.__s2.loadCatalog(u), CATALOG);
    await page.evaluate((v) => window.__s2.buildIndex(v), variant);
    
    // ดึง JSON ของ index ออกมา (ผ่าน serializeIndex เพื่อความชัดเจน)
    const raw = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return window.__s2_indexJson();
    });
    
    const file = join(SPIKE, 'dist', 'prebuilt', `index-${variant}.json`);
    writeFileSync(file, raw, 'utf8');
    const gz = gzipSync(Buffer.from(raw, 'utf8'), { level: 9 });
    writeFileSync(file + '.gz', gz);
    out.artifacts[`index-${variant}`] = { bytes_json: statSync(file).size, bytes_gz: gz.length };
    console.log(`artifact index-${variant}: json ${(statSync(file).size / 1048576).toFixed(2)} MB, gz ${(gz.length / 1048576).toFixed(2)} MB`);
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage(browser);
    await page.evaluate((u) => window.__s2.loadCatalog(u), CATALOG);
    const slim = await page.evaluate(() => window.__s2_slimCatalog());
    const file = join(SPIKE, 'dist', 'prebuilt', 'catalog-slim.json');
    writeFileSync(file, slim, 'utf8');
    const gz = gzipSync(Buffer.from(slim, 'utf8'), { level: 9 });
    writeFileSync(file + '.gz', gz);
    out.artifacts['catalog-slim'] = { bytes_json: statSync(file).size, bytes_gz: gz.length };
    console.log(`artifact catalog-slim: json ${(statSync(file).size / 1048576).toFixed(2)} MB, gz ${(gz.length / 1048576).toFixed(2)} MB`);
    await ctx.close();
  }

  // 2) วัดเวลาโหลด prebuilt index (แทนการ build ใหม่)
  for (const variant of ['full', 'key_only']) {
    for (const cpu of [1, 4]) {
      const { ctx, page } = await newPage(browser, cpu);
      const r = await page.evaluate(
        async ([url, v]) => window.__s2_loadPrebuilt(url, v),
        [`${ORIGIN}/prebuilt/index-${variant}.json.gz`, variant],
      );
      await sleep(100);
      out.loads.push({ variant, cpuThrottle: cpu, ...r });
      console.log(
        `load prebuilt ${variant} x${cpu}: fetch ${r.ms_fetch.toFixed(0)} + gunzip ${r.ms_gunzip.toFixed(0)} + loadJSON ${r.ms_loadJSON.toFixed(0)} = ${r.ms_total.toFixed(0)} ms · heapΔ ${(r.heap_delta / 1048576).toFixed(1)} MB · query5 ${r.queries.total_ms.toFixed(1)} ms`,
      );
      await ctx.close();
    }
  }

  await browser.close();
  saveResult('s2b', out);
  process.exit(0);
})();
