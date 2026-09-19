# ADR-003 — ข้อเบี่ยงจากแผนตอน bootstrap (Phase 0)

> หมายเลข: ADR-001 = `docs/04-ARCHITECTURE.md`; ADR-002 จองไว้สำหรับ fallback range request (04 §D3/§6 S1) จึงใช้ 003

- **Status**: Accepted — 2569-09-19 (main thread; `po` review T-005 เห็นชอบ)
- **Links**: CLAUDE.md §3/§5.1, 04 §D8, 07 §5, BACKLOG T-000..T-004

## Context
ระหว่าง Phase 0 พบข้อจำกัดของเครื่อง dev / ecosystem ปัจจุบันที่ทำให้ต้องเลือกต่างจากข้อความในแผนเล็กน้อย ไม่มีข้อใดกระทบ Non-negotiables N1–N9

## Decisions

| # | แผนเดิม | ที่ทำจริง | เหตุผล | ผลตามมา |
|---|---|---|---|---|
| 1 | CSP meta ตาม 04 §D8 รวม `frame-ancestors 'none'` | ตัด `frame-ancestors` ออกจาก meta (`web/vite-plugins/cspMeta.ts`) | spec CSP: directive นี้ **ถูกเพิกเฉยใน `<meta>`** และ browser พ่น console warning; GitHub Pages ตั้ง HTTP header ไม่ได้ (04 §D8 ระบุข้อจำกัดนี้เองแล้ว) | ไม่มีการป้องกัน clickjacking ระดับ header บน Pages — ความเสี่ยงต่ำ (ไม่มี session/cookie; key อยู่ใน memory) ให้ `security-reviewer` ประเมินซ้ำใน T-307/T-602 และบันทึกใน T-605 |
| 2 | CSP meta อยู่ใน `index.html` ตรง ๆ | inject เฉพาะตอน `vite build` ผ่าน plugin + unit test + CI grep `dist/index.html` | Vite dev server ต้องใช้ inline script/WebSocket (HMR) ซึ่งชน CSP นี้ | dev ไม่มี CSP → ปัญหา CSP จะเห็นใน `vite preview`/e2e/production เท่านั้น — e2e (Playwright) ต้องรันกับ build จริง |
| 3 | remote SSH `git@github.com:…` | remote **HTTPS** `https://github.com/xzozero5/thai-government-budget-planner.git` | SSH บนเครื่องนี้ `Host key verification failed` (ไม่มี github.com ใน known_hosts) — ไม่แก้ config ความปลอดภัยของเครื่องผู้ใช้เอง; HTTPS ผ่าน credential manager push ได้ (รวมไฟล์ workflow) | ตรง fallback ที่ T-000 ระบุไว้ |
| 4 | `uv` ใน PATH | ติดตั้งด้วย `python -m pip install --user uv` เรียกผ่าน `python -m uv …`; ตั้ง `PYTHONUTF8=1` เมื่อพิมพ์ภาษาไทยบน Windows console (cp1252) | เครื่อง dev ไม่มี uv; stdout เริ่มต้นไม่ใช่ UTF-8 | บันทึกใน README; CI ใช้ `astral-sh/setup-uv` ปกติ |
| 5 | Python "3.11+" | local = 3.13.2, CI = 3.11; `requires-python = ">=3.11,<3.14"` | ใช้ interpreter ที่มีบนเครื่อง; CI เป็นตัวจับความต่างเวอร์ชัน | pandas resolve เป็น 3.x — โค้ด pipeline ต้องไม่พึ่งพฤติกรรม pandas 2.x ที่เลิกแล้ว |
| 6 | (ไม่ระบุเวอร์ชัน) | react-router-dom **7.x** (HashRouter), Tailwind **v3**, Vite **6**, TypeScript 5.9, Vitest 5, React **18.3** (ตามแผน) | router 6.x ล่าสุดมี advisory open-redirect ที่แก้ใน 7.x; Tailwind v4 เปลี่ยน config model; scaffold `create-vite` ล่าสุดดึง React 19/TS 7 beta/Vite 8 ซึ่งขัด CLAUDE.md §3 จึง pin เอง | `[UNVERIFIED]` รายละเอียด advisory ของ router 6.x มาจากรายงาน `npm audit` ของ agent — ไม่ได้ตรวจเลข CVE เอง |
| 7 | deploy "push `main` (หลัง ci ผ่าน)" | `deploy.yml` trigger ด้วย `workflow_run` ของ `ci` (conclusion = success, event = push, branch main) + `workflow_dispatch` | เป็นวิธีเดียวที่ทำให้ deploy รอ ci จริงโดยไม่ build/test ซ้ำใน workflow เดียว | deploy ใช้ `head_sha` ของ run ที่ผ่าน; smoke `data/manifest.json` เป็น warning จนกว่า Phase 1 จะ publish |
| 8 | pipeline deps ตาม 03 §2 (รวม pypdf, pydantic, rapidfuzz) | ใส่เฉพาะที่ CLAUDE.md §3 ระบุ | เพิ่มเมื่อ task ที่ใช้จริงมาถึง (T-101/T-104/T-109) ลด lock churn | data-engineer ต้อง `uv add` เองตอนนั้น |
| 9 | — | เพิ่ม `.gitattributes` (`* text=auto eol=lf`, binary สำหรับ parquet/gz/ttf/png/pdf) | dev บน Windows + CI บน Linux → กัน CRLF noise และกัน git แตะไฟล์ data | — |
| 10 | — | `pipeline/tests/conftest.py` ล้าง `GITHUB_ACTIONS`/`FORCE_COLOR` + `NO_COLOR=1` ก่อน import typer | rich/typer บังคับ ANSI บน GitHub Actions → assert substring ของ help พัง (CI รอบแรกล้มด้วยเหตุนี้) | test CLI ต้อง assert กับ plain text เสมอ |

## Consequences
- 04 §D8 ยังเป็นแหล่งอ้างอิงของ CSP; ค่าใน meta = §D8 ลบ `frame-ancestors` (ข้อ 1) — ถ้าย้าย host ไปที่ตั้ง header ได้ ให้ใส่กลับเป็น HTTP header
- ไม่มีข้อใดเพิ่ม egress/dependency ที่มี network access (ไม่เข้า `[ASK-HUMAN]` ข้อ 4)
