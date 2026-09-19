---
description: Phase 2 — spikes + data access layer (DuckDB-WASM, MiniSearch, repo API)
---
เริ่ม Phase 2 ตาม `docs/04-ARCHITECTURE.md` และ BACKLOG T-201..T-206

1. `architect` ทำ T-201 spikes S1–S5 → `docs/decisions/SPIKES.md` (ตัวเลขจริง) — ถ้า S1 ล้มเหลว ให้เขียน ADR-002 ก่อนไปต่อ
2. ขนานกับ 1: `frontend-dev` ทำ T-202 (types + manifest loader) โดยใช้ fixture `web/tests/fixtures/data/` (ถ้า Phase 1 ยังไม่เสร็จ ให้สร้าง fixture มือจาก schema 03 §3 ชั่วคราวและติดป้าย)
3. หลัง spikes: `frontend-dev` ทำ T-203, T-204, T-205 (ขนานได้ 204/205)
4. `architect` ทำ T-206 review boundaries
5. test/lint/typecheck/build ผ่าน → STATUS/BACKLOG/commit `web: data access layer`
