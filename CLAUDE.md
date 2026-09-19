# Thai Government Budget Planner (TGBP) — CLAUDE.md

> อ่านไฟล์นี้ก่อนเสมอ แล้วไปต่อที่ `docs/00-START-HERE.md`
> ภาษา: เอกสาร/commit message/UI = ไทย, ศัพท์เทคนิค/โค้ด/identifier = อังกฤษ

## 1. โปรเจกต์นี้คืออะไร

Web application (MVP) ที่ให้ **ประชาชน / สื่อ / สส. ที่ตรวจสอบงบ** คุยกับ Claude เพื่อ
1. บอกไอเดียโครงการ (เช่น "อบต. จะสร้างฝายน้ำล้น" / "กรมจะซื้อวิทยุสื่อสาร 500 เครื่อง")
2. AI ถามคำถามที่จำเป็นจนได้ requirement ครบ
3. AI สร้าง **ข้อเสนอโครงการ + สเปค + รายการค่าใช้จ่าย (BOQ)** พร้อมเหตุผลทุกบรรทัด
4. ทุกตัวเลขที่อ้างจากข้อมูลจริงต้องมี **citation** ชี้กลับไปยังไฟล์/ชีต/แถว/หน้า ที่มาจริง
5. Export รายงานเป็น **PDF** (ฟอนต์ไทย)

แหล่งข้อมูลที่ AI ใช้ตอบ (เรียงตามลำดับความน่าเชื่อถือ):
1. **งบประมาณในอดีต** — โฟลเดอร์ `เพราะ AI ไม่ใช่แค่ CHATBOT/` (PBO เบิกจ่าย 2558-2568, ร่าง พ.ร.บ. 2570, ข้อบัญญัติ อปท., เอกสาร กมธ.)
2. **ตัวเลขเศรษฐกิจรายปี** — snapshot JSON ใน repo (`public/data/econ/`) + web search เสริม
3. **ราคาตลาดปัจจุบัน** (Shopee/Lazada/ร้านค้า) — ผ่าน Anthropic **server-side web search tool** เท่านั้น (ห้าม scrape เอง)

## 2. Non-negotiables (ห้ามละเมิด)

| # | กฎ | เหตุผล |
|---|----|--------|
| N1 | **ไม่มี backend, ไม่มี database** — ทุกอย่างรันใน browser, deploy เป็น static site | requirement ของโปรเจกต์ |
| N2 | **API key อยู่ใน memory ของ tab เท่านั้น** ห้ามเขียนลง localStorage/sessionStorage/cookie/URL/log/analytics/error report | security requirement — token ห้ามหลุด |
| N3 | **ทุกตัวเลขที่มาจากข้อมูลจริงต้องมี citation** (`source_id` → file path + sheet + row/page + ข้อความที่พบ) ตัวเลขที่ AI ประมาณเองต้องติดป้าย `estimate` พร้อม confidence | แยก "ยืนยันแล้ว" ออกจาก "เดา" เสมอ |
| N4 | **ห้าม OCR** — PDF ที่ไม่มี text layer อยู่นอก scope (ลงทะเบียนไว้ใน `sources.json` เป็น metadata เท่านั้น) | scope |
| N5 | **ห้าม fetch ข้าม origin จาก browser ยกเว้น `api.anthropic.com`** และไฟล์ static ของเว็บเอง | ไม่มี proxy, ป้องกัน key รั่ว |
| N6 | ข้อมูลดิบใน `เพราะ AI ไม่ใช่แค่ CHATBOT/` เป็น **read-only** ห้ามแก้/ย้าย/ลบ; output ของ pipeline ไปที่ `public/data/` เท่านั้น | ต้นฉบับของผู้ใช้ |
| N7 | ค้นก่อนสร้าง — ก่อนสร้างไฟล์/component/ฟังก์ชันใหม่ ให้ grep ว่ามีอยู่แล้วหรือไม่ | ห้ามทำของซ้ำ |
| N8 | งานทุก phase ต้องมี test ที่รันผ่านก่อนปิดงาน และอัปเดต `docs/STATUS.md` | definition of done |
| N9 | **ภาพประกอบโครงการ = SVG ที่ Claude สร้างเท่านั้น** (ไม่มี image-gen provider อื่น) และต้องผ่าน sanitizer ก่อน render ทุกครั้ง | ตัดสินใจโดยคุณนิว 19 ก.ย. 2569 — รักษา N5 |

## 3. Tech stack (ตัดสินใจแล้ว — ดูเหตุผลใน `docs/04-ARCHITECTURE.md`)

