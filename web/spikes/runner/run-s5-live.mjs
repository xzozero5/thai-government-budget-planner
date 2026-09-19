// S5 (live) — ให้ Claude สร้าง SVG 3 โจทย์ → sanitize → PNG 2× → react-pdf ; งบ ≤ $0.30
// รัน: npx vite build && node runner/run-s5-live.mjs
import { startServer, launch, ORIGIN, saveResult, SPIKE_DIR, sleep } from './lib/harness.mjs';
import { readApiKey } from './lib/key.mjs';
import { record, total } from './lib/ledger.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(SPIKE_DIR, 's5', 'out');
const BUDGET_TOTAL = 0.4; // งบรวมของ T-201
const SONNET = 'claude-sonnet-5';
const HAIKU = 'claude-haiku-4-5-20251001';

const PALETTE = ['#A51931', '#F4F5F8', '#2D2A4A', '#1F4E79', '#E8EEF7', '#6B7280', '#0F7B6C', '#B45309'];

const SYSTEM = `คุณสร้างภาพประกอบโครงการภาครัฐไทยเป็น SVG เพียงอย่างเดียว
ข้อบังคับ (ห้ามละเมิด):
- ตอบกลับเป็นโค้ด SVG ล้วน เริ่มด้วย <svg และจบด้วย </svg> ห้ามมีคำอธิบายอื่น
- ต้องมี viewBox และ width/height
- ขนาดไฟล์รวมไม่เกิน 60 KB
- ใช้เฉพาะสีจาก palette นี้: ${PALETTE.join(', ')} (ใช้ #FFFFFF เป็นพื้นหลังได้)
- ห้ามใช้ <script>, <foreignObject>, <image>, <use>, event attribute (on*), href ภายนอก, <style> ที่มี url( หรือ @import
- ข้อความในภาพเป็นภาษาไทย ใช้ font-family="Sarabun, sans-serif" และ font-size ≥ 12
- ใส่มาตราส่วน/หน่วยกำกับเมื่อเกี่ยวข้อง และหมายเหตุ "ภาพประกอบ ไม่ใช่แบบก่อสร้าง"`;

const TASKS = [
  {
    id: '01-road-isometric',
    model: SONNET,
    kind: 'isometric',
    prompt: 'สร้างภาพ isometric ของถนนคอนกรีต 4 ช่องจราจร กว้างช่องละ 3.50 เมตร มีเกาะกลาง ไหล่ทาง 2.50 เมตร ทางเท้าและเสาไฟส่องสว่างสองฝั่ง ยาว 1.2 กิโลเมตร ระบุองค์ประกอบเป็นภาษาไทยพร้อมขนาด',
  },
  {
    id: '02-weir-cross-section',
    model: HAIKU,
    kind: 'cross_section',
    prompt: 'สร้างภาพตัดขวาง (cross section) ของฝายน้ำล้นคอนกรีตเสริมเหล็ก สันฝายสูง 1.50 เมตร กว้าง 8.00 เมตร มีฐานราก ตีนฝาย บ่อรับน้ำท้ายฝาย ระดับน้ำปกติและระดับน้ำหลาก ระบุชั้นวัสดุและขนาดเป็นภาษาไทย',
  },
  {
    id: '03-route-map',
    model: SONNET,
    kind: 'map',
    prompt: 'สร้างแผนที่แผนผัง (schematic map) เส้นทางจากกรุงเทพมหานครไปจังหวัดนครนายก ระยะทางประมาณ 105 กิโลเมตร แสดงถนนสายหลัก (ทางหลวงหมายเลข 305 และ 33) จุดผ่านสำคัญ เช่น รังสิต องครักษ์ พร้อมเข็มทิศและมาตราส่วนโดยประมาณ ข้อความภาษาไทย',
  },
];

