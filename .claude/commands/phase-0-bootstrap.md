---
description: Phase 0 — bootstrap repo (web/ + pipeline/ + CI + gitignore)
---
เริ่ม Phase 0 ของ TGBP ตาม `docs/BACKLOG.md` (T-001..T-005)

1. อ่าน `CLAUDE.md` §3–5.1 และ `docs/00-START-HERE.md`
1.5 ทำ T-000 เอง (main thread): git init, remote origin = git@github.com:xzozero5/thai-government-budget-planner.git, checkout main จาก origin (มี LICENSE อยู่แล้ว), ตรวจ .gitignore ครอบโฟลเดอร์ข้อมูลดิบ, commit แผน, push — ยืนยันด้วย `git ls-remote origin` ว่า commit ขึ้นแล้ว
2. รัน **ขนานกัน**: subagent `frontend-dev` ทำ T-001, subagent `data-engineer` ทำ T-002 (ไม่แตะไฟล์เดียวกัน)
3. เมื่อทั้งสองกลับมา: main thread ทำ T-003, T-004 เอง (ไฟล์ root)
4. เรียก `po` ทำ T-005 review โครงกับ CLAUDE.md §4
5. รัน `cd web && npm run lint && npm run typecheck && npm run test && npm run build` และ `cd pipeline && uv run ruff check . && uv run pytest` ให้ผ่าน
6. อัปเดต `docs/STATUS.md` (เวลา Asia/Bangkok) + ติ๊ก BACKLOG แล้ว commit `chore: bootstrap web/pipeline/ci`
