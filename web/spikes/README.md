# web/spikes — โค้ดทดลองของ T-201 (S1–S5)

โปรเจกต์ npm **แยกจาก `web/`** (มี `package.json` + `package-lock.json` ของตัวเอง)
ห้าม import อะไรจากที่นี่เข้า `web/src/**` — เป็นโค้ดวัดผลอย่างเดียว
ผลสรุปอยู่ที่ `docs/decisions/SPIKES.md` และ `docs/decisions/ADR-002-*.md`

## โครงสร้าง

```
web/spikes/
├── server.mjs              static server (Range + counter ของ bytes ที่ serve จริง) → dist/ ที่ / , web/public/data ที่ /data , vendor/duckdb-ext ที่ /duckdb-ext
├── vite.config.ts          multi-page build (pages/*/index.html → dist/)
├── pages/                  หน้า HTML ของแต่ละ spike พร้อม CSP meta (ของ 04 §D8 เป๊ะ เว้นที่ระบุไว้ในไฟล์)
├── src/                    โค้ดที่รันในหน้า (เปิด API ผ่าน window.__s1 … window.__s5)
├── runner/                 สคริปต์ Node + Playwright ที่สั่งหน้าเว็บแล้วเก็บตัวเลข
├── results/                ผลดิบ (JSON) ของทุกการวัด
├── s4/fonts/               Sarabun (OFL) + OFL.txt   · s4/out/  PDF/PNG ที่ render ออกมา
├── s5/in/                  SVG ทดสอบ sanitizer 7 เคส · s5/out/ SVG ที่ sanitize แล้ว + PNG + PDF
├── vendor/                 (gitignored) parquet extension ของ duckdb — ดาวน์โหลดตามคำสั่งด้านล่าง
└── api-spend.json          ledger ค่าใช้จ่าย API (ไม่มี key)
```

## เตรียม

```bash
cd web/spikes
npm ci
curl -L --create-dirs -o vendor/duckdb-ext/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm \
  https://extensions.duckdb.org/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm
npx vite build
```

## รัน

```bash
node runner/run-s1.mjs           # S1 matrix (local + GitHub Pages จริง)
node runner/run-s1-rowgroup.mjs  # S1 row-group pruning
node runner/debug-ext.mjs        # S1 egress/extension (N5)
node runner/run-s2.mjs           # S2 catalog 45,193 entries + MiniSearch
node runner/run-s2b.mjs          # S2 prebuilt index (ทางเลือก T-208)
node runner/run-s4.mjs           # S4 react-pdf + Sarabun
node runner/run-s4-probe.mjs     # S4 ตรวจความถูกต้องของข้อความไทย
node runner/run-s5-offline.mjs   # S5 sanitizer + SVG→PNG + PNG→PDF
```

spike ที่เรียก API จริง (ต้องมี `VITE_EVAL_ANTHROPIC_API_KEY` ใน `web/.env.local`):

```bash
node runner/run-s3-live.mjs      # S3 — มี guard หยุดที่ $0.10
node runner/run-s5-live.mjs      # S5 สร้าง SVG — มี guard หยุดที่ $0.40 รวม
```

## กฎความปลอดภัย (N2) ที่ใช้ในโค้ดนี้

- key ถูกอ่านที่ `runner/lib/key.mjs` **ฝั่ง Node เท่านั้น** แล้วส่งเข้าหน้าเว็บเป็น argument ของ
  `page.evaluate` ตอน runtime → อยู่ใน memory ของ tab
- **ห้าม** อ้าง `import.meta.env.VITE_EVAL_ANTHROPIC_API_KEY` ในโค้ดใต้ `src/` (Vite จะ inline ค่าลง bundle)
- ไม่เปิด Playwright trace / video / HAR ในสคริปต์ที่มี key; ไม่ print key; ไม่เขียน key ลงไฟล์ใด ๆ
- `run-s3-live.mjs` ตรวจ `localStorage`/`sessionStorage`/`cookie` หลังรันเสมอ (ต้องว่าง)
