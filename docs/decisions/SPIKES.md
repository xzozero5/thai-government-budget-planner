# SPIKES — ผลการทดลอง S1–S5 (T-201)

ผู้ทำ: `architect` · วันที่วัด: **20 ก.ย. 2569** · โค้ดทั้งหมดอยู่ที่ `web/spikes/` (npm project แยก, ไม่ถูก import เข้า `web/src`)

> **กติกาของเอกสารนี้**: ตัวเลขทุกตัวในตาราง "ผล" มาจากการรันจริงบนเครื่อง dev และบันทึกดิบไว้ที่
> `web/spikes/results/*.json` · สิ่งที่ยังไม่ได้วัดต้องติดป้าย `[UNVERIFIED]` และบอกว่าทำไม

## สภาพแวดล้อมร่วม

| รายการ | ค่า |
|---|---|
| เครื่อง | Windows 11 (26200), Node **v22.15.1**, npm **11.3.0** |
| Browser | Playwright **1.63.0** → Chromium **153.0.8010.12** (headless, `--enable-precise-memory-info --js-flags=--expose-gc`) |
| Static host (local) | `web/spikes/server.mjs` (Node http, รองรับ Range, `Cache-Control: no-store`, นับ bytes ที่ serve จริง) |
| Static host (จริง) | GitHub Pages `https://xzozero5.github.io/thai-government-budget-planner/` — `data_version cd15fb2dd39b…` ตรงกับ local |
| ข้อมูล | `web/public/data/` 180.6 MB · shard ใหญ่สุด `budget_lines/pbo/2564/20000.parquet` **6,167,492 B / 151,878 แถว / 3 row group (64k) / 40 คอลัมน์ / ZSTD** · catalog `catalog/items.json.gz` **5,396,799 B gz, 45,193 entries** |
| Library | `@duckdb/duckdb-wasm` **1.32.0** (stable ล่าสุด; `latest` บน npm เป็น dev tag `1.33.1-dev57.0`) · `minisearch` **7.2.0** · `@anthropic-ai/sdk` **0.127.0** · `@react-pdf/renderer` **4.9.0** · `dompurify` **3.4.15** · `pdfjs-dist` **6.3.289** (ใช้ตรวจผลเท่านั้น) · `vite` **7.3.6** |

วิธีรันซ้ำทั้งหมด:

```bash
cd web/spikes
npm ci
curl -L --create-dirs -o vendor/duckdb-ext/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm \
  https://extensions.duckdb.org/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm
npx vite build
node runner/run-s1.mjs          # S1 matrix (local + GitHub Pages)
node runner/run-s1-rowgroup.mjs # S1 row-group pruning
node runner/debug-ext.mjs       # S1 egress/extension (N5)
node runner/run-s2.mjs          # S2 catalog + MiniSearch
node runner/run-s2b.mjs         # S2 prebuilt index (T-208)
node runner/run-s4.mjs          # S4 react-pdf + Sarabun
node runner/run-s4-probe.mjs    # S4 ความถูกต้องของข้อความไทย
node runner/run-s5-offline.mjs  # S5 sanitizer + PNG + PDF
node runner/run-s3-live.mjs     # S3 (ต้องมี key ใน web/.env.local)
node runner/run-s5-live.mjs     # S5 generate SVG (ต้องมี key)
```

---

## S1 — DuckDB-WASM (eh, ไม่มี threads) + Parquet ผ่าน HTTP range

### คำถาม
(1) Pages รองรับ Range กับ parquet จริงไหม (2) DuckDB-WASM ใช้ range จริงไหม และโหลดกี่ไบต์ต่อ query
(3) row-group statistics ช่วย skip ไหม (4) ทำงานใต้ CSP ของ §D8 ได้ไหม (5) bundle/หน่วยความจำเท่าไร

### วิธีวัด
`web/spikes/src/s1.ts` + `runner/run-s1.mjs` — ทุก query วัดแบบ **เย็นจริง**: browser context ใหม่ +
DuckDB instance ใหม่ทุกครั้ง แล้วยิงซ้ำ 3 รอบเพื่อวัด warm
นับ bytes 2 ทาง: (ก) counter ใน `server.mjs` (ground truth ฝั่ง local) (ข) patch `XMLHttpRequest`
**ภายใน worker ของ DuckDB** ก่อน `importScripts` (จำเป็น เพราะ **CDP/Playwright network events ไม่เห็น
request ที่ worker ยิง** — ค่าที่ได้เป็น 0 ทุกครั้ง) ตัวเลข (ก) และ (ข) ตรงกันในฝั่ง local

### ผล 1 — host รองรับ Range (ยืนยันแล้ว)

| การทดสอบ | ผล |
|---|---|
| GitHub Pages: `HEAD` parquet | `200`, `Accept-Ranges: bytes`, `Access-Control-Allow-Origin: *`, `Cache-Control: max-age=600` |
| GitHub Pages: `Range: bytes=0-99` บน `pbo/2564/20000.parquet` | **`206`**, `Content-Range: bytes 0-99/6167492` |
| จาก browser (fetch / sync XHR / ใน worker) | `206` ทุกกรณี, 100 B |
| Pages + cross-origin JS อ่าน `Content-Range` | **อ่านไม่ได้** (ไม่มี `Access-Control-Expose-Headers`) — ไม่กระทบ production เพราะ same-origin |

### ผล 2 — ค่า config ที่ทำให้ range ทำงาน (สำคัญที่สุดของ S1)

`SELECT count(*)` บนไฟล์เดียว, วัดที่ server:

| `filesystem` config | req | bytes | ผล |
|---|---|---|---|
| `{}` (ค่าเริ่มต้นของ library) | 2 | **6,167,492** | อ่านทั้งไฟล์ |
| `{ allowFullHTTPReads: false }` | 1 | 0 | **เปิดไฟล์ไม่ได้** (`Failed to open file`) |
| `{ reliableHeadRequests: true }` | 2 | 6,167,492 | อ่านทั้งไฟล์ |
| `{ forceFullHTTPReads: true }` | 2 | 6,167,492 | อ่านทั้งไฟล์ |
| **`{ forceFullHTTPReads: false }`** | 5 | **23,493** | ใช้ range (206 × 4) |
| `{ forceFullHTTPReads: false, allowFullHTTPReads: false, reliableHeadRequests: true }` | 4 | 23,492 | ใช้ range, ไม่มี probe `bytes=0-0` |

⇒ **`forceFullHTTPReads` มีค่าเริ่มต้นเป็น `true` ใน 1.32.0** ต้องตั้งเป็น `false` เองเท่านั้นถึงจะได้ range
(ชื่อ `allowFullHTTPReads` ชวนเข้าใจผิด — ตั้ง `false` เดี่ยว ๆ ทำให้พัง)

