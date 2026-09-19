---
description: ให้ po + architect (+ security-reviewer ถ้าเกี่ยว) review งานล่าสุดก่อน commit
argument-hint: [task-id หรือ path]
---
Review งาน $ARGUMENTS:
1. `git diff --stat` และ `git status` เพื่อดูไฟล์ที่เปลี่ยน
2. เรียก `po` ตรวจ AC และ Non-negotiables; เรียก `architect` ถ้าแตะ `web/src/data|ai` หรือ `pipeline/`; เรียก `security-reviewer` ถ้าแตะ key/network/markdown/tool handlers
3. รวม findings เรียง severity → แก้ P0/P1 ก่อน commit; P2 ลง BACKLOG
4. ยืนยัน test/lint ผ่านแล้วค่อยเสนอข้อความ commit
