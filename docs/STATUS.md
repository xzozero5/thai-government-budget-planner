# STATUS — สถานะโปรเจกต์ (Claude Code อัปเดตทุกครั้งที่ปิดงาน)

รูปแบบ entry: `## YYYY-MM-DD HH:MM (Asia/Bangkok) — <ใคร/agent> — <phase/task>` แล้วตามด้วย ทำอะไร / ไฟล์ที่แตะ / test / ค้าง / ไม่ยืนยัน

## สถานะปัจจุบัน
- Phase: **3 กำลังทำ** — ตัดสินใจ **ADR-006** (model/พารามิเตอร์/tool version ตาม Claude API ปัจจุบัน; แผนเดิมบางข้อจะโดน 400) · `ai-engineer` ทำ T-301→T-302→T-303→T-309 (**SDK mocked ทั้งหมด — 0 USD**) → ต่อด้วย T-304 (agent loop) + T-305 (system prompt) → T-306 eval แบบจำกัดงบ (8 โจทย์) → T-307 security review → T-308 po review · Phase 2 **เสร็จ**
- Phase 0, 1: เสร็จ · ข้อมูล production: `data_version cd15fb2dd39b…` 796 ไฟล์ (เพิ่ม `catalog/items-slim` + `catalog/search-index`), อยู่บน Pages แล้ว
- Test ล่าสุด (main thread รันเองทั้งหมด): **web** lint 0 error · typecheck ✅ · vitest **312/312** · build ✅ (initial JS 60.3 KB gz; DuckDB/ค้นหาเป็น lazy; ไม่มี harness ใน `dist/`) · Playwright e2e **7/7** (206 จาก DuckDB worker, บล็อก cross-origin แล้ว query ผ่าน, ไม่มี CSP violation, ลำดับ range = full) · **pipeline** pytest **451** · ruff ✅ · CI ล่าสุดที่ยืนยัน: `a62b978` เขียว (web 75 s รวม e2e)
- API ที่ `ai/` ต้องใช้: **`web/src/data/index.ts` (facade) เท่านั้น** — ESLint `no-restricted-imports` บังคับ
- Blockers: ไม่มี · `[ASK-HUMAN]` ค้าง: ไม่มี · **งบ API: ใช้ไป 0.1453 / 5.00 USD** (`docs/api-budget.md`)
- งานที่เลื่อน (มี interface รองรับแล้ว): **T-209** sort shard ตาม `item_key` + row group 16k, **T-210** catalog detail blocks (เลิกโหลด catalog เต็ม ~40 MB heap) — ทำพร้อมกันใน republish ครั้งถัดไป
- แจ้งคุณนิว (ไม่บล็อก): ADR-004 (PBO 2562 ไม่ครบ 79 %), ADR-005 (ราชาเทวะ OCR ต้นทาง), econ ขาดน้ำมัน/ค่าแรง + `verified:false` ทั้งหมด, ราคาต่อหน่วยมี ~3 % ของแถว, DuckDB-WASM จริง ~8.6 MB gz (lazy), react-pdf มี 3 บั๊กภาษาไทยที่ต้องแก้ใน Phase 5
- กติกาจากบทเรียน: (1) ตรวจซ้ำรายงาน agent ทุกครั้งก่อน commit — รวม**ตรวจกับข้อมูล production ไม่ใช่แค่ fixture** และ**โจมตี security code เอง** (2) ห้าม `git stash/checkout` ขณะมี agent แก้ไฟล์เดียวกัน (3) test ห้ามเขียนลง `.cache`/`web/public/data` จริง (4) commit data หลัง review ผ่าน (5) **ห้ามแก้ไฟล์ที่มี backslash ผ่าน Python heredoc** — ใช้ Edit tool

