# PO review — Phase 4 + 5 (T-410) · 2569-09-21

ผู้ตรวจ: agent `po` (read-only; รัน typecheck + vitest 1153 ผ่าน) · main thread ย่อและจัดคิวแก้ · สถานะ: `[ ]` ยังไม่แก้ / `[~]` กำลังแก้ / `[x]` แก้แล้ว

## สถานะ user story (docs/05-FEATURES.md §1)
| US | สถานะ | ช่องว่างหลัก |
|---|---|---|
| US-1.1 key gate | บางส่วน | ไม่มีเตือนงบที่ 80 % |
| US-1.2 โปร่งใส | บางส่วน | ไม่แสดงประมาณการต้นทุนต่อข้อเสนอ |
| US-2.1 interview, US-2.3 stream/cancel/retry, US-3.2 แก้ BOQ, US-3.3 version, US-4.3 ลิงก์เว็บ, US-5.2 save/load | ผ่าน | — |
| US-2.2 tool activity | บางส่วน | ข้อความผล tool เป็นชื่อ tool อังกฤษ (`chat.tool.*.done` 40+ key ไม่ถูกใช้) |
| US-3.1 proposal | บางส่วน | ไม่มี badge "อ้างอิงไม่พบ"; เว็บไม่แสดง subtotal/contingency/VAT (PDF แสดง) |
| US-4.1 drawer | บางส่วน | ไม่มีปุ่มเปิดไฟล์ต้นฉบับ (`VITE_SOURCE_BASE_URL`) |
| US-4.2 แหล่งอ้างอิงทั้งหมด | บางส่วน | UI มีเฉพาะแหล่งเว็บ (PDF appendix ครบ) |
| US-5.1 PDF | บางส่วน → ตรวจภาพแล้วโดย main thread (`3416c38`) | เหลือ T-503 (viewer จริง 4 ตัว) |
| US-7.1 ภาพประกอบ | บางส่วน | ปุ่ม "สร้างภาพใหม่/ซ่อนภาพ" ไม่ถูกต่อ |
| US-8.1 sparkline | บางส่วน | ไม่มี tooltip ปี/มัธยฐาน/n |
| US-8.2 stat card | บางส่วน | ไม่มี Δ%, แหล่งที่มา, ป้าย verified |
| US-8.3 กราฟใน PDF | ยังไม่มี | T-504 ส่วนกราฟ |

Component ที่ยังลอย (ไม่มีผู้ใช้จริง): `TrendChartLazy`, `features/citations/CitationChip`

## must (บล็อก MVP)
- [~] M1 ประมาณการต้นทุนต่อข้อเสนอที่ KeyGate + Settings (Sonnet/Opus ติดป้าย "ยังไม่ได้วัดจริง") — ชุด A
- [ ] M2 badge "อ้างอิงไม่พบ" บนบรรทัด BOQ (ใช้ `CitationChip` + `unresolved` จาก ToolLog) — ชุด B
- [~] M3 เตือนงบ 80 % (store/controller ชุด A; toast ใน workspace ชุด B)
- [~] M4 ข้อความผล tool ภาษาไทยจาก copy (event แบบมีโครงสร้าง ชุด A; UI mapping ชุด B)
- [ ] M5 "เทียบเคียงงบในอดีต" ต้องคลิกไปที่ citation ได้ (มี `source_id` อยู่แล้ว) — ชุด B
- [ ] M6 แสดง subtotal / ค่าเผื่อเหลือเผื่อขาด / VAT บนเว็บ — ชุด B
- [x] M7 STATUS/BACKLOG ไม่ตรงของจริง (vitest 312 → 1153; T-502 ยัง `[ ]`) — แก้แล้ว

## should
- [ ] S8 stat card: Δ%, แหล่งที่มา, ป้าย verified (US-8.2 AC)
- [ ] S9 ต่อปุ่ม "สร้างภาพใหม่/ซ่อนภาพ"
- [ ] S10 ต่อปุ่ม "ไม่เอาราคานี้" (`onRejectWeb`)
- [ ] S11 empty state ของ proposal มี checklist ข้อมูลที่ผู้ช่วยต้องการ (copy พร้อมแล้ว)
- [ ] S12 data loading indicator บอกไฟล์/ขนาด/ความคืบหน้า (ต้องให้ facade ส่ง progress)
- [ ] S13 export dialog: preview หน้าแรก, ชื่อผู้จัดทำ, switch ที่ disabled ทั้งที่ copy บอกว่าเลือกได้
- [ ] S14 ปุ่ม "คัดลอกสรุป (markdown)"
- [ ] S15 section "แหล่งอ้างอิงทั้งหมด" ครบทุกชนิดบนเว็บ (US-4.2)
- [ ] S16 คีย์ลัดตามสเปค (`Ctrl/⌘+K` โฟกัส composer; ตอนนี้ใช้ `/`)
- [ ] S17 `VITE_SOURCE_BASE_URL` + ปุ่มเปิดไฟล์ต้นฉบับ

## could
- [ ] C18 แก้ชื่อโครงการ / compare-restore version
- [ ] C19 ใช้ `TrendChartLazy` จริง (drawer "ดูแนวโน้มเต็ม") หรือย้ายเป็น post-MVP
- [ ] C20 การ์ด BOQ บนมือถือเพิ่มเหตุผล/แนวโน้ม/หน่วย
- [ ] C21 ข้อความไทย hardcode: .tsx 40 บรรทัด/19 ไฟล์ + `ai/agent.ts` 26 บรรทัด (error ใช้ "กรุณา") → map เข้า `errors.*`

## Copy (06 §5)
609 key · ใช้จริง ~348 · **ไม่ถูกใช้ ~261 (43 %)** (ส่วนใหญ่คือ `errors.*`, `chat.tool.*`, `proposal.stat.*` ที่รอ UI ต่อสาย) · key ที่โค้ดเรียกแต่ไม่มี = 0 (type `CopyKey` กันไว้)
แก้ในชุด A: ตัด "DuckDB", "session" → "การใช้งานครั้งนี้ (แท็บนี้)", "AI" → "ผู้ช่วย" (ยกเว้นปุ่ม `proposal.reviewWithAi`), "โปรด" → "ควร", เติม "ทำอะไรต่อ" ใน `proposal.warnings.noCitation`, เพิ่ม key ที่ขาด (impact/severity/comparables/trend/totals/citationUnresolved/spendLimitHint)
ค้าง: key ซ้ำความหมาย 7 คู่, `settings.budget*Help` ฝังค่า default, `chat.placeholderAudit` ยาว, `proposal.boq.mobileHint`

## สิ่งที่ PO ไม่ได้ตรวจ
PDF ใน viewer จริง (T-503) · e2e/axe บนเบราว์เซอร์จริง (T-409) · storage audit ตอน runtime · motion/reduced-motion (T-411) · responsive/dark-mode contrast จริง · bundle/TTI · คุณภาพ prompt + eval (T-604) · lint · pipeline · loaders ของ CitationDrawer กับข้อมูล production
