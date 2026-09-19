# 06 — UI Spec (Phase 4)

Owner: `ui-designer` (ออกแบบ/tokens/copy) → `frontend-dev` (implement) · ตรวจ: `po`, `qa-engineer`

## 1. หลักการ
- **Flat + modern, มีชีวิตชีวา** (เพิ่ม 19 ก.ย.): ไม่มี gradient/เงาหนัก, ขอบมน, พื้นที่ว่างเยอะ, typography ชัด; ทุก interaction มีการตอบสนองทันที (hover/press/focus/loading/success) แต่ไม่รกและเคารพ reduced-motion
- **สีหลักจากธงชาติไทย** แต่ใช้อย่างมีรสนิยม: น้ำเงินเข้มเป็นสีหลัก/โครง, แดงเป็น accent เฉพาะจุดสำคัญ (CTA หลัก, ค่าที่ผิดปกติ), ขาว/เทาอ่อนเป็นพื้น — ไม่ใช่แถบสามสีทั้งหน้า
- **หลักฐานต้องมองเห็น** — ทุกตัวเลขมี badge basis (สีต่างกัน) และคลิกได้
- **ไม่ต้องเรียนรู้** — ผู้ใช้ทั่วไป/นักข่าวเปิดมาแล้วพิมพ์ได้เลย; copy ภาษาไทยเป็นกันเอง ไม่ราชการ
- **โปร่งใสเรื่องความปลอดภัย** — key/ค่าใช้จ่าย/สิ่งที่ส่งออก มองเห็นตลอด
- Desktop-first (นักข่าว/ทีม สส. ใช้จอใหญ่) แต่ใช้บนมือถือได้ (แชท + อ่าน proposal; แก้ตารางบนมือถือเป็น best-effort)

## 2. Design tokens (`web/src/styles/tokens.css` + Tailwind theme)
- ฟอนต์: UI = `"Sarabun", system-ui` (bundle woff2 400/500/700) — ฟอนต์เดียวกับ PDF เพื่อความสอดคล้อง; ตัวเลขใช้ `font-variant-numeric: tabular-nums`
- Palette ตั้งต้น (ค่าธงชาติตามมาตรฐานราชการ `[UNVERIFIED — ui-designer ตรวจกับประกาศสำนักนายกรัฐมนตรี เรื่องมาตรฐานสีธงชาติ พ.ศ. 2560 ก่อนใช้]`): แดง `#A51931`, ขาว `#F4F5F8`, น้ำเงิน `#2D2A4A`
  - `--brand-navy: #2D2A4A` (primary: header, ปุ่มรอง, ข้อความเด่น) + tint/shade 5 ระดับ
  - `--brand-red: #A51931` (accent: CTA หลัก, badge ค่าผิดปกติใน audit, จุดเน้น) ใช้ < 10 % ของพื้นที่
  - `--brand-white: #F4F5F8` (พื้นหลังหลัก light), surface `#FFFFFF`, เทา `#E6E8EE` / `#8A8FA3`
  - dark mode: พื้น `#15142A` (navy ลึก), surface `#1F1D3A`, แดงปรับสว่างขึ้นให้ contrast ผ่าน
  - สีสถานะ (success/warn/info) และสี basis ต้องอยู่คนละโทนกับแดง/น้ำเงินหลักเพื่อไม่สับสน (basis-historical = teal, basis-market = amber, basis-estimate = slate)
- สี (light + dark ผ่าน `prefers-color-scheme` และ toggle):
  - `--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`
  - `--accent` (ปุ่มหลัก), `--danger`
  - basis: `--basis-historical` (เขียวอมน้ำเงิน), `--basis-market` (ส้ม), `--basis-estimate` (เทา/ม่วงอ่อน) — ต้องผ่าน contrast 4.5:1 ทั้ง 2 โหมด และมี **ไอคอน/ตัวอักษรกำกับ** ไม่ใช้สีอย่างเดียว
  - confidence: จุด 3 ระดับ (●●● / ●●○ / ●○○) + tooltip
- Spacing 4-pt, radius 8/12, shadow ต่ำ
- Motion (ใช้ `motion`): 150–250 ms ease-out; รายการ: ปุ่ม press scale 0.98, การ์ด hover ยก 2px, ข้อความแชท fade+slide-up, tool activity card มี progress pulse ระหว่างทำงาน → check เมื่อเสร็จ, ตัวเลขยอดรวม count-up เมื่อเปลี่ยน, แถว BOQ ใหม่ highlight แล้วจาง, เส้นกราฟ draw-in, drawer slide-in, skeleton ระหว่างโหลด shard; ทั้งหมดปิดเมื่อ `prefers-reduced-motion`
- Feedback ทันที: ทุกปุ่มมี loading/success state ในตัว (ไม่ใช้ toast อย่างเดียว), input ตรวจ inline, copy → ไอคอนเปลี่ยนเป็น ✓ 1.5 s

