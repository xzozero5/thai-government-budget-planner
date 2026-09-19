# ADR-002 — DuckDB-WASM: เปิด HTTP range เอง + self-host parquet extension (แก้ N5)

สถานะ: **Accepted** · 20 ก.ย. 2569 · ผู้เขียน: `architect` (T-201 / S1)
เกี่ยวข้อง: `04-ARCHITECTURE.md` §D3, §D8, §5 · `CLAUDE.md` N5 · `docs/decisions/SPIKES.md` §S1

## Context

04 §D3 สมมติว่า `read_parquet('https://<origin>/data/**.parquet')` ใน DuckDB-WASM จะใช้ HTTP range + parquet
statistics โดยอัตโนมัติ และ §D8 สมมติว่า CSP `<meta>` (`connect-src 'self' https://api.anthropic.com`)
คุ้มครองทุก request ที่ออกจาก tab

S1 วัดจริงด้วย `@duckdb/duckdb-wasm` **1.32.0** (eh build, ไม่มี threads) บน Chromium 153.0.8010.12
ทั้งบน static server local และบน GitHub Pages จริง แล้วพบข้อเท็จจริง 3 ข้อที่ขัดกับสมมติฐาน:

1. **ค่าเริ่มต้นของ library ไม่ใช้ range เลย** — `DuckDBConfig.filesystem.forceFullHTTPReads` มีค่าเริ่มต้น
   เป็น `true` ในเวอร์ชันนี้ ทำให้ทุก query ดึงไฟล์ทั้งก้อน (`HEAD` + `GET 200` เต็มไฟล์)
   วัดได้: `SELECT count(*)` บน `pbo/2564/20000.parquet` โหลด **6,167,492 B** ทั้งที่ต้องการแค่ footer
   และถ้าตั้ง `allowFullHTTPReads: false` อย่างเดียว (ตามที่ชื่อชวนให้คิด) จะ **เปิดไฟล์ไม่ได้เลย**
   (`Failed to open file`)
2. **DuckDB-WASM ดาวน์โหลด parquet extension จาก `https://extensions.duckdb.org` เอง** ตอน `read_parquet`
   ครั้งแรก (`/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm`, 3,045,039 B) — เป็น **egress ข้าม origin
   ที่ไม่ใช่ `api.anthropic.com` → ละเมิด N5**
3. **CSP จาก `<meta>` ของหน้าเว็บไม่ครอบคลุม dedicated worker ที่สร้างจาก URL เดียวกัน (same-origin script)**
   — worker ได้ CSP จาก response header ของสคริปต์ worker เอง ซึ่ง GitHub Pages ตั้งไม่ได้ ⇒ worker ของ
   DuckDB ยิงออก `extensions.duckdb.org` **ได้สำเร็จโดยไม่มี CSP error ปรากฏ** (พิสูจน์ด้วยการ block ที่
   ชั้น Playwright: query พังทันที แปลว่าก่อนหน้านี้มันยิงออกจริง)
   ตรงข้ามกับ worker ที่สร้างจาก `blob:` ซึ่ง **สืบทอด CSP ของหน้า** → request เดียวกันถูกบล็อก

## Options

| # | ทางเลือก | ผล (วัดจริง) |
|---|---|---|
| A | ใช้ค่าเริ่มต้นของ library (full-file read) + ปล่อยให้โหลด extension จาก CDN | ผิด N5; bytes ต่อ query = ขนาด shard เต็ม (6.17 MB / 11.47 MB); Pages cold 1,138–1,989 ms |
| B | เปิด range เอง (`forceFullHTTPReads: false`) + self-host extension + worker แบบ `blob:` | ถูกต้องตาม N5; bytes ลดลง 6–260×; Pages cold 401–1,542 ms |
| C | เลิกใช้ `read_parquet(url)` → `fetch` ทั้ง shard แล้ว `registerFileBuffer` (fallback เดิมใน D3) | ใช้ได้จริง (Pages: fetch 6.17 MB = 1,092 ms, register 2.2 ms, query 33–44 ms) แต่โหลดทั้งไฟล์เสมอ |
| D | ย้ายไป SQLite-WASM / pre-aggregate อย่างเดียว | ไม่พิจารณาใหม่ — เหตุผลเดิมใน D3 ยังอยู่ และ B ใช้งานได้ |

ตัวเลขเปรียบเทียบ (cold ต่อ query, browser context ใหม่ทุกครั้ง, จับ bytes ที่ระดับ XHR ใน worker):

