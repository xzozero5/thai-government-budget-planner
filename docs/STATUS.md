# STATUS — สถานะโปรเจกต์ (Claude Code อัปเดตทุกครั้งที่ปิดงาน)

รูปแบบ entry: `## YYYY-MM-DD HH:MM (Asia/Bangkok) — <ใคร/agent> — <phase/task>` แล้วตามด้วย ทำอะไร / ไฟล์ที่แตะ / test / ค้าง / ไม่ยืนยัน

## สถานะปัจจุบัน
- Phase: **1 (data pipeline) — PAUSED 2569-09-19 ~19:00** (คุณนิวสั่งพักเพราะใกล้ติด usage limit; กลับมาทำต่อได้ทันที)
- เสร็จ + commit แล้ว: T-101, T-102, T-103, T-104, T-105, T-111 (บางส่วน — ขาดน้ำมัน/ค่าแรง)
- **ค้างกลางทาง (ยังไม่ commit, ไฟล์อยู่บนดิสก์)** — 4 agents ถูกสั่งหยุดที่ safe point:
  - T-106 `extract/act2570.py` + `tests/extract/test_act2570.py` → cache `.cache/act2570/`
  - T-107 `extract/local_sheets.py` + `tests/extract/test_local_sheets.py` → `.cache/local/`
  - T-108 `extract/committee_xlsx.py`, `extract/office_text.py` + tests → `.cache/committee/`, `.cache/docs/`
  - T-109 `extract/pdf_text.py` + `tests/extract/test_pdf_text.py` → `.cache/docs/` (+ `_pdf_report.json`, `_pdf_index.json`; resume ได้)
  - กติกาที่ให้ไว้: ห้ามแตะ `cli.py`/`schema.py`/`validate.py`/`pyproject.toml`/`conftest.py`; แต่ละตัว export `extract_<x>(cfg, *, cache_dir=None)`; test ต้องเขียนลง `tmp_path` เท่านั้น
- **วิธีทำต่อ (main thread)**: (1) `git status` ดูไฟล์ untracked ใต้ `pipeline/` (2) ต่อ task: รัน `ruff check` + `pytest tests/extract/test_<x>.py`, เปิดดูรายงาน/ cache, **ตรวจซ้ำเองกับไฟล์จริง** (agent เคยรายงานคลาดเคลื่อน 3 ครั้ง: test isolation, cache 2566 ถูกทับ, fixture 100 % แบบวงกลม) แล้วค่อย commit ทีละ task (3) wire `tgbp extract --dataset act2570|local|committee|office|pdf|all` ใน `cli.py` + ย้าย `check_v2`/`check_v3` เข้า `validate.py` (4) T-110: normalize stage (item_parser + org_master กับ 2.9 ล้านแถว — ใช้ multiprocessing/ cache ต่อ distinct name), validate V1–V10, publish (shards < 24 MB, catalog, trends, facets + `coverage_notes` จาก ADR-004, orgs, docs chunks, econ series view, manifest sha256, อัปเดต `sources.json.extracted/text_chunks_file`), รัน `tgbp build --dataset all` จริง, วัดขนาดรวม ≤ 500 MB → 02 §E (5) T-112 sample fixtures (6) T-113 po review (7) STATUS/BACKLOG + commit `pipeline: phase 1 complete`
- **สถานะจริง ณ จุด pause + ข้อค้นพบที่ agent รายงาน (ยังไม่ได้ตรวจซ้ำโดย main thread → `[UNVERIFIED]` ทั้งหมด)**:
  - **T-106**: ยังไม่มีไฟล์โค้ด (ออกแบบเสร็จ). พบ: ไฟล์ A2 ตัวหลักตาม dedupe = สำเนาใน `งบประมาณ สมุทรปราการ/` (`ส` มาก่อน `เ`); A3 มี 6 ไฟล์ — **มีแค่ 1 ไฟล์** (`เชียงใหม่/1`) ที่มี title "575 รายการ | งบรวม 9,043,395,000 บาท"; อีก 5 ไฟล์เป็น sheet `Data` header แถว 1 แบบ field code ของ A2 ไม่มี title → V2 ต้องเป็น `no_oracle`; ไฟล์ format A มีแถวว่าง 404 + แถว "รวมทั้งหมด" 1 → ต้องข้ามแถวที่ `รายการ` ว่าง มิฉะนั้นยอดเบิ้ล 2 เท่า; `เชียงใหม่/4` ใช้ `objc_8` + มีคอลัมน์ จังหวัด/อำเภอ/ตำบล และ `min` เป็น int ปน str; filter A2 ด้วย "เชียงใหม่" ได้ 680 แถวเพราะติด อ.ศรีเชียงใหม่ (หนองคาย)
  - **T-107**: `extract/local_sheets.py` เขียนครบ (ผ่าน `ast.parse`), ยังไม่มี test/ยังไม่รันจริง. พบ: มี 4 ไฟล์ — ราชาเทวะ 345 แถว/11 sheets; อบจ. ชม. `Data` 1,027 แถว (มีทั้ง `Divison` ว่างล้วน และ `Division`); **อบจ. สมุทรปราการ ไม่เหมือน อบจ. ชม.** — 4 sheets คนละทรง ใช้ได้เฉพาะ `โครงการรวม งบ 70` (577 แถว); ทน. ชม. `ชีต1` 700 แถว ตรงกับ `_หมายเหตุ`; คอลัมน์ `FCY` **ไม่ใช่ปีงบ** (เป็นโน้ต/ชื่อชุมชน); `BudgetLine` ไม่มี field `source_pdf_doc_id` → ใช้ `.cache/local/pdf_pairs.json`
  - **T-108**: `extract/office_text.py` (มี `DocChunk`, `chunk_atoms`, `write_doc_chunks_gz` — **T-109 ต้อง reuse**) + `extract/committee_xlsx.py` เขียนครบ ผ่าน ruff, รันจริงแล้ว 1 รอบ, **ยังไม่มี test**. พบ: 26 ไฟล์ xlsx/xls — map เป็น budget_lines ได้ไฟล์เดียว (`กองทุนอนุรักษ์พลังงาน/รวมข้อมูลโครงการ 61-68` 3,328 แถว; sheet "ปี 68" ถูกตัดเพราะไม่รู้หน่วยเงิน); อีก 25 ไฟล์เป็นแบบฟอร์ม BIS → DocChunk; `องค์การโคนม/BI*.XLS` 13 ไฟล์ เป็น zip (xlsx) แต่ openpyxl ไม่เปิด — main thread สงสัยว่า openpyxl ปฏิเสธจาก**นามสกุลไฟล์** ให้ลองเปิดผ่าน file object (`open(path,'rb')`)
  - **T-109**: ยังไม่มีไฟล์โค้ด (สำรวจเสร็จ). พบ: PDF เข้าเกณฑ์ 114 ไฟล์ (~9,428 หน้า, ไม่มีไฟล์ > 100 MB); ตาราง OPEN SSO (label/value เหลื่อมแถว) และ `2_ราคากลาง21.pdf` (ราคากลาง 2 ความหมาย) โครงไม่ชัด → **ไม่ map เป็น committee_table** ปล่อยเป็น DocChunk; ต้องทำ Thai PUA (U+F700–F71A) mapping; มีไฟล์อ้างอิงชั่วคราว `pipeline/.cache/_ref_fix_thai_pdf.py` (ลบได้)
  - resume agent เดิมได้ด้วย SendMessage ถ้า session เดิมยังอยู่; ถ้าเป็น session ใหม่ให้สั่ง `data-engineer` ใหม่พร้อมข้อค้นพบข้างบน
