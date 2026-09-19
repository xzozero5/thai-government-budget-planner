# 05 — Features, User Stories, AI Tool Spec, Proposal Schema

Owner: `po` (stories/AC) · `ai-engineer` (§3–5) · `frontend-dev` (§6)

## 1. User stories + Acceptance criteria

### F1 Key gate
- **US-1.1** ในฐานะผู้ใช้ ฉันใส่ Anthropic API key ของตัวเองแล้วเริ่มใช้ได้ทันที
  - AC: ช่องกรอกเป็น `type=password`, ปุ่ม "ทดสอบ key" เรียก `messages.count_tokens` (ไม่มีค่าใช้จ่ายสำคัญ) สำเร็จ → ไปหน้าแชท; ล้มเหลว → ข้อความ error ภาษาไทยที่แยกกรณี 401/403/429/network
  - AC: key ไม่ปรากฏใน localStorage/sessionStorage/cookie/URL/document; refresh หน้า = ต้องใส่ใหม่ (มีคำอธิบายบอกผู้ใช้ล่วงหน้า)
  - AC: มีปุ่ม "ล้าง key และออก" ทุกหน้า; เมื่อ tab ซ่อนนาน > 60 นาที → ล้าง key อัตโนมัติ (แจ้งเตือน)
  - AC: เลือก model ได้ (Sonnet default) และตั้ง `max budget (USD)` ต่อ session — เตือนเมื่อถึง 80 % และหยุดที่ 100 %
- **US-1.2** ฉันเห็นอย่างชัดเจนว่าข้อมูลถูกส่งไปที่ไหน — หน้า key gate มี "สิ่งที่ส่งออกจากเครื่องคุณ: เฉพาะข้อความแชทและผลค้นข้อมูลที่ AI ขอ ไป api.anthropic.com เท่านั้น"

### F2 Interview chat
- **US-2.1** ฉันพิมพ์ไอเดียโครงการเป็นภาษาไทยแบบหลวม ๆ แล้ว AI ถามคำถามที่จำเป็นทีละชุด (≤ 4 คำถาม/turn) จนครบ
  - AC: ก่อน `emit_proposal` ครั้งแรก AI ต้องมีข้อมูลขั้นต่ำ: ประเภทโครงการ, พื้นที่/หน่วยงานเจ้าของ (หรือ "ไม่ระบุ"), ขนาด/ปริมาณ, กลุ่มเป้าหมาย, ปีงบที่จะเทียบ — ถ้าผู้ใช้ตอบ "ไม่รู้" ให้ AI ตั้งสมมติฐานและระบุใน `assumptions`
  - AC: ผู้ใช้กด "ข้ามคำถาม สรุปเลย" ได้ทุกเมื่อ → AI ต้อง emit proposal ด้วยสมมติฐาน
- **US-2.2** ระหว่าง AI ค้นข้อมูล ฉันเห็นว่า AI กำลังทำอะไร ("กำลังค้นราคาเครื่องปรับอากาศในงบปี 2566–2568…", "กำลังค้นราคาตลาด…") และผลลัพธ์ย่อ (จำนวนแถวที่พบ)
- **US-2.3** Streaming ข้อความ, ยกเลิกกลางคันได้, ข้อความ error กู้คืนได้ (retry turn ล่าสุด)

### F3 Proposal
- **US-3.1** ฉันได้ข้อเสนอโครงการที่มี: ชื่อ, สรุป, วัตถุประสงค์, ขอบเขต/สเปค, BOQ, สมมติฐาน, ความเสี่ยง, โครงการเทียบเคียงในอดีต, สรุปรวมเงิน
  - AC: ทุกบรรทัด BOQ มี `basis ∈ {historical, market, estimate}`, `rationale` (≥ 1 ประโยค), `confidence ∈ {high, medium, low}`, และ `citations[]` (ว่างได้เฉพาะ `estimate`)
  - AC: บรรทัด `historical` ต้องมี ≥ 1 citation ที่ resolve ได้ใน ToolLog; ไม่งั้น UI ลดเป็น `estimate` + badge "อ้างอิงไม่พบ"
  - AC: ตัวเลข historical ที่ปรับเงินเฟ้อ ต้องแสดงทั้งค่าเดิม ปีเดิม และค่าปรับแล้ว พร้อม indicator ที่ใช้
- **US-3.2** ฉันแก้ qty/unit price ในตารางได้ → ยอดรวมคำนวณใหม่ทันที และมีปุ่ม "ให้ AI ทบทวนจากที่แก้"
- **US-3.3** ฉันดูเวอร์ชันก่อนหน้าได้ (proposal history ใน session)