## Open questions / `[UNVERIFIED]` ที่ยังค้าง
- econ: ยังไม่มี `diesel_avg_thb_per_l`, `gasoline95_avg_thb_per_l` (EPPO มีแต่ราคารายวัน/หน้า JS), `min_wage_bangkok_thb` มีแค่ปี 2568, `min_wage_avg_thb` ไม่มีค่าทางการ → คง `null`; **ทุกค่า econ `verified:false` `[UNVERIFIED]`** จนกว่าคนจะตรวจ (`docs/econ-sources.md`)
- `sources.json.fiscal_years` เป็น heuristic จากชื่อไฟล์/โฟลเดอร์ ยังพลาดบางแบบ ("ปี 66-68" ได้แค่ 2566; วันที่ในชื่อไฟล์ถูกนับเป็นปีงบ) `[UNVERIFIED]` — แก้เมื่ออ่านเนื้อหาจริงใน T-109
- `item_parser` ข้อจำกัดที่รู้: ชื่อจังหวัดฝังในชื่อหน่วยงานโดยไม่มี marker, `บ้าน` กำกวม, chainage ติดอักษรไทย (`0+000-1+700`), เกณฑ์ qty ≥ 20 over-flag เมื่อเลขติดคำไทย (`…กรุงเทพมหานคร100 ชุด`) — ผลคือ unit_price หายบางแถว (ปลอดภัยกว่าผิด); ยังเหลือ 305 กลุ่มใน catalog ที่ `unit_price × 20 < amount` `[UNVERIFIED]` → AC ใน T-302 (n < 3 ห้าม confidence สูง)
- catalog หลัง decompress 40.5 MB (45,193 entries) — ความเสี่ยง memory/TTI บนมือถือ → S2 ต้องวัดกับไฟล์จริง; ทางออกสำรอง T-208
- `act_2570_province` format A (575 แถว เชียงใหม่) ไม่มีรหัสกระทรวง/หน่วยงาน (org mapped 21 %) ทั้งที่ match กลับ A2 ได้ 100 % → copy code จาก A2 ได้ในอนาคต (ผลกระทบต่ำ: เป็น subset ที่ไม่นับใน catalog)
- ราคา API ต่อ token ของแต่ละ model (T-301) — ต้องเช็คจาก docs.claude.com ตอน implement
- DuckDB-WASM range request บน host เป้าหมาย — S1 ใน T-201
- SSH push จากเครื่องคุณนิว: **ไม่ผ่าน** (`Host key verification failed`) → ใช้ HTTPS remote แทน (ยืนยันแล้วว่า push ได้ รวมไฟล์ workflow) — ADR-003 ข้อ 3
- advisory ของ react-router-dom 6.x ที่เป็นเหตุให้ใช้ 7.x — มาจาก `npm audit` ของ agent ยังไม่ได้ตรวจเลข advisory เอง `[UNVERIFIED]` (ADR-003 ข้อ 6)
- GitHub Pages: **live แล้ว** — ยืนยัน 19 ก.ย.: หน้า placeholder ขึ้น, CSP meta อยู่ใน HTML ที่ serve, `Accept-Ranges: bytes`, `Range: bytes=0-99` กับ `data/sources.json` → **206 / 100 bytes**; ยังต้องวัดกับไฟล์ parquet + DuckDB-WASM จริงใน S1 (T-201) และ `Cache-Control: max-age=600` (ข้อมูลใหม่อาจช้า ≤ 10 นาที)

## Log

## 2569-09-20 09:30 (Asia/Bangkok) — Claude Code main thread (+ frontend-dev ×4, data-engineer, architect) — ปิด Phase 2
- **T-203** DuckDB client ตาม ADR-002 + `BudgetRepo` + หน้า harness (ตัดออกจาก production ด้วย alias ตาม mode) + e2e ใน Chromium จริง. main thread: e2e 7/7, `dist/` ไม่มี harness/duckdb, **sha256 ของ parquet extension ตรงกับ `extensions.duckdb.org`**, CI Linux เขียว. agent เจอบั๊กจริง 2 จุด (URL root-relative ใช้ไม่ได้จาก blob worker; Arrow `LIST(NULL)` เมื่อ list ว่างทั้งคอลัมน์)
- **T-204 + T-208** ค้นหาไทย: fold ก่อน tokenize + `Intl.Segmenter`, prebuilt index (slim 1.97 MB gz + index 1.65 MB gz; tokenizer แชร์กับ Node ผ่าน esbuild). main thread วัด latency กับ catalog จริง: query ที่มีคำทั่วไป 230–360 ms (เกินงบ) — agent คาดว่าเป็น fuzzy/prefix แต่**ต้นเหตุจริงคือ re-rank เรียก `Intl.Segmenter` ต่อ hit** → เปลี่ยนเป็น string scan + เลข/คำสั้น match ตรงตัว → **0.8–19 ms**. pipeline: `tgbp publish` เรียกสคริปต์ + ลง manifest; แก้ปัญหาไก่-ไข่ของ `data_version` (ไม่นับไฟล์ derived) → `data_version` เดิม, shards byte เดิม
- **T-205 + T-207** econ/inflation (ไม่เดาค่า, ไม่ข้ามปีฐาน), trends (basis ไม่ปน, caveat 2562), **SVG sanitizer**: test ของ agent ผ่าน 30 เคส แต่ (ก) การโจมตีของ main thread หลุด 1/9 (`style="mask-image:image-set(…)"`) → ตัด `style` attribute เสมอ + กฎ external reference (ข) architect หลุดได้อีกด้วย **CSS escape `\000075rl(`** (Chromium ยิง request ออกจริง) → เปลี่ยนเป็น **allowlist grammar** สำหรับ paint/reference attributes + ห้าม backslash; ตอนนี้ 62 tests. ยังต้องมี e2e ใน browser จริง (T-412)
- **T-206** architect review: boundaries ผ่าน, ADR-002 ครบ, ไม่มี SQL injection; blockers 3 (ORDER BY ไม่มี tiebreaker → citation ไม่ reproducible; แถว Zod fail ถูกทิ้งเงียบ; ผล query ไม่บอก shard) + majors (LRU evict shard ของ query ตัวเอง, coverageNotes ไม่ครบ, re-rank, ตรวจ version ของ slim) → แก้ครบ + API ใหม่สำหรับ Phase 3 (`findDocuments`, `getDoc` จำกัด chunk, `getCatalogItemByKey`, `searchCatalog.total`) + **facade `data/index.ts`**. รายงาน: `docs/decisions/T-206-review.md`
- ข้อสังเกตคุณภาพที่ยังเปิด (ส่งต่อ eval T-306): "ก่อสร้างอาคาร" → top-1 ยังเป็น "ปรับปรุงซ่อมแซมอาคารเรียน…สิ่งก่อสร้างอื่น" (substring match; n=53,806); `getDoc` แนบ coverage notes ของกลุ่ม `province_budget` แบบ heuristic
- ความผิดพลาดของ main thread: แก้ไฟล์ผ่าน Python heredoc ทำ backslash เพี้ยน/NUL byte → คืนจาก git แล้วแก้ด้วย Edit tool (ไม่มีอะไรหลุดเข้า commit)
- Commits: `077ee92` `56fb6f6` `f7c5f05` `a62b978` `64ba7f2` `39c97e1` `5a98586`(data) `9ec7f32` + commit นี้

