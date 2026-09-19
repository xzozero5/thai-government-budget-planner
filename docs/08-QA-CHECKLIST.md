# 08 — QA Checklist (Phase 6 — `qa-engineer` รัน, `po` เซ็น)

ผลการรันแต่ละรอบเขียนลง `docs/qa/run-YYYY-MM-DD.md` (คัดลอก checklist นี้ ติ๊ก + แนบหลักฐาน screenshot/log) · bug เปิดใน `docs/qa/bugs.md` (ID B-xxx, severity, repro, สถานะ)

## A. Functional
- [ ] A1 ใส่ key ถูก/ผิด/ว่าง/มีช่องว่างหน้า-หลัง — พฤติกรรมตาม US-1.1
- [ ] A2 เลือก model ทุกตัวใน list แล้วส่งข้อความได้ (ตัวที่บัญชีไม่มีสิทธิ์ → error ชัด)
- [ ] A3 Interview: ไอเดียคลุมเครือ → AI ถาม ≤ 4 ข้อ/turn; ตอบ "ไม่รู้" → มี assumption; "ข้าม สรุปเลย" → ได้ proposal
- [ ] A4 Tool cards แสดงทุก tool call พร้อมจำนวนผล; "ดูผล" เปิดตารางตรงกับที่ AI ได้
- [ ] A5 Proposal ครบ section; BOQ ทุกบรรทัดมี basis/confidence/เหตุผล; ยอดรวมถูก (ตรวจด้วย spreadsheet)
- [ ] A6 แก้ qty/ราคา → ยอดรวมเปลี่ยน; "ให้ AI ทบทวน" → เวอร์ชันใหม่, เวอร์ชันเก่ายังดูได้
- [ ] A7 Citation drawer: budget_line / document (มี text) / document (สแกน) / web / econ — ข้อมูลตรงกับไฟล์ต้นทางจริง (สุ่มตรวจ 10 citations เปิดไฟล์ Excel/PDF จริงเทียบ)
- [ ] A8 Export PDF: เปิดใน Chrome, Acrobat, macOS Preview, มือถือ; ฟอนต์ไทย, สระ/วรรณยุกต์, ตารางข้ามหน้า, appendix ครบ, ค้นหาข้อความใน PDF ได้
- [ ] A9 Save JSON → เปิดใน tab ใหม่ที่ไม่มี key → แสดงครบ read-only; ใส่ key → คุยต่อได้
- [ ] A10 Budget cap: ถึง 80 % เตือน, 100 % หยุด, ปรับเพดานแล้วไปต่อได้
- [ ] A11 Idle 60 นาที (จำลองด้วยเวลาปลอม) → key ถูกล้าง + แจ้ง
- [ ] A12 ยกเลิก streaming กลางคัน → state ไม่พัง, ส่งต่อได้
- [ ] A14 ภาพประกอบ: โจทย์ถนน 4 เลน / ฝาย / อาคาร → มีภาพ SVG เชิงแผนผังที่สื่อความ, ป้าย "ภาพประกอบโดย AI", ไม่มีตัวเลขเงินในภาพ, สร้างใหม่/ซ่อนได้, อยู่ใน PDF; โจทย์ครุภัณฑ์ล้วน → ไม่มีภาพ
- [ ] A15 Trend: บรรทัด historical มี sparkline ที่ค่าตรงกับ catalog; การ์ดสถิติ (เช่น ดัชนีเหล็ก) แสดง 10 ปี + Δ% + แหล่ง; ไม่มี series → ไม่มีกราฟ
- [ ] A16 Design: โทนสีธงชาติใช้ตามสัดส่วน (แดง < 10 %), contrast ผ่านทั้ง light/dark, micro-interactions ทำงานและปิดเมื่อ reduced-motion
- [ ] A17 ลิงก์เว็บ (Shopee/Lazada): กดจาก BOQ chip / drawer / การ์ด / แชท / PDF → เปิดแท็บใหม่ถูก URL, `noopener noreferrer`, คีย์บอร์ดเปิดได้, URL ที่ไม่ใช่ https ไม่เป็นลิงก์
- [ ] A13 โหมด "ตรวจสอบ": ใส่ตัวเลขที่รัฐเสนอ → ได้ audit_findings ที่ชี้รายการแพง/ถูกผิดปกติพร้อม citation

## B. Data quality (สุ่มจาก production data)
- [ ] B1 สุ่ม 20 `source_id` จาก catalog → เปิด Excel ต้นทางที่ sheet/row ระบุ → ค่าตรง 20/20
- [ ] B2 สุ่ม 10 item_key ยอดนิยม (แอร์, คอมพิวเตอร์, รถบรรทุก, ถนน คสล., ฝาย) → สถิติราคาต่อหน่วยสมเหตุสมผล ไม่มีค่าหลุด (เช่น 1 บาท, 10^12) ที่ไม่ถูก flag
- [ ] B3 ค้น "เชียงใหม่" ใน act_2570 → จำนวน/ยอดตรง title ของไฟล์ subset (V2)
- [ ] B4 econ indicators ทุกค่ามี source_url เปิดได้; สุ่ม 5 ค่าเทียบกับแหล่ง → ตรง แล้ว set `verified:true`
- [ ] B5 sources.json นับไฟล์ = จำนวนไฟล์จริงในโฟลเดอร์ (ไม่รวม .DS_Store)

## C. Security (ทำตาม 09-SECURITY §5 ทุกข้อ)
- [ ] C1–C9 ผ่าน (แนบ log)

## D. Performance
- [ ] D1 Lighthouse (desktop) Performance ≥ 85, initial transfer < 3 MB gz (ไม่รวม shard)
- [ ] D2 Query แรกที่ต้องโหลด shard: เวลาและ bytes ที่โหลดจริง (DevTools) ต่อ 3 โจทย์ — บันทึกไว้เทียบเป้า §5 ของ 04
- [ ] D3 Memory หลังใช้งาน 30 นาที < 1 GB (Chrome task manager)
- [ ] D4 ค่าใช้จ่าย API เฉลี่ยต่อ proposal (จาก eval) ≤ 0.5 USD Sonnet

## E. Compatibility / a11y
- [ ] E1 Chrome, Edge, Firefox, Safari (desktop) — flow หลักผ่าน; Safari iOS / Chrome Android — แชท+อ่าน proposal ได้
- [ ] E2 axe ไม่มี violation ระดับ serious/critical บน 3 หน้า
- [ ] E3 คีย์บอร์ดอย่างเดียวทำ flow A ได้ครบ; screen reader อ่าน tool activity และ badge ได้
- [ ] E4 Zoom 200 %, dark mode, reduced motion

## F. Release readiness
- [ ] F1 `docs/STATUS.md` เป็นปัจจุบัน, BACKLOG ปิดครบ MVP, ไม่มี `[UNVERIFIED]` ค้างในสิ่งที่ UI แสดงเป็นข้อเท็จจริง
- [ ] F2 README มีวิธี build/run/deploy และวิธี regenerate data
- [ ] F3 `docs/eval-report.md` ล่าสุดผ่านเกณฑ์
- [ ] F4 ทบทวน license ฟอนต์ (Sarabun OFL) และ dependency (ไม่มี GPL ที่ขัด)
- [ ] F5 `[ASK-HUMAN]` deploy: เลือก host, ตั้ง CSP headers, ตรวจ range request บน host จริง