### ผล 3 — bytes/latency ต่อ query (เย็นจริง, 1 query ต่อ 1 browser context)

`A` = range mode (`forceFullHTTPReads:false, allowFullHTTPReads:true, reliableHeadRequests:true`) ·
`C/E` = ค่าเริ่มต้น (full read)

| query (บน `pbo/2564/20000.parquet` เว้นแต่ระบุ) | A req | A bytes | C bytes | A cold local | A warm local | Pages cold (range) | Pages cold (full) | Pages warm (range) |
|---|---|---|---|---|---|---|---|---|
| `count(*)` | 5 | **23,493** | 6,167,492 | 49 ms | 6/6/5 ms | **401 ms** | 1,138 ms | 20/16/16 ms |
| `item_key IN (3 keys)` → 7 คอลัมน์ (มี `item_name_raw`) | 22 | **7,773,125** | 6,167,492 | 230 ms | 75/68/68 ms | 1,542 ms | 1,459 ms | 88/97/110 ms |
| `item_key IN (3 keys)` → 3 คอลัมน์ | 21 | 3,578,821 | 6,167,492 | 150 ms | 25/25/26 ms | 1,014 ms | 1,230 ms | 40/34/35 ms |
| `item_key LIKE '%เครื่องปรับอากาศ%'` + aggregate (2 คอลัมน์) | 15 | **1,013,641** | 6,167,492 | 125 ms | 21/22/21 ms | **469 ms** | 1,663 ms | 33/29/31 ms |
| aggregate ข้าม 3 shards (2564/2565/2566, รวม 11.47 MB) | 32 | **640,619** | 11,470,440 | 144 ms | 20/18/16 ms | **1,235 ms** | 1,989 ms | 60/52/45 ms |

ข้อสังเกตที่สำคัญ:
- **range ชนะทุก query บน Pages ยกเว้นกรณีดึงคอลัมน์อ้วน**: query ที่ดึง `item_name_raw` อ่าน **7.77 MB
  มากกว่าไฟล์ทั้งก้อน** (อ่านซ้ำเป็นบล็อก 16 KB) และช้ากว่าการโหลดไฟล์เต็มเล็กน้อย
- warm (คิวรีซ้ำใน instance เดิม) **ไม่มี request ออกเลย** (0 B) — DuckDB-WASM cache ช่วง byte ที่อ่านแล้วไว้ในหน่วยความจำ
- ผลลัพธ์ทุก query ถูกต้อง (`count(*)` = 151,878 ตรงกับ metadata ของไฟล์)

### ผล 4 — row-group statistics (ยืนยันแล้ว: ช่วยเฉพาะคอลัมน์ที่ sort/มี range แคบ)

metadata จริงของไฟล์ (อ่านด้วย pyarrow): 3 row group (65,536 / 65,536 / 20,806 แถว)
ช่วง `item_key` ของ rg0 = `2000435052` … `โครงการพัฒนาระบบ…`, rg2 = `16 นิ้ว พร้อมติดตั้ง` … `ไร้สาย`
⇒ **ช่วง item_key ของ row group ทับกันเกือบทั้งหมด** (เพราะ sort ด้วย `agency` ก่อน)

| query | req | bytes | หมายเหตุ |
|---|---|---|---|
| `agency = 'โรงเรียนมหิดลวิทยานุสรณ์'` (อยู่ rg2 เท่านั้น) | 9 | **383,941** | prune ได้ |
| `agency = 'สำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน'` (กินทุก rg) | 19 | 3,201,989 | prune ไม่ได้ |
| `item_key = 'เครื่องตัดหญ้า'` | 20 | 2,530,245 | **prune ไม่ได้** |
| `count(DISTINCT item_key)` (baseline คอลัมน์เดียวทั้งไฟล์) | 13 | 793,541 | |
| `amount_thb > 200,000,000,000` | 7 | **105,413** | stats ตัวเลข prune ได้ดีมาก |

### ผล 5 — CSP / egress (N5) — **ข้อค้นพบสำคัญ**

| การทดสอบ (หน้า serve พร้อม CSP meta ของ §D8 เป๊ะ) | ผล |
|---|---|
| worker จาก URL same-origin (`new Worker(url)`) + ไม่บล็อกอะไร | query ผ่าน **แต่มี request ออก `https://extensions.duckdb.org/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm` (3,045,039 B)** |
| worker เดิม + block cross-origin ที่ชั้น Playwright | query **พัง** → ยืนยันว่าเดิมมันยิงออกจริง |
| worker จาก `blob:` (สืบทอด CSP ของหน้า) | request เดียวกัน **ถูก CSP บล็อก** → query พัง |
| worker `blob:` + `SET custom_extension_repository='<origin>/duckdb-ext'; INSTALL parquet; LOAD parquet;` | **ผ่าน, 142 ms, ไม่มี request ข้าม origin** |
| worker same-origin + self-host repo + block cross-origin | ผ่าน, ไม่มี request ข้าม origin |

⇒ 2 ข้อสรุปที่ต้องเข้า 04: (ก) **CSP ผ่าน `<meta>` ไม่ครอบคลุม dedicated worker ที่โหลดจาก URL same-origin**
(worker ได้ CSP จาก response header ของสคริปต์ตัวเอง ซึ่ง GitHub Pages ตั้งไม่ได้) → ต้องสร้าง worker จาก
`blob:` ถ้าต้องการให้ N5 ถูกบังคับจริง (ข) **ต้อง self-host parquet extension** → `ADR-002`

### ผล 6 — ขนาด bundle / init / memory (ยืนยันแล้ว)

| artifact | raw | gzip (−9) |
|---|---|---|
| `duckdb-eh.wasm` | 34,242,586 B | **7,639,912 B** |
| `duckdb-browser-eh.worker.js` | 772,759 B | 188,100 B |
| JS ของ `@duckdb/duckdb-wasm` (bundle ด้วย vite, รวม apache-arrow) | 188,130 B | 43,940 B |
| `parquet.duckdb_extension.wasm` (v1.4.3 / wasm_eh) | 3,045,039 B | 701,417 B (CDN ต้นทางส่งแบบ gzip อยู่แล้ว) |
| **รวมที่ต้องโหลดก่อน query แรก** | ~38.2 MB | **~8.57 MB gz** |

- init (worker + `instantiate` + `open` + connect): **645 ms** (instantiate 440 ms, open 75 ms) บน local
  ที่ไม่บีบอัด (โหลด 38,060,384 B) · `LOAD parquet` เพิ่มอีก 142 ms
- DuckDB memory (`pragma_database_size().memory_usage`) หลัง query: 28 KiB (`count(*)`) → 408 KiB
  (`IN` 7 คอลัมน์) → 124–256 KiB (aggregate) — ต่ำมาก ไม่ใกล้เพดาน 512 MB