## 2569-09-20 02:30 (Asia/Bangkok) — Claude Code main thread (+ architect, frontend-dev) — Phase 2 ช่วงแรก
- **ยืนยันบน production**: CI/deploy ของ `eea8632` เขียว; Pages เสิร์ฟ `data_version cd15fb2dd39b` (794 ไฟล์); parquet ตอบ Range `206`
- **T-202** types (Zod) + manifest loader + 75 tests. main thread ตรวจ schema กับ **ข้อมูล production ทั้งชุด** (catalog 45,193, trends 256 shards, docs 142 ไฟล์/29,288 chunks, sources, orgs, econ) → เจอ 3 จุดที่ fixture จับไม่ได้: (1) enum `basis` ผิด (`unit_price` vs ของจริง `unit_price_per_line`) (2) DocChunk จาก xlsx = `{sheet, rows}` และ `page` เป็น null 1,100 chunks (3) **บั๊ก pipeline**: manifest glob โฟลเดอร์ trends → ไฟล์ค้างหลุดเข้า fixtures ของ `tgbp sample` (แก้แล้ว; production `data_version` ไม่เปลี่ยน). 03 §3.3/§3.4 แก้ตามของจริง
- **T-201 spikes** (architect; ตัวเลขวัดจริงทั้งหมดใน SPIKES.md): **S1** DuckDB-WASM 1.32.0 default `forceFullHTTPReads:true` (โหลดทั้งไฟล์) + **แอบดาวน์โหลด parquet extension จาก `extensions.duckdb.org` (ละเมิด N5)** + CSP meta ไม่ครอบ same-origin worker → **ADR-002**: เปิด range เอง, self-host extension, worker จาก blob; bytes/query ลด 6–260×; ขนาดจริง ~8.6 MB gz (04 เดิมเขียน 2.5 MB ผิด) · **S2** build index ใน browser 1.7 s / 14.3 s (CPU 4×) → เปิด **T-208** prebuilt index; folding ทำให้ค้น text PDF ได้ (0 → 55 hits) · **S3** SDK ใน browser ใต้ CSP จริง: streaming, tool loop, web_search, **prompt cache hit**, storage audit ว่าง → default model เปลี่ยนเป็น `claude-sonnet-5` · **S4** react-pdf + Sarabun ใช้ได้ แต่มี 3 บั๊ก (ตัดคำไทยกลางคำ, ToUnicode เพี้ยน, ตัวอักษรท้าย block หาย `[UNVERIFIED]`) → T-501/T-503 · **S5** DOMPurify profile เดิม**ปล่อย `<style>@import` หลุด** → ต้องลบ `<style>` ทั้ง element; SVG จาก Claude ผ่าน sanitizer 100 %; isometric ชน `max_tokens` 4,000
- main thread ตรวจซ้ำ: ไม่มี `sk-ant-` ในไฟล์ใดของ spikes/docs; ledger 9 requests = **0.1453 USD** (เพดาน 0.40); ทดลองเองว่า sort shard ตาม `item_key` → ขนาด +1 %, prune ได้ (row group 3 → 1) → **T-209** ทำพร้อม republish ครั้งหน้า (ไม่ republish 165 MB เพื่อเรื่องนี้)
- 04 §D2/D3/D8/D9/§5 แก้ตามผลวัดจริง; BACKLOG เพิ่ม AC ให้ T-203/204/207/301/309/408/501/503/504/605 + เปิด T-208/T-209
- ติดตั้ง dependency ล็อกเวอร์ชัน: `@duckdb/duckdb-wasm@1.32.0`, `minisearch@7.2.0`, `dompurify@3.4.15` (+ `zod` จาก T-202)
- Test (main thread รันเอง): web lint/typecheck ✅, vitest **80/80** ✅, build ✅ (initial JS 60 KB gz); pipeline pytest **438** ✅
- Commits: `8f59b4e` `60ae931` `a71c358` `8152e78` `9b60356` `00856a5`

