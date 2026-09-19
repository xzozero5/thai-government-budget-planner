# 07 — Testing Strategy

หลัก: **เขียน test พร้อม/ก่อนโค้ด** (test-first สำหรับ pure logic: parser, money, schema validation, citation integrity, inflation) · ทุก phase ปิดงานได้เมื่อ test เขียวและ coverage ของ `ai/`, `data/`, `pipeline/normalize` ≥ 80 % lines

## 1. Pyramid

| ชั้น | เครื่องมือ | ครอบคลุม | รันเมื่อ |
|---|---|---|---|
| Unit (Python) | pytest | thai_text, item_parser, money, org_master, header detector, hash, validators | ทุก commit |
| Unit (TS) | Vitest + RTL | Zod schemas, tool handlers (repo mocked), agent loop (SDK mocked), citation integrity, inflation, proposal totals, stores, components (Badge/Table/Drawer) | ทุก commit |
| Integration (TS) | Vitest + fixtures (`web/tests/fixtures/data/`) | DuckDB-WASM ใน Node (duckdb-wasm node build) query fixture parquet; MiniSearch index จาก fixture catalog | ทุก commit (ช้าได้ ≤ 60 s) |
| E2E | Playwright (Chromium, + WebKit smoke) | flow ทั้งหมดด้วย **mock Anthropic API** (route intercept) ตอบตาม script | ทุก PR / ก่อน release |
| Eval (AI จริง) | `npm run eval` (ต้องมี key ใน `.env.local`, ไม่รันใน CI) | 20 cases ใน `web/tests/eval/cases.yaml` | Phase 3 จบ, Phase 6, ก่อน release |
| Security | script + manual (09-SECURITY §5) | storage/network/CSP | Phase 3, 6 |
| a11y | `@axe-core/playwright` | หน้า KeyGate/Workspace/Drawer | Phase 6 |

## 2. Fixtures
- `pipeline/tests/fixtures/`: xlsx สร้างด้วย openpyxl ในเทสต์ (ไม่ commit ไบนารีใหญ่): pbo_mini (30 แถว ครอบ gotchas), act2570_mini, local_mini (ราชาเทวะ style + summary), province_subset_mini (มี title row), committee_generic
- `web/tests/fixtures/data/`: output ของ `tgbp sample --rows 1000` (commit ได้ ขนาดเล็ก < 2 MB) — โครงเดียวกับ production
- `web/tests/fixtures/anthropic/*.json`: ลำดับ response ของ API สำหรับ e2e (มี tool_use → tool_result → emit_proposal)

## 3. Test cases สำคัญ (ต้องมี)

### 3.1 pipeline
- item_parser: 200 ชื่อจริงจาก PBO (คัดใส่ yaml พร้อมเฉลย) — province, qty/unit, item_key; รวมเคส: ไม่มีสถานที่, สถานที่ซ้อน (โรงเรียน…ตำบล…อำเภอ…จังหวัด), ตัวเลขไทย, "จำนวน 2 คัน", "ขนาด 18,000 บีทียู 1 เครื่อง"
- money: "-"→null, "3185000"→3,185,000,000,000? (**ระวัง: PBO เป็นล้านบาท** → 3,185,000 ล้านบาท = 3.185e12 บาท) ทดสอบ overflow int64 (ok ถึง 9.2e18)
- PBO extract: Sheet1 นำหน้า, Grand Total, 16384 คอลัมน์, ปีในชีตไม่ตรงชื่อไฟล์ → flag
- validate: V1–V10 แต่ละกฎมี case ผ่าน/ไม่ผ่าน
- hash คงที่: source_id เท่าเดิมเมื่อรันซ้ำ และเปลี่ยนเมื่อ path/sheet/row เปลี่ยน
- publish: ไฟล์ > 24 MB → แตก part; manifest sha256 ตรง

