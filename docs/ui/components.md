# UI Component inventory (T-401, docs/06-UI-SPEC.md §7 ข้อ 4)

Owner: `ui-designer` · ผู้ใช้: `frontend-dev` (T-402 ขึ้นไป)
ที่อยู่โค้ด: `web/src/components/ui/<Name>.tsx` (N7: grep ก่อนสร้างใหม่ทุกครั้ง)

## 0. กติการวม (อ่านก่อนเขียน component)

1. **ห้ามใส่ hex ตรง ๆ** — ใช้ class ที่ map กับ token เท่านั้น (`bg-surface text-fg border-line bg-accent text-accent-contrast text-basis-historical bg-basis-historical-bg ring-focus rounded-md shadow-1`) ไม่งั้น dark mode พัง
2. **ข้อความทุกตัวมาจาก `docs/ui/copy.th.json`** — ห้าม hard-code ภาษาไทยใน component (ยกเว้นสัญลักษณ์ `●`, `▣`)
3. **Focus ที่มองเห็นได้เสมอ**: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg` — ห้ามลบ outline โดยไม่ใส่ ring แทน
4. **ขนาดแตะ ≥ 40px** (`min-h-10`) สำหรับทุกสิ่งที่กดได้ ยกเว้น chip ในตารางที่ให้ `min-h-8` + ระยะห่าง ≥ 8px
5. **สีอย่างเดียวห้ามสื่อความหมาย** — basis/confidence/flag ต้องมี ไอคอน + ข้อความ เสมอ (06 §2)
6. **ห้าม gradient / เงาหนัก** — เงาสูงสุดคือ `shadow-2` และใช้เฉพาะ overlay (drawer/dialog/popover/toast)
7. **ตัวเลข** ใช้ `class="tabular-nums"` + `Intl.NumberFormat('th-TH')` เสมอ
8. **ไม่มี dependency UI ใหม่** — primitives เขียนเอง (dialog/drawer/popover ใช้ `<dialog>`+focus trap ของเราเอง); ถ้าจำเป็นต้องใช้ Radix ให้เปิด ADR ก่อน
9. **motion** อ่าน `docs/ui/motion.md`; ทุก animation ต้องมี fallback เมื่อ `prefers-reduced-motion: reduce`
10. `loading` state ของปุ่ม **ต้องคงความกว้างเดิม** (ใส่ spinner แทน label โดยใช้ `aria-live` บอก) เพื่อไม่ให้ layout กระตุก

ตารางสถานะที่ทุก interactive component ต้องรองรับ: `default · hover · focus-visible · active(press) · disabled · loading · success · error`

---

## 1. Button

```ts
type ButtonVariant = 'primary' | 'accent' | 'ghost' | 'outline' | 'danger';
interface ButtonProps {
  variant?: ButtonVariant;            // default 'primary'
  size?: 'sm' | 'md' | 'lg';          // default 'md' (h-10)
  type?: 'button' | 'submit';
  loading?: boolean;                  // แสดง Spinner แทน label, ปิดการคลิก
  success?: boolean;                  // แสดง ✓ 1.5 วินาทีแล้วกลับ default (จัดการโดย hook useTransientSuccess)
  disabled?: boolean;
  fullWidth?: boolean;
  iconLeft?: ReactNode; iconRight?: ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;                // ต้องเป็น "กริยา" (06 §5)
}
```

| variant | ใช้เมื่อ | class |
|---|---|---|
| `primary` | ปุ่มหลักทั่วไป (ส่ง, บันทึก) | `bg-primary text-primary-contrast hover:opacity-90 active:scale-[0.98]` |
| `accent` | CTA สำคัญที่สุดของหน้า **หน้าละ 1 ปุ่ม** (ทดสอบและเริ่ม, ส่งออก PDF) | `bg-accent text-accent-contrast` |
| `outline` | รอง | `border border-line bg-surface text-fg hover:bg-surface-2` |
| `ghost` | ในแถบเครื่องมือ | `text-fg hover:bg-surface-2` |
| `danger` | ทำลายข้อมูล (ล้าง key) | `bg-surface text-danger border border-danger hover:bg-surface-2` |

- ร่วมทุก variant: `inline-flex items-center gap-2 rounded-sm px-4 min-h-10 font-medium transition-[transform,background-color,opacity] duration-fast ease-out`
- `disabled`: `opacity-50 cursor-not-allowed` + `aria-disabled` (ยังโฟกัสได้เพื่อให้ screen reader อ่านเหตุผล) + `title` อธิบายว่าทำไมกดไม่ได้
- a11y: `<button>` จริงเท่านั้น; ตอน `loading` ใส่ `aria-busy="true"` และข้อความ `a11y.spinner`; ตอน `success` ประกาศผ่าน `aria-live="polite"`
- keyboard: Enter/Space; ปุ่ม `accent` ห้ามผูก autofocus ในกล่องยืนยันที่เป็นการลบ

## 2. IconButton

```ts
interface IconButtonProps { label: string; icon: ReactNode; size?: 'sm'|'md'; variant?: 'ghost'|'outline'; loading?: boolean; onClick(): void; }
```
- `label` บังคับ → `aria-label`; ห้ามใช้ `title` แทน
- `min-h-10 min-w-10 rounded-sm text-fg-muted hover:text-fg hover:bg-surface-2`
- ถ้าเป็น toggle: `aria-pressed`

## 3. Input

```ts
interface InputProps {
  id: string; label: string; value: string; onChange(v: string): void;
  type?: 'text' | 'password' | 'number';
  placeholder?: string; help?: string; error?: string | null;
  required?: boolean; disabled?: boolean; readOnly?: boolean;
  suffix?: ReactNode;          // เช่น "บาท", ปุ่มแสดง/ซ่อน key
  inputMode?: 'text' | 'decimal' | 'numeric';
  autoComplete?: 'off';        // ฟิลด์ key บังคับ 'off' + spellCheck=false + data-1p-ignore
}
```
- class: `min-h-10 w-full rounded-sm border border-fg-muted bg-surface px-3 text-fg placeholder:text-fg-muted`
  **หมายเหตุ contrast**: ขอบฟอร์มใช้ `border-fg-muted` (≥ 4.5:1 กับพื้น) ไม่ใช่ `border-line` (ใช้เป็นเส้นแบ่งตกแต่งเท่านั้น ~1.2:1)
- error: `border-danger` + `<p id="{id}-error" class="text-danger text-sm">` + `aria-invalid="true" aria-describedby="{id}-error {id}-help"`
- help: `text-fg-muted text-sm`
- ตัวเลข: `text-right tabular-nums`; ตรวจ inline ตอน blur (ไม่ใช่ทุก keystroke)
- ฟิลด์ API key: `type=password` + IconButton แสดง/ซ่อน (`a11y.showPassword/hidePassword`), ห้ามใส่ `name` ที่ browser จะจำ, ห้าม log ค่า

## 4. Textarea (Composer)

```ts
interface TextareaProps {
  value: string; onChange(v: string): void; onSubmit(): void;
  placeholder?: string; maxRows?: number;   // default 10 แล้ว scroll
  disabled?: boolean; busy?: boolean;       // ระหว่าง streaming → ปุ่มกลายเป็น "หยุด"
  label: string;                            // a11y.chatComposer
}
```
- autosize (วัดจาก `scrollHeight`), `rounded-md border border-line bg-surface p-3`
- keyboard: Enter = ส่ง, Shift+Enter = ขึ้นบรรทัด, `Ctrl/⌘+K` (global) โฟกัสที่นี่, Esc = เลิกโฟกัส (ไม่ล้างข้อความ)
- IME: ห้ามส่งเมื่อ `isComposing === true`

## 5. Select

```ts
interface SelectOption<T> { value: T; label: string; help?: string; disabled?: boolean }
interface SelectProps<T> { id: string; label: string; value: T; options: SelectOption<T>[]; onChange(v: T): void; disabled?: boolean; help?: string }
```
- ใช้ `<select>` ของ browser (เข้าถึงง่ายที่สุด, ไม่มี dependency) + ลูกศรวาดเอง; class เหมือน Input
- ถ้าต้องมี `help` ต่อ option (เช่น เลือกโมเดล) ให้แสดง `help` ของ option ที่เลือกไว้ใต้ select แทน custom listbox

## 6. Switch

```ts
interface SwitchProps { id: string; label: string; checked: boolean; onChange(v: boolean): void; help?: string; disabled?: boolean }
```
- `role="switch"` + `aria-checked` (ใช้ `<button>`); track `bg-surface-2` → `bg-primary` เมื่อ on; knob `bg-surface shadow-1`
- ต้องมีข้อความสถานะข้าง ๆ ("เปิด"/"ปิด") ไม่ใช้ตำแหน่ง/สีอย่างเดียว
- ใช้กับ `settings.webSearchLabel` — เมื่อปิดต้องแสดง `settings.webSearchOffNotice`

## 7. Badge

```ts
type BasisKind = 'historical' | 'market' | 'estimate';
type ConfidenceLevel = 'high' | 'medium' | 'low';
type FlagKind = 'upstream_ocr' | 'source_incomplete' | 'group_total_mismatch' | 'low_specificity' | 'scanned_no_text' | 'estimate_no_source' | 'unresolved_citation' | 'user_edited';