- JS heap ของ main thread หลัง init ≈ **2.9 MB** (WASM linear memory อยู่นอก JS heap และวัดตรง ๆ ไม่ได้ `[UNVERIFIED]`)
- fallback `registerFileBuffer`: ดึงทั้ง shard จาก Pages **1,092 ms / 6,167,492 B**, `registerFileBuffer` 2.2 ms,
  แล้ว query 33–44 ms (ผลลัพธ์ตรง)

### ข้อสรุป S1 + ผลต่อสถาปัตยกรรม
- **D3 ผ่าน (go)** แต่ต้องแก้รายละเอียด → **`ADR-002`** (config, self-host extension, blob worker, column pruning, fallback)
- **D8 ต้องเพิ่มข้อความเรื่อง CSP กับ worker** และเพิ่ม asset `duckdb-ext/`
- **§5 performance budget ผิดอย่างมีนัยสำคัญ**: "DuckDB-WASM ~2.5 MB" จริงคือ **~8.6 MB gz**

### `[UNVERIFIED]` ที่เหลือใน S1
- GitHub Pages บีบอัด `application/wasm` หรือไม่ — ยังไม่มีไฟล์ `.wasm` บน Pages ให้ทดสอบ (ยืนยันแล้วว่า
  Pages บีบอัด `text/html` ด้วย gzip) ⇒ ถ้าไม่บีบ ผู้ใช้จะโหลด 34 MB จริง **ต้องวัดหลัง deploy แอปจริง**
- พฤติกรรมบนเครือข่ายมือถือจริง (4G) — วัดจากเครือข่ายสำนักงานเท่านั้น ไม่ได้จำลอง throttle เครือข่าย
- Firefox / Safari — ไม่ได้ทดสอบ (มีแค่ Chromium ของ Playwright)

---

## S2 — ค้นหาไทย: `Intl.Segmenter` + MiniSearch กับ catalog ตัวจริง

### คำถาม
catalog 45,193 entries (40.5 MB หลัง decompress) สร้าง index ใน browser ได้ในงบเวลา/หน่วยความจำไหม
และ `search_catalog` < 200 ms (04 §5) จริงไหม รวมถึงบนมือถือ (CPU 4×)

### วิธีวัด
`web/spikes/src/s2.ts` + `runner/run-s2.mjs`, `runner/run-s2b.mjs` · หน่วยความจำวัดด้วย
`performance.memory.usedJSHeapSize` หลังเรียก `gc()` 2 ครั้ง · CPU throttle ด้วย CDP
`Emulation.setCPUThrottlingRate {rate:4}` · 5 คำค้น: `แอร์ 18000 บีทียู`, `รถบรรทุกดีเซล 1 ตัน`, `ฝาย`,
`วิทยุสื่อสาร`, `กล้องวงจรปิด`

### ผล 1 — `Intl.Segmenter('th', {granularity:'word'})`

| รายการ | ค่า |
|---|---|
| มีใน Chromium 153 | **ใช่** |
| ตัด 1,000 `item_key` | **17.7 ms** → 8,972 token |
| ตัวอย่าง `เครื่องปรับอากาศแบบแยกส่วนชนิดติดผนัง ขนาด 18000 บีทียู` | `["เครื่อง","ปรับ","อากาศ","แบบ","แยก","ส่วน","ชนิด","ติด","ผนัง","18000","บี","ที","ยู"]` |
| fallback n-gram 3 (เทียบ) | 4.4 ms / 20,636 token (เร็วกว่าตอน tokenize แต่ index/query แย่กว่ามาก — ดูตารางถัดไป) |

Firefox / Safari: **`[UNVERIFIED]`** — ไม่ได้ทดสอบจริง (ไม่มี browser ให้ใช้ใน environment นี้)
และยังไม่ได้ตรวจเอกสารทางการของทั้งสองเจ้าใน spike นี้ ⇒ T-204 ต้องมี fallback n-gram + test ที่บังคับใช้ path นั้น

### ผล 2 — โหลด catalog (เหมือนกันทุก variant)

| ขั้น | ms |
|---|---|
| `fetch` (local, 5,396,799 B) | 24 |
| gunzip ด้วย `DecompressionStream('gzip')` → text (24,187,424 ตัวอักษร) | 139 |
| `JSON.parse` → 45,193 entries | 64 |
| **รวม** | **226 ms** (CPU 4×: **1,043 ms**) |

heap ทันทีหลังโหลด (ก่อน gc) **110.0 MB** · หลัง gc เหลือ **38.0 MB** (= ตัว object ของ catalog)

### ผล 3 — สร้าง index + query (desktop 1× และ CPU 4×)

| variant (field ที่ index) | index (ms) 1× | index (ms) 4× | heap Δ | heap รวมท้ายรัน | 5 query cold | 5 query warm | 5 query (4×) |
|---|---|---|---|---|---|---|---|
| `full` = `key`+`name`, store `key/name/n_lines` | **1,677** | **14,312** | 37.3 MB | 73.9 MB | 59.7 ms | 41.8 ms | 381.4 ms |
| `key_keys` = `key`+`keys[]` | 1,169 | — | 26.4 MB | 60.0 MB | 49.3 ms | 31.4 ms | — |
| `key_only` = `key` อย่างเดียว, ไม่ store | **698** | **5,498** | 19.5 MB | 56.6 MB | 34.1 ms | 21.1 ms | 133.5 ms |
| `ngram_full` (fallback n-gram 3) | 2,651 | — | 71.6 MB | 108.2 MB | 1,204.1 ms | 1,109.5 ms | — |

ต่อคำค้น (warm, variant `full` / `key_only`):

| query | full 1× | key_only 1× | full 4× | key_only 4× | hits (full) |
|---|---|---|---|---|---|
| `แอร์ 18000 บีทียู` | 10.5 | 4.6 | 67.7 | 28.5 | 8,491 |
| `รถบรรทุกดีเซล 1 ตัน` | 22.2 | 10.8 | **214.9** | 72.4 | 14,577 |
| `ฝาย` | 7.4 | 4.5 | 79.6 | 22.4 | 8,894 |
| `วิทยุสื่อสาร` | 0.9 | 0.6 | 10.2 | 4.1 | 420 |
| `กล้องวงจรปิด` | 0.8 | 0.6 | 9.0 | 6.1 | 564 |

### ผล 4 — คุณภาพผลลัพธ์ top-5 (variant `full`, `prefix:true, fuzzy:0.2, combineWith:'OR'`)