### 3.2 web / ai
- `session` store: ไม่มี persist; `clearKey()` ล้างจริง; idle timer ล้าง key
- Zod tool schemas: reject limit > 50, ปีนอกช่วง, `source_ids` > 20
- agent loop: หยุดที่ MAX_TOOL_ROUNDS; ส่ง tool_result ที่มี `is_error` เมื่อ handler throw; ตัดผลลัพธ์ที่ 50 แถว + total; cost meter หยุดเมื่อเกิน budget (ไม่ส่ง request ต่อ)
- citation integrity: proposal อ้าง source_id ที่ไม่มีใน ToolLog → line ถูก downgrade + warning; อ้างที่มี → ผ่าน
- emit_proposal validator: total ≠ qty×price → warning; historical ไม่มี citation → warning; market ไม่มี web → warning
- adjust_for_inflation: factor = to/from, ปีที่ไม่มี indicator → error ชัดเจน; `verified:false` ต้องส่งต่อใน output
- SVG sanitizer: `<script>`, `onload`, `<foreignObject>`, `<image href=http…>`, `<a xlink:href=javascript:>`, `<style>@import` → ถูกตัด; SVG ปกติ (path/rect/text/g/defs/linearGradient) คงเดิม; ไม่มี viewBox หรือ > 60 KB → reject
- get_price_trend: item มี ≥ 3 ปี → series; < 3 ปี → null; indicator ที่ไม่มี → null; change_pct คำนวณถูก
- proposal validator: illustration_id/trend_ref ที่ไม่อยู่ใน ToolLog → ตัดทิ้ง + warning
- Sparkline/TrendChart: render จาก series ≤ 10 จุด, reduced-motion ไม่มี animation (ตรวจ prop)
- MiniSearch th: "แอร์ 18000" เจอ "เครื่องปรับอากาศ … 18,000 บีทียู"; typo OCR "เบี้ยยังขีพ" เจอ "เบี้ยยังชีพ" (fuzzy 0.2)
- repo.queryLines: filter รวมกัน, order, limit; shard selection ถูก (ปี × กระทรวง) และ cache hit ไม่ fetch ซ้ำ
- PDF: snapshot text ของหน้าแรก (pdf-parse) มีชื่อโครงการ/ยอดรวม; ฟอนต์ embed (ตรวจ `/FontFile2`), ไทยไม่ถูกแทนด้วย tofu (เช็คว่าไม่มี glyph `.notdef` ในสตริงหลัก — ผ่านการ extract แล้วเทียบข้อความต้นทาง)

### 3.3 e2e (mock API)
1. KeyGate: key ผิด → error; key ถูก (mock count_tokens 200) → workspace
2. Happy path: prompt → AI ถาม → ตอบ → tool cards ปรากฏ → proposal render → คลิก citation → drawer มีข้อมูลตรงกับ fixture → export PDF (ตรวจไฟล์ดาวน์โหลดขนาด > 20 KB) → save JSON → reload → /load เปิดได้
3. Storage audit: หลัง flow ทั้งหมด `localStorage`, `sessionStorage`, cookies ต้องไม่มีสตริง key; request ทุกอันไป host อื่นนอกจาก origin/api.anthropic.com = 0
4. Budget cap: mock usage สูง → toast + composer disabled
5. Mobile viewport: แชทและอ่าน proposal ได้, drawer full screen

## 4. Eval (AI จริง) — `web/tests/eval/`
- runner ใช้ agent loop จริง + repo จริง (fixture หรือ data เต็มบนเครื่อง dev) ต่อ Anthropic จริง
- ให้คะแนน auto: มี proposal, จำนวนบรรทัด ≥ min, basis ตามคาด, citation resolve 100 %, ไม่มีสตริงต้องห้าม (`must_not_claim`), cost ≤ เพดาน
- ให้คะแนน LLM-as-judge (Opus) 1–5: ความสมเหตุสมผลของ BOQ, คุณภาพเหตุผล, ความชัดเจนของสมมติฐาน — เก็บลง `docs/eval-report.md` พร้อมวันที่/model/ค่าใช้จ่าย
- เกณฑ์ผ่าน Phase 3: auto 100 % ใน 18/20 cases, judge เฉลี่ย ≥ 3.5

## 5. CI/CD (GitHub Actions)
### `.github/workflows/ci.yml` — ทุก push/PR
- job `pipeline`: python 3.11, `uv sync`, ruff, pytest
- job `web`: node 22, `npm ci`, lint, typecheck, vitest (รวม integration กับ fixture), build, playwright (chromium) กับ mock
- ไม่มี secret ใด ๆ ใน CI; eval ไม่รัน
- artifact: playwright report, PDF ตัวอย่าง
### `.github/workflows/deploy.yml` — push `main` (หลัง ci ผ่าน) + `workflow_dispatch`
- `permissions: {contents: read, pages: write, id-token: write}`, `concurrency: {group: pages, cancel-in-progress: true}`
- steps: checkout → setup-node 22 (cache npm) → `npm ci` → `npm run build` (base `/thai-government-budget-planner/`) → `actions/configure-pages` → `actions/upload-pages-artifact` path `web/dist` → `actions/deploy-pages`
- post-deploy smoke: `curl -sI <site>/data/manifest.json` ต้อง 200 และมี `Accept-Ranges` (ถ้าไม่มีให้ log warning ไม่ fail)
- ห้ามรัน pipeline ใน Actions (ไม่มี raw data) — data ถูก commit มาแล้ว