## 2569-09-20 01:00 (Asia/Bangkok) — Claude Code main thread (+ data-engineer ×2, explorer, po) — ปิด Phase 1
- **T-110b** `publish.py` + `tgbp build/sample`: shards ปี×กระทรวง (zstd, sort + tiebreak `source_id` — agent เจอว่า DuckDB เรียง tie ไม่คงที่ทำให้ byte ไม่ deterministic), catalog/trends/facets/orgs/docs/econ/manifest, V6, V10 ใช้ magic bytes (262 = 262). main thread รัน **full build ตั้งแต่ extract เอง: exit 0 / 724 s / `data_version` เดียวกับ agent**
- main thread ตรวจ catalog ด้วยตา → พบ key แตกเพราะเว้นวรรคไทย → agent ทำ `group_key` (ตัด whitespace) + `keys[]`; เช่น โน้ตบุ๊กประมวลผล 1,503 → 2,811 แถว, รถกระบะ 1 ตัน 5 → 10 ปี. main thread ตรวจ resolve เอง → **พบ `shards` ถูก cap 60 แบบเงียบ (194 entries; sample_source_ids ชี้นอก shard)** ทั้งที่ agent รายงานว่า resolve ครบ → แก้เอง (ไม่ cap) + ภายหลังเป็น index (catalog v2) + มี test กัน regression; ตรวจซ้ำ 111 entries = 0 mismatch
- **T-113** (ก) blind check: main thread สุ่ม 13 `source_id` (PBO 5 ปีรวม 2562/2567, act2570, จังหวัด, เงินอุดหนุน, อปท. 3, กมธ.) → `explorer` เปิดไฟล์ดิบโดยเห็นแค่ path/sheet/row → main thread เทียบด้วยโปรแกรม: **13/13 ตรง** (ชื่อ, พรบ., เบิกจ่าย, หน่วยงาน) (ข) `po` review: DoD ผ่านหลังปิด blocking 5 ข้อ; ทดลอง 5 โจทย์จริง (แอร์/รถกระบะ/ฝาย/วิทยุ/CCTV) → AC ใหม่เข้า BACKLOG T-201/202/203/207/302/305/306/407; เห็นด้วยกับ ADR-004/005 และการไม่ซ่อม text/ไม่ map ตารางกำกวม
- **T-114/T-115**: กัน qty จากรหัสนำหน้าชื่อ (`AC0405 …` qty 405 → unit_price 593 บาท — แก้แล้ว, 220 แถว), sanity qty ≥ 20 (unit_price 109,706 → 94,985 แถว), กลุ่ม catalog ที่ `unit_price×20 < amount` 1,121 → 305, catalog v2 (49.4 → 40.5 MB หลัง decompress), `low_specificity` 2,409 entries (เช่น `ฝาย`), สถิติ DoD ใน validation report, V9 เข้า `coverage_notes` (5 entries), fixture `sample:true`
- **T-112** fixtures `web/tests/fixtures/data/` ~0.97 MB (998 แถว, 16 shards, catalog 41 entries, 3 docs) resolve ครบ
- เอกสาร: 02 §A3/A4/A5/B/E ไม่มี `[UNVERIFIED]` ค้างแล้ว (เหลือเฉพาะ econ + ข้อจำกัดที่ระบุใน Open questions); 03 §3.1/§3.4/§6 ตรง output จริง; ADR-003/004/005
- Commits: `013cbf9` `a3ffcab` `ba7816e` `1f5e464` `3f00db0`(data 181 MB) `60d9968`

