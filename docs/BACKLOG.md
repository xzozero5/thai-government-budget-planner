# BACKLOG — เรียงตามลำดับที่ควรทำ (MVP)

สัญลักษณ์: `[ ]` ยังไม่ทำ · `[~]` กำลังทำ · `[x]` เสร็จ (test ผ่าน + STATUS อัปเดต) · `∥` ทำขนานกับงานอื่นได้ · agent = ผู้รับผิดชอบหลัก
ทุก task ต้องผ่าน DoD ใน `00-START-HERE.md`

## Phase 0 — Bootstrap (เป้า: ครึ่งวัน)
- [x] T-001 `frontend-dev` ∥ สร้าง `web/` ด้วย Vite React-TS template; ตั้ง ESLint (typescript-eslint strict), Prettier, Vitest+RTL, Playwright, Tailwind, path alias `@/`; scripts ตาม CLAUDE.md §5; `npm run build` ผ่าน
- [x] T-002 `data-engineer` ∥ สร้าง `pipeline/` (pyproject + uv, ruff, pytest, typer CLI โครง `tgbp --help`), `config.yaml` ชี้ raw dir, `.cache/` gitignored
- [x] T-000 **main thread ทำก่อนอื่น** — git init ในโฟลเดอร์นี้, `git remote add origin git@github.com:xzozero5/thai-government-budget-planner.git`, `git fetch origin && git checkout -b main origin/main` (มี LICENSE + Initial commit อยู่แล้ว — ห้ามทับ), ตรวจ `git status` ว่าโฟลเดอร์ข้อมูลดิบถูก ignore, commit แผนทั้งหมด `docs: แผน MVP + CLAUDE.md + agents` แล้ว push; ถ้า SSH ไม่ผ่านให้ลอง HTTPS remote และ `[ASK-HUMAN]` ถ้ายัง push ไม่ได้
- [x] T-003 `frontend-dev` ตรวจทาน baseline ที่มีให้แล้ว: `.gitignore` (commit `web/public/data/**` ทั้งหมดตาม CLAUDE.md §5.1; ignore raw data/.cache/.env), เพิ่ม pre-commit hook (`.githooks/pre-commit` + `git config core.hooksPath .githooks`) ที่ grep `sk-ant-` และบล็อกไฟล์ > 24 MB, `.env.example` (เพิ่ม key ใหม่ถ้ามี), `README.md` (เติม section build/run เมื่อ web/pipeline พร้อม) — ไม่ต้องสร้างใหม่
- [x] T-004 `frontend-dev` `.github/workflows/ci.yml` + `deploy.yml` ตาม 07 §5 (Pages deploy จาก `web/dist`, base path `/thai-government-budget-planner/`, HashRouter, CSP meta) — รันได้แม้ยังไม่มี test จริง; หน้าแรก placeholder ต้องขึ้นที่ `https://xzozero5.github.io/thai-government-budget-planner/` (ถ้า Pages ยังไม่เปิด Source=GitHub Actions → `[ASK-HUMAN]` ข้อ 1) — **19 ก.ย.: Pages live, placeholder + CSP meta + range request (206) ยืนยันบน URL จริงแล้ว**
- [x] T-005 `po` ตรวจโครงตรง CLAUDE.md §4; สร้าง `docs/STATUS.md` เวอร์ชันแรก; `docs/decisions/` + `docs/qa/` โฟลเดอร์

