# Motion spec (T-401, docs/06-UI-SPEC.md §2)

หลัก: **flat + มีชีวิตชีวา แต่ไม่รก** — 150–250 ms, ease-out, เคลื่อนที่สั้น (≤ 8px), ไม่มี bounce/spring เกินจริง,
ไม่มี animation วนลูปนอกจาก "กำลังทำงานอยู่จริง"

## ค่าที่ใช้ได้ (จาก `tokens.css` — ห้าม hard-code ตัวเลขอื่น)

| token | ค่า | ใช้กับ |
|---|---|---|
| `--motion-fast` | 150ms | hover, press, ไอคอนเปลี่ยน |
| `--motion-base` | 200ms | fade/slide ของข้อความ, toast, popover |
| `--motion-slow` | 250ms | drawer, dialog, lightbox |
| `--ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | ทุกอย่างที่ "เข้ามา" |
| ease-in (ออก) | `cubic-bezier(0.4, 0, 1, 1)` | สิ่งที่ "ออกไป" (ใช้ระยะเวลา fast) |

Tailwind: `duration-fast|base|slow` + `ease-out` (map ไว้แล้วใน `tailwind.config.ts`)

## ตาราง interaction → animation

| # | Interaction | Animation | Duration / easing | Reduced-motion fallback |
|---|---|---|---|---|
| 1 | ปุ่ม hover | `background`/`opacity` เปลี่ยน | 150ms ease-out | เปลี่ยนทันที (0ms) — สีคงเดิม |
| 2 | ปุ่ม press | `scale(0.98)` | 150ms ease-out | ไม่ scale; ใช้ `bg` เข้มขึ้นแทน |
| 3 | ปุ่ม → loading | label fade-out → Spinner fade-in (ความกว้างคงที่) | 150ms | สลับทันที, Spinner หมุน 1.6s (คงไว้ = สื่อ "ยังทำงาน") |
| 4 | ปุ่ม → success | ไอคอน ✓ scale 0.8→1 + fade | 150ms ease-out, ค้าง 1.5s | แสดง ✓ ทันที ค้าง 1.5s |
| 5 | การ์ดที่คลิกได้ hover | `translateY(-2px)` + `shadow-1→shadow-2` | 150ms ease-out | เปลี่ยนเฉพาะ border เป็น `border-fg-muted` |
| 6 | ข้อความแชทใหม่ | `opacity 0→1` + `translateY(8px→0)` | 200ms ease-out | fade อย่างเดียว 0ms (แสดงทันที) |
| 7 | สตรีมข้อความ | caret `▌` กะพริบ 1s step-end | ต่อเนื่องระหว่างสตรีม | ไม่กะพริบ — แสดง `chat.streaming` เป็นข้อความคงที่ |
| 8 | Tool activity — running | แถบ progress ด้านล่างการ์ด pulse (x -100%→100%) | 1.2s linear วนลูป | แถบคงที่ 30% + ข้อความ "กำลัง…" |
| 9 | Tool activity — done | แถบหาย, ไอคอน ⌛→✓ crossfade + scale 0.9→1 | 150ms ease-out | สลับไอคอนทันที |
| 10 | ตัวเลขยอดรวมเปลี่ยน | count-up จากค่าเดิม→ใหม่ (rAF, tabular-nums) | 250ms ease-out | แสดงค่าปลายทางทันที |
| 11 | แถว BOQ ใหม่ | `bg-basis-historical-bg` → โปร่งใส | ค้าง 400ms แล้ว fade 800ms | ไม่ highlight; ใช้ FlagBadge "ใหม่" 5 วินาทีแทน |
| 12 | แถว BOQ ที่ผู้ใช้แก้ | border ซ้าย 2px accent เข้ามา (scaleY 0→1) | 150ms ease-out | แสดง border ทันที |
| 13 | เส้นกราฟ TrendChart | draw-in (`stroke-dasharray` 0→100%) | 250ms ease-out ครั้งเดียวตอน mount | วาดเต็มเส้นทันที |
| 14 | Sparkline | ไม่มี animation (เล็กเกินไป) | – | – |
| 15 | Drawer เปิด | slide-in จากขวา `translateX(24px→0)` + fade; scrim fade | 250ms ease-out | fade อย่างเดียว 0ms |
| 16 | Drawer ปิด | slide-out `translateX(0→16px)` + fade | 150ms ease-in | ซ่อนทันที |
| 17 | Dialog เปิด | `scale(0.98→1)` + fade | 200ms ease-out | fade 0ms |
| 18 | Lightbox ภาพ | fade + `scale(0.96→1)` | 250ms ease-out | fade 0ms |
| 19 | Popover/Tooltip | fade + `translateY(4px→0)`; tooltip หน่วง 200ms ก่อนแสดง | 150ms ease-out | แสดงทันทีหลังหน่วง (ไม่มี transform) |
| 20 | Toast เข้า | slide-up 12px + fade | 200ms ease-out | fade 0ms |
| 21 | Toast ออก | fade + `translateX(8px)` | 150ms ease-in | ซ่อนทันที |
| 22 | Skeleton | opacity 1→0.6→1 | 1.4s ease-in-out วนลูป | คงที่ที่ opacity 0.75 |
| 23 | Cost meter เปลี่ยน | ความกว้าง fill transition | 250ms ease-out | เปลี่ยนทันที |
| 24 | Accordion เปิด/ปิด | height auto→content (grid-template-rows 0fr→1fr) + fade | 200ms ease-out | สลับทันที |
| 25 | Tab เปลี่ยน (มือถือ) | เนื้อหา crossfade | 150ms ease-out | สลับทันที |
| 26 | Focus ring | ไม่มี transition (ต้องปรากฏทันทีเพื่อ a11y) | 0ms | เหมือนกัน |
| 27 | Data loading bar | ความกว้างตามเปอร์เซ็นต์จริง (ไม่ใช่ indeterminate ถ้ารู้ขนาด) | 250ms ease-out | เปลี่ยนทันที |
| 28 | เปลี่ยนหน้า (route) | fade 120ms | 120ms | ไม่มี |
| 29 | สลับธีม light/dark | ไม่มี transition ของสี (กันจอกระพริบ/ค่าใช้จ่าย repaint) | 0ms | เหมือนกัน |
| 30 | KeyGate → workspace | ปุ่ม success ค้าง 400ms แล้ว fade ออก | 200ms | ข้ามไปเลย |

## กฎการ implement

1. `prefers-reduced-motion: reduce` ถูกบังคับระดับ global ใน `tokens.css` แล้ว (`animation-duration: 0.01ms`)
   — แต่ **ยังต้องเขียน fallback ตามตาราง** เพราะบาง effect ต้องเปลี่ยน "วิธีสื่อสาร" ไม่ใช่แค่ปิด (ข้อ 7, 8, 11, 22)
   ใช้ hook `usePrefersReducedMotion()` อ่านค่าเดียวกันใน JS
2. ห้าม animate `width/height/top/left` ของ layout — ใช้ `transform`/`opacity` (ยกเว้น progress bar และ accordion grid-rows)
3. animation ที่วนลูปต้องหยุดเมื่อ element ไม่อยู่ใน viewport หรือ tab ถูกซ่อน (`document.hidden`)
4. `motion`/framer-motion ใช้เฉพาะที่ตารางระบุว่าเป็น enter/exit ของ overlay และรายการแชท — ส่วนที่เหลือใช้ CSS transition ล้วน (เบากว่า)
5. ห้ามให้ animation หน่วงการอ่านค่า: ตัวเลขที่ count-up ต้องมีค่าปลายทางใน DOM (`aria-live` อ่านค่าสุดท้ายครั้งเดียว ไม่อ่านทุกเฟรม)
6. การสตรีมข้อความ: อัปเดต DOM ≤ 20 ครั้ง/วินาที (throttle) เพื่อไม่ให้ screen reader/CPU รับไม่ไหว
