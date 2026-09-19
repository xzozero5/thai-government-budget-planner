# Thai Government Budget Planner (TGBP) — MVP

Web app (static, no backend) ที่ให้ผู้ใช้ใส่ Anthropic API key ของตัวเอง แล้วคุยกับ AI เพื่อสร้าง
ข้อเสนอโครงการ + รายการค่าใช้จ่าย โดยอ้างอิง **งบประมาณจริงย้อนหลัง 11 ปี** (PBO, ร่าง พ.ร.บ. 2570, ข้อบัญญัติ อปท., เอกสาร กมธ.)
ทุกตัวเลขมี citation ชี้กลับไฟล์/ชีต/แถว/หน้า และ export PDF ได้

**สถานะ: วางแผนเสร็จ — รอ Claude Code ลงมือ** → เริ่มที่ `CLAUDE.md` แล้ว `docs/00-START-HERE.md`

## โครงสร้าง
- `CLAUDE.md` — กฎ, stack, conventions (อ่านก่อน)
- `docs/` — PRD, data inventory, pipeline spec, architecture, features/AI tools, UI spec, testing, QA, security, backlog, status
- `.claude/agents/` — subagents (po, architect, data-engineer, ai-engineer, ui-designer, frontend-dev, qa-engineer, security-reviewer, explorer)
- `.claude/commands/` — `/phase-0-bootstrap` … `/phase-6-qa`, `/status`, `/review`
- `เพราะ AI ไม่ใช่แค่ CHATBOT/` — ข้อมูลดิบ (read-only, ไม่ commit)
- `pipeline/`, `web/` — จะถูกสร้างใน Phase 0

## Repository
`git@github.com:xzozero5/thai-government-budget-planner.git` — โค้ด + public data (`web/public/data/`) อยู่ใน git; ข้อมูลดิบไม่อยู่ (ดู CLAUDE.md §5.1)

## Deploy
GitHub Actions → GitHub Pages: `https://xzozero5.github.io/thai-government-budget-planner/` (push `main` แล้ว deploy อัตโนมัติ; ครั้งแรกต้องตั้ง Settings → Pages → Source = GitHub Actions)

## เริ่มต้น (Claude Code)
```
claude
> /phase-0-bootstrap    # จะทำ T-000 (git init + remote + push แผน) ก่อน
```
แล้วไล่ `/phase-1-data` → `/phase-6-qa` ตาม `docs/00-START-HERE.md` (`/status` เพื่อดูว่าอยู่ตรงไหน)

## สิ่งที่ต้องเตรียมเอง
- Python 3.11+ และ [uv](https://docs.astral.sh/uv/) (หรือ pip), Node 22+, poppler (`pdftotext`, `pdfinfo`), LibreOffice (แปลง .xls เก่า)
- Anthropic API key สำหรับรัน eval (ใส่ใน `web/.env.local` ห้าม commit)