(async () => {
  const key = readApiKey();
  await startServer();
  const browser = await launch();
  mkdirSync(OUT, { recursive: true });
  const results = { spike: 'S5-live', chromium: browser.version(), when: new Date().toISOString(), tasks: [] };

  // 1) generate (หน้า s3 ที่มี SDK)
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/pages/s3/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__s3?.ready === true, null, { timeout: 60000 });

  for (const t of TASKS) {
    if (total() + 0.06 > BUDGET_TOTAL) {
      console.log('หยุด: ใกล้เพดานงบ', total());
      results.aborted = `budget ${total()}`;
      break;
    }
    const r = await page.evaluate(
      ([k, m, s, p]) => window.__s3.generateSvg(k, m, s, p, 4000),
      [key, t.model, SYSTEM, t.prompt],
    );
    if (!r.ok) {
      console.log(`${t.id}: FAIL`, JSON.stringify(r.error));
      results.tasks.push({ ...t, prompt: undefined, error: r.error });
      break; // ห้าม retry
    }
    record('S5', t.model, t.id, r.usage);
    if (r.svg) writeFileSync(join(OUT, `${t.id}.raw.svg`), r.svg, 'utf8');
    results.tasks.push({
      id: t.id,
      model: t.model,
      kind: t.kind,
      ms: r.ms,
      usage: r.usage,
      stop_reason: r.stop_reason,
      svg_bytes: r.svg_bytes,
      has_svg: !!r.svg,
    });
    console.log(
      `${t.id} (${t.model}): ${r.ms.toFixed(0)} ms · out ${r.usage.output_tokens} tok · svg ${r.svg_bytes} B · stop=${r.stop_reason} · spend ${total()}`,
    );
    await sleep(300);
  }
  await ctx.close();

  // 2) sanitize + PNG + PDF (หน้า s5 ที่ CSP ตาม D8 เป๊ะ)
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto(`${ORIGIN}/pages/s5/index.html`, { waitUntil: 'load' });
  await page2.waitForFunction(() => window.__s5?.ready === true, null, { timeout: 60000 });

  const { readFileSync, existsSync } = await import('node:fs');
  for (const t of results.tasks) {
    const f = join(OUT, `${t.id}.raw.svg`);
    if (!existsSync(f)) continue;
    const svg = readFileSync(f, 'utf8');
    const audit = await page2.evaluate((c) => window.__s5.sanitizeCases(c), [{ name: t.id, svg }]);
    const clean = await page2.evaluate((s) => window.__s5.sanitize(s), svg);
    writeFileSync(join(OUT, `${t.id}.clean.svg`), clean, 'utf8');
    const vb = /viewBox="([\d.\-\s]+)"/.exec(clean);
    const [, , w, h] = vb ? vb[1].trim().split(/\s+/).map(Number) : [0, 0, 800, 480];
    const png = await page2.evaluate(
      ([s, ww, hh]) => window.__s5.svgToPng(s, { via: 'data', scale: 2, w: ww, h: hh }),
      [clean, w || 800, h || 480],
    );
    if (png.loaded && !png.tainted) {
      const b64 = await page2.evaluate(() => window.__s5png);
      writeFileSync(join(OUT, `${t.id}.2x.png`), Buffer.from(b64.split(',')[1], 'base64'));
    }
    const pdfRes = png.loaded ? await page2.evaluate(() => window.__s5.pngIntoPdf(window.__s5png)) : null;
    t.sanitize = audit.results[0];
    t.png = png;
    t.pdf = pdfRes;
    console.log(
      `${t.id}: clean ${svg.length}→${clean.length} B · removed=${JSON.stringify(audit.results[0].removed_tags)} · leftovers=${JSON.stringify(audit.results[0].after.suspicious)} · png ${png.png_bytes} B · pdf image_ops=${pdfRes?.image_ops}`,
    );
  }
  await ctx2.close();

  results.total_usd = total();
  console.log('TOTAL USD (T-201 ทั้งหมด):', total());
  await browser.close();
  saveResult('s5-live', results);
  process.exit(0);
})();
