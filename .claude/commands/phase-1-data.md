---
description: Phase 1 — data pipeline (inventory → extract → normalize → validate → publish)
---
เริ่ม Phase 1 ตาม `docs/03-DATA-PIPELINE.md` และ BACKLOG T-101..T-113

1. อ่าน `docs/02-DATA-INVENTORY.md` ทั้งหมด (สิ่งที่ยืนยันแล้ว + `[UNVERIFIED]` ที่ต้องปิด)
2. มอบหมาย `data-engineer` ทีละกลุ่ม task: (T-101, T-102) → (T-103, T-104 ขนานได้) → T-105 → (T-106, T-107, T-108, T-109 ขนานได้ ถ้าไม่แตะไฟล์เดียวกัน) → T-110 → (T-111, T-112)
   - ทุก task: ให้ agent เปิดไฟล์จริงดูก่อน แล้วอัปเดต `docs/02` แทนที่ `[UNVERIFIED]`
   - ก่อน T-105 ให้ใช้ `explorer` ยืนยัน header ของ PBO ทั้ง 11 ปี (โดยเฉพาะ 2 คอลัมน์ท้าย) และเก็บชื่อจริงลง 02
3. T-111 (econ): ใช้ web search ของคุณเองหาแหล่งทางการ (ธปท., สศช., สนค., ก.แรงงาน, EPPO, สำนักงบประมาณ) ทุกค่าใส่ `source_url`, `retrieved_at`, `verified:false`; เขียน `docs/econ-sources.md`
4. รัน `uv run tgbp build --dataset all` จริงบนเครื่องนี้ (ใช้เวลาได้หลายสิบนาที — รันเป็น background แล้ว poll); ตรวจ `validation_report.md`
5. `po` ทำ T-113 (สุ่มตรวจ 10 source_id กับไฟล์จริงผ่าน `explorer`)
6. STATUS + BACKLOG + commit `pipeline: phase 1 complete`
ถ้า hard validation ไม่ผ่านและแก้ไม่ได้ใน 2 รอบ → เขียนสาเหตุลง STATUS และ `[ASK-HUMAN]`