- **Frontend**: React 18 + TypeScript + Vite, Tailwind CSS, Zustand (state), React Router
- **AI**: `@anthropic-ai/sdk` เรียกตรงจาก browser (`dangerouslyAllowBrowser: true` + header `anthropic-dangerous-direct-browser-access: true`), model default `claude-sonnet-4-5` (ให้ผู้ใช้เลือกได้), tools = client tools (ค้นข้อมูลงบ) + server tool `web_search_20250305`
- **Data engine ใน browser**: DuckDB-WASM อ่าน Parquet ผ่าน HTTP range request + MiniSearch (full-text ภาษาไทย ใช้ `Intl.Segmenter`) สำหรับ catalog
- **PDF export**: `@react-pdf/renderer` + ฟอนต์ Sarabun (bundle ใน repo) — render ฝั่ง client
- **Charts / motion / SVG**: Recharts (trend charts), `motion` (framer-motion) สำหรับ micro-interactions, DOMPurify (sanitize SVG ที่ AI สร้าง) — ทั้งหมด bundle ไม่มี CDN
- **Data pipeline (offline, รันบนเครื่อง dev เท่านั้น)**: Python 3.11+, pandas, pyarrow, duckdb, openpyxl, xlrd, pdfplumber, python-docx, python-pptx; tests ด้วย pytest
- **Tests**: Vitest + React Testing Library (unit), Playwright (e2e), pytest (pipeline)
- **Lint/format**: ESLint + Prettier (TS), ruff (Python)
- **Hosting/CI**: **GitHub Pages** deploy ด้วย **GitHub Actions** (`.github/workflows/deploy.yml` on push `main`; `ci.yml` รัน test ทุก push/PR) — URL: `https://xzozero5.github.io/thai-government-budget-planner/` → Vite `base: '/thai-government-budget-planner/'`, ใช้ **HashRouter** (Pages ไม่มี SPA rewrite), CSP ผ่าน `<meta http-equiv>` (Pages ตั้ง header เองไม่ได้); ไฟล์ข้อมูลแต่ละไฟล์ < 24 MB, รวม ≤ 500 MB, initial load (ไม่รวมข้อมูล) < 3 MB gz

## 4. โครงสร้าง repo (เป้าหมาย)

```
/
├── CLAUDE.md                      ← ไฟล์นี้
├── README.md
├── docs/                          ← แผนทั้งหมด (อ่านตามลำดับเลข)
│   ├── 00-START-HERE.md           ← วิธีรันงานด้วย Claude Code + subagents
│   ├── 01-PRD.md
│   ├── 02-DATA-INVENTORY.md       ← สิ่งที่สำรวจพบในข้อมูลดิบ (ยืนยันแล้ว)
│   ├── 03-DATA-PIPELINE.md
│   ├── 04-ARCHITECTURE.md
│   ├── 05-FEATURES.md             ← user stories + AI tool spec + system prompt
│   ├── 06-UI-SPEC.md
│   ├── 07-TESTING.md
│   ├── 08-QA-CHECKLIST.md
│   ├── 09-SECURITY.md
│   ├── BACKLOG.md                 ← งานเรียงลำดับ มี ID (T-xxx) และ DoD
│   ├── STATUS.md                  ← สถานะล่าสุด (Claude Code อัปเดตทุกครั้งที่ปิดงาน)
│   └── decisions/                 ← ADR เพิ่มเติมระหว่างทาง (ADR-00x.md)
├── .claude/
│   ├── agents/                    ← subagent definitions (po, architect, data-engineer, ...)
│   └── commands/                  ← slash commands /phase-0 ... /phase-6, /status, /review
├── pipeline/                      ← Python ETL (ไม่ถูก bundle ไปเว็บ)
│   ├── pyproject.toml
│   ├── tgbp_pipeline/             ← package
│   ├── tests/
│   └── config.yaml                ← RAW_DATA_DIR ฯลฯ
├── web/                           ← Vite app
│   ├── src/
│   │   ├── app/                   ← routes, providers
│   │   ├── features/              ← keygate/, chat/, proposal/, citations/, export/
│   │   ├── data/                  ← duckdb client, minisearch index, loaders, schema types
│   │   ├── ai/                    ← anthropic client, tools, system prompt, agent loop
│   │   ├── components/ui/         ← design system primitives
│   │   └── lib/
│   ├── public/
│   │   ├── data/                  ← OUTPUT ของ pipeline (parquet/json.gz/manifest) — gitignored ถ้าใหญ่
│   │   └── fonts/                 ← Sarabun
│   ├── tests/e2e/
│   └── vite.config.ts
├── เพราะ AI ไม่ใช่แค่ CHATBOT/     ← ข้อมูลดิบ (read-only, gitignored)
└── .gitignore
```

## 5. คำสั่งมาตรฐาน

```bash
# pipeline
cd pipeline && uv sync            # หรือ pip install -e ".[dev]"
uv run tgbp inventory             # สแกน raw → docs/02 + public/data/sources.json
uv run tgbp build --dataset all   # extract → normalize → validate → publish
uv run pytest

# web
cd web && npm ci
npm run dev
npm run test        # vitest
npm run test:e2e    # playwright
npm run lint && npm run typecheck
npm run build       # ต้องผ่านก่อน merge
```

## 5.1 Git / repository