## 2569-09-19 23:30 (Asia/Bangkok) — Claude Code main thread (+ data-engineer ×5) — Phase 1 ช่วงสาม
- **T-106** ร่าง พ.ร.บ. 2570: A2 96,470 แถว = 3.788 ล้านล้านบาทพอดี; A3 6 ไฟล์ (1 format A มี title/oracle ตรงเป๊ะ 575 / 9,043,395,000; 5 format B `no_oracle`) match กลับ A2 100 % → flag `subset_of_act_2570_draft`; พิสูจน์ว่า filter ด้วย substring จังหวัดใช้ไม่ได้ (อ.ศรีเชียงใหม่, รายการ อปท.)
- **T-107** ข้อบัญญัติ อปท. 4 ไฟล์ = 2,646 แถว; ทน. ชม. ตรงยอดกระทบของต้นทางเป๊ะ; agent แก้บั๊กโค้ดเดิม 3 จุด (z-score flag ผิด, tie-break คอลัมน์หน้า → 700 แถวเสีย page citation, รูป "N/M"); main thread ตรวจ workbook ราชาเทวะเอง → `summary_ocr_raw_data` คือยอดพิมพ์ในเอกสาร ไม่ตรงรายการ 10/38 กลุ่ม (รวมต่าง 0.21 %) → **ADR-005**
- **T-108** กมธ.: 26 xlsx/xls → map ได้ไฟล์เดียว (กองทุนอนุรักษ์พลังงาน 3,325 แถว หลังแก้บั๊ก 3 จุด: ปีงบ null ทั้งชุด, gov_level ผิด, แถว "รวม" หลุด 3 แถว); `BI*.XLS` 13 ไฟล์เป็น xlsx ปลอมนามสกุล — ยืนยันสมมติฐาน main thread (openpyxl เช็กนามสกุล → เปิดผ่าน file object); docx 1 + pptx 25 chunks
- **T-109** PDF: 114/114 ไฟล์, 9,428 หน้า (ไม่มี text 1,119 หน้า — ข้าม ไม่ OCR), 28,163 chunks, 6.38 MB; Thai PUA map; main thread วัดเอง: สระ/วรรณยุกต์หลุดตำแหน่ง ~18,800 จุด/78 ไฟล์ และพบว่าซ่อมเหมารวมไม่ปลอดภัย (`ล านบาท`) → ไม่ซ่อม, เพิ่มข้อกำหนด folding ใน T-204
- **T-110a** wire CLI ครบ, normalize 2.99 ล้านแถวใน ~2.5 นาที (parse เฉพาะ distinct + process pool), validate V1–V10 รวม; field ใหม่ `budget_group`; บั๊กจริงที่เจอ: `item_parser` recursion ไม่จำกัด (RecursionError กับ PBO 2558), ชื่อย่อ อปท. (อบจ./ทน.) ไม่ match org master. sanity โดย main thread: แอร์ 18,000 BTU ปี 2558–59 median 28,000 บาท/เครื่อง; พบ item_key แบบ "หมวดรวม" (…ที่มีราคาต่อหน่วยต่ำกว่า 10 ล้านบาท) ต้องกันออกจาก catalog → flag `lump_sum_category` ใน T-110b
- **ความผิดพลาดของ main thread**: รัน `git stash` เพื่อตรวจ tree ขณะ agent T-110a กำลังแก้ → edits 3 ไฟล์ถูกย้อนชั่วคราว; กู้ครบ (agent ยืนยัน byte-identical กับ stash) ไม่มีงานหาย → กติกาใหม่ด้านบน
- Test ที่ main thread รันเอง ณ `ec121f5`: pipeline pytest **385 passed**, ruff ผ่าน; CI ของ `a0ca1ff` — ดูผลรอบถัดไป
- Commits: `a1e94d3`(T-004) `2d8b6d9`(T-107+ADR-005) `2dabfa6`(T-106) `23d0c63`(T-109) `a0ca1ff`(T-108) `ec121f5`(T-110a)

## 2569-09-19 20:00 (Asia/Bangkok) — Claude Code main thread — resume + ปิด T-004
- คุณนิวเปิด GitHub Pages แล้ว: workflow `deploy` ของ `b701860`/`1722df4` สำเร็จ; `https://xzozero5.github.io/thai-government-budget-planner/` → 200, title ไทย, `lang="th"`, CSP meta ครบ, asset ใต้ base path; **range request ใช้ได้** (206) → T-004 `[x]`, `[ASK-HUMAN]` ข้อ 1 ปิด
- CI ของ `1722df4` เขียว (pipeline 183 tests + web)
- สั่ง `data-engineer` ชุดใหม่ 4 ตัว (T-106, T-107, T-108, T-109) พร้อมข้อค้นพบ ณ จุด pause และกติกาไฟล์เดิม