## Phase 1 — Data pipeline (เป้า: 2–3 วัน) — อ่าน `03-DATA-PIPELINE.md`
- [x] T-101 `data-engineer` `inventory.py` + `tgbp inventory` → `sources.json` ครบ 318 ไฟล์, PDF text-layer detection, parse metadata จากโฟลเดอร์ (unicode normalize U+200B); test
- [x] T-102 `data-engineer` `normalize/thai_text.py`, `money.py` + tests
- [x] T-103 `data-engineer` `item_parser.py` + fixture 200 ชื่อจริง (คัดจาก PBO 2566 ด้วยสคริปต์ sample แบบ stratified ตามงบรายจ่าย) + tests ≥ 95 %/90 %
- [x] T-104 `data-engineer` `org_master.py` จาก A2 Data Dict + aliases + fuzzy; test
- [x] T-105 `data-engineer` `extract/pbo.py` streaming 11 ปี → `.cache/pbo/*.parquet`; test ด้วย fixture gotchas
- [x] T-106 `data-engineer` `extract/act2570.py` (A2 + A3 header detector + dedupe) ; test
- [x] T-107 `data-engineer` `extract/local_sheets.py` (ราชาเทวะ, อบจ. ชม., generic mapper สำหรับที่เหลือ) ; test
- [x] T-108 `data-engineer` `extract/committee_xlsx.py` (generic table detector, xls→xlrd/libreoffice) + `office_text.py` (docx/pptx) ; test
- [x] T-109 `data-engineer` `extract/pdf_text.py` (เฉพาะ has_text_layer, ≤ 100 MB; pdfplumber text+tables → DocChunk; ตาราง OPEN SSO/ราคากลาง → committee_table ถ้า map ได้) ; test
- [x] T-110 `data-engineer` `validate.py` V1–V10 + `publish.py` (shards < 24 MB, catalog, facets, orgs, manifest sha256, docs chunks) ; test; รัน `tgbp build --dataset all` จริง → บันทึกขนาดจริงลง 02 §E; ยอดรวม `web/public/data/` ต้อง ≤ 500 MB (CLAUDE.md §5.1) มิฉะนั้นเพิ่ม compression/ตัดคอลัมน์ก่อน commit; commit data แยก `data: publish <date>` แล้ว push
- [x] T-111 `data-engineer` `econ/indicators.json` — ดึงจากแหล่งเปิด (ธปท., สศช., สนค. กระทรวงพาณิชย์, กระทรวงแรงงาน, สนพ./EPPO, สำนักงบประมาณ) ด้วย web search/fetch ของ Claude Code; ทุกค่า `verified:false` + `source_url` + `retrieved_at`; เขียน `docs/econ-sources.md` อธิบายที่มาและวิธีอัปเดต
- [x] T-112 `data-engineer` `tgbp sample --rows 1000` → `web/tests/fixtures/data/` (commit)
- [x] T-113 `po` review: validation_report, สุ่มตรวจ 10 source_id กับไฟล์จริง (ใช้ `explorer` ช่วยเปิดไฟล์), ปิด `[UNVERIFIED]` ใน 02, อัปเดต STATUS
- [x] T-114 `data-engineer` (จาก po review T-113) สถิติ DoD ใน validation_report (% qty/unit_price/province ต่อ dataset, PDF มี/ไม่มี text layer), V9 `org_unmapped` เข้า `coverage_notes`, catalog v2 (`shard_paths` + index — ลดขนาดหลัง decompress จาก 49 MB), flag `low_specificity`, fixture manifest `sample:true`, test ว่า `sample_source_ids` อยู่ใน shard ที่ entry ชี้
- [x] T-115 `data-engineer` กัน qty จากรหัสนำหน้าชื่อ (`AC0405 …` → qty 405) + sanity qty ≥ 20 ที่ไม่มีคำบอกจำนวน → `qty_parsed_low_conf`; republish