| query | top-5 (key, n_lines) |
|---|---|
| `แอร์ 18000 บีทียู` | แอร์ชนิดแขวน 18000 บีทียู (6) · เครื่องปรับอากาศ 18000 บีทียู (14) · เครื่องปรับอากาศ ขนาด 18000 บีทียู (53) · เครื่องปรับอากาศแบบแขวน 18000 บีทียู (4) · เครื่องปรับอากาศ ชนิดแขวน ขนาด 18000 บีทียู (5) |
| `รถบรรทุกดีเซล 1 ตัน` | รถบรรทุก ดีเซล ขนาด 1 ตัน (9) · …ปริมาตรกระบอกสูบ (15) · …ขับเคลื่อน 4 ล้อ (94) · …กันกระสุน (8) · **รถบรรทุก ดีเซล ขนาด 3 ตัน 6 ล้อ (20) ← หลุด** |
| `ฝาย` | ก่อสร้างฝายชะลอน้ำ จำนวน 22 ฝาย… (6) · ฝายยาง โครงการฝายยางลำเซบาย (6) · ดำเนินการที่ จำนวน 22 ฝาย… (11) · ฝายน้ำฝางลูกที่ 9… (7) · ดำเนินการท้องที่ จำนวน 22 ฝาย… (17) |
| `วิทยุสื่อสาร` | วิทยุสื่อสาร (45) · เครื่องวิทยุสื่อสาร (7) · เครื่องรับส่งวิทยุสื่อสาร (6) · ค่าซ่อมบำรุงอุปกรณ์วิทยุสื่อสาร (6) · ระบบวิทยุสื่อสาร แขวงวัดราชบพิธ (10) |
| `กล้องวงจรปิด` | กล้องวงจรปิด (305) · กล้องวงจรปิด cctv (42) · กล้องโทรทัศน์วงจรปิด (88) · ชุดกล้องวงจรปิด (53) · ระบบกล้องวงจรปิด (102) |

ใช้ `combineWith:'AND', fuzzy:0` ผลแม่นขึ้นแต่ recall ต่ำมาก (`แอร์ 18000 บีทียู` เหลือ **1 hit**)
⇒ แนะนำ: OR+fuzzy เป็นค่าเริ่มต้น แล้วให้ tool จัดอันดับซ้ำด้วย `n_lines`/จำนวน token ที่ match

### ผล 5 — ทางเลือก T-208 (prebuilt index / ไฟล์ผอม)

สร้าง artifact จริงแล้ววัดเวลาโหลดกลับ:

| artifact | JSON (bytes) | gzip (bytes) | โหลด 1× (fetch+gunzip+`loadJSON`) | โหลด 4× | heap Δ | 5 query 1× / 4× |
|---|---|---|---|---|---|---|
| prebuilt index `full` | 31,733,379 | **4,516,333** | **556 ms** (25+100+200… incl. gc) | **2,309 ms** | 69.7 MB | 54.8 / 260.6 ms |
| prebuilt index `key_only` | 5,973,765 | **1,596,623** | **309 ms** | **1,476 ms** | 22.8 MB | 34.4 / 186.0 ms |
| `catalog-slim` (key, name, n_lines, years, shards) | 19,384,637 | **1,958,330** | — | — | — | — |
| (อ้างอิง) catalog v2 ปัจจุบัน | ~40.5 MB | 5,396,799 | 226 / 1,043 ms | | 38.0 MB | |

เทียบทางตรง สำหรับ "พร้อมค้นหา":
- ปัจจุบัน (โหลด catalog + build index `full`): 226 + 1,677 = **1,903 ms** (4×: 1,043 + 14,312 = **15,355 ms** ← รับไม่ได้)
- prebuilt `full`: **556 ms** (4×: **2,309 ms**)
- prebuilt `key_only`: **309 ms** (4×: **1,476 ms**)

### ผล 6 — folding สำหรับ text จาก PDF (02 §B) — ยืนยันแล้ว

corpus = chunk จริง 177 ชิ้นจาก `data/docs/d_1b50f9faf276`, `d_1f490878307e`, `d_1000a15a98f5`
(ข้อความต้นฉบับมี `ส านักงาน`, `ประจ าปี`, `ขั้นต่ า` จริง)

folding = NFC → ตัดช่องว่างระหว่างอักษรไทย → `ำ`/`ํา` → `า` (ใช้กับ **ทั้ง index และ query**)

| query | ไม่ fold | fold |
|---|---|---|
| `สำนักงาน` | **0** | **55** |
| `ประจำปี` | 0 | 44 |
| `ขั้นต่ำ` | 0 | 20 |
| `สำนักงานประกันสังคม` | 0 | 52 |

⇒ กฎ T-204 ใช้ได้จริง **แต่ต้อง fold ก่อน tokenize** (ถ้า fold ที่ `processTerm` หลัง tokenize จะไม่ match
เพราะช่องว่างทำให้ segment แตกไปแล้ว) และ **ห้าม fold ข้อความที่แสดงเป็นหลักฐาน**

### ข้อสรุป S2 + ผลต่อสถาปัตยกรรม
- **D3 (MiniSearch + Intl.Segmenter) ผ่าน (go)** บน desktop: query 0.6–22 ms ≪ 200 ms
- **ไม่ผ่านบนมือถือถ้า build index ใน browser**: `full` ใช้ 14.3 s ที่ CPU 4× และ heap รวม 73.9 MB
  ⇒ **ควรเปิด T-208** และเลือก prebuilt `key_only` (1.60 MB gz, 309 ms / 1,476 ms, heap 22.8 MB)
  คู่กับ `catalog-slim` สำหรับ metadata (1.96 MB gz) — รวม gz ≈ 3.55 MB แทน 5.40 MB
- fallback n-gram ใช้งานได้แต่ query ช้า ~50× (1.2 s) ⇒ ถ้า browser ไม่มี `Intl.Segmenter` ต้องเตือนผู้ใช้
  หรือใช้ prebuilt index ที่สร้างด้วย tokenizer เดียวกันจาก pipeline

### `[UNVERIFIED]` ที่เหลือใน S2
- `Intl.Segmenter` บน Firefox / Safari (รวมถึงคุณภาพการตัดคำไทยของแต่ละเจ้า)
- heap ของ prebuilt (69.7 / 22.8 MB) รวมสตริง JSON ที่ยังถูกอ้างถึงใน closure ของฟังก์ชันวัด → เป็นค่า **บน**
- ยังไม่ได้ทดสอบว่า pipeline (Python) สร้าง prebuilt MiniSearch index ที่ tokenizer ตรงกับ browser ได้จริง

---

## S3 — Anthropic SDK ใน browser (รันจริง)

### คำถาม
เรียก `api.anthropic.com` ตรงจาก browser ภายใต้ CSP §D8 ได้ไหม; streaming / client tool loop /
server tool web search / prompt caching ทำงานอย่างไร; key รั่วไหม; bundle เท่าไร