- Remote: `git@github.com:xzozero5/thai-government-budget-planner.git` (GitHub, public, license Apache-2.0 — มี `LICENSE` + "Initial commit" อยู่แล้วบน `main`)
- **สิ่งที่อยู่ใน git**: โค้ดทั้งหมด (`web/`, `pipeline/`, `.claude/`, `docs/`) **และ public data ที่ pipeline publish แล้ว (`web/public/data/**`)** — เพื่อให้ clone แล้ว `npm run dev` ใช้ได้ทันที และ static host deploy จาก repo ได้ตรง ๆ
- **สิ่งที่ห้ามอยู่ใน git**: ข้อมูลดิบ `เพราะ AI ไม่ใช่แค่ CHATBOT/` (3.2 GB, ต้นฉบับผู้ใช้), `pipeline/.cache/`, `.env*`, `node_modules`, `dist`, key ทุกชนิด
- ข้อจำกัดขนาด: ทุกไฟล์ < 24 MB อยู่แล้ว (ต่ำกว่า GitHub 100 MB); ยอดรวม `web/public/data/` ต้อง **≤ 500 MB** — ถ้า pipeline วัดแล้วเกิน ให้เพิ่ม compression/ตัดคอลัมน์ก่อน ห้ามใช้ Git LFS (GitHub Pages/Cloudflare Pages ไม่ serve ไฟล์ LFS) → ถ้าลดไม่ได้ `[ASK-HUMAN]`
- Deploy: push `main` → Actions build `web/` (รวม `web/public/data/`) → GitHub Pages อัตโนมัติ; ต้องเปิด Settings → Pages → Source = **GitHub Actions** ครั้งแรก (คนทำ — `[ASK-HUMAN]` ข้อ 1)
- Branch: ทำงานบน `main` ตรง ๆ ใน MVP (คนเดียว + Claude Code); commit เล็กบ่อย; push ทุกครั้งที่ปิด task; ก่อน push รัน test/lint ให้ผ่าน
- ไฟล์ data ที่ generate ให้ commit แยกจากโค้ดเสมอ (`data: publish <date>`) เพื่อให้ diff โค้ดอ่านง่าย; `manifest.json` ต้องเปลี่ยนพร้อมไฟล์ data ทุกครั้ง
- ห้าม `git push --force` บน `main`; ห้าม commit ไฟล์ที่มี `sk-ant-` (มี pre-commit check ใน T-003)

## 6. วิธีทำงาน (workflow)

1. เริ่มทุก session: อ่าน `CLAUDE.md` → `docs/STATUS.md` → `docs/BACKLOG.md` หยิบงานถัดไปที่ยังไม่ปิด
2. งานที่ต้องอ่านโค้ด/ข้อมูลเยอะ → delegate ให้ subagent ที่เหมาะ (ดู `docs/00-START-HERE.md`) แล้วรับข้อสรุปสั้น; งาน **เขียน/ตัดสินใจ** ทำเองใน main thread
3. ก่อนปิดงานทุกชิ้น: test ผ่าน, lint ผ่าน, อัปเดต `docs/STATUS.md` (วันที่เวลา Asia/Bangkok, สิ่งที่ทำ, สิ่งที่ค้าง, สิ่งที่ยังไม่ยืนยัน)
4. การตัดสินใจทางสถาปัตยกรรมที่เบี่ยงจาก `docs/04-ARCHITECTURE.md` → เขียน `docs/decisions/ADR-xxx.md` ก่อนแก้โค้ด
5. Commit เล็ก ๆ บ่อย ๆ, ข้อความ commit ภาษาไทย นำหน้าด้วย scope: `pipeline:`, `web:`, `docs:`, `ai:`, `ui:`
6. สิ่งที่ยังไม่ยืนยัน (เช่น ตัวเลขเศรษฐกิจที่ดึงมา) ต้องติดป้าย `[UNVERIFIED]` ในเอกสาร และห้าม hard-code เป็นข้อเท็จจริงในโค้ด

## 7. Conventions

- TypeScript strict, ไม่ใช้ `any` (ยกเว้น boundary ของ DuckDB/SDK พร้อม comment)
- ทุก AI tool มี Zod schema ทั้ง input/output และ unit test
- ตัวเงินเก็บเป็น **บาท (integer)** เสมอ; PBO ต้นทางเป็นล้านบาท → คูณ 1,000,000 ตอน normalize และเก็บ `amount_unit_source` ไว้
- ปีงบประมาณใช้ พ.ศ. (`fiscal_year_be: 2567`) และมีคอลัมน์ `fiscal_year_ce` คู่กัน
- ชื่อไฟล์/ชีต/แถวต้นทางเก็บตามจริง (unicode ไทย) ห้าม transliterate; `source_id` เป็น hash คงที่
- ห้ามใส่ข้อมูลดิบทั้งก้อนใน context ของ AI — ให้ AI เรียก tool แล้วส่งเฉพาะแถวที่เกี่ยว (จำกัด ≤ 50 แถว/ครั้ง)
- UI ภาษาไทยเป็นหลัก, ตัวเลขใช้ `Intl.NumberFormat('th-TH')`, วันที่ พ.ศ.