| query | B: range req/bytes | A: full-read bytes | B cold (Pages) | A cold (Pages) |
|---|---|---|---|---|
| `count(*)` 1 shard | 5 / 23,493 | 6,167,492 | 401 ms | 1,138 ms |
| `item_key IN (3 keys)` 7 คอลัมน์ | 22 / 7,773,125 | 6,167,492 | 1,542 ms | 1,459 ms |
| `item_key IN (3 keys)` 3 คอลัมน์ | 21 / 3,578,821 | 6,167,492 | 1,014 ms | 1,230 ms |
| `item_key LIKE '%…%'` 2 คอลัมน์ | 15 / 1,013,641 | 6,167,492 | 469 ms | 1,663 ms |
| aggregate 3 shards | 32 / 640,619 | 11,470,440 | 1,235 ms | 1,989 ms |

## Decision

รับทางเลือก **B** เป็นค่าเริ่มต้นของ `data/duckdb.ts` (T-203) โดยมีข้อกำหนดบังคับ:

1. `db.open({ filesystem: { forceFullHTTPReads: false, allowFullHTTPReads: true, reliableHeadRequests: true } })`
   — ทั้งสามค่าต้องระบุชัดเจนพร้อม comment อ้าง ADR นี้ (ค่า default ของ library ผิดความคาดหมาย)
2. **self-host parquet extension**: publish ไฟล์ `parquet.duckdb_extension.wasm` ของ duckdb เวอร์ชันที่ตรงกับ
   `@duckdb/duckdb-wasm` ไว้ใต้ `web/public/duckdb-ext/v<X.Y.Z>/wasm_eh/` แล้วสั่ง
   `SET custom_extension_repository = '<BASE_URL>duckdb-ext'; INSTALL parquet; LOAD parquet;`
   ทันทีหลัง `connect()` (วัดได้ 142 ms, ไม่มี request ข้าม origin)
   - path `v1.4.3` ผูกกับเวอร์ชัน duckdb-wasm → ต้องมี test ที่ fail เมื่ออัปเกรด library แล้ว path ไม่ตรง
   - ยังคงเป็นไฟล์ที่ DuckDB เซ็นไว้ (ไม่ต้องเปิด `allowUnsignedExtensions`)
3. **สร้าง worker จาก `blob:` ที่ `importScripts()` ไฟล์ worker ของเรา** (ไม่ใช่ `new Worker(url)` ตรง ๆ)
   เพื่อให้ worker สืบทอด CSP ของหน้า → N5 ถูกบังคับจริงแม้ในเธรดของ DuckDB
   (CSP ปัจจุบันมี `worker-src 'self' blob:` อยู่แล้ว จึงไม่ต้องแก้)
4. `data/repo.ts` ต้อง**เลือกคอลัมน์ให้แคบที่สุด** เสมอ — S1 แสดงว่าถ้าดึง `item_name_raw` มาด้วย
   range mode จะอ่าน 7.77 MB (มากกว่าไฟล์ทั้งก้อน เพราะอ่านซ้ำเป็นบล็อก 16 KB) ⇒ กำหนดกฎ:
   query แบบ "หาแถวเพื่อ citation" ให้ดึง `source_id` + ตัวเลขก่อน แล้วค่อยดึง `item_name_raw`
   เฉพาะแถวที่ต้องแสดง (≤ 50 แถว)
5. คง **ทางเลือก C เป็น fallback ที่มีอยู่จริงในโค้ด** (`registerFileBuffer`) สำหรับกรณีที่ host ไม่ตอบ 206
   หรือ query ที่ประเมินแล้วว่าจะอ่าน > 70 % ของ shard — วัดแล้วใช้ได้ทั้ง local และ Pages

## Consequences

- **บวก**: query แบบ selective ประหยัด bytes 6–260× และเร็วกว่าบน Pages 1.3–3.5 เท่า; ไม่มี egress
  ออกนอก origin นอกจาก `api.anthropic.com` (ตรวจซ้ำได้ด้วย test ที่ block cross-origin แล้วต้องยังผ่าน)
- **ลบ / ต้นทุน**:
  - เพิ่ม artifact ใน repo อีก ~3.0 MB (extension wasm) — ยังห่างเพดาน 500 MB มาก
  - ผูกกับ private config ของ library (`forceFullHTTPReads`) → ต้องมี integration test ที่ยืนยันว่ายัง
    เห็น `206` จริงหลังอัปเกรด
  - request ต่อ query เพิ่มเป็น 5–32 ครั้ง (latency ต่อ request มีผลมากบนเครือข่ายช้า) ⇒ warm cache สำคัญ
- **ต้องแก้ 04**: §D3 (เพิ่มข้อ 1–5), §D8 (เพิ่มประโยคว่า CSP meta ไม่ครอบ same-origin worker + เพิ่ม
  `duckdb-ext/` เป็น asset), §5 (งบ DuckDB-WASM ~2.5 MB ไม่ตรงความจริง — ดู SPIKES §S1.6)
- **ต้องแก้ backlog**: T-203 (config + extension + worker + column pruning + fallback), T-202 (manifest
  ต้องรู้จัก `duckdb-ext/`), T-605/T-004 (deploy ต้องคัด `web/public/duckdb-ext/**` ไปด้วย)