interface BasisBadgeProps { kind: BasisKind; size?: 'sm'|'md'; showLabel?: boolean; onClick?(): void }
interface ConfidenceBadgeProps { level: ConfidenceLevel; reason?: string }
interface FlagBadgeProps { kind: FlagKind; params?: Record<string, string | number> }
```

**BasisBadge** (หัวใจของ N3 — ห้ามพึ่งสีอย่างเดียว):

| kind | ไอคอน | ข้อความ | class |
|---|---|---|---|
| historical | `▣` | จากงบจริง | `text-basis-historical bg-basis-historical-bg` |
| market | `◆` | ราคาตลาด | `text-basis-market bg-basis-market-bg` |
| estimate | `◌` | ประมาณการ | `text-basis-estimate bg-basis-estimate-bg` |

- class ร่วม: `inline-flex items-center gap-1 rounded-sm px-2 min-h-8 text-sm font-medium`
- `showLabel=false` ได้เฉพาะเมื่อคอลัมน์มีหัวตาราง "ที่มา" กำกับอยู่แล้ว และต้องมี `aria-label` = `a11y.basisBadge`
- ถ้ามี `onClick` → เป็น `<button>` (เปิด citation drawer) + `hover:brightness-95` + cursor-pointer
- **`estimate` ต้องมีคำว่า "ประมาณการ" เสมอ** แม้ `showLabel=false` ก็ต้องอยู่ใน `aria-label` และ tooltip

**ConfidenceBadge**: `●●● / ●●○ / ●○○` (`text-fg-muted`, จุดที่ "ติด" ใช้ `text-fg`) + `aria-label` = `a11y.confidenceBadge` + Tooltip จาก `proposal.confidence.*Tooltip`; ห้ามใช้สีเป็นตัวแยกระดับ

**FlagBadge**: `bg-surface-2 text-fg-muted border border-line` + ไอคอน `!`; ถ้าเป็น `unresolved_citation` ใช้ `text-danger border-danger`; ทุกตัวมี Tooltip ข้อความเต็มจาก `citation.flags.*`

## 8. Chip (citation)

```ts
interface CitationChipProps {
  kind: 'budget_line' | 'document' | 'web' | 'econ';
  label: string;                 // เช่น "PBO 2566 · กรมพลังงาน" หรือ "Shopee"
  href?: string;                 // เฉพาะ kind='web'
  unresolved?: boolean;
  onOpenDrawer(): void;
}
```
- `kind='web'`: ตัว chip เป็น `<a target="_blank" rel="noopener noreferrer">` เปิดแท็บใหม่ **ทันที** + ไอคอน ↗ + ปุ่มเล็ก `ⓘ` ข้าง ๆ เปิด drawer (สองปุ่มแยก target แตะได้)
- kind อื่น: `<button>` เปิด drawer
- `unresolved`: `bg-surface-2 text-fg-muted line-through-none border-dashed border border-danger` + FlagBadge `อ้างอิงไม่พบ`
- class: `inline-flex items-center gap-1 rounded-sm bg-surface-2 px-2 min-h-8 text-sm hover:bg-surface`

## 9. Card

```ts
interface CardProps { as?: 'div'|'section'|'article'; interactive?: boolean; padded?: boolean; title?: string; actions?: ReactNode; children: ReactNode }
```
- `bg-surface border border-line rounded-md shadow-1 p-4`
- `interactive`: `hover:-translate-y-0.5 hover:shadow-2 transition duration-fast ease-out` (การ์ดที่คลิกได้ต้องมี `<button>`/`<a>` ข้างในเป็น target จริง ห้ามผูก onClick ที่ div)

## 10. Table (BOQ)

```ts
interface Column<Row> {
  id: string; header: string; align?: 'left'|'right';
  width?: string; sticky?: boolean;
  render(row: Row): ReactNode;
  sortable?: boolean;
}
interface TableProps<Row> {
  caption: string;                       // บังคับ (a11y)
  columns: Column<Row>[]; rows: Row[];
  groupBy?: (row: Row) => string;        // หมวด → subtotal
  renderSubtotal?(group: string, rows: Row[]): ReactNode;
  loading?: boolean; emptyState?: ReactNode;
  stickyHeader?: boolean;                // default true
  mobileCard?(row: Row): ReactNode;      // < 768px ใช้ card list
}
```
- `<caption class="sr-only">`, `<th scope="col">`, แถวหมวดใช้ `<th scope="rowgroup">`
- sticky header: `sticky top-0 z-10 bg-surface border-b border-line` (ไม่ใช้เงา)
- zebra: ใช้ `odd:bg-surface-2/40` เท่านั้น (อย่าใช้สีอื่น); แถวที่ผู้ใช้แก้: `border-l-2 border-accent` + FlagBadge `user_edited`
- แถวใหม่จาก AI: highlight `bg-basis-historical-bg` แล้วจางใน 1.2 วินาที (motion.md)
- sort: `aria-sort` + `a11y.sortAscending/Descending`
- loading: Skeleton 5 แถว; empty: `proposal.boq.emptyTitle/emptyBody`

## 11. Drawer (citation)

```ts
interface DrawerProps { open: boolean; onClose(): void; title: string; width?: 480; children: ReactNode; footer?: ReactNode }
```
- `role="dialog" aria-modal="true" aria-labelledby` + **focus trap** + คืนโฟกัสไปยัง element ที่เปิด
- Esc ปิด; คลิก scrim ปิด; scrim `bg-[color:var(--text)]/30` (ใช้ token ผ่าน arbitrary value เฉพาะกรณี overlay)
- desktop: ขวา 480px `shadow-2 border-l border-line`; มือถือ: เต็มจอ + ปุ่มปิดบนซ้าย
- มี `aria-live="polite"` สำหรับผลของ "ดูแถวใกล้เคียง"

## 12. Dialog (export / ยืนยัน)

```ts
interface DialogProps { open: boolean; onClose(): void; title: string; description?: string; size?: 'sm'|'md'|'lg'; children: ReactNode; primaryAction?: {label: string; onClick(): void; loading?: boolean; variant?: ButtonVariant}; secondaryAction?: {label: string; onClick(): void} }
```
- เหมือน Drawer เรื่อง a11y; `<dialog>` element + polyfill focus trap ของเราเอง
- ปุ่มยืนยันการลบ/ล้าง key: ปุ่มหลักเป็น `danger`, โฟกัสเริ่มต้นอยู่ที่ "ยกเลิก"

## 13. Toast

```ts
interface Toast { id: string; kind: 'info'|'success'|'warn'|'error'; message: string; action?: {label: string; onClick(): void}; duration?: number }  // error = ไม่หายเอง
```
- container `role="status" aria-live="polite"` (kind='error' ใช้ `role="alert"`), มุมขวาล่าง, ซ้อนได้ ≤ 3 (เกินนั้นรวมเป็น "+N")
- สีเป็นแถบซ้าย 3px (`border-l-4 border-success|warn|danger|info`) + ไอคอน + ข้อความ — **ห้ามใช้พื้นสีเต็ม**
- ต้องมีปุ่มปิด (`toast.dismiss`) และหยุดนับถอยหลังเมื่อ hover/focus

## 14. Meter (cost)

```ts
interface MeterProps { value: number; max: number; label: string; format?: (n: number) => string; thresholds?: { warn: number; danger: number } } // default warn .8 danger 1
```
- `role="meter"` (fallback `progressbar`) + `aria-valuenow/min/max` + `aria-label` = `a11y.costMeter`
- แท่ง `h-1.5 rounded-sm bg-surface-2`, fill `bg-primary` → `bg-warn` ≥ 80% → `bg-accent` ≥ 100%
- ข้างแท่งมีตัวเลข `{used} จาก {limit} ดอลลาร์` เสมอ (ไม่พึ่งสี) + Tooltip `workspace.costMeterTooltip`

## 15. Popover / Tooltip

```ts
interface TooltipProps { content: string; children: ReactElement; placement?: 'top'|'bottom'|'left'|'right' }
interface PopoverProps { trigger: ReactElement; title?: string; children: ReactNode; onOpenChange?(open: boolean): void }
```
- **Tooltip** = ข้อความสั้นอย่างเดียว, แสดงเมื่อ hover **และ** focus, ผูกด้วย `aria-describedby`, หน่วง 200ms, Esc ปิด, ห้ามใส่ปุ่มข้างใน, ห้ามเป็นที่อยู่เดียวของข้อมูลสำคัญ
- **Popover** = มีเนื้อหา/ปุ่มได้ (ⓘ เหตุผลของบรรทัด BOQ), `<button aria-expanded aria-controls>`, focus เข้าไปข้างใน, Esc/คลิกนอกปิด, `bg-surface border border-line rounded-md shadow-2 p-3 max-w-80`
- บนมือถือ Tooltip → กดแล้วเปิดเป็น Popover

## 16. Accordion

```ts
interface AccordionItemProps { id: string; title: string; defaultOpen?: boolean; badge?: ReactNode; children: ReactNode }
```
- `<button aria-expanded aria-controls>` + `<section role="region" aria-labelledby>`
- desktop เปิดทุก section โดย default; มือถือเปิดเฉพาะ "สรุป" + "BOQ"
- หัวข้อ sticky ภายใน pane (`sticky top-0 bg-surface z-[1]`)

## 17. Tabs

```ts
interface TabsProps { tabs: {id: string; label: string; badge?: number}[]; active: string; onChange(id: string): void; ariaLabel: string }
```
- `role="tablist"` + `role="tab" aria-selected aria-controls` + `role="tabpanel" tabIndex=0`
- keyboard: ←/→ เลื่อน, Home/End
- ใช้ที่: สลับ pane บนมือถือ (บทสนทนา / ข้อเสนอ), version selector แบบกว้าง

## 18. Skeleton

```ts
interface SkeletonProps { variant: 'text'|'block'|'row'|'card'; lines?: number; width?: string; height?: string }
```
- `bg-surface-2 rounded-sm` + pulse เบา (opacity 1 → .6 → 1, 1.4s); `prefers-reduced-motion` → คงที่
- `aria-hidden="true"` เสมอ และต้องมีข้อความสถานะจริง (`data.loadingEngine` ฯ) ใน live region คู่กัน

## 19. Spinner

```ts
interface SpinnerProps { size?: 12|16|24; label?: string }   // label default a11y.spinner
```
- วงแหวน `border-2 border-line border-t-primary animate-spin`; ใน Button ใช้ `border-t-primary-contrast`
- reduced-motion: หมุนช้าลงเป็น 1.6s (ไม่ตัดทิ้ง เพราะเป็นตัวบอก "ยังทำงานอยู่")

## 20. ExternalLink

```ts
interface ExternalLinkProps { href: string; children: ReactNode; showDomain?: boolean }
```
- บังคับ `target="_blank" rel="noopener noreferrer"` + ไอคอน ↗ + `aria-label` = `a11y.externalLink`
- แสดง/copy URL เต็มได้ (`font-mono text-sm break-all`); ตรวจว่า scheme เป็น `https:` เท่านั้น ไม่งั้น render เป็นข้อความธรรมดา
- **ห้าม** fetch ปลายทาง (N5) — เป็นลิงก์เท่านั้น

## 21. Sparkline

```ts
interface SparklineProps { points: {year: number; median: number; n: number}[]; width?: 96; height?: 24; ariaLabel: string }
```
- SVG เขียนเอง (ไม่ต้องใช้ Recharts เพื่อความเบา): `stroke-[var(--basis-historical)] stroke-2 fill-none`, จุดสุดท้ายเป็นวงกลม r=2
- hover/focus จุด → Tooltip `proposal.boq.trendTooltip`
- `role="img"` + `aria-label` = `a11y.sparkline`; ต้องมีตัวเลขกำกับในคอลัมน์ข้าง ๆ เสมอ (กราฟไม่ใช่ที่เดียวที่มีข้อมูล)
- ข้อมูล < 2 จุด → แสดง `proposal.boq.trendEmpty` แทน

## 22. TrendChart (Recharts)

```ts
interface TrendChartProps { series: {year: number; value: number}[]; unit: string; highlightYear?: number; height?: 160; ariaLabel: string; showTable?: boolean }
```
- เส้นเดียว `stroke=var(--primary)` 2px, จุดเฉพาะปีที่ highlight (`--accent`), grid เส้นบาง `--border`, แกนใช้ พ.ศ.
- ไม่มีพื้นไล่สี; tooltip ใช้สไตล์ Popover ของเรา
- `showTable` → มี `<table class="sr-only">` ค่าทุกปี (a11y fallback ของกราฟ)

## 23. StatCard

```ts
interface StatCardProps {
  indicator: string; value: string; unit: string; year: number;
  delta?: { percent: number; fromYear: number };
  series: {year: number; value: number}[];
  source: string; verified: boolean;
  onOpenDetail(): void;
}
```
- Card + ชื่อตัวชี้วัด (`text-fg-muted text-sm`) + ค่าใหญ่ `text-2xl tabular-nums`
- delta: ขึ้น = `text-warn ▲` / ลง = `text-success ▼` / ทรงตัว = `text-fg-muted ▬` **พร้อมข้อความเต็ม** (`proposal.stat.deltaUp` ฯ) — ห้ามใช้ลูกศร+สีอย่างเดียว
- `verified=false` → FlagBadge `ยังไม่ตรวจสอบ` + Tooltip `proposal.stat.unverifiedTooltip`
- ทั้งการ์ดต้องมีปุ่ม "ดูรายละเอียดตัวชี้วัด" (เปิด drawer econ); แถวการ์ด `overflow-x-auto snap-x` บนมือถือ

## 24. IllustrationFrame (+ Lightbox)

```ts
interface IllustrationFrameProps {
  illustration: { id: string; title: string; caption: string; kind: 'map'|'cross_section'|'isometric'|'diagram'; svg: string };
  sanitizeWarnings?: string[];
  onRegenerate?(): void; onHide?(): void;
  thumbnails?: { id: string; title: string }[];
  onSelect?(id: string): void;
}
```
- **บังคับ**: render ด้วย `sanitizeSvg(svg).node()` แล้ว `ref.appendChild(node)` — ห้าม `dangerouslySetInnerHTML` (N9, T-307)
- กรอบ: `aspect-video bg-surface-2 rounded-md border border-line overflow-hidden` + `contain: content`
- ป้ายมุมล่างซ้าย `proposal.illustration.aiBadge` (`bg-surface/90 text-fg-muted text-xs rounded-sm px-2`) — ต้องเห็นเสมอ ห้ามซ่อนตอน hover
- caption ใต้ภาพ; ถ้า `sanitizeWarnings.length` → FlagBadge + Popover รายการที่ถูกตัด
- `sanitizeSvg` fail → กล่อง `proposal.illustration.failed` + ปุ่ม "สร้างภาพใหม่"
- Lightbox = Dialog size lg, ภาพ `max-h-[80vh]`, Esc ปิด, ←/→ สลับภาพ, `role="img" aria-label` = `a11y.illustration`
- pointer-events ของ SVG: `pointer-events-none` (ภาพเป็นเนื้อหา ไม่ใช่ UI)

## 25. ToolActivityCard (chat)

```ts
interface ToolActivityCardProps {
  tool: 'search_catalog'|'query_budget_lines'|'get_budget_line'|'find_documents'|'read_document'|'get_econ_indicator'|'adjust_for_inflation'|'get_price_trend'|'emit_illustration'|'emit_proposal'|'web_search';
  status: 'running'|'done'|'empty'|'error'|'cancelled';
  params: Record<string, string | number>;   // เติมลง copy chat.tool.<tool>.<status>
  rowCount?: number; durationMs?: number;
  onViewResults?(): void;                    // เปิด drawer ตาราง ≤ 50 แถว
  onRetry?(): void;
}
```
- `bg-surface-2 border border-line rounded-sm px-3 py-2 text-sm` + ไอคอนตาม tool + ข้อความจาก `chat.tool.*`
- `running`: progress pulse (แถบบาง 2px ด้านล่าง) + `aria-live="polite"` ประกาศครั้งเดียวตอนเริ่ม/จบ (ห้ามประกาศทุก tick)
- `done`: ไอคอน ✓ `text-success`; `error`: `text-danger` + ปุ่ม "เรียกใหม่"; `empty`: `text-fg-muted`
- ต้องบอก **ทุกครั้ง** ว่าค้นอะไร/ได้กี่แถว (โปร่งใสว่า AI ใช้ข้อมูลอะไร)

---

## 26. Matrix สถานะ × component (checklist ตอน implement)

| Component | hover | focus-visible | active | disabled | loading | success | error |
|---|---|---|---|---|---|---|---|
| Button | opacity/bg | ring-focus | scale .98 | opacity 50 | Spinner + aria-busy | ✓ 1.5s | inline error ใต้ปุ่ม |
| IconButton | bg-surface-2 | ring-focus | scale .98 | opacity 50 | Spinner | ไอคอน ✓ | Tooltip error |
| Input | border-fg | ring-focus | – | bg-surface-2 | – | border-success 1.5s | border-danger + ข้อความ |
| Select/Switch | bg-surface-2 | ring-focus | – | opacity 50 | – | – | ข้อความใต้ฟิลด์ |
| Chip/Badge | brightness 95% | ring-focus | – | – | – | – | unresolved style |
| Card(interactive) | -2px + shadow-2 | ring-focus | translate 0 | – | Skeleton | – | – |
| Table row | bg-surface-2 | ring ที่ cell | – | – | Skeleton row | highlight fade | แถว flag |
| Drawer/Dialog | – | focus trap | – | – | Skeleton | – | ErrorState ข้างใน |
| Meter | – | – | – | – | pulse | – | สี accent + ข้อความ |
| IllustrationFrame | ปุ่มลอยขึ้น | ring-focus | – | – | Skeleton 16:9 | – | กล่อง failed |

## 27. สิ่งที่ยังไม่ตัดสินใจ / [UNVERIFIED]
- ไอคอนชุดไหน: ร่างนี้ใช้ **inline SVG เขียนเอง** (stroke 2px, 20×20) ไม่เพิ่ม dependency; ถ้า frontend-dev อยากใช้ไลบรารีไอคอน ให้เปิด ADR
- ค่าสีธงชาติใน tokens ยัง `[UNVERIFIED]` (ดูหัวไฟล์ `tokens.css`)