### วิธีวัด
`web/spikes/src/s3.ts` + `runner/run-s3-live.mjs` · **N2**: key อ่านจาก `web/.env.local` **ฝั่ง Node เท่านั้น**
แล้วส่งเข้าหน้าเว็บเป็น argument ของ `page.evaluate` ตอน runtime — ไม่มีการ log, ไม่เขียนไฟล์, ไม่ใส่ใน URL,
ไม่เปิด trace/video/HAR ของ Playwright · model **`claude-haiku-4-5-20251001`** (ถูกที่สุด), `max_tokens ≤ 300`

### ผล (ยืนยันแล้ว — รันจริง 20 ก.ย. 2569)

| การทดสอบ | ผล |
|---|---|
| CSP ของ §D8 เป๊ะ (`connect-src 'self' https://api.anthropic.com`) | **ไม่มี CSP violation เลย** |
| `dangerouslyAllowBrowser: true` + header `anthropic-dangerous-direct-browser-access: true` | ผ่าน (CORS preflight ผ่าน) |
| `messages.countTokens` (ping สำหรับ KeyGate) | ok, **3,324 ms** (request แรก รวม TLS/preflight), `input_tokens: 13`, **ไม่คิดค่าบริการ** |
| `messages.stream()` | ok, first token **1,142 ms**, 37 text event, 105 ตัวอักษร, usage in 47 / out 92 |
| client tool loop (`search_catalog` mock คืน 2 แถว) | ok 2 รอบ (`tool_use` → `end_turn`), 2,368 ms รวม; โมเดลอ้างตัวเลขจาก tool result ถูกต้อง |
| server tool **`web_search_20250305`**, `max_uses: 1` | ok 4,687 ms; usage `server_tool_use.web_search_requests: 1`, in 10,553 / out 331; block types = `server_tool_use`, `web_search_tool_result`, `text`×7 พร้อม `citations[].url` จริง (dohome.co.th ฯลฯ) |
| prompt caching (system block ยาว, 2 ครั้งติด) | call0: `cache_creation_input_tokens` **17,882**, call1: `cache_read_input_tokens` **17,882** → **cache hit ยืนยันแล้ว**; call0 1,249 ms → call1 766 ms |
| storage audit หลังรันทั้งหมด | `localStorage: []`, `sessionStorage: []`, `document.cookie.length: 0` → **N2 ผ่าน** |
| bundle `@anthropic-ai/sdk` (vite, esbuild minify) | **190,970 B / 50,190 B gz** |

### รุ่นโมเดล / เวอร์ชัน tool ปัจจุบัน (จาก API `GET /v1/models` + docs.claude.com 20 ก.ย. 2569)

รุ่นที่เรียกได้ด้วย key นี้: `claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`,
`claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-opus-4-5-20251101`,
**`claude-haiku-4-5-20251001`**, **`claude-sonnet-4-5-20250929`**

ราคา (docs.claude.com/en/docs/about-claude/pricing, ตรวจ 20 ก.ย. 2569, USD/MTok in→out):
Sonnet 5 **2 → 10** · Sonnet 4.6 3 → 15 · Sonnet 4.5 3 → 15 · Haiku 4.5 **1 → 5** · Opus 5 5 → 25
· cache write 5m = 1.25×, cache read = 0.1× · **web search = $10 / 1,000 ครั้ง ($0.01/ครั้ง)**
· ขั้นต่ำที่ cache ได้: **Haiku 4.5 = 4,096 token**, Sonnet 4.5/4.6/5 = 1,024 token, Opus 4.5/4.6 = 4,096

เวอร์ชัน web search tool ที่เอกสารระบุ: `web_search_20250305` (basic, ที่แผนใช้อยู่ — **ยังใช้ได้**),
`web_search_20260209` (dynamic filtering, ต้อง Claude 4.6+), `web_search_20260318` (response inclusion)

**ข้อเสนอ (ไม่แก้ docs อื่นใน task นี้)**
1. `ai/models.ts` ควรตั้ง default เป็น **`claude-sonnet-5`** แทน `claude-sonnet-4-5`: ถูกกว่า (2/10 vs 3/15),
   ใหม่กว่า และขั้นต่ำ cache ต่ำกว่า (1,024 vs 4,096 ของ Haiku) — ถ้าต้องการความเสถียรของ output ให้คง
   `claude-sonnet-4-5-20250929` เป็นตัวเลือก
2. คงใช้ `web_search_20250305` ใน MVP (ง่ายและรองรับทุกรุ่น) แต่ทำให้ tool version เป็นค่าคงที่ตัวเดียว
   ใน `ai/tools/webSearch.ts` เพื่อสลับไป `web_search_20260318` ได้ทีหลัง
3. เอกสารเตือนว่า **Claude 4.7 ขึ้นไปใช้ tokenizer ใหม่ที่ให้จำนวน token มากขึ้น ~30 %** → `ai/pricing.ts`
   ต้องคิดจาก `usage` ที่ API คืน ไม่ใช่ประมาณจากความยาวข้อความ

### `[UNVERIFIED]` ที่เหลือใน S3
- `count_tokens` ping 3,324 ms เป็นค่า request แรกจากเครือข่ายนี้เท่านั้น (ไม่ได้วัดค่าเฉลี่ย)
- ยังไม่ได้ทดสอบ streaming + web search + client tool **ใน loop เดียวกัน** (ทดสอบแยกกันเพื่อคุมงบ)
- ยังไม่ได้ทดสอบ error path (401/429/overloaded) กับ key จริง

---

## S4 — `@react-pdf/renderer` + ฟอนต์ Sarabun

### คำถาม
ฟอนต์ไทยแสดงถูกไหม (สระลอย/วรรณยุกต์ซ้อน), ตาราง BOQ ข้ามหน้าได้ไหม, `<Link>` กดได้ไหม, เร็ว/ใหญ่แค่ไหน

### วิธีวัด
`web/spikes/src/s4.tsx` + `runner/run-s4.mjs`, `runner/run-s4-probe.mjs`
ฟอนต์ **Sarabun (OFL)** ดาวน์โหลดจาก `github.com/google/fonts/ofl/sarabun` → `web/spikes/s4/fonts/`
(`Sarabun-Regular.ttf` 90,220 B, `-Bold` 89,804 B, `-Italic` 93,248 B, `OFL.txt` 4,387 B)
ตรวจผล 2 ทาง: (ก) render PDF → ภาพด้วย pdf.js แล้ว **ดูด้วยตา** (ข) extract text กลับมาเทียบสตริงต้นทาง
ไฟล์ผลลัพธ์: `web/spikes/s4/out/*.pdf`, `*.png`

### ผล

