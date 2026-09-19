# BACKLOG — เรียงตามลำดับที่ควรทำ (MVP)

สัญลักษณ์: `[ ]` ยังไม่ทำ · `[~]` กำลังทำ · `[x]` เสร็จ (test ผ่าน + STATUS อัปเดต) · `∥` ทำขนานกับงานอื่นได้ · agent = ผู้รับผิดชอบหลัก
ทุก task ต้องผ่าน DoD ใน `00-START-HERE.md`

## Phase 0 — Bootstrap (เป้า: ครึ่งวัน)
- [x] T-001 `frontend-dev` ∥ สร้าง `web/` ด้วย Vite React-TS template; ตั้ง ESLint (typescript-eslint strict), Prettier, Vitest+RTL, Playwright, Tailwind, path alias `@/`; scripts ตาม CLAUDE.md §5; `npm run build` ผ่าน
- [x] T-002 `data-engineer` ∥ สร้าง `pipeline/` (pyproject + uv, ruff, pytest, typer CLI โครง `tgbp --help`), `config.yaml` ชี้ raw dir, `.cache/` gitignored
- [x] T-000 **main thread ทำก่อนอื่น** — git init ในโฟลเดอร์นี้, `git remote add origin git@github.com:xzozero5/thai-government-budget-planner.git`, `git fetch origin && git checkout -b main origin/main` (มี LICENSE + Initial commit อยู่แล้ว — ห้ามทับ), ตรวจ `git status` ว่าโฟลเดอร์ข้อมูลดิบถูก ignore, commit แผนทั้งหมด `docs: แผน MVP + CLAUDE.md + agents` แล้ว push; ถ้า SSH ไม่ผ่านให้ลอง HTTPS remote และ `[ASK-HUMAN]` ถ้ายัง push ไม่ได้
- [x] T-003 `frontend-dev` ตรวจทาน baseline ที่มีให้แล้ว: `.gitignore` (commit `web/public/data/**` ทั้งหมดตาม CLAUDE.md §5.1; ignore raw data/.cache/.env), เพิ่ม pre-commit hook (`.githooks/pre-commit` + `git config core.hooksPath .githooks`) ที่ grep `sk-ant-` และบล็อกไฟล์ > 24 MB, `.env.example` (เพิ่ม key ใหม่ถ้ามี), `README.md` (เติม section build/run เมื่อ web/pipeline พร้อม) — ไม่ต้องสร้างใหม่
- [~] T-004 `frontend-dev` `.github/workflows/ci.yml` + `deploy.yml` ตาม 07 §5 (Pages deploy จาก `web/dist`, base path `/thai-government-budget-planner/`, HashRouter, CSP meta) — รันได้แม้ยังไม่มี test จริง; หน้าแรก placeholder ต้องขึ้นที่ `https://xzozero5.github.io/thai-government-budget-planner/` (ถ้า Pages ยังไม่เปิด Source=GitHub Actions → `[ASK-HUMAN]` ข้อ 1) — **สถานะ 19 ก.ย.: workflows เสร็จ + CI เขียว; ค้างเฉพาะคนเปิด Pages แล้ว re-run `deploy`**
- [x] T-005 `po` ตรวจโครงตรง CLAUDE.md §4; สร้าง `docs/STATUS.md` เวอร์ชันแรก; `docs/decisions/` + `docs/qa/` โฟลเดอร์

## Phase 1 — Data pipeline (เป้า: 2–3 วัน) — อ่าน `03-DATA-PIPELINE.md`
- [x] T-101 `data-engineer` `inventory.py` + `tgbp inventory` → `sources.json` ครบ 318 ไฟล์, PDF text-layer detection, parse metadata จากโฟลเดอร์ (unicode normalize U+200B); test
- [x] T-102 `data-engineer` `normalize/thai_text.py`, `money.py` + tests
- [x] T-103 `data-engineer` `item_parser.py` + fixture 200 ชื่อจริง (คัดจาก PBO 2566 ด้วยสคริปต์ sample แบบ stratified ตามงบรายจ่าย) + tests ≥ 95 %/90 %
- [x] T-104 `data-engineer` `org_master.py` จาก A2 Data Dict + aliases + fuzzy; test
- [x] T-105 `data-engineer` `extract/pbo.py` streaming 11 ปี → `.cache/pbo/*.parquet`; test ด้วย fixture gotchas
- [~] T-106 `data-engineer` `extract/act2570.py` (A2 + A3 header detector + dedupe) ; test
- [~] T-107 `data-engineer` `extract/local_sheets.py` (ราชาเทวะ, อบจ. ชม., generic mapper สำหรับที่เหลือ) ; test
- [~] T-108 `data-engineer` `extract/committee_xlsx.py` (generic table detector, xls→xlrd/libreoffice) + `office_text.py` (docx/pptx) ; test
- [~] T-109 `data-engineer` `extract/pdf_text.py` (เฉพาะ has_text_layer, ≤ 100 MB; pdfplumber text+tables → DocChunk; ตาราง OPEN SSO/ราคากลาง → committee_table ถ้า map ได้) ; test
- [ ] T-110 `data-engineer` `validate.py` V1–V10 + `publish.py` (shards < 24 MB, catalog, facets, orgs, manifest sha256, docs chunks) ; test; รัน `tgbp build --dataset all` จริง → บันทึกขนาดจริงลง 02 §E; ยอดรวม `web/public/data/` ต้อง ≤ 500 MB (CLAUDE.md §5.1) มิฉะนั้นเพิ่ม compression/ตัดคอลัมน์ก่อน commit; commit data แยก `data: publish <date>` แล้ว push
- [~] T-111 `data-engineer` `econ/indicators.json` — ดึงจากแหล่งเปิด (ธปท., สศช., สนค. กระทรวงพาณิชย์, กระทรวงแรงงาน, สนพ./EPPO, สำนักงบประมาณ) ด้วย web search/fetch ของ Claude Code; ทุกค่า `verified:false` + `source_url` + `retrieved_at`; เขียน `docs/econ-sources.md` อธิบายที่มาและวิธีอัปเดต
- [ ] T-112 `data-engineer` `tgbp sample --rows 1000` → `web/tests/fixtures/data/` (commit)
- [ ] T-113 `po` review: validation_report, สุ่มตรวจ 10 source_id กับไฟล์จริง (ใช้ `explorer` ช่วยเปิดไฟล์), ปิด `[UNVERIFIED]` ใน 02, อัปเดต STATUS