## 3. Information architecture / routes
```
/            KeyGate (ถ้ายังไม่มี key) → redirect /workspace
/workspace   3-pane: [Chat] | [Proposal] | [Citation drawer (overlay)]  — ซ่อน/ขยาย pane ได้
/load        เปิดไฟล์ .tgbp.json (ไม่ต้องมี key)
/about       วิธีทำงาน, แหล่งข้อมูล, ข้อจำกัด (PDF สแกน), ความเป็นส่วนตัว
```

## 4. Screens

### 4.1 KeyGate
- Hero สั้น: "ประเมินงบโครงการรัฐ ด้วยข้อมูลงบจริงย้อนหลัง 11 ปี"
- ฟอร์ม: API key (password, ปุ่มแสดง/ซ่อน), model select, งบสูงสุดต่อ session (USD, default 2), ปุ่ม "ทดสอบและเริ่ม"
- กล่อง "ความเป็นส่วนตัว": 3 bullet (key อยู่แค่ในแท็บนี้ / รีเฟรชแล้วหาย / ส่งออกไป api.anthropic.com เท่านั้น) + ลิงก์ /about
- states: idle, testing (spinner ในปุ่ม), error (ข้อความเฉพาะกรณี + วิธีแก้), success (transition ไป workspace)
- ลิงก์ "มีไฟล์ proposal อยู่แล้ว? เปิดดูโดยไม่ต้องใส่ key"

### 4.2 Workspace — Chat pane (ซ้าย, ~40 %)
- Header: model chip, token/cost meter (progress ถึง budget), ปุ่ม "ล้าง key & ออก"
- Message list: user / assistant (markdown จำกัด: bold, list, table เล็ก) / **tool activity cards** (ไอคอน + "ค้นรายการ 'เครื่องปรับอากาศ 18,000 บีทียู' ปี 2566–2568 → พบ 1,240 แถว" + ปุ่ม "ดูผล" เปิด drawer แสดงตาราง ≤ 50 แถว)
- Quick replies เมื่อ AI ถาม (chips) + ปุ่ม "ข้าม สรุปเลย"
- Composer: textarea autosize, Enter ส่ง / Shift+Enter ขึ้นบรรทัด, ปุ่มหยุด streaming, mode toggle (ตรวจสอบ/ร่างโครงการ)
- Empty state: 3 ตัวอย่าง prompt คลิกได้ (ครุภัณฑ์ / สิ่งก่อสร้าง / โหมดตรวจสอบ)

### 4.3 Workspace — Proposal pane (ขวา, ~60 %)
- Empty: การ์ดอธิบาย "คุยกับ AI สักครู่ ข้อเสนอจะโผล่ที่นี่" + checklist ข้อมูลที่ AI ต้องการ (อัปเดต ✓ ตามที่คุยไป — derive จาก state ที่ AI เก็บ)
- Header: title (แก้ได้), version selector (v1, v2…), badges สรุป: ยอดรวม, จำนวนบรรทัด, สัดส่วน historical/market/estimate (stacked bar)
- **Hero ภาพประกอบ** (ถ้ามี `illustrations`): แสดงภาพแรกเต็มความกว้าง pane (aspect 16:9, พื้น surface, ป้าย "ภาพประกอบโดย AI — เชิงแผนผัง") + thumbnail ภาพอื่น; คลิกขยาย (lightbox) ; ปุ่ม "สร้างภาพใหม่" / "ซ่อนภาพ"
- **Stat cards** (≤ 4, แถวเดียว scroll แนวนอนบนมือถือ): ชื่อตัวชี้วัด, ค่าปัจจุบัน, Δ% ช่วงที่ใช้ (สีตามทิศ), line chart เล็ก 10 ปี, แหล่ง + verified badge; คลิก → drawer econ
- Sections (accordion, เปิดหมดโดย default บน desktop): สรุป → วัตถุประสงค์ → ขอบเขต/สเปค → **BOQ** → สมมติฐาน → ความเสี่ยง → เทียบเคียงในอดีต → (audit findings) → คำถามที่ยังเปิด
- **BOQ table**: คอลัมน์ หมวด | รายการ (+สเปค บรรทัดย่อย) | จำนวน | หน่วย | ราคา/หน่วย | รวม | basis badge | confidence | ⓘ เหตุผล (popover) | sparkline (ถ้ามี trend_ref; hover tooltip ปี/มัธยฐาน/n) | citations (chip "PBO 2566 · กรมพลังงาน" คลิก → drawer; chip เว็บ "Shopee ↗" **คลิกเปิดแท็บใหม่ทันที** + ปุ่มเล็กเปิด drawer)
  - แก้ qty/ราคาแบบ inline (input ตัวเลข) → บรรทัดที่แก้มี badge "แก้โดยผู้ใช้" และยอดรวมอัปเดต; ปุ่ม "ให้ AI ทบทวน" ส่ง diff เข้าแชท
  - แถวที่ citation resolve ไม่ได้: badge เทา "อ้างอิงไม่พบ" + tooltip
  - sticky header, group by category, subtotal ต่อหมวด, มือถือ → card list
- Footer actions: Export PDF, Save JSON, Copy summary (markdown)