| รายการ | ค่า |
|---|---|
| render เอกสาร 4 หน้า (หน้าทดสอบฟอนต์ + BOQ 64 แถว) | **235 ms** (`hyphenationCallback` ปิด) / 216 ms (ค่าเริ่มต้น) |
| ขนาดไฟล์ PDF | **35,065 B** (subset ฟอนต์ให้เอง) |
| ตาราง BOQ ข้ามหน้า | ✅ แตกเป็นหน้า 2–4 อัตโนมัติ, header `fixed` ซ้ำทุกหน้า, `wrap={false}` กันแถวขาดกลาง |
| `<Link>` | ✅ pdf.js อ่าน annotation ได้ `https://xzozero5.github.io/thai-government-budget-planner/` |
| footer `fixed` + `render({pageNumber,totalPages})` | ✅ ทำงาน |
| สระลอย/วรรณยุกต์ซ้อน (`น้ำ ผู้ ปี้ เกี๊ยะ กตัญญู ฤๅษี ปฏิญาณ`) | ✅ แสดงถูกต้องด้วยตา |
| เลขไทย `๐–๙` + เลขอารบิก + `Intl.NumberFormat('th-TH')` | ✅ ถูกต้องทั้งคู่ |
| bundle `@react-pdf/renderer` (vite) | **1,241,750 B / 456,170 B gz** |
| ฟอนต์ Regular+Bold (gz) | 43,454 + 43,366 = **86,820 B gz** (ถ้ารวม Italic 133,019 B gz) |

### ปัญหาที่พบ (ต้องเข้า backlog)

1. **การตัดบรรทัดภาษาไทยไม่รู้จักขอบเขตคำ** — ยืนยันด้วยตาจากภาพ render 3×:
   ข้อความยาวถูกตัดกลางคำเป็น `จังหวัดเชียงใ` / `หม่` และ `ตำบลบ้า` / `นกลาง`
   `Font.registerHyphenationCallback((w) => [w])` **ไม่ช่วย** (ผลต่างจากค่าเริ่มต้น < 1 %: 739 vs 736 ตัวอักษร/หน้า)
   และเมื่อ "คำ" (ช่วงที่ไม่มีช่องว่าง) ยาวกว่าความกว้างบรรทัด ส่วนเกินจะ **ถูกตัดทิ้ง** (`…ปัญหาอุทกภั` หาย `ยในฤดูฝน`)
   ⇒ ต้องใส่ **soft break ฝั่งเราเอง** (เช่น แทรก `U+200B` ตามผลของ `Intl.Segmenter('th')` ก่อนส่งข้อความเข้า react-pdf)
2. **ตัวอักษรท้าย block หายในเอกสารเต็ม** — `ฯลฯ` → `ฯ`, `ป๋วย` → `ป๋ว` (เห็นทั้งจากภาพและจาก extract)
   แต่สตริงเดียวกันใน **เอกสารทดสอบหน้าเดียว 18 สตริง กลับถูกต้องครบ 18/18**
   ⇒ ยังแยกสาเหตุไม่ได้ในกรอบเวลา spike; ข้อสงสัยหลักคือการ layout 2 รอบเมื่อมี `fixed` + `render(totalPages)`
   **`[UNVERIFIED — ต้องหาสาเหตุใน T-501]`**
3. **ToUnicode ของข้อความไทยเชื่อถือไม่ได้** (กระทบ ค้นหา/คัดลอกข้อความใน PDF ไม่กระทบภาพ):
   `า` (U+0E32) ถูก map เป็นอักขระควบคุม (`U+001E`/`U+001F`) และ `ำ` ถูกแตกเป็น `ำ`+`า`
   เช่น `สำนักงาน` → `สำ␟นักง␟น`, `ปฏิญาณ` → `ปฏิญ␟ณ`
   ⇒ test snapshot ของ T-501 **ต้อง normalize อักขระควบคุมกลับเป็น `า`** ก่อนเทียบ และ QA (T-503)
   ต้องทดสอบ "ค้นคำไทยใน PDF viewer" เป็นเคสหนึ่ง
4. คอลัมน์แคบเกินจะถูกตัดข้อความเงียบ ๆ (`ลำดับ` → `ลำดั`, `จำนวน` → `จำนว`) — เรื่อง layout ปกติ แต่ต้องมี
   test ความกว้างคอลัมน์ของ BOQ

### ข้อสรุป S4
**D6 ผ่าน (go)** — react-pdf + Sarabun ให้ผลที่ใช้งานได้จริง (ตาราง/ลิงก์/ฟอนต์/ความเร็ว/ขนาดดี)
แต่ต้องเพิ่มงานใน T-501: soft-break ภาษาไทย + assertion ความถูกต้องของข้อความ + normalize ToUnicode

### `[UNVERIFIED]` ที่เหลือใน S4
- ตรวจ PDF ด้วย viewer จริง 4 ตัว (Acrobat/Preview/Chrome/Edge) — spike นี้ตรวจผ่าน pdf.js ตัวเดียว (A8/T-503)
- เมื่อฝัง PNG ของภาพประกอบเข้าไปด้วย ขนาด/เวลาจะเปลี่ยน (ดู S5)

---

## S5 — SVG จาก Claude → sanitize → PNG → PDF

### วิธีวัด
`web/spikes/src/s5.tsx` + `runner/run-s5-offline.mjs` (ไม่ใช้ API) และ `runner/run-s5-live.mjs` (ใช้ API)
เคสทดสอบ sanitizer เขียนมือ 7 ไฟล์ที่ `web/spikes/s5/in/*.svg` · ผลลัพธ์ที่ `web/spikes/s5/out/`
หน้า spike ใช้ CSP ของ §D8 **เป๊ะ** (`img-src 'self' data:`) และมีหน้าเทียบที่เติม `blob:`

### ผล 1 — DOMPurify profile ตาม §D9 (dompurify 3.4.15)

config ที่ใช้: `USE_PROFILES:{svg:true,svgFilters:true}`, `FORBID_TAGS:['script','foreignObject','use','image']`,
`FORBID_ATTR:['href','xlink:href']`

| เคส | ผล |
|---|---|
| `<script>` ใน svg | **ถูกตัด** |
| `onload` บน `<svg>`, `onclick`/`onmouseover` บน `<rect>`, `onbegin` | **ถูกตัดทั้งหมด** |
| `<foreignObject>` ที่มี `<iframe>` + `<img onerror>` | **ถูกตัดทั้งหมด** |
| `<image href="https://…">`, `<image xlink:href="https://…">`, `<use xlink:href="https://…#a">` | **ถูกตัด** |
| `<a href="javascript:alert()">`, `<a xlink:href="https://…">` | `<a>` เหลือแต่ **`href` ถูกตัด** (ไม่มี `javascript:` หลงเหลือ) |
| `<image href="data:image/svg+xml;base64,…<script>…">` | **ถูกตัด** |
| SMIL: `<animate attributeName="xlink:href" values="javascript:…">`, `<set attributeName="onload">` | **ถูกตัดทั้ง `animate` และ `set`** |
| **`<style>@import url("https://evil/x.css"); rect{fill:url(https://evil/p.svg#g)}</style>`** | **ไม่ถูกตัด — หลุด 100 %** (ขนาดโตขึ้น 296 → 302 B) |
| SVG สะอาด (gradient/filter/text ไทย) | ผ่านครบ, `fill="url(#g1)"` และ `filter="url(#f1)"` ภายในยังทำงาน |

