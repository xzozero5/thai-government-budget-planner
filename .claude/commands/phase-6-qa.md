---
description: Phase 6 — QA, security, hardening, release prep
---
เริ่ม Phase 6 ตาม `docs/08-QA-CHECKLIST.md`, `docs/09-SECURITY.md`; BACKLOG T-601..T-606

1. ขนาน: `qa-engineer` T-601, `security-reviewer` T-602, `ai-engineer` T-604
2. รวม bug/findings → `frontend-dev`/`ai-engineer` แก้ (T-603) เรียง severity; regression e2e หลังแก้
3. `frontend-dev` T-605 deploy config + ตรวจ range request บน `vite preview` และ (ถ้ามี) preview ของ host → **หยุด `[ASK-HUMAN]` ก่อน deploy จริง**
4. `po` T-606 release notes + STATUS "MVP done"