## Phase 2 — Architecture & data access (เป้า: 1–2 วัน) — อ่าน `04-ARCHITECTURE.md`
- [x] T-201 `architect` ∥ Spike S1–S5 (04 §6) ใน `web/spikes/` → `docs/decisions/SPIKES.md` ผลวัดจริง; ถ้า S1 ล้มเหลวบน host เป้าหมาย → ADR-002 fallback — **จาก T-113**: S1 ต้องวัดกับ `budget_lines/pbo/2564/20000.parquet` (ไฟล์ใหญ่สุด ~6.2 MB) บน Pages จริง (range request ยืนยันแล้วว่าได้ 206 กับ JSON) และรายงาน bytes ที่โหลดจริงต่อ query; S2 ต้องวัดกับ `catalog/items.json.gz` **ตัวจริง** (~45k entries) ไม่ใช่ mock: เวลา parse + index, memory, บนมือถือจำลอง — ถ้าไม่ผ่าน ให้เปิด T-208 (publish `catalog/search.json.gz` แบบผอม key/name/n_lines/years หรือ prebuilt index)
- [x] T-202 `frontend-dev` `data/manifest.ts` loader + types จาก schema (สร้าง `data/types.ts` ให้ตรง 03 §3); test — types ต้องตรง **output จริง** (03 §3.1 หมายเหตุ publish, §3.4 catalog v2) + test ว่าคอลัมน์ใน fixture parquet ครบตาม type และ catalog index resolve ได้
- [ ] T-203 `frontend-dev` `data/duckdb.ts` (lazy init, register shard URLs, query with params, cache/evict) + `data/repo.ts` API (`queryLines`, `getLines`, `getDoc`, `getEcon`, `facets`) ; integration test กับ fixture — `queryLines` ต้องรองรับ `item_key IN (keys[])` (variant ที่ต่างกันแค่เว้นวรรค) และ keyword fallback สำหรับรายการหางยาวที่ไม่อยู่ใน catalog (catalog ครอบ ~57 % ของแถว) โดย**บังคับ filter ปี/กระทรวง**เพื่อคุมขนาดสแกน (shards รวม ~165 MB); ทุกผลลัพธ์แนบ `coverage_notes` ที่ match ปี/dataset — **ADR-002 (บังคับ)**: `filesystem:{forceFullHTTPReads:false, allowFullHTTPReads:true, reliableHeadRequests:true}`; self-host parquet extension ใต้ `web/public/duckdb-ext/v<ver>/wasm_eh/` + `SET custom_extension_repository` + test ที่ fail เมื่อเวอร์ชัน lib กับ path ไม่ตรง; worker จาก `blob:`+`importScripts`; เลือกคอลัมน์แคบ (ดึง `item_name_raw` เฉพาะแถวที่แสดง); fallback `registerFileBuffer`; **integration test ที่ block cross-origin แล้วต้องยังผ่าน (N5)**; prefetch DuckDB (~8.6 MB gz) หลังใส่ key สำเร็จ; ใช้ `@duckdb/duckdb-wasm@1.32.0` (ไม่ใช่ `latest`)
- [ ] T-204 `frontend-dev` `data/search.ts` MiniSearch + Thai tokenizer (`Intl.Segmenter` + fallback) ; test เคส 3.2; **folding สำหรับ text จาก PDF** (02 §B): ตัดช่องว่างระหว่างอักษรไทย + พับ `ำ`→`า` ทั้งฝั่ง index และ query (ค้น "สำนักงาน" ต้องเจอ `ส านักงาน`) โดยไม่แก้ text ที่แสดงเป็นหลักฐาน — **จาก S2**: โหลด prebuilt index (T-208) ไม่ build ใน browser; fold **ก่อน** tokenize; ค่าเริ่มต้น `prefix:true, fuzzy:0.2, combineWith:'OR'` แล้ว re-rank ด้วย `n_lines`; ผลที่ `low_specificity` ต้องติดป้าย; fallback n-gram มี test แยก; `minisearch@7.2.0`
- [ ] T-205 `frontend-dev` `data/inflation.ts` deterministic + test
- [ ] T-207 `frontend-dev` `data/trends.ts` (โหลด `catalog/trends/*`, econ series, คำนวณ change_pct) + `lib/svgSanitizer.ts` (DOMPurify profile ตาม 04 §D9) ; tests ตาม 07 §3.2 — รองรับ `basis: unit_price | amount_per_line` (ห้ามปน) และแสดง `note: source_incomplete` ของปี 2562 บนกราฟ; การ์ด econ แสดงป้าย `verified:false` ทุกใบ และไม่วาดเมื่อ series ไม่มีค่า — **จาก S5**: sanitizer ต้องลบ `<style>` ทั้ง element + ตัด attribute `style` ที่มี `url(`/`@import`; `FORBID_ATTR` เป็น string เท่านั้น; unit test จาก `web/spikes/s5/in/*.svg` ครบทุกเคส; `dompurify@3.4.15`
- [ ] T-206 `architect` review boundaries (04 §3), เขียน ADR ที่เกิดขึ้น, อัปเดต STATUS
- [ ] T-208 `data-engineer` → `frontend-dev` (เปิดตามผล S2) publish `catalog/search-index.json.gz` (MiniSearch prebuilt แบบ key_only ~1.6 MB gz — ต้อง build ด้วย tokenizer/folding **ชุดเดียวกับ browser**: สร้าง index ด้วยสคริปต์ Node ใน `web/scripts/` ที่ import โค้ด tokenizer จาก `web/src/data/search.ts` แล้วให้ pipeline เรียก หรือ build ตอน `npm run build`) + `catalog/items-slim.json.gz` (~2 MB gz: key/name/n_lines/years/flags/trend + index เข้า items เต็ม); items เต็มโหลดเฉพาะ entry ที่ต้องใช้; test ว่า index กับ catalog เป็น `data_version` เดียวกัน
- [ ] T-209 `data-engineer` (ทำพร้อม republish shards ครั้งถัดไปเท่านั้น — ไม่ republish เพื่อเรื่องนี้อย่างเดียว) sort shard ตาม `item_key, agency, source_id` + `ROW_GROUP_SIZE` 16k เพื่อให้ `item_key IN (…)` prune row group ได้ (main thread ทดลองกับ `pbo/2564/20000`: ขนาด +1 %, row group ที่อ่านต่อ key 3 → 1)

