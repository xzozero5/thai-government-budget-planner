# STATUS — สถานะโปรเจกต์ (Claude Code อัปเดตทุกครั้งที่ปิดงาน)

รูปแบบ entry: `## YYYY-MM-DD HH:MM (Asia/Bangkok) — <ใคร/agent> — <phase/task>` แล้วตามด้วย ทำอะไร / ไฟล์ที่แตะ / test / ค้าง / ไม่ยืนยัน

## สถานะปัจจุบัน
- Phase: **2 กำลังทำ** — `architect` T-201 spikes S1–S5 (ใน `web/spikes/` แยก npm project) ∥ `frontend-dev` T-202 (types + manifest loader จาก fixture จริง) → แล้ว T-203/T-204/T-205/T-207 → T-206 · Phase 1 **เสร็จ** (T-101..T-115; `po` review ผ่าน)
- Phase 0: เสร็จทั้งหมด (Pages live)
- ข้อมูลที่ publish: `data_version cd15fb2dd39b…` — **2,993,621 แถว / 794 ไฟล์ / 180.6 MB** (งบ 500 MB), ไฟล์ใหญ่สุด 6.17 MB; `tgbp build --dataset all` = 12 นาที, deterministic (main thread รันเต็มเองได้ `data_version` เดียวกับ agent)
- Test ล่าสุด (main thread รันเอง ณ `1f5e464`): pipeline **pytest 437 passed**, ruff check/format ผ่าน; web ไม่เปลี่ยน (vitest 7/7 ณ Phase 0); **CI ของ `eea8632` เขียว + deploy สำเร็จ** — Pages เสิร์ฟ `data_version cd15fb2dd39b` (794 ไฟล์); `budget_lines/pbo/2564/20000.parquet` ตอบ Range ด้วย **206** (7,492 bytes / 53 ms); `*.json.gz` เสิร์ฟเป็น `application/gzip` ไม่มี `Content-Encoding` → client ต้อง gunzip เอง
- Blockers: ไม่มี · `[ASK-HUMAN]` ค้าง: ไม่มี
- **แจ้งคุณนิว (ไม่บล็อก)**: (1) ADR-004 `PBO/2562.xlsx` ต้นทางไม่ครบ (coverage 79.24 %, ขาด 6 กระทรวง) — ถ้ามีไฟล์ฉบับครบนำมาแทนแล้วรัน `tgbp build` ใหม่ (2) ADR-005 ราชาเทวะ: ตัวเลขมาจาก OCR ของต้นทาง ไม่ตรงยอดในเอกสาร 10/38 กลุ่ม → V3 เป็น soft + flag (3) econ ยังไม่มีราคาน้ำมัน/ค่าแรงขั้นต่ำรายปี; ทุกค่า `verified:false` (4) ราคาต่อหน่วยมีแค่ ~3 % ของแถว PBO (ชื่อรายการส่วนใหญ่ไม่ระบุจำนวน)
- กติกาจากบทเรียน: (1) ตรวจซ้ำรายงาน agent ทุกครั้งก่อน commit (2) ห้าม `git stash/checkout` ขณะมี agent แก้ไฟล์ (3) test ห้ามเขียนลง `.cache`/`web/public/data` จริง (4) commit data หลัง review ผ่านเท่านั้น (กัน history บวม)

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