## 2569-09-19 19:00 (Asia/Bangkok) — Claude Code main thread — Phase 1 ช่วงสอง + PAUSE
- **T-103** เสร็จ: item_parser + fixture 220 เคส (200 จาก PBO 2566 + hold-out 2563/2560/2568 ที่ label มือ). main thread รัน hold-out อิสระ 2 รอบ (2563: พบบั๊ก 7 แบบ → ตีกลับ; 2565 หลังแก้: province 17/18 [ที่พลาด = ชื่อมี 2 จังหวัด], qty/unit ผิด 0/22) แล้วเพิ่ม `_canon_key` เอง (เว้นวรรคเลข–อักษรไทย, ตัด "จำนวน"/"ความยาว"/"พื้นที่รับประโยชน์" ที่ค้าง) เพื่อให้รายการเดียวกัน group กันได้. ข้อจำกัดที่รู้: ชื่อจังหวัดที่ฝังในชื่อหน่วยงานโดยไม่มี marker, `บ้าน` กำกวม, เคสสถานที่ล้วน → fallback คงข้อความเต็ม
- **T-105** เสร็จ: extract PBO 11 ปี = **2,887,730 แถว**; V1 ตรง oracle ทุกปีที่มี (max diff < 0.004 %; 2564/2565 คอลัมน์ PO ต่าง 100 บาท ผ่านด้วย abs floor 1,000 บาท); 2567 `no_oracle` (221,571 แถว, รวม พรบ. 3,602,000); **2562 `source_incomplete`** coverage 79.24 % (ขาด กลาโหม, คลัง, ต่างประเทศ, ท่องเที่ยวฯ, พม., ชดใช้เงินคงคลัง; เกษตรฯ 20.3 %, สำนักนายกฯ 6.6 %) → **ADR-004** เก็บพร้อมป้าย; แถว 226 คอลัมน์เลื่อน → `corrupt_row`; V4 unique ครบ. main thread จับบั๊กที่ agent ไม่รายงาน: rawdata test เขียนทับ `.cache/pbo/2566.parquet` เหลือ 5,000 แถว → แก้เป็น `.partial.parquet` + test ใช้ `tmp_path`; ยืนยันจำนวนแถว/ยอดรวมทั้ง 11 ปีเองหลังรัน pytest
- org_master: ปิด fuzzy สำหรับชื่อ อปท. แล้ว (+test คลองโยง/คลองยาง)
- Test ที่ main thread รันเอง ณ commit `25c3845`: pipeline pytest 183 passed, ruff ผ่าน
- สั่ง T-106..T-109 ขนาน 4 agents แล้ว **PAUSE** ตามคำสั่งคุณนิว — ดู "วิธีทำต่อ" ด้านบน
- Commits: `3108188`(ADR-004) `3f923d3`(T-103) `25c3845`(T-105)

