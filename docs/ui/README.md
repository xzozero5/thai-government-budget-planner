# UI design deliverables (Phase 4, T-401) — ดู `docs/06-UI-SPEC.md` §7

| ไฟล์ | เนื้อหา | ใครใช้ |
|---|---|---|
| `copy.th.json` | ข้อความ UI ภาษาไทยทั้งหมด (i18n source เดียว) — ห้าม hard-code ข้อความใน component | frontend-dev ทุกคน |
| `components.md` | props / states / a11y / class ของ primitive ทุกตัว + กติการวม | frontend-dev |
| `wireframes.md` | ASCII wireframe 4.1–4.6 ครบทุก state (empty/loading/error/streaming/มี proposal/mobile) | frontend-dev, po |
| `motion.md` | ตาราง interaction → animation + reduced-motion fallback | frontend-dev |
| `illustration-style.md` | สไตล์ SVG ที่ส่งให้ AI (palette/กฎ sanitizer/องค์ประกอบ) | ai (system prompt), frontend-dev |
| `illustrations/*.svg` | few-shot 3 ชิ้น (map / cross_section / diagram) | ai |
| `../../web/src/styles/tokens.css` | ค่าสีและ motion token (ชื่อตัวแปรคือ contract ห้ามเปลี่ยนชื่อ) | frontend-dev |

กฎที่ใช้บ่อย: ห้ามใส่ hex ตรงใน component · ข้อความมาจาก `copy.th.json` · basis/confidence ต้องมีไอคอน+ข้อความ ไม่ใช้สีอย่างเดียว · ขอบ form control ใช้ `border-fg-muted` ไม่ใช่ `border-line`
