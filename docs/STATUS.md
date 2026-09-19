# STATUS — สถานะโปรเจกต์ (Claude Code อัปเดตทุกครั้งที่ปิดงาน)

รูปแบบ entry: `## YYYY-MM-DD HH:MM (Asia/Bangkok) — <ใคร/agent> — <phase/task>` แล้วตามด้วย ทำอะไร / ไฟล์ที่แตะ / test / ค้าง / ไม่ยืนยัน

## สถานะปัจจุบัน
- Phase: **1 (data pipeline) กำลังทำ** — เสร็จ: T-101, T-102, T-104, T-111 (บางส่วน) · กำลังทำ: T-103 (รอบแก้หลัง hold-out), T-105 (PBO extract) · ถัดไป: T-106..T-109 (ขนาน) → T-110 → T-112 → T-113
- Phase 0: เสร็จ ยกเว้น AC สุดท้ายของ T-004 (รอคนเปิด Pages)
- Blockers: ไม่มี
- `[ASK-HUMAN]` ค้าง: **ข้อ 1 — เปิด GitHub Pages**: repo → Settings → Pages → Build and deployment → Source = **GitHub Actions** แล้ว re-run workflow `deploy` — main thread ไม่มี `gh`/token จึงเปิดเองไม่ได้ (deploy run `35427525874` ล้มที่ `actions/configure-pages`: "Get Pages site failed … Not Found")

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