## 2569-09-19 16:30 (Asia/Bangkok) — Claude Code main thread (+ data-engineer ×4, explorer) — Phase 1 ช่วงแรก
- **ข้อเท็จจริงใหม่ที่แก้เอกสาร** (main thread สแกนไฟล์จริงเอง หลังรายงาน explorer ไม่คงเส้นคงวา): PBO ปี **2561/2567/2568 ไม่มีแถว Grand Total** (inventory เดิมผิด) → 02 §A1, 03 §4.1, **V1 ใหม่** (Grand Total / Sheet1 ปี 2561 รวม 3,050,000.007 ล้านบาท / Sheet1 ปี 2568 เฉพาะสำนักนายกฯ / 2567 `no_oracle`); header 22 คอลัมน์เหมือนกันทุกปี, 2567 มีคอลัมน์ขยะ 23–30
- **เครื่อง dev ไม่มี `pdfinfo`/LibreOffice** → pipeline ใช้ Python ล้วน (pypdf/pdfplumber/xlrd) — แก้ 02, 03 §4.4/§4.5
- **T-101** `tgbp inventory` → `sources.json` 318 records (pdf 262 [มี text 119 / ไม่มี 143], xlsx 36, xls 13, jpg 4, pptx 1, docx 1, other 1; duplicates 41 กลุ่ม), `rel_path` เป็น posix, เขียน LF; appendix auto-gen. รอบแรกถูกตีกลับ 3 จุด (backslash path, test ไม่ isolate env — agent รายงานว่าผ่านแต่ main thread รันแล้ว 7 failed, `fiscal_years` เดาจากวันประชุม) → แก้แล้ว
- **T-102** `thai_text`, `money` (Decimal), `util/hash` + tests
- **T-104** org master จาก A2: 33 กระทรวง / 3,289 หน่วยงาน, code เป็น string (มี `7510A`), map PBO→A2: ministry 100 %, agency 98.4 % (2566) / 98.8 % (2568); พบ fuzzy จับ อปท. ผิดตัว → **ตัดสินใจปิด fuzzy สำหรับ อปท.** (03 §5 ข้อ 3; implement ใน T-105)
- **T-111** econ: รอบแรกได้เฉพาะแหล่งทุติยภูมิ (World Bank/Wikipedia); main thread พบ JSON API ของ สนค. (`index.tpso.go.th/api/cmi/*`) ผ่าน browser → รอบสองได้ CMI 10 หมวดทางการ + CPI/เงินเฟ้อจาก สนค. โดยตรง (158/250 records มีค่า); main thread ตรวจไขว้ `cmi_steel` กับ API เองแล้วตรง; เงินเฟ้อ สนค. = World Bank 10/11 ปี; วงเงินงบ 2566 (3,185,000 ล้านบาท) ตรงกับ Grand Total ใน PBO. ปรับ spec `cmi_*` ตามหมวดทางการ (03 §3.5)
- **T-103** รอบแรก: fixture 200 เคส 100 %/100 %/100 % — main thread ไม่เชื่อ จึงรัน hold-out 28 ชื่อจาก PBO 2563 อ่านด้วยตา: province 25/25 ถูก แต่พบบั๊ก 7 แบบ (มิติถูกตีเป็น qty เช่น "หน้ากว้าง 1.30 เมตร"→qty 1.3; สเปคหลุดจาก item_key; ตัวเลขติด marker ถูกกิน; เศษเลขหมู่; `อ.ท่ายางจ.`; ชื่อหน่วยงานท้ายชื่อไม่ถูกตัด) → ตีกลับพร้อม expected ที่ label มือ
- Test ล่าสุดที่ main thread รันเอง: pipeline pytest 92 → (หลัง T-104) ผ่าน, ruff ผ่าน; CI ของ `7a167b2` เขียว (ยืนยัน `checkout@v5`/`setup-node@v5`)
- Commits: `d1e411f` `9d46d5b` `3816a9c`(data) `8a322f1` `9b48ad2` `0397bad` `a296257` `cd2a749`

## 2569-09-19 13:50 (Asia/Bangkok) — Claude Code main thread (+ frontend-dev, data-engineer, po) — Phase 0 / T-000..T-005
> หมายเหตุ: เวลาใน entry วางแผนด้านล่าง (14:00–14:45) เป็นเวลาประมาณจาก session Cowork; entry นี้ใช้นาฬิกาเครื่องจริง
- **T-000** git init, remote **HTTPS** (SSH ล้ม: host key), checkout `main` ต่อจาก `1738f03 Initial commit` (LICENSE ไม่ถูกทับ), raw data ถูก ignore (ตรวจ `git check-ignore`), push แผน `9eadb43` — ยืนยันด้วย `git ls-remote`
- **T-001** (`frontend-dev`) `web/`: Vite 6 + React 18.3 + TS 5.9 strict, ESLint strictTypeChecked, Prettier, Vitest+RTL, Playwright, Tailwind 3, alias `@/`, HashRouter + หน้า placeholder ไทย, `base` = `/thai-government-budget-planner/`, CSP meta inject ตอน build (`web/vite-plugins/cspMeta.ts`)
- **T-002** (`data-engineer`) `pipeline/`: pyproject + uv.lock, typer CLI stub 7 คำสั่ง (`inventory/extract/normalize/validate/publish/build/sample`), `config.yaml` + loader (env `TGBP_RAW_DATA_DIR`) + write-guard N6 (`assert_writable_path`)
- **T-003** `.githooks/pre-commit` (บล็อก `sk-ant-…`, ไฟล์ > 24 MB, `.env*`; ทดสอบมือ 4 เคส: secret/big/env = บล็อก, clean = ผ่าน), `core.hooksPath` ตั้งแล้ว, `.gitattributes` (eol=lf + binary), README เติม Build/Run; `.gitignore`/.env.example เดิมใช้ได้ ไม่ต้องแก้
- **T-004** `ci.yml` (jobs pipeline + web รวม e2e chromium + grep CSP ใน dist) และ `deploy.yml` (`workflow_run` หลัง ci สำเร็จบน main + manual; smoke manifest เป็น warning) — **CI run `35427487787` (commit `86d6c34`) เขียวทั้ง 2 jobs**; รอบแรกล้มที่ pytest เพราะ rich/typer ใส่ ANSI บน Actions → แก้ด้วย `pipeline/tests/conftest.py`; **deploy ล้มเพราะ Pages ยังไม่เปิด → `[ASK-HUMAN]` ข้อ 1**
- **T-005** (`po`) review: โครงตรง CLAUDE.md §4 ครบ, N1/N2/N5/N6/N7 ผ่าน; blocking ที่ po แจ้ง (STATUS/BACKLOG, ยืนยัน CI, ADR ของ CSP) ปิดแล้วใน commit นี้ → `docs/decisions/ADR-003-bootstrap-deviations.md`; รับข้อเสนอ: `requires-python <3.14`, CI push เฉพาะ `main`, เพิ่ม guard ใน T-306/T-307/T-605
- Test (รันจริงบนเครื่อง dev โดย main thread): web `lint` ✅ `typecheck` ✅ `vitest` 7/7 ✅ `build` ✅ (JS 60 KB gz) · e2e 1/1 ✅ (agent + CI) · pipeline `ruff check`/`format --check` ✅ `pytest` 15/15 ✅ (ทั้ง env ปกติและจำลอง `GITHUB_ACTIONS=true`)
- ค้าง: เปิด Pages (คน) → re-run deploy → ตรวจ URL จริง แล้วติ๊ก T-004
- ไม่ยืนยัน: ดูหัวข้อ Open questions (SSH, advisory router, action v5, Pages)