## Phase 2 — Architecture & data access (เป้า: 1–2 วัน) — อ่าน `04-ARCHITECTURE.md`
- [ ] T-201 `architect` ∥ Spike S1–S5 (04 §6) ใน `web/spikes/` → `docs/decisions/SPIKES.md` ผลวัดจริง; ถ้า S1 ล้มเหลวบน host เป้าหมาย → ADR-002 fallback
- [ ] T-202 `frontend-dev` `data/manifest.ts` loader + types จาก schema (สร้าง `data/types.ts` ให้ตรง 03 §3); test
- [ ] T-203 `frontend-dev` `data/duckdb.ts` (lazy init, register shard URLs, query with params, cache/evict) + `data/repo.ts` API (`queryLines`, `getLines`, `getDoc`, `getEcon`, `facets`) ; integration test กับ fixture
- [ ] T-204 `frontend-dev` `data/search.ts` MiniSearch + Thai tokenizer (`Intl.Segmenter` + fallback) ; test เคส 3.2
- [ ] T-205 `frontend-dev` `data/inflation.ts` deterministic + test
- [ ] T-207 `frontend-dev` `data/trends.ts` (โหลด `catalog/trends/*`, econ series, คำนวณ change_pct) + `lib/svgSanitizer.ts` (DOMPurify profile ตาม 04 §D9) ; tests ตาม 07 §3.2
- [ ] T-206 `architect` review boundaries (04 §3), เขียน ADR ที่เกิดขึ้น, อัปเดต STATUS

## Phase 3 — AI layer (เป้า: 2–3 วัน) — อ่าน `05-FEATURES.md` §3–6
- [ ] T-301 `ai-engineer` `ai/client.ts` (SDK browser mode, model list, count_tokens ping, usage/cost calc ต่อ model ราคาใน `ai/pricing.ts` พร้อม `[UNVERIFIED]` และวันที่) ; test (SDK mocked)
- [ ] T-302 `ai-engineer` `ai/tools/*.ts` Zod schemas + JSON Schema export + handlers เรียก repo; test ทุก tool
- [ ] T-303 `ai-engineer` `ai/tools/proposal.ts` schema + validator (citation integrity vs ToolLog, totals) ; test
- [ ] T-304 `ai-engineer` `ai/agent.ts` loop (streaming, tool rounds, ToolLog, budget stop, cancel, error/retry) ; test
- [ ] T-309 `ai-engineer` tools `get_price_trend` + `emit_illustration` (ใช้ `data/trends.ts`, `lib/svgSanitizer.ts`; จำกัด 3 ภาพ/proposal) + proposal validator รองรับ `illustrations`/`stat_cards`/`trend_ref` ; tests
- [ ] T-305 `ai-engineer` `ai/systemPrompt.ts` (cached blocks: กฎ + facets + dataset notes + 3 few-shot tool traces + `<palette>` และ illustration style จาก `docs/ui/illustration-style.md` + few-shot SVG 1 ชิ้น) + mode variants
- [ ] T-306 `ai-engineer` `web/tests/eval/` cases.yaml 20 โจทย์ + runner `npm run eval` (+ judge) ; รันจริง 1 รอบ → `docs/eval-report.md`; **guard N2**: test ที่ build แล้ว grep `dist/assets/*.js` ต้องไม่พบ `sk-ant-` / ค่า `VITE_EVAL_ANTHROPIC_API_KEY` (ตัวแปร `VITE_*` ถูก inline เข้า bundle ถ้ามีค่าตอน build — runner ต้องอ่าน key ฝั่ง Node ไม่ใช่ผ่าน `import.meta.env`)
- [ ] T-307 `security-reviewer` review key handling/egress/prompt-injection ใน ai/ + data/; รายการแก้ → ai-engineer แก้
- [ ] T-308 `po` review eval report เทียบเกณฑ์ 07 §4; ปรับ prompt/tool ถ้าไม่ผ่าน (วนได้ 2 รอบ) ; STATUS