**ช่องโหว่ที่ต้องปิดใน T-207**
- `<style>` ไม่ถูก sanitize เนื้อหา CSS ⇒ ต้อง **ลบ `<style>` ทั้ง element** หลัง DOMPurify (หรืออย่างน้อย
  ตัดทิ้งเมื่อพบ `url(` / `@import` / `expression(`) และตัด attribute `style` ที่มี `url(` ด้วย
  (CSP `default-src 'self'` จะบล็อกการโหลดจริงอยู่แล้ว แต่ **ไม่ควรพึ่ง CSP อย่างเดียว** และมันทำให้เกิด
  request ที่ล้มเหลว + ข้อความ error รบกวน)
- `FORBID_ATTR: [/^on/i, …]` ที่เขียนใน 04 §D9 **ใช้ไม่ได้** — DOMPurify รับเฉพาะ string
  (โชคดีที่ DOMPurify ตัด event attribute ให้โดยปริยายอยู่แล้ว — ยืนยันแล้ว) ⇒ แก้ข้อความใน §D9

### ผล 2 — SVG → PNG ภายใต้ CSP (ยืนยันแล้ว)

| วิธี | CSP `img-src 'self' data:` (ของ §D8) | CSP + `blob:` |
|---|---|---|
| `data:image/svg+xml;charset=utf-8,…` → `<img>` → `canvas` | **ผ่าน**, canvas **ไม่ tainted**, `toDataURL('image/png')` สำเร็จ | ผ่าน |
| `URL.createObjectURL(Blob)` → `<img>` | **ถูกบล็อก** (`img error`) | ผ่าน (14.7 ms) |

- ภาพทดสอบ 400×240 → canvas 800×480 (scale 2×) → PNG **42,438 B**
- PNG → react-pdf `<Image>`: **ผ่าน**, render 90.8 ms, PDF 23,169 B, pdf.js นับ `paintImageXObject` = **1**
- **ฟอนต์ไทยใน SVG ตอน rasterize**: ข้อความไทยวาดออกมาถูกต้อง (ตรวจด้วยตา — ดู `s5/out/s5-diagram-2x.png`)
  แต่ `font-family="Sarabun"` **ไม่ถูกใช้** — จำนวนพิกเซลเข้มเท่ากันเป๊ะ (1,213) ทั้ง `Sarabun`,
  `sans-serif`, `Tahoma` ⇒ browser fallback ไปฟอนต์ระบบเสมอ (SVG ใน `<img>` โหลด `@font-face` ภายนอกไม่ได้)
  ⇒ ถ้าต้องการให้ตรงกับ PDF ต้องฝังฟอนต์เป็น data URI ใน SVG (จะทำให้ไฟล์โต +90 KB/ตัด subset)
  หรือยอมรับฟอนต์ระบบ — **แนะนำให้ยอมรับฟอนต์ระบบใน MVP** และบังคับให้ AI ใส่ข้อความในภาพให้น้อย

### ผล 3 — ให้ Claude สร้าง SVG จริง (3 โจทย์, ยิงโจทย์ละ 1 ครั้ง ไม่ retry)

system prompt ใส่ palette + ข้อจำกัดของ §D9 · `max_tokens: 4000`

| โจทย์ | model | เวลา | output tok | stop | SVG | ค่าใช้จ่าย |
|---|---|---|---|---|---|---|
| ถนน 4 เลน (isometric) | `claude-sonnet-5` | 48,349 ms | 4,000 | **`max_tokens`** | **ไม่ได้ SVG ที่สมบูรณ์** | $0.0413 |
| ฝายน้ำล้น (cross_section) | `claude-haiku-4-5-20251001` | 18,403 ms | 3,215 | `end_turn` | 7,839 B | $0.0167 |
| แผนที่ กทม.–นครนายก (map) | `claude-sonnet-5` | 34,424 ms | 3,600 | `end_turn` | 5,160 B | $0.0373 |

- ทั้ง 2 ชิ้นที่สำเร็จ **ผ่าน sanitizer โดยไม่มีอะไรถูกตัด** (โมเดลทำตามข้อจำกัดใน prompt ครบ) และ
  แปลงเป็น PNG 2× ได้ (269,619 B และ 165,210 B) แล้วใส่ react-pdf ได้ (`image_ops = 1` ทั้งคู่)
- คุณภาพ (ตรวจด้วยตา): แผนที่ของ Sonnet 5 ดีมาก (legend/เข็มทิศ/มาตราส่วน/หมายเหตุครบ) เสียแค่ป้ายชื่อ
  ทางหลวงถูกเส้นทับ · ภาพตัดฝายของ Haiku 4.5 อ่านรู้เรื่องและมีมิติกำกับครบ แต่ป้าย 2 ป้ายซ้อนกัน
- **`max_tokens: 4000` ไม่พอสำหรับภาพ isometric ที่ซับซ้อน** ⇒ T-309 ควรตั้ง ~8,000 และ **ตรวจ
  `stop_reason === 'max_tokens'` แล้วทิ้งผลทันที** (อย่าพยายาม repair SVG ที่ขาด)

### ข้อสรุป S5
**D9 ผ่าน (go)** — ทาง SVG → sanitize → PNG (data URL) → react-pdf ใช้ได้จริงทั้งสาย ภายใต้ CSP เดิม
แต่ต้องปิดช่องโหว่ `<style>` และแก้ข้อความ `FORBID_ATTR` ใน §D9 + เพิ่ม `max_tokens`/`stop_reason` guard

### `[UNVERIFIED]` ที่เหลือใน S5
- คุณภาพ SVG จากโจทย์อื่น ๆ (อาคาร 3 ชั้น, ผังประปาหมู่บ้าน) — ตัดออกเพื่อคุมงบ
- การเปรียบเทียบคุณภาพ Sonnet vs Haiku อย่างมีนัยสำคัญ (ตัวอย่างละ 1 ชิ้น ต่างโจทย์กัน → เทียบตรง ๆ ไม่ได้)
- ขนาด/เวลา export PDF จริงเมื่อมีภาพ 3 ภาพ + กราฟ (T-504)

---

## ค่าใช้จ่าย API ที่ใช้จริงใน T-201