### F4 Citations
- **US-4.1** คลิกตัวเลข/badge → drawer แสดง: dataset, ปีงบ, หน่วยงาน, ชื่อรายการเต็ม, จำนวนเงิน (ทุกคอลัมน์ที่มี), ไฟล์ต้นทาง (path เต็ม copy ได้), ชีต/แถว หรือ หน้า, และ excerpt/แถวดิบ
  - AC: ถ้ามี `VITE_SOURCE_BASE_URL` → แสดงลิงก์เปิดไฟล์ (PDF ต่อท้าย `#page=N`); ถ้าไม่มี → แสดง path + "เปิดไฟล์นี้ในเครื่องคุณ"
  - AC: เอกสารที่ `has_text_layer:false` แสดงป้าย "เอกสารสแกน — ระบบไม่ได้อ่านเนื้อหา แนะนำเปิดดูเอง"
- **US-4.2** หน้า "แหล่งอ้างอิงทั้งหมด" ของ proposal รวม citation ทุกบรรทัด + web sources (URL, วันที่ค้น)
- **US-4.3** (เพิ่ม 19 ก.ย.) citation จากเว็บ (Shopee/Lazada/ผู้ขาย) ต้อง **กดเปิดในแท็บใหม่ได้ทุกที่ที่ปรากฏ**: chip ในบรรทัด BOQ, citation drawer, การ์ดราคาตลาด, หน้าแหล่งอ้างอิงทั้งหมด, ข้อความแชท (markdown link) และใน PDF (link annotation)
  - AC: `<a href target="_blank" rel="noopener noreferrer">` เท่านั้น; แสดงชื่อร้าน/โดเมน + ไอคอน external-link + ราคาที่พบ + วันที่ค้น; URL ต้องเป็น `https://` (อื่น ๆ แสดงเป็นข้อความไม่ใช่ลิงก์)
  - AC: มีปุ่ม copy URL; hover/focus แสดง URL เต็ม; คีย์บอร์ด Enter เปิดได้
  - AC: ลิงก์ที่ AI อ้างต้องเป็น URL ที่ปรากฏใน web_search result ของ session (ตรวจใน validator เหมือน source_id) — ไม่ผ่านให้ลดเป็น `estimate` + badge "ลิงก์ไม่พบ" 

### F5 Export / Save
- **US-5.1** Export PDF: หน้าปก, สรุป, BOQ (ตารางข้ามหน้าได้), สมมติฐาน/ความเสี่ยง, appendix แหล่งอ้างอิง (path + sheet/row/page + excerpt), footer มี วันที่/เวลา (พ.ศ.), model ที่ใช้, disclaimer
- **US-5.2** Save `.tgbp.json` / Load กลับมาแสดงได้โดยไม่ต้องใส่ key (read-only จนกว่าจะใส่ key เพื่อคุยต่อ)

### F7 ภาพประกอบโครงการ (SVG) — เพิ่ม 19 ก.ย.
- **US-7.1** เมื่อโครงการเป็นสิ่งก่อสร้าง/โครงสร้างพื้นฐาน/โครงการใหญ่ ฉันเห็นภาพประกอบเชิงแผนผังที่ช่วยให้เข้าใจ (เช่น ถนน 4 เลน กทม.–นครนายก: แผนที่เส้นทางอย่างง่าย + cross-section ถนนพร้อมมิติ)
  - AC: proposal มี `illustrations[]` (0–3 ภาพ) แต่ละภาพมี `title`, `caption` (บอกว่าเป็นภาพเชิงแผนผัง ไม่ใช่แบบก่อสร้างจริง), `kind`, `svg` ที่ผ่าน sanitizer แล้ว; render ในส่วน "ภาพรวมโครงการ" ด้านบน proposal และใน PDF
  - AC: SVG ใช้สีจาก design tokens (ส่ง palette ให้ AI), มี viewBox, responsive, ขนาด ≤ 60 KB; ถ้า sanitizer ตัดอะไรออก → บันทึก warning และยังแสดงได้
  - AC: ผู้ใช้กด "สร้างภาพใหม่" / "ไม่ต้องมีภาพ" ได้; ภาพไม่ถูกนับเป็นหลักฐาน (ไม่มี citation) และมีป้าย "ภาพประกอบโดย AI"
- **US-7.2** ภาพต้องไม่ทำให้เข้าใจผิดเรื่องตัวเลข: ห้ามใส่ตัวเลขเงินในภาพ ยกเว้นมิติทางกายภาพที่มาจาก requirement (ความกว้าง/ยาว/จำนวนเลน)

