# STATUS — สถานะโปรเจกต์ (Claude Code อัปเดตทุกครั้งที่ปิดงาน)

รูปแบบ entry: `## YYYY-MM-DD HH:MM (Asia/Bangkok) — <ใคร/agent> — <phase/task>` แล้วตามด้วย ทำอะไร / ไฟล์ที่แตะ / test / ค้าง / ไม่ยืนยัน

## สถานะปัจจุบัน
- Phase: **0 เสร็จ (เหลือเปิด GitHub Pages โดยคน)** → ถัดไป **Phase 1** `/phase-1-data` (ขนานกับส่วนของ Phase 2 ที่ไม่พึ่งข้อมูลจริงได้หลัง T-112)
- งานถัดไป: T-101 (inventory) → T-102/T-103/T-104 → T-105…
- Blockers: ไม่มีสำหรับ Phase 1; T-004 ค้างเฉพาะ AC "หน้า placeholder ขึ้นบน URL จริง"
- `[ASK-HUMAN]` ค้าง: **ข้อ 1 — เปิด GitHub Pages**: repo → Settings → Pages → Build and deployment → Source = **GitHub Actions** แล้ว re-run workflow `deploy` (Actions → deploy → Run workflow) — main thread ไม่มี `gh`/token จึงเปิดเองไม่ได้ (deploy run `35427525874` ล้มที่ `actions/configure-pages`: "Get Pages site failed … Not Found")

## Open questions / `[UNVERIFIED]` ที่ยังค้าง
- โครงสร้างไฟล์ A3 (subset จังหวัดอื่น ๆ), A4 (อบจ. สป., ทน. ชม.), A5 (xlsx/xls ใน กมธ.) — ยืนยันใน T-101/T-106..T-108
- ขนาดข้อมูลหลัง compact (02 §E) — วัดจริงใน T-110
- ราคา API ต่อ token ของแต่ละ model (T-301) — ต้องเช็คจาก docs.claude.com ตอน implement
- DuckDB-WASM range request บน host เป้าหมาย — S1 ใน T-201
- SSH push จากเครื่องคุณนิว: **ไม่ผ่าน** (`Host key verification failed`) → ใช้ HTTPS remote แทน (ยืนยันแล้วว่า push ได้ รวมไฟล์ workflow) — ADR-003 ข้อ 3
- advisory ของ react-router-dom 6.x ที่เป็นเหตุให้ใช้ 7.x — มาจาก `npm audit` ของ agent ยังไม่ได้ตรวจเลข advisory เอง `[UNVERIFIED]` (ADR-003 ข้อ 6)
- เวอร์ชัน action `actions/checkout@v5`, `actions/setup-node@v5` — bump เพื่อเลี่ยง warning Node 20; ยืนยันเมื่อ CI ของ commit ปิด Phase 0 เขียว `[UNVERIFIED จนกว่า run ถัดไปผ่าน]`
- GitHub Pages: ยังไม่เปิด → CSP meta/Accept-Ranges บน URL จริงยังไม่ได้วัด (T-004 AC สุดท้าย, S1, T-605)

## Log

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