### 4.4 Citation drawer (overlay ขวา 480px / มือถือ full)
- Header: ประเภทแหล่ง (PBO เบิกจ่าย / ร่าง พ.ร.บ. 2570 / ข้อบัญญัติ อบต. / เอกสาร กมธ. / เว็บ / ตัวชี้วัด ศก.)
- Body budget_line: ตาราง key-value ทุกฟิลด์ที่มี (ปี, กระทรวง, หน่วยงาน, แผนงาน, รายการเต็ม, พ.ร.บ., หลังโอน, PO, เบิกจ่าย, %เบิก), "ที่มา": path เต็ม (monospace, ปุ่ม copy), ชีต, แถว, หน้า; ปุ่ม "เปิดไฟล์" (ถ้ามี base URL)
- Body document: title, หน่วยงาน, การประชุมครั้งที่/วันที่, จำนวนหน้า, ป้าย "สแกน — ไม่ได้อ่านเนื้อหา" หรือ excerpt ที่ตรง query (highlight)
- Body web: title เป็นลิงก์ใหญ่กดได้ (เปิดแท็บใหม่ `target=_blank rel=noopener noreferrer`, ไอคอน external-link), โดเมน/ชื่อร้าน, URL เต็ม (monospace + ปุ่ม copy), ราคาที่พบ + เงื่อนไข (price_note), วันที่ค้น; ปุ่ม "ไม่เอาราคานี้"
- Body econ: indicator, ปี, ค่า, หน่วย, source_url, badge `verified`/`ยังไม่ตรวจสอบ`
- ปุ่ม "ดูแถวใกล้เคียง" (เรียก `query_budget_lines` ด้วย item_key เดียวกัน — ไม่ผ่าน AI)

### 4.5 Export dialog
- เลือกส่วนที่รวม (checkbox), ใส่ชื่อผู้จัดทำ (optional, ไม่เก็บ), preview หน้าแรก, ปุ่มดาวน์โหลด; progress ระหว่าง render

### 4.6 Global
- Toast สำหรับ error/warning (เช่น budget ใกล้หมด, key ถูกล้างเพราะ idle)
- Data loading indicator (มุมล่างซ้าย): "โหลดข้อมูลงบปี 2566 กระทรวงมหาดไทย… 8.2 MB" — ผู้ใช้เข้าใจว่าทำไมช้า
- Keyboard: `Ctrl/⌘+K` โฟกัส composer, `Esc` ปิด drawer

## 5. Copy guidelines (ไทย)
- คำเรียก AI: "ผู้ช่วย"; ผู้ใช้: "คุณ"
- ปุ่มเป็นกริยา: "ทดสอบและเริ่ม", "ส่งออก PDF", "ให้ AI ทบทวน"
- ป้าย basis: "จากงบจริง" / "ราคาตลาด" / "ประมาณการ"
- error ต้องบอก "เกิดอะไร + ทำอะไรต่อ" เช่น "key ใช้ไม่ได้ (401) — ตรวจว่าคัดลอกครบและยังไม่ถูกเพิกถอนที่ console.anthropic.com"
- ห้ามใช้ "ฯลฯ" ใน UI; ตัวเลขมี comma; หน่วย "บาท" ท้าย; ปีเป็น พ.ศ. ทุกที่

## 6. Accessibility checklist (ขั้นต่ำ)
- ทุก interactive มี label; ตาราง BOQ มี `<th scope>`; drawer เป็น `role=dialog` + focus trap + คืน focus
- Live region สำหรับ streaming (`aria-live=polite`) และ tool activity
- ขนาดแตะ ≥ 40px; zoom 200 % ไม่แตก
- ทดสอบด้วย axe (Playwright) ใน Phase 6

## 7. Deliverables ของ `ui-designer` (ก่อน frontend-dev เริ่ม)
1. `web/src/styles/tokens.css` + Tailwind config
2. `docs/ui/wireframes.md` — ASCII/mermaid wireframe ของ 4.1–4.5 พร้อม states
3. `docs/ui/copy.th.json` — ข้อความ UI ทั้งหมด (key → ข้อความ) ใช้เป็น i18n source เดียว
4. Component inventory (`docs/ui/components.md`): Button, Input, Select, Badge(basis/confidence), Table, Drawer, Toast, Meter, Card, Chip, Popover, Accordion, **Sparkline, TrendChart, StatCard, IllustrationFrame (พร้อม lightbox), Skeleton** — props และ states
5. `docs/ui/motion.md` — ตาราง interaction → animation (duration/easing/reduced-motion fallback)
6. `docs/ui/illustration-style.md` — สไตล์ SVG ที่ส่งให้ AI: palette (hex จาก tokens), stroke 2px, มุมมอง (แผนที่อย่างง่าย / cross-section / isometric flat), ฟอนต์ระบบ, องค์ประกอบมาตรฐาน (ถนน, อาคาร, ต้นไม้, น้ำ, คน สัดส่วน) + ตัวอย่าง SVG 3 ชิ้นเป็น few-shot