## 2569-09-19 14:45 (Asia/Bangkok) — Claude (Cowork) — Hosting
- ตัดสินใจ: deploy ด้วย GitHub Actions → GitHub Pages (`https://xzozero5.github.io/thai-government-budget-planner/`), HashRouter, base path, CSP meta, DuckDB eh build (ไม่มี COEP) → CLAUDE.md §3/5.1, 04 §D8, 07 §5, T-004/T-605; range request บน Pages `[UNVERIFIED]` วัดใน S1

## 2569-09-19 14:30 (Asia/Bangkok) — Claude (Cowork) — Git
- ตัดสินใจ: โค้ด + `web/public/data/**` อยู่ใน git `xzozero5/thai-government-budget-planner` (public, Apache-2.0, มี Initial commit + LICENSE แล้ว); raw data ไม่อยู่; ≤ 500 MB, ไม่ใช้ LFS → CLAUDE.md §5.1, T-000, T-003 (pre-commit), T-110
- ตรวจจากเครื่องคุณนิว: HTTPS `ls-remote` ถึง repo ได้ (main = 1738f03); SSH จาก sandbox นี้ไม่มี key (Permission denied) — Claude Code ในเครื่องจริงต้องใช้ key ของคุณนิว ยังไม่ยืนยันจนกว่าจะ push ครั้งแรก `[UNVERIFIED]`

## 2569-09-19 14:00 (Asia/Bangkok) — Claude (Cowork) — Requirement เพิ่ม
- citation จากเว็บ (Shopee ฯลฯ) ต้องกดเปิดแท็บใหม่ได้ทุกที่ + ใน PDF → US-4.3, 06 §4.3/4.4, A17, T-407/T-501

## 2569-09-19 13:30 (Asia/Bangkok) — Claude (Cowork) — Requirement เพิ่มจากคุณนิว
- UI flat+modern สีธงชาติไทย มีชีวิตชีวา → 06-UI-SPEC §1/§2 + motion.md, T-401/T-411
- ภาพประกอบโครงการใหญ่ → ตัดสินใจ **SVG จาก Claude เท่านั้น** (N9, 04 §D9, F7, T-309/T-412/T-504, spike S5)
- Trend chart สถิติ (ราคาเหล็ก ฯลฯ) → F8, tool get_price_trend, catalog/trends, econ series cmi_* (03 §3.5), T-207/T-412

## 2569-09-19 12:00 (Asia/Bangkok) — Claude (Cowork, วางแผนกับคุณนิว) — Planning
- สำรวจข้อมูลดิบจริง (318 ไฟล์ 3.2 GB) → `docs/02-DATA-INVENTORY.md`
- ยืนยัน scope กับคุณนิว: ผู้ใช้หลัก = ประชาชน/สื่อ/สส. ตรวจสอบงบ; ราคาตลาดผ่าน Claude web search tool; econ = snapshot JSON + web search เสริม; static site + shard ข้อมูล
- เขียน CLAUDE.md, docs/00–09, BACKLOG, agents, commands
- ค้าง: ทั้ง backlog