## Phase 4 — UI (เป้า: 3 วัน) — อ่าน `06-UI-SPEC.md`
- [ ] T-401 `ui-designer` deliverables 06 §7 (tokens ธงชาติ+ตรวจค่ามาตรฐานสี, wireframes, copy.th.json, components.md, motion.md, illustration-style.md + few-shot SVG)
- [ ] T-402 `frontend-dev` `components/ui/*` primitives + stories/tests พื้นฐาน
- [ ] T-403 `frontend-dev` stores (`session`, `chat`, `proposal`, `toolLog`, `data`) + tests (no-persist, idle clear)
- [ ] T-404 `frontend-dev` KeyGate page (4.1) + `/about`
- [ ] T-405 `frontend-dev` Workspace layout + Chat pane (4.2) รวม tool activity cards, quick replies, streaming, cancel
- [ ] T-406 `frontend-dev` Proposal pane (4.3) + BOQ table (inline edit, recompute, "ให้ AI ทบทวน", version selector)
- [ ] T-407 `frontend-dev` Citation drawer (4.4) ทุกประเภท + "ดูแถวใกล้เคียง" + `ExternalLink` component (US-4.3: เปิดแท็บใหม่, https-only, copy URL) ใช้ใน BOQ chip/drawer/แชท
- [ ] T-408 `frontend-dev` Data loading indicator, toasts, keyboard shortcuts, responsive/mobile
- [ ] T-411 `frontend-dev` Motion layer ตาม `docs/ui/motion.md` (`motion`, reduced-motion guard, count-up, skeletons, button states) ; tests prop-level
- [ ] T-412 `frontend-dev` `Sparkline`, `TrendChart`, `StatCard` (Recharts) + `IllustrationFrame` (sanitized SVG, lightbox, สร้างใหม่/ซ่อน) และต่อเข้า Proposal pane/BOQ/drawer ; tests
- [ ] T-409 `qa-engineer` e2e happy path + storage audit (07 §3.3 ข้อ 1–3) กับ mock API
- [ ] T-410 `po` + `ui-designer` review ตาม 06 §1/§5; แก้ copy; STATUS

## Phase 5 — Export (เป้า: 1 วัน)
- [ ] T-501 `frontend-dev` `features/export/pdf/*` react-pdf document (ปก, สรุป, BOQ ตารางข้ามหน้า, สมมติฐาน/ความเสี่ยง, appendix citations พร้อม **`<Link>` กดได้สำหรับ URL เว็บ**, footer) + Sarabun register; test snapshot text
- [ ] T-502 `frontend-dev` Export dialog + progress; Save/Load `.tgbp.json` (+ `/load` route read-only)
- [ ] T-504 `frontend-dev` SVG/กราฟ → PNG (canvas 2×) ใส่ PDF: ส่วน "ภาพรวมโครงการ" และ "แนวโน้มราคาที่เกี่ยวข้อง" ; test ว่า PDF มี image objects
- [ ] T-503 `qa-engineer` ตรวจ PDF ใน 4 viewer (A8) + ภาพ/กราฟ ; bug → แก้

## Phase 6 — QA & hardening (เป้า: 2 วัน)
- [ ] T-601 `qa-engineer` รัน `08-QA-CHECKLIST.md` ทั้งหมด → `docs/qa/run-<date>.md` + `bugs.md`
- [ ] T-602 `security-reviewer` รัน 09 §5 C1–C9 ; แก้
- [ ] T-603 `frontend-dev` แก้ bug severity high/medium ทั้งหมด; a11y fixes จาก axe
- [ ] T-604 `ai-engineer` รัน eval รอบสุดท้าย → eval-report
- [ ] T-605 `frontend-dev` ตรวจ production deploy บน GitHub Pages: CSP meta ทำงาน, range request/latency บน URL จริง (บันทึกลง SPIKES.md), Lighthouse, README deploy section; ยืนยันว่า CSP meta ไม่ถูก strip และบันทึกผลกระทบที่ไม่มี `frame-ancestors` (ADR-003 ข้อ 1); custom domain (ถ้ามี) เป็น post-MVP
- [ ] T-606 `po` release notes `docs/RELEASE-0.1.md`, STATUS = "MVP done", รายการ post-MVP (F6 data browser, OCR, share link ฯลฯ)

## Post-MVP ideas (ไม่ทำตอนนี้)
- Data browser (F6) · Image-gen provider ภายนอกสำหรับภาพเหมือนจริง (ตัดออกโดยคุณนิว — ทบทวนหลัง MVP) · OCR pipeline แยกโปรเจกต์ · Export DOCX · เปรียบเทียบสองข้อเสนอ · ภาษาอังกฤษ · โหลดข้อมูลจาก URL ภายนอกที่ผู้ใช้กำหนด (ต้องทบทวน security)