### F8 Trend charts — เพิ่ม 19 ก.ย.
- **US-8.1** บรรทัด BOQ ที่ basis=historical มี sparkline ราคาต่อหน่วยย้อนหลัง (≤ 10 ปี) จาก catalog; hover เห็นปี/ค่ามัธยฐาน/จำนวนรายการ
- **US-8.2** เมื่อ AI อ้างตัวชี้วัด (เช่น ดัชนีราคาเหล็ก, CPI, น้ำมัน) การ์ดสถิติแสดงกราฟเส้น 10 ปี + ค่าเปลี่ยนแปลง % ช่วงที่ใช้ + แหล่งที่มา + ป้าย verified
  - AC: กราฟ render จาก series ที่ได้จาก tool `get_price_trend` เท่านั้น; ไม่มี series → ไม่แสดงกราฟ (ไม่ประดิษฐ์)
  - AC: กระชับ: ไม่เกิน 1 กราฟต่อบรรทัด BOQ, ไม่เกิน 4 การ์ดสถิติต่อ proposal; รายละเอียดเพิ่มอยู่ใน drawer
- **US-8.3** PDF มีกราฟเดียวกัน (render เป็น PNG) ในส่วน "แนวโน้มราคาที่เกี่ยวข้อง"

### F6 Data browser (nice-to-have หลัง MVP ถ้าเวลาเหลือ)
- ค้น catalog ด้วยตัวเอง ดูกราฟราคาต่อหน่วยข้ามปี

## 2. Non-functional
- ภาษาไทยทั้ง UI; ตัวเลข `th-TH`; พ.ศ.
- Keyboard-accessible, contrast ≥ 4.5:1, focus visible (ดู 06-UI-SPEC)
- ทำงานบน Chrome/Edge ล่าสุด (primary), Safari/Firefox (should work; `Intl.Segmenter` fallback)
- ไม่มี analytics/telemetry ใด ๆ

## 3. AI tools (client tools) — ทุกตัวมี Zod schema ใน `web/src/ai/tools/*.ts`

| tool | input | output (ย่อ) | หมายเหตุ |
|---|---|---|---|
| `search_catalog` | `{query: string, fiscal_years?: int[], gov_level?: "central"\|"local", budget_type?: string, limit?: int ≤ 20}` | `{items: CatalogItem[], total: int}` | MiniSearch fuzzy บน item_key/display_name/spec_tokens; คืนสถิติราคาต่อหน่วยรายปี |
| `query_budget_lines` | `{item_key?: string, keywords?: string[], fiscal_years?: int[], ministry_code?: string, agency?: string, province?: string, dataset?: string[], min_amount?: int, max_amount?: int, order_by?: "amount_desc"\|"unit_price_asc"\|..., limit?: int ≤ 50}` | `{rows: BudgetLineLite[], total: int, shards_loaded: string[]}` | ผ่าน `repo.queryLines` → DuckDB; **ไม่ให้ AI เขียน SQL เอง** (ปลอดภัย/ควบคุมขนาด) |
| `get_budget_line` | `{source_ids: string[] ≤ 20}` | `{lines: BudgetLine[]}` | ดึงแถวเต็มสำหรับ citation |
| `find_documents` | `{query: string, collection?: string, agency?: string, fiscal_year?: int, has_text_only?: boolean, limit?: int ≤ 10}` | `{docs: SourceDocLite[]}` | ค้น sources.json (title/topic/agency) |
| `read_document` | `{doc_id: string, query?: string, pages?: int[], max_chunks?: int ≤ 6}` | `{doc: SourceDocLite, chunks: DocChunk[]}` | เฉพาะ `has_text_layer`; ถ้าไม่ → คืน metadata + note |
| `get_econ_indicator` | `{indicators: string[], years_be: int[]}` | `{values: EconIndicator[]}` | จาก econ/indicators.json (มี `verified`) |
| `adjust_for_inflation` | `{amount_thb: int, from_year_be: int, to_year_be: int, indicator?: "cpi_headline_index"\|"construction_material_index"}` | `{adjusted_thb, factor, from_value, to_value, source}` | deterministic; ให้ AI ใช้แทนคำนวณเอง |
| `get_price_trend` | `{kind: "item"\|"indicator", key: string, years_be?: [int,int]}` | `{series: {label_th, unit, points:[{year_be, value, n?}], source, verified?}, summary: {first, last, change_pct}}` | item → `catalog/trends`, indicator → econ series; ไม่มี → `{series: null}` |
| `emit_illustration` | `{title, caption, kind, svg}` | `{ok, illustration_id, warnings[]}` | sanitize + ตรวจขนาด/viewBox; ใช้ได้สูงสุด 3 ครั้งต่อ proposal |
| `emit_proposal` | `Proposal` (§5) | `{ok: true, proposal_id, warnings[]}` | UI validate citations กับ ToolLog; คืน warnings ให้ AI แก้ |
| (server) `web_search` | Anthropic-managed | | `max_uses: 5` ต่อ turn; ให้ AI ระบุ `site:shopee.co.th` / `lazada.co.th` / ชื่อผู้ขายในคำค้น; ผลลัพธ์ต้องถูกใส่ใน `citations[]` แบบ `{kind:"web", url, title, retrieved_at, price_note}` |