## Phase 3 — AI layer (เป้า: 2–3 วัน) — อ่าน `05-FEATURES.md` §3–6
- [ ] T-301 `ai-engineer` `ai/client.ts` (SDK browser mode, model list, count_tokens ping, usage/cost calc ต่อ model ราคาใน `ai/pricing.ts` พร้อม `[UNVERIFIED]` และวันที่) ; test (SDK mocked) — **จาก S3**: default `claude-sonnet-5`, ตัวเลือก `claude-haiku-4-5-20251001`/`claude-opus-5`; `@anthropic-ai/sdk@0.127.0` (~50 KB gz); ราคาใน `ai/pricing.ts` ต้องตรวจจากหน้า pricing ทางการอีกครั้ง + วันที่; ขั้นต่ำ prompt cache ต่อรุ่น; ต้นทุน web search ต่อครั้ง; S3 ยืนยันแล้ว: CORS/streaming/tool loop/web_search/cache hit ใต้ CSP จริง และ storage audit ว่าง (N2)
- [ ] T-302 `ai-engineer` `ai/tools/*.ts` Zod schemas + JSON Schema export + handlers เรียก repo; test ทุก tool — **AC จาก T-113**: (1) tool result แนบ `coverage_notes`; (2) `unit_price.n < 3` ห้ามเป็น `historical` confidence สูงกว่า medium; entry ที่ไม่มี `unit_price` ต้องรายงานเป็น "ราคาต่อรายการ (amount/บรรทัด)" ไม่ใช่ราคาต่อหน่วย; (3) entry `low_specificity` ห้ามใช้เป็น benchmark โดยไม่ถามขนาด/สเปคก่อน และต้องแสดง p25–p75 + n เสมอ; (4) แถวที่มี flag `upstream_ocr`/`group_total_mismatch`/`corrupt_row`/`qty_parsed_low_conf`/`qty_is_measure`/`org_tail_uncertain` → confidence ≤ medium; (5) `get_econ_indicator`/`get_price_trend` คืน `{value:null, note}` เมื่อไม่มีค่า — ห้ามประมาณเอง ให้ใช้ `web_search`
- [ ] T-303 `ai-engineer` `ai/tools/proposal.ts` schema + validator (citation integrity vs ToolLog, totals) ; test
- [ ] T-304 `ai-engineer` `ai/agent.ts` loop (streaming, tool rounds, ToolLog, budget stop, cancel, error/retry) ; test
- [ ] T-309 `ai-engineer` tools `get_price_trend` + `emit_illustration` (ใช้ `data/trends.ts`, `lib/svgSanitizer.ts`; จำกัด 3 ภาพ/proposal) + proposal validator รองรับ `illustrations`/`stat_cards`/`trend_ref` ; tests — **จาก S5**: `max_tokens ≥ 8000`, ทิ้งผลเมื่อ `stop_reason==='max_tokens'` (ห้ามซ่อม SVG ที่ขาด), prompt สั่งใช้ presentation attributes (ห้าม `<style>`)
- [ ] T-305 `ai-engineer` `ai/systemPrompt.ts` (cached blocks: กฎ + facets + dataset notes + 3 few-shot tool traces + `<palette>` และ illustration style จาก `docs/ui/illustration-style.md` + few-shot SVG 1 ชิ้น) + mode variants — system prompt ต้องระบุ: "ไม่พบในปี 2562 ≠ ไม่มีงบ (ADR-004)", "ไม่พบใน catalog ≠ ไม่เคยตั้งงบ — ต้องลอง `query_budget_lines` ด้วย keyword ก่อนสรุป", ตัวเลขราชาเทวะมาจาก OCR ต้นทาง (ADR-005)
- [ ] T-306 `ai-engineer` `web/tests/eval/` cases.yaml 20 โจทย์ + runner `npm run eval` (+ judge) ; รันจริง 1 รอบ → `docs/eval-report.md`; **guard N2**: test ที่ build แล้ว grep `dist/assets/*.js` ต้องไม่พบ `sk-ant-` / ค่า `VITE_EVAL_ANTHROPIC_API_KEY` (ตัวแปร `VITE_*` ถูก inline เข้า bundle ถ้ามีค่าตอน build — runner ต้องอ่าน key ฝั่ง Node ไม่ใช่ผ่าน `import.meta.env`); **เคสบังคับจาก T-113**: ฝายของ อบต. (ต้องไม่หยิบ median 25 ล้านของ key `ฝาย`), รายการหางยาวที่ไม่อยู่ใน catalog, รายการปี 2562, รายการที่ unit_price n=1
- [ ] T-307 `security-reviewer` review key handling/egress/prompt-injection ใน ai/ + data/; รายการแก้ → ai-engineer แก้
- [ ] T-308 `po` review eval report เทียบเกณฑ์ 07 §4; ปรับ prompt/tool ถ้าไม่ผ่าน (วนได้ 2 รอบ) ; STATUS

