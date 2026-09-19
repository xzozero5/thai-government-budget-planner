# STATUS — สถานะโปรเจกต์ (Claude Code อัปเดตทุกครั้งที่ปิดงาน)

รูปแบบ entry: `## YYYY-MM-DD HH:MM (Asia/Bangkok) — <ใคร/agent> — <phase/task>` แล้วตามด้วย ทำอะไร / ไฟล์ที่แตะ / test / ค้าง / ไม่ยืนยัน

## สถานะปัจจุบัน
- Phase: **0 (ยังไม่เริ่ม)** — แผนครบ พร้อมให้ Claude Code เริ่ม `/phase-0-bootstrap`
- งานถัดไป: T-001, T-002 (ขนาน) → T-003..T-005
- Blockers: ไม่มี
- `[ASK-HUMAN]` ค้าง: ไม่มี

## Open questions / `[UNVERIFIED]` ที่ยังค้าง
- โครงสร้างไฟล์ A3 (subset จังหวัดอื่น ๆ), A4 (อบจ. สป., ทน. ชม.), A5 (xlsx/xls ใน กมธ.) — ยืนยันใน T-101/T-106..T-108
- ขนาดข้อมูลหลัง compact (02 §E) — วัดจริงใน T-110
- ราคา API ต่อ token ของแต่ละ model (T-301) — ต้องเช็คจาก docs.claude.com ตอน implement
- DuckDB-WASM range request บน host เป้าหมาย — S1 ใน T-201

## Log

## 2569-09-19 14:45 (Asia/Bangkok) — Claude (Cowork) — Hosting
- ตัดสินใจ: deploy ด้วย GitHub Actions → GitHub Pages (`https://xzozero5.github.io/thai-government-budget-planner/`), HashRouter, base path, CSP meta, DuckDB eh build (ไม่มี COEP) → CLAUDE.md §3/5.1, 04 §D8, 07 §5, T-004/T-605; range request บน Pages `[UNVERIFIED]` วัดใน S1

## 2569-09-19 14:30 (Asia/Bangkok) — Claude (Cowork) — Git
- ตัดสินใจ: โค้ด + `web/public/data/**` อยู่ใน git `xzozero5/thai-government-budget-planner` (public, Apache-2.0, มี Initial commit + LICENSE แล้ว); raw data ไม่อยู่; ≤ 500 MB, ไม่ใช้ LFS → CLAUDE.md §5.1, T-000, T-003 (pre-commit), T-110
- ตรวจจากเครื่องคุณนิว: HTTPS `ls-remote` ถึง repo ได้ (main = 1738f03); SSH จาก sandbox นี้ไม่มี key (Permission denied) — Claude Code ในเครื่องจริงต้องใช้ key ของคุณนิว ยังไม่ยืนยันจนกว่าจะ push ครั้งแรก `[UNVERIFIED]`

## 2569-09-19 14:00 (Asia/Bangkok) — Claude (Cowork) — Requirement เพิ่ม
- citation จากเว็บ (Shopee ฯลฯ) ต้องกดเปิดแท็บใหม่ได้ทุกที่ + ใน PDF → US-4.3, 06 §4.3/4.4, A17, T-407/T-501

## 2569-09-19 13:30 (Asia/Bangkok) — Claude (Cowork) — Requirement เพิ่มจากคุณนิว
- UI flat+modern สีธงชาติไทย มีชีวิตชีวา → 06-UI-SPEC §1/§2 + motion.md, T-401/T-411
- ภาพประกอบโครงการใหญ่ → ตัดสินใจ **SVG จาก Claude เท่านั้น** (N9, 04 §D9, F7, T-309/T-412/T-504, spike S5)
- Trend chart สถิติ (ราคาเหล็ก ฯลฯ) → F8, tool get_price_trend, catalog/trends, econ series cmi_* (03 §3.5), T-207/T-412

## 2569-09-19 12:00 (Asia/Bangkok) — Claude (Cowork, วางแผนกับคุณนิว) — Planning
- สำรวจข้อมูลดิบจริง (318 ไฟล์ 3.2 GB) → `docs/02-DATA-INVENTORY.md`
- ยืนยัน scope กับคุณนิว: ผู้ใช้หลัก = ประชาชน/สื่อ/สส. ตรวจสอบงบ; ราคาตลาดผ่าน Claude web search tool; econ = snapshot JSON + web search เสริม; static site + shard ข้อมูล
- เขียน CLAUDE.md, docs/00–09, BACKLOG, agents, commands
- ค้าง: ทั้ง backlog