บันทึกทุก request ไว้ที่ `web/spikes/api-spend.json` (ไม่มี key) — คิดจาก `usage` ที่ API คืน ×
ราคาจาก docs.claude.com (ตรวจ 20 ก.ย. 2569)

| spike | รายการ | ค่าใช้จ่าย (USD) |
|---|---|---|
| S3 | stream + tool loop ×2 + caching ×2 + web search ×1 | **0.049951** |
| S5 | สร้าง SVG 3 โจทย์ | **0.095325** |
| **รวม** | 9 requests | **0.145276** (งบ 0.40) |

รายการที่แพงเกินคาด: `caching call0` $0.0226 (cache write 17,882 token) และ `webSearch` $0.0222
(input 10,553 token จากผลค้นหา + $0.01 ค่าค้น) ⇒ **ข้อมูลสำหรับ T-301**: ผลของ web search กินโควตา
input มาก ควรจำกัด `max_uses` และเปิด prompt caching กับ system prompt เสมอ

---

## ข้อเสนอต่อ backlog

| task | สิ่งที่ต้องเปลี่ยน | ที่มา |
|---|---|---|
| **T-202** | `manifest.ts`/types ต้องรู้จัก asset ใหม่ `duckdb-ext/` และ (ถ้ารับ T-208) `catalog/search.json.gz` + `catalog/index.json.gz` | S1, S2 |
| **T-203** | บังคับ `filesystem: {forceFullHTTPReads:false, allowFullHTTPReads:true, reliableHeadRequests:true}`; `SET custom_extension_repository` + `INSTALL/LOAD parquet` จาก self-host; สร้าง worker จาก `blob:`+`importScripts`; `repo.queryLines` ต้องเลือกคอลัมน์แคบ (ห้ามดึง `item_name_raw` ในขั้น filter); fallback `registerFileBuffer` เมื่อคาดว่าจะอ่าน > 70 % ของ shard; integration test ที่ block cross-origin แล้วต้องยังผ่าน (กัน N5 regression) | **ADR-002** |
| **T-204** | fold **ก่อน** tokenize (ตัดช่องว่างระหว่างอักษรไทย + `ำ`→`า`) ทั้ง index และ query; ค่า search เริ่มต้น `prefix:true, fuzzy:0.2, combineWith:'OR'` แล้ว re-rank ด้วย `n_lines`; fallback n-gram ต้องมี test เฉพาะ (query ช้ากว่า ~50×) | S2 |
| **T-207** | `lib/svgSanitizer.ts` ต้อง **ลบ `<style>` ทั้ง element** และตัด attribute `style` ที่มี `url(` หลัง DOMPurify; `FORBID_ATTR` ใช้ string เท่านั้น; มี unit test จากไฟล์ `web/spikes/s5/in/*.svg` ทั้ง 7 เคส | S5 |
| **T-208** | **ควรเปิด** — publish `catalog/search-index.json.gz` (MiniSearch `key_only` prebuilt, 1.60 MB gz) + `catalog/items-slim.json.gz` (1.96 MB gz) แทนการ build index ใน browser (ประหยัด 1.4 s บน desktop / **12.8 s บน CPU 4×** และ heap 51 MB → 23 MB) | S2 |
| **T-301** | default model → `claude-sonnet-5` (2/10 USD/MTok); `ai/pricing.ts` คิดจาก `usage` เท่านั้น (รุ่น 4.7+ tokenizer ใหม่); ระบุขั้นต่ำ cache ต่อรุ่น (Sonnet 1,024 / Haiku 4.5 4,096) | S3 |
| **T-302** | `web_search` ให้ `max_uses` ต่ำ (ผลค้นหา 1 ครั้ง = ~10.5k input token ≈ $0.022 บน Haiku) | S3 |
| **T-309** | `emit_illustration`: `max_tokens ≥ 8000` และทิ้งผลเมื่อ `stop_reason === 'max_tokens'` (ห้ามซ่อม SVG ที่ขาด) | S5 |
| **T-501** | แทรก soft break (`U+200B`) ตาม `Intl.Segmenter('th')` ก่อนส่งข้อความยาวเข้า react-pdf; test ต้อง extract text กลับมาเทียบ โดย normalize `U+001C–U+001F` → `า`; ตรวจข้อความท้าย block ไม่หาย | S4 |
| **T-503** | เพิ่มเคส "ค้น/คัดลอกข้อความไทยใน PDF viewer" (ToUnicode เพี้ยน) | S4 |
| **T-504** | ใช้ `data:` URL (ไม่ใช่ `blob:`) ตอนแปลง SVG → PNG เพื่อไม่ต้องแก้ CSP; ยอมรับฟอนต์ระบบในภาพ SVG | S5 |
| **T-605 / deploy** | workflow ต้องคัด `web/public/duckdb-ext/**` ไปด้วย และ smoke test ต้องตรวจว่า `.wasm` ถูก serve (และดูว่า Pages บีบอัดหรือไม่) | S1 |

## ข้อเสนอแก้ `04-ARCHITECTURE.md` §5 (performance budget)

| บรรทัดเดิม | ควรเป็น | เหตุผล (วัดจริง) |
|---|---|---|
| `DuckDB-WASM ~ 2.5 MB (lazy)` | **`DuckDB-WASM ~ 8.6 MB gz (lazy): wasm 7.64 + worker 0.19 + parquet ext 0.69 + js 0.04`** | S1 §ผล 6 |
| `fonts ~ 300 KB (lazy ตอน export)` | **`fonts ~ 90 KB gz (Regular+Bold) และ react-pdf ~ 456 KB gz (lazy ตอน export)`** | S4 |
| ไม่มี | **`catalog/ค้นหา ~ 3.6 MB gz (lazy ตอน tool แรก) — ถ้าไม่ทำ T-208 คือ 5.4 MB gz + build index 1.7 s (14.3 s ที่ CPU 4×)`** | S2 |
| `query_budget_lines ต่อ shard เย็น < 3 s (4G), อุ่น < 300 ms` | คงไว้ได้ — วัดบน Pages จริง: เย็น **401–1,542 ms**, อุ่น **16–110 ms** (แต่ยังไม่ได้ throttle เครือข่าย `[UNVERIFIED]`) | S1 §ผล 3 |
| `search_catalog < 200 ms` | คงไว้ได้ แต่ **ต้องระบุว่าไม่รวมเวลาสร้าง/โหลด index** และ query ที่แย่ที่สุดที่ CPU 4× = 215 ms (variant `full`) / 72 ms (`key_only`) | S2 |
| `Memory: DuckDB จำกัด 512 MB` | เพิ่ม **`JS heap ของ catalog+index ≈ 74 MB (full) หรือ 23 MB (prebuilt key_only) — peak ตอนโหลด catalog 110 MB`** | S2 |