## Phase 4 — UI (เป้า: 3 วัน) — อ่าน `06-UI-SPEC.md`
- [ ] T-401 `ui-designer` deliverables 06 §7 (tokens ธงชาติ+ตรวจค่ามาตรฐานสี, wireframes, copy.th.json, components.md, motion.md, illustration-style.md + few-shot SVG)
- [ ] T-402 `frontend-dev` `components/ui/*` primitives + stories/tests พื้นฐาน
- [ ] T-403 `frontend-dev` stores (`session`, `chat`, `proposal`, `toolLog`, `data`) + tests (no-persist, idle clear)
- [ ] T-404 `frontend-dev` KeyGate page (4.1) + `/about`
- [ ] T-405 `frontend-dev` Workspace layout + Chat pane (4.2) รวม tool activity cards, quick replies, streaming, cancel
- [ ] T-406 `frontend-dev` Proposal pane (4.3) + BOQ table (inline edit, recompute, "ให้ AI ทบทวน", version selector)
- [ ] T-407 `frontend-dev` Citation drawer (4.4) ทุกประเภท + "ดูแถวใกล้เคียง" + `ExternalLink` component (US-4.3: เปิดแท็บใหม่, https-only, copy URL) ใช้ใน BOQ chip/drawer/แชท — drawer แสดง `item_name_raw` เต็ม (ไม่มี `item_name`/`location_text` ใน shard), badge ของ quality flags + ข้อความ "ตัวเลขถอดจาก OCR ของต้นทาง โปรดตรวจหน้า N", ป้าย "เอกสารสแกน ระบบไม่ได้อ่านเนื้อหา"
- [ ] T-408 `frontend-dev` Data loading indicator, toasts, keyboard shortcuts, responsive/mobile; แสดง progress ของการ prefetch DuckDB/ดัชนีค้นหา (lazy ~12 MB gz รวม) ระหว่าง AI ถามคำถาม
- [ ] T-411 `frontend-dev` Motion layer ตาม `docs/ui/motion.md` (`motion`, reduced-motion guard, count-up, skeletons, button states) ; tests prop-level
- [ ] T-412 `frontend-dev` `Sparkline`, `TrendChart`, `StatCard` (Recharts) + `IllustrationFrame` (sanitized SVG, lightbox, สร้างใหม่/ซ่อน) และต่อเข้า Proposal pane/BOQ/drawer ; tests
- [ ] T-409 `qa-engineer` e2e happy path + storage audit (07 §3.3 ข้อ 1–3) กับ mock API
- [ ] T-410 `po` + `ui-designer` review ตาม 06 §1/§5; แก้ copy; STATUS