กติกา tool result: ≤ 50 แถว, ตัด string ยาว > 300 ตัวอักษร (คง item_name เต็มไว้), แนบ `total` เสมอ, ทุก object มี `source_id`

## 4. System prompt (โครง — ไฟล์จริง `web/src/ai/systemPrompt.ts`, ใช้ prompt caching)

```
คุณคือผู้ช่วยประเมินงบประมาณโครงการภาครัฐไทย สำหรับประชาชน/สื่อ/สส. ที่ตรวจสอบงบ
หน้าที่: (1) สัมภาษณ์ให้ได้ requirement (2) ค้นข้อมูลงบในอดีตด้วย tools (3) ค้นราคาตลาดด้วย web_search (4) สร้างข้อเสนอผ่าน emit_proposal

กฎเหล็ก:
- ตัวเลขทุกตัวที่อ้างว่า "รัฐเคยตั้ง/เบิกจ่าย" ต้องมาจากผล tool ในบทสนทนานี้ และอ้าง source_id — ห้ามจำจากความรู้ทั่วไป
- ถ้าไม่พบข้อมูล ให้บอกตรง ๆ และใช้ basis="estimate" พร้อม confidence และเหตุผล
- ราคาข้ามปีต้องใช้ adjust_for_inflation (ห้ามคำนวณเอง) และระบุปีฐาน
- ถามไม่เกิน 4 คำถามต่อครั้ง ถามเฉพาะที่กระทบตัวเลข; ผู้ใช้บอกให้สรุป → สรุปทันทีด้วยสมมติฐาน
- ราคาตลาดจาก web_search: ระบุ URL, เงื่อนไข (รวม VAT? ขายส่ง? ติดตั้ง?), และวันที่ค้น; ถ้าราคากระจายมากให้ให้ช่วง
- เปรียบเทียบกับ "โครงการคล้ายกันในอดีต" อย่างน้อย 3 รายการถ้ามี (ต่างหน่วยงาน/ปี) และชี้ความต่างของสเปค
- โครงการสิ่งก่อสร้าง/โครงสร้างพื้นฐาน หรือยอด ≥ 10 ล้านบาท: สร้างภาพประกอบเชิงแผนผัง 1–3 ภาพผ่าน emit_illustration ก่อน emit_proposal (SVG, viewBox="0 0 800 450", ใช้สีจาก <palette>, ตัวอักษรไทยได้, ห้าม script/รูปภายนอก/ตัวเลขเงิน) — ครุภัณฑ์ล้วน ๆ ไม่ต้องสร้าง
- ตัวเลขเชิงสถิติ (ราคาต่อหน่วย, ดัชนีราคาวัสดุ, CPI): เรียก get_price_trend แล้วอ้าง trend_ref ในบรรทัด BOQ/การ์ดสถิติ — UI จะวาดกราฟเอง ห้ามบรรยายตัวเลขรายปียาว ๆ ในข้อความ
- ภาษาไทย สุภาพ กระชับ ไม่ใช้ศัพท์ราชการเกินจำเป็น อธิบายให้คนทั่วไปเข้าใจ
- ห้ามแนะนำวิธีหลบเลี่ยงกฎหมาย/ระเบียบจัดซื้อ; ถ้าผู้ใช้ขอ ให้ปฏิเสธและอธิบายระเบียบที่เกี่ยวข้องแทน

ขั้นตอนมาตรฐาน: intake → search_catalog (คำกว้าง) → query_budget_lines (ปี/หน่วยงานเจาะ) → get_budget_line (แถวที่จะ cite) → get_econ_indicator/adjust → web_search (เฉพาะรายการที่ซื้อจากตลาดได้) → emit_proposal → รับ warnings → แก้ → emit อีกครั้ง

<ข้อมูลบริบทที่แนบให้ (cached)>: facets (ปี, กระทรวง, ประเภทงบที่มี), รายชื่อ indicator, คำอธิบาย dataset และข้อจำกัด (PDF สแกนอ่านไม่ได้), ตัวอย่างการเรียก tool ที่ดี 3 ตัวอย่าง
```
ผู้ใช้เลือก "โหมด" ได้: `ตรวจสอบ` (เน้นเทียบกับสิ่งที่รัฐเสนอ, ชี้ส่วนที่แพงผิดปกติ) / `ร่างโครงการ` (เน้นครบถ้วน) — โหมดเปลี่ยนแค่ย่อหน้าท้ายของ system prompt

