# 00 — START HERE: วิธีให้ Claude Code ทำโปรเจกต์นี้

เอกสารชุดนี้ถูกเขียนให้ Claude Code (main thread) อ่านแล้วลงมือได้ทันที โดยไม่ต้องถามคนเพิ่ม ยกเว้นจุดที่ระบุว่า `[ASK-HUMAN]`

## ลำดับการอ่าน (ครั้งแรกเท่านั้น)

1. `CLAUDE.md` — กฎและ stack
2. `docs/01-PRD.md` — ทำอะไร เพื่อใคร วัดผลอย่างไร
3. `docs/02-DATA-INVENTORY.md` — ข้อมูลดิบมีอะไร (สำรวจแล้ว 19 ก.ย. 2569)
4. `docs/04-ARCHITECTURE.md` — ภาพรวมระบบ
5. `docs/BACKLOG.md` — งานเรียงลำดับ
6. ที่เหลืออ่านเมื่อถึง phase นั้น

## Phases และคำสั่ง

| Phase | ชื่อ | slash command | เอกสารหลัก | agent หลัก | ผลลัพธ์ที่ต้องได้ |
|---|---|---|---|---|---|
| 0 | Bootstrap repo | `/phase-0-bootstrap` | CLAUDE.md §4-5 | `frontend-dev`, `data-engineer` | โครง repo, lint/test รันได้, CI script |
| 1 | Data pipeline | `/phase-1-data` | 03-DATA-PIPELINE.md | `data-engineer` (+`po` review) | `public/data/**` + `manifest.json` + validation report |
| 2 | Architecture & data access layer | `/phase-2-arch` | 04-ARCHITECTURE.md | `architect`, `frontend-dev` | DuckDB/MiniSearch client + tests, ADR ที่จำเป็น |
| 3 | AI layer | `/phase-3-ai` | 05-FEATURES.md §3-6 | `ai-engineer`, `po` | agent loop, tools, system prompt, citation model, eval set ผ่าน |
| 4 | UI | `/phase-4-ui` | 06-UI-SPEC.md | `ui-designer` → `frontend-dev` | หน้าจอครบ, responsive, a11y พื้นฐาน |
| 5 | PDF export | `/phase-5-export` | 05-FEATURES.md F5 + 04 §D6 | `frontend-dev` | PDF ไทยถูกต้อง มี citation appendix |
| 6 | QA & hardening | `/phase-6-qa` | 07-TESTING.md, 08-QA-CHECKLIST.md, 09-SECURITY.md | `qa-engineer`, `security-reviewer` | e2e ผ่าน, checklist ติ๊กครบ, release notes |

Phase 1 กับ Phase 2-3 (ส่วนที่ไม่พึ่งข้อมูลจริง) ทำ **ขนานกัน** ได้ — ใช้ fixture ข้อมูลเล็ก ๆ (`web/tests/fixtures/data/`) ที่ pipeline สร้างจาก sample 1,000 แถวก่อน

## Subagents (`.claude/agents/`)

| agent | model | บทบาท | ใช้เมื่อ |
|---|---|---|---|
| `po` | opus | Product Owner — ตรวจว่างานตรง PRD/AC, เขียน/ปรับ backlog, ตัดสิน scope | ก่อนเริ่มและหลังจบทุก phase |
| `architect` | opus | ออกแบบ/ทบทวน architecture, เขียน ADR, ตรวจ boundary ระหว่าง module | phase 2, เมื่อจะเบี่ยงจากแบบ |
| `data-engineer` | sonnet | เขียน pipeline Python, schema, validation, ลดขนาดข้อมูล | phase 1 |
| `ai-engineer` | sonnet | Anthropic SDK, tool definitions, system prompt, agent loop, eval | phase 3 |
| `ui-designer` | opus | design tokens, layout, copy ภาษาไทย, states (empty/loading/error) | ต้น phase 4 |
| `frontend-dev` | sonnet | implement React/TS ตาม spec, unit tests | phase 0, 2, 4, 5 |
| `qa-engineer` | sonnet | e2e Playwright, exploratory test, bug report | phase 6 และ regression หลังทุก phase |
| `security-reviewer` | opus | ตรวจ key handling, CSP, dependency, data leak | phase 3 และ 6 |
| `explorer` | haiku | อ่านโค้ด/ข้อมูลจำนวนมากแล้วสรุปสั้น (read-only) | ทุกครั้งที่ต้อง "ไปดูให้หน่อยว่า..." |

หลักการ delegate:
- **Main thread = ผู้ตัดสินใจและผู้เขียนไฟล์สำคัญ** (docs, ADR, STATUS, การ merge)
- งาน implement ยาว ๆ ให้ agent ทำ แล้วรายงานกลับเป็น: สิ่งที่ทำ / ไฟล์ที่แตะ / test ผล / สิ่งที่ยังไม่ยืนยัน
- ให้ agent อ่านเอกสาร phase ของตัวเองเท่านั้น + CLAUDE.md (ประหยัด context)
- รันหลาย agent พร้อมกันได้เมื่องานไม่แตะไฟล์เดียวกัน (เช่น `data-engineer` ทำ pipeline ขณะ `frontend-dev` ทำ bootstrap web)

## Definition of Done (ทุก task)

- [ ] โค้ด + test ผ่าน (`npm run test` / `pytest`), lint/typecheck ผ่าน
- [ ] ไม่ละเมิด Non-negotiables N1-N8 ใน CLAUDE.md
- [ ] อัปเดต `docs/STATUS.md` และติ๊ก `docs/BACKLOG.md`
- [ ] สิ่งที่ยังไม่ยืนยันติดป้าย `[UNVERIFIED]` และอยู่ในหัวข้อ "Open questions" ของ STATUS.md
- [ ] ถ้ามีการตัดสินใจใหม่ → ADR

## `[ASK-HUMAN]` — จุดที่ต้องหยุดถามคน

1. ครั้งแรกที่ต้องเปิด GitHub Pages (Settings → Pages → Source = GitHub Actions) — Claude Code ทำผ่าน UI ไม่ได้ (ลอง `gh api` ก่อน ถ้าไม่มีสิทธิ์ค่อยถาม)
2. ถ้า pipeline พบว่าข้อมูลชุดใดขัดแย้งกันเองมากจนต้องเลือกทิ้ง
3. ถ้าค่าใช้จ่าย API ต่อ session ทดสอบเกิน ~2 USD/ครั้ง (ควรปรับ context/tool budget ก่อน)
4. การเพิ่ม dependency ที่มี network access อื่นนอกจาก `api.anthropic.com`
5. ต้องการ Anthropic API key เพื่อรัน eval (Phase 3/6) แต่ไม่มี `web/.env.local` — เตรียม runner ให้พร้อมแล้วหยุดถาม ห้ามใช้ key จากที่อื่น
6. push ไป GitHub ไม่ได้ (SSH/HTTPS auth) หรือ `web/public/data/` ลดให้ ≤ 500 MB ไม่ได้

นอกเหนือจากนี้ ให้ตัดสินใจเอง เขียนเหตุผลลง STATUS.md/ADR แล้วเดินต่อ
