# Thai Government Budget Planner (TGBP) — MVP

Web app (static, no backend) ที่ให้ผู้ใช้ใส่ Anthropic API key ของตัวเอง แล้วคุยกับ AI เพื่อสร้าง
ข้อเสนอโครงการ + รายการค่าใช้จ่าย โดยอ้างอิง **งบประมาณจริงย้อนหลัง 11 ปี** (PBO, ร่าง พ.ร.บ. 2570, ข้อบัญญัติ อปท., เอกสาร กมธ.)
ทุกตัวเลขมี citation ชี้กลับไฟล์/ชีต/แถว/หน้า และ export PDF ได้

**สถานะ: Phase 0 (bootstrap) เสร็จ — ดูล่าสุดที่ `docs/STATUS.md`** → เริ่มที่ `CLAUDE.md` แล้ว `docs/00-START-HERE.md`

## โครงสร้าง
- `CLAUDE.md` — กฎ, stack, conventions (อ่านก่อน)
- `docs/` — PRD, data inventory, pipeline spec, architecture, features/AI tools, UI spec, testing, QA, security, backlog, status
- `.claude/agents/` — subagents (po, architect, data-engineer, ai-engineer, ui-designer, frontend-dev, qa-engineer, security-reviewer, explorer)
- `.claude/commands/` — `/phase-0-bootstrap` … `/phase-6-qa`, `/status`, `/review`
- `เพราะ AI ไม่ใช่แค่ CHATBOT/` — ข้อมูลดิบ (read-only, ไม่ commit)
- `pipeline/` — Python ETL (offline, รันบนเครื่อง dev เท่านั้น) · `web/` — Vite React-TS app (static site)
- `.github/workflows/` — `ci.yml` (ทุก push/PR), `deploy.yml` (GitHub Pages หลัง ci ผ่านบน `main`)
- `.githooks/pre-commit` — บล็อก `sk-ant-…`, ไฟล์ > 24 MB, `.env*`

## Repository
`https://github.com/xzozero5/thai-government-budget-planner.git` (หรือ SSH `git@github.com:xzozero5/thai-government-budget-planner.git`) — โค้ด + public data (`web/public/data/`) อยู่ใน git; ข้อมูลดิบไม่อยู่ (ดู CLAUDE.md §5.1)

## Deploy
GitHub Actions → GitHub Pages: `https://xzozero5.github.io/thai-government-budget-planner/` (push `main` แล้ว deploy อัตโนมัติ; ครั้งแรกต้องตั้ง Settings → Pages → Source = GitHub Actions)

## Build / Run
หลัง clone ครั้งแรก:
```bash
git config core.hooksPath .githooks
```
Web (Node 22+):
```bash
cd web && npm ci
npm run dev                          # http://localhost:5173/thai-government-budget-planner/
npm run lint && npm run typecheck && npm run test && npm run build
npx playwright install chromium      # ครั้งแรก
npm run test:e2e
```
Pipeline (Python 3.11+, [uv](https://docs.astral.sh/uv/)) — ถ้า `uv` ไม่อยู่ใน PATH: `python -m pip install --user uv` แล้วใช้ `python -m uv` แทน `uv`; บน Windows ตั้ง `PYTHONUTF8=1` ก่อนรันคำสั่งที่พิมพ์ภาษาไทย:
```bash
cd pipeline && uv sync
uv run tgbp --help
uv run ruff check . && uv run ruff format --check . && uv run pytest
```
ข้อมูลดิบ (`เพราะ AI ไม่ใช่แค่ CHATBOT/`) ต้องวางที่ root ของ repo เอง — ไม่อยู่ใน git; pipeline อ่านอย่างเดียว เขียน output ไป `web/public/data/`

### สร้างข้อมูลใหม่ (regenerate data)
```bash
cd pipeline
uv run tgbp build --dataset all      # ~12 นาที, deterministic: extract → normalize → validate (V1–V9) → publish
                                     # → web/public/data/ (manifest, shards, catalog, trends, docs, econ, ดัชนีค้นหา)
                                     # hard validation fail = exit code ≠ 0 และไม่ publish
uv run tgbp validate                 # รันเฉพาะ validation ซ้ำ → validation.json
```
ตรวจ `git diff --stat web/public/data` แล้ว commit เป็น commit แยก (`data: …`) — `data_version` ใน `manifest.json` จะเปลี่ยนเมื่อเนื้อหา shard เปลี่ยน

### Eval ของ AI (ใช้เงินจริง — อ่าน `docs/api-budget.md` ก่อน)
```bash
cd web
npm run eval                         # dry-run (fake client, ไม่เสียเงิน)
npm run eval -- --real --confirm-spend --tier core8 --max-usd 1.80   # ยิง API จริง: key จาก web/.env.local, ledger ที่ tests/eval/api-spend.json
npm run guard:n2                     # ยืนยันว่า key ของ eval ไม่ถูก inline เข้า bundle
```

### ใช้งานเว็บ
เปิด `https://xzozero5.github.io/thai-government-budget-planner/` → ใส่ API key ของ Anthropic (อยู่ในหน่วยความจำของแท็บเท่านั้น) → เล่าโครงการ → ได้ข้อเสนอ + BOQ ที่ทุกตัวเลขคลิกดูที่มาได้ → ส่งออก PDF หรือบันทึก `.tgbp.json` (เปิดดูภายหลังที่ `#/load` ได้โดยไม่ต้องใช้ key) — ข้อจำกัดของข้อมูลดูที่หน้า "เกี่ยวกับเว็บนี้"
**หมายเหตุ**: ทุกครั้งที่ deploy เวอร์ชันใหม่ แท็บที่เปิดค้างไว้ควรบันทึกงานแล้วรีเฟรช (ไฟล์ JS ของเวอร์ชันเดิมถูกแทนที่)

## เริ่มต้น (Claude Code)
```
claude
> /phase-0-bootstrap    # จะทำ T-000 (git init + remote + push แผน) ก่อน
```
แล้วไล่ `/phase-1-data` → `/phase-6-qa` ตาม `docs/00-START-HERE.md` (`/status` เพื่อดูว่าอยู่ตรงไหน)

## สิ่งที่ต้องเตรียมเอง
- Python 3.11+ และ [uv](https://docs.astral.sh/uv/) (หรือ pip), Node 22+, poppler (`pdftotext`, `pdfinfo`), LibreOffice (แปลง .xls เก่า)
- Anthropic API key สำหรับรัน eval (ใส่ใน `web/.env.local` ห้าม commit)
