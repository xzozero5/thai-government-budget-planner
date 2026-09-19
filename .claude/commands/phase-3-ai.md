---
description: Phase 3 — AI layer (client, tools, agent loop, system prompt, eval)
---
เริ่ม Phase 3 ตาม `docs/05-FEATURES.md` §3–6 และ BACKLOG T-301..T-308

1. `ai-engineer` ทำ T-301 → T-302 → T-303 → T-304 → T-305 (ลำดับ เพราะพึ่งกัน)
2. `ai-engineer` ทำ T-306 eval: ต้องมี `.env.local` ที่มี `VITE_EVAL_ANTHROPIC_API_KEY` — ถ้าไม่มี ให้หยุดและ `[ASK-HUMAN]` ขอ key สำหรับ eval (ห้าม commit) แล้วเตรียม runner ให้พร้อมรัน
3. `security-reviewer` ทำ T-307 → main thread มอบหมายแก้ให้ `ai-engineer`
4. `po` ทำ T-308 review eval report เทียบเกณฑ์ `docs/07-TESTING.md` §4; ปรับ prompt ได้ 2 รอบ
5. STATUS/BACKLOG/commit `ai: agent loop + tools + eval`