- Phase 0: เสร็จ ยกเว้น AC สุดท้ายของ T-004 (รอคนเปิด Pages)
- Blockers: ไม่มี
- `[ASK-HUMAN]` ค้าง: **ข้อ 1 — เปิด GitHub Pages**: repo → Settings → Pages → Build and deployment → Source = **GitHub Actions** แล้ว re-run workflow `deploy` — main thread ไม่มี `gh`/token จึงเปิดเองไม่ได้
- แจ้งคุณนิว (ไม่บล็อก): `PBO/2562.xlsx` ต้นทางไม่ครบ (coverage 79.24 %, ขาด 6 กระทรวง) → ADR-004; ถ้ามีไฟล์ฉบับครบให้นำมาแทน

## Open questions / `[UNVERIFIED]` ที่ยังค้าง
- โครงสร้างไฟล์ A3 (subset จังหวัดอื่น ๆ), A4 (อบจ. สป., ทน. ชม.), A5 (xlsx/xls ใน กมธ.) — ยืนยันใน T-101/T-106..T-108
- ขนาดข้อมูลหลัง compact (02 §E) — วัดจริงใน T-110
- econ: ยังไม่มี `diesel_avg_thb_per_l`, `gasoline95_avg_thb_per_l` (EPPO มีแต่ราคารายวัน/หน้า JS), `min_wage_bangkok_thb` มีแค่ปี 2568, `min_wage_avg_thb` ไม่มีค่าทางการ → คง `null`; **ทุกค่า econ `verified:false` `[UNVERIFIED]`** จนกว่าคนจะตรวจ (`docs/econ-sources.md`)
- `sources.json.fiscal_years` เป็น heuristic จากชื่อไฟล์/โฟลเดอร์ ยังพลาดบางแบบ ("ปี 66-68" ได้แค่ 2566; วันที่ในชื่อไฟล์ถูกนับเป็นปีงบ) `[UNVERIFIED]` — แก้เมื่ออ่านเนื้อหาจริงใน T-109
- `item_parser`: fixture 200 เคสแรกให้ 100 % แต่ label เอนตาม parser — ตัวเลขที่เชื่อได้คือ hold-out (รอรอบแก้ T-103)
- ราคา API ต่อ token ของแต่ละ model (T-301) — ต้องเช็คจาก docs.claude.com ตอน implement
- DuckDB-WASM range request บน host เป้าหมาย — S1 ใน T-201
- SSH push จากเครื่องคุณนิว: **ไม่ผ่าน** (`Host key verification failed`) → ใช้ HTTPS remote แทน (ยืนยันแล้วว่า push ได้ รวมไฟล์ workflow) — ADR-003 ข้อ 3
- advisory ของ react-router-dom 6.x ที่เป็นเหตุให้ใช้ 7.x — มาจาก `npm audit` ของ agent ยังไม่ได้ตรวจเลข advisory เอง `[UNVERIFIED]` (ADR-003 ข้อ 6)
- GitHub Pages: ยังไม่เปิด → CSP meta/Accept-Ranges บน URL จริงยังไม่ได้วัด (T-004 AC สุดท้าย, S1, T-605)

## Log

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