## Phase 5 — Export (เป้า: 1 วัน)
- [ ] T-501 `frontend-dev` `features/export/pdf/*` react-pdf document (ปก, สรุป, BOQ ตารางข้ามหน้า, สมมติฐาน/ความเสี่ยง, appendix citations พร้อม **`<Link>` กดได้สำหรับ URL เว็บ**, footer) + Sarabun register; test snapshot text — **จาก S4** (`@react-pdf/renderer@4.9.0` + Sarabun OFL): (1) ตัดบรรทัดไทยกลางคำและส่วนเกินถูกตัดทิ้ง — `hyphenationCallback` ไม่ช่วย → แทรก `U+200B` ตาม `Intl.Segmenter('th')` ก่อนส่งข้อความ; (2) ToUnicode เพี้ยน (`า`→U+001E/1F, `ำ` แตก) → test extract text ต้อง normalize; (3) ตัวอักษรท้าย block หายในเอกสารหลายหน้า (`ฯลฯ`→`ฯ`) สาเหตุ `[UNVERIFIED]` → ต้องหาสาเหตุ/ทางเลี่ยงก่อนปิด task
- [ ] T-502 `frontend-dev` Export dialog + progress; Save/Load `.tgbp.json` (+ `/load` route read-only)
- [ ] T-504 `frontend-dev` SVG/กราฟ → PNG (canvas 2×) ใส่ PDF: ส่วน "ภาพรวมโครงการ" และ "แนวโน้มราคาที่เกี่ยวข้อง" ; test ว่า PDF มี image objects — ใช้ `data:` URL ตอนแปลง SVG → PNG (`blob:` ถูก CSP บล็อก — S5); ยอมรับฟอนต์ระบบในภาพ
- [ ] T-503 `qa-engineer` ตรวจ PDF ใน 4 viewer (A8) + ภาพ/กราฟ ; bug → แก้; เพิ่มเคส "ค้น/คัดลอกข้อความไทยใน PDF viewer" (ToUnicode เพี้ยน — S4)

## Phase 6 — QA & hardening (เป้า: 2 วัน)
- [ ] T-601 `qa-engineer` รัน `08-QA-CHECKLIST.md` ทั้งหมด → `docs/qa/run-<date>.md` + `bugs.md`
- [ ] T-602 `security-reviewer` รัน 09 §5 C1–C9 ; แก้
- [ ] T-603 `frontend-dev` แก้ bug severity high/medium ทั้งหมด; a11y fixes จาก axe
- [ ] T-604 `ai-engineer` รัน eval รอบสุดท้าย → eval-report
- [ ] T-605 `frontend-dev` ตรวจ production deploy บน GitHub Pages: CSP meta ทำงาน, range request/latency บน URL จริง (บันทึกลง SPIKES.md), Lighthouse, README deploy section; ยืนยันว่า CSP meta ไม่ถูก strip และบันทึกผลกระทบที่ไม่มี `frame-ancestors` (ADR-003 ข้อ 1); custom domain (ถ้ามี) เป็น post-MVP; workflow ต้อง deploy `web/public/duckdb-ext/**` + smoke ว่า `.wasm` ถูก serve และถูกบีบอัดหรือไม่
- [ ] T-606 `po` release notes `docs/RELEASE-0.1.md`, STATUS = "MVP done", รายการ post-MVP (F6 data browser, OCR, share link ฯลฯ)

## Post-MVP ideas (ไม่ทำตอนนี้)
- เติม econ `diesel/gasoline95/min_wage_*` หรือประกาศปิดถาวรใน `econ-sources.md` (ทบทวนใน Phase 6) · Data browser (F6) · Image-gen provider ภายนอกสำหรับภาพเหมือนจริง (ตัดออกโดยคุณนิว — ทบทวนหลัง MVP) · OCR pipeline แยกโปรเจกต์ · Export DOCX · เปรียบเทียบสองข้อเสนอ · ภาษาอังกฤษ · โหลดข้อมูลจาก URL ภายนอกที่ผู้ใช้กำหนด (ต้องทบทวน security)