## 5. Proposal schema (Zod → `web/src/ai/tools/proposal.ts`)

```ts
Proposal {
  version: 1
  title: string
  summary: string                      // 3–6 ประโยค
  mode: "audit" | "draft"
  requester_context: { area?: string, owner_agency?: string, target_group?: string, fiscal_year_be: number, duration_months?: number }
  objectives: string[]
  scope_and_specs: { section: string, items: string[] }[]
  assumptions: { text: string, impact: "high"|"medium"|"low" }[]
  boq: BoqLine[]
  totals: { subtotal_thb: number, contingency_pct?: number, contingency_thb?: number, vat_included: boolean, grand_total_thb: number }
  comparables: Comparable[]            // โครงการ/รายการคล้ายกันในอดีต
  risks: { text: string, mitigation?: string }[]
  audit_findings?: { text: string, severity: "info"|"warn"|"high", citations: Citation[] }[]   // โหมด audit
  open_questions: string[]
  citations_web: WebCitation[]
  illustrations: { illustration_id: string, title: string, caption: string, kind: "map"|"cross_section"|"isometric"|"diagram" }[]   // svg เก็บใน store แยก (ผ่าน emit_illustration)
  stat_cards: { trend_ref: TrendRef, headline_th: string }[]        // ≤ 4
}
TrendRef = { kind: "item"|"indicator", key: string }
BoqLine {
  id: string, category: string, item: string, spec?: string,
  qty: number, unit: string, unit_price_thb: number, total_thb: number,
  basis: "historical" | "market" | "estimate",
  confidence: "high" | "medium" | "low",
  rationale: string,
  price_derivation?: { from_amount_thb: number, from_year_be: number, to_year_be: number, indicator: string, factor: number },
  citations: Citation[]                // ≥1 ถ้า basis != estimate
  trend_ref?: TrendRef                 // sparkline (เฉพาะที่ get_price_trend คืน series)
}
Citation = { kind: "budget_line", source_id: string, note?: string }
         | { kind: "document", doc_id: string, page?: number, quote?: string }
         | { kind: "econ", indicator: string, year_be: number }
         | { kind: "web", url: string, title?: string, retrieved_at: string, price_note?: string }
Comparable { source_id: string, fiscal_year_be: number, agency: string, item_name: string, amount_thb: number, unit_price_thb?: number, similarity_note: string }
```
Validation ใน `emit_proposal` handler: `illustration_id`/`trend_ref` ต้องเคยผ่าน tool ในบทสนทนา (ToolLog) มิฉะนั้นตัดทิ้ง + warning; `total_thb == qty*unit_price` (±1 บาท), `grand_total` สอดคล้อง, citations resolve ได้ใน ToolLog, `historical` ต้องมี ≥ 1 `budget_line`/`document` citation, `market` ต้องมี ≥ 1 `web` → ไม่ผ่านคืน `warnings[]` (AI แก้ได้สูงสุด 2 รอบ แล้ว UI แสดงตามที่ได้พร้อม badge)

## 6. Eval set (ใช้ใน Phase 3 และ 6) — `web/tests/eval/cases.yaml`
20 โจทย์ครอบคลุม: ครุภัณฑ์ (แอร์, คอมพิวเตอร์, รถบรรทุก), สิ่งก่อสร้าง (ถนน คสล., ฝาย, ลานกีฬา, อาคาร), โครงการฝึกอบรม, ระบบ IT (ซอฟต์แวร์/จ้างพัฒนา), งบท้องถิ่น (อบต. จัดงานประเพณี), โจทย์ที่ข้อมูลไม่มี (ต้องตอบว่าไม่พบ), โจทย์ล่อให้ hallucinate (ถามราคาปี 2540), โจทย์โหมด audit (เทียบกับที่รัฐเสนอ)
แต่ละ case: `prompt_sequence[]`, `expected: {min_boq_lines, must_have_basis, must_cite_dataset, must_not_claim[]}` → runner (`npm run eval`, ต้องใส่ key ใน env เฉพาะเครื่อง dev) ให้คะแนน + เขียน `docs/eval-report.md`
