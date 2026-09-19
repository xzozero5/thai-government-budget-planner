// S1 เสริม — row-group statistics ช่วย skip จริงไหม (ไฟล์ sort ตาม agency,item_key; row_group 64k)
import { startServer, launch, ORIGIN, serverStats, saveResult, sleep } from './lib/harness.mjs';

const FS = {
  extensionRepo: `${ORIGIN}/duckdb-ext`,
  forceFullHTTPReads: false,
  allowFullHTTPReads: true,
  reliableHeadRequests: true,
};
const F = `${ORIGIN}/data/budget_lines/pbo/2564/20000.parquet`;

// rg0 agency: สถาบันทดสอบ… → สพฐ. / rg1: สพฐ. เท่านั้น / rg2: สพฐ. → โรงเรียนมหิดลวิทยานุสรณ์
const CASES = {
  // agency = sort key ตัวแรก → ควร prune ได้ (อยู่เฉพาะ rg2)
  W1_agency_rg2_only: `SELECT count(*) AS n, min(source_id) FROM read_parquet('${F}') WHERE agency = 'โรงเรียนมหิดลวิทยานุสรณ์'`,
  // agency ที่กินทุก row group → prune ไม่ได้
  W2_agency_all_rg: `SELECT count(*) AS n, min(source_id) FROM read_parquet('${F}') WHERE agency = 'สำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน'`,
  // item_key = sort key ตัวที่สอง → ช่วง min/max ของ 3 row group ทับกัน → prune ไม่ได้
  W3_item_key_eq: `SELECT count(*) AS n, min(source_id) FROM read_parquet('${F}') WHERE item_key = 'เครื่องตัดหญ้า'`,
  // baseline: อ่านคอลัมน์เดียวทั้งไฟล์
  W4_baseline_col: `SELECT count(DISTINCT item_key) AS n FROM read_parquet('${F}')`,
  // filter บนคอลัมน์ตัวเลข (ไม่ sort) — ใช้ stats ของ amount ได้ไหม
  W5_amount_high: `SELECT count(*) AS n FROM read_parquet('${F}') WHERE amount_thb > 200000000000`,
};

(async () => {
  await startServer();
  const browser = await launch();
  const out = { spike: 'S1-rowgroup', chromium: browser.version(), when: new Date().toISOString(), cases: {} };
  for (const [name, sql] of Object.entries(CASES)) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${ORIGIN}/pages/s1/index.html`);
    await page.waitForFunction(() => window.__s1?.ready === true);
    await page.evaluate((o) => window.__s1.init(o), FS);
    await serverStats({ reset: true });
    const r = await page.evaluate((s) => window.__s1.runSql(s, 1), sql);
    await sleep(250);
    const st = await serverStats({ reset: true, log: true });
    const parquet = (st.log ?? []).filter((l) => l.url.endsWith('.parquet'));
    out.cases[name] = {
      sql,
      ms: r.ms,
      rows: r.rows,
      requests: parquet.length,
      bytes: parquet.reduce((a, b) => a + b.bytes, 0),
      ranges: parquet.map((l) => l.reqRange).filter(Boolean),
    };
    console.log(`${name}: ${r.ms.toFixed(0)} ms · ${parquet.length} req · ${out.cases[name].bytes} B · ${JSON.stringify(r.rows[0])}`);
    await ctx.close();
  }
  await browser.close();
  saveResult('s1-rowgroup', out);
  process.exit(0);
})();
