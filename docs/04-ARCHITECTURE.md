# 04 — Architecture (ADR-001 รวม)

สถานะ: Accepted (19 ก.ย. 2569) · ทบทวนโดย `architect` ต้น Phase 2 — ถ้าเปลี่ยนให้เขียน ADR ใหม่ใน `docs/decisions/`

## 1. ภาพรวม

```
┌────────────────────────── Browser (static site) ───────────────────────────┐
│                                                                            │
│  KeyGate ──► Chat UI ◄──► Agent Loop ──► Anthropic Messages API (HTTPS)     │
│                 │            │   ▲                 ├─ server tool: web_search│
│                 │            │   └── client tools ─┘                        │
│                 │            ▼                                              │
│           Proposal View   Tool Router                                       │
│                 │            ├── search_catalog  → MiniSearch (in-memory)   │
│           Citation Drawer   ├── query_budget_lines → DuckDB-WASM ──► /data/*.parquet (HTTP range)
│                 │            ├── get_source_doc   → sources.json / docs/*.json.gz
│           PDF Export        ├── get_econ_indicator → econ/indicators.json   │
│  (react-pdf, client)        └── emit_proposal     → Proposal store (Zustand)│
│                                                                            │
│  Storage: memory only (API key) · IndexedDB cache เฉพาะ data shards (ไม่มี key/แชท)│
└────────────────────────────────────────────────────────────────────────────┘
```

ไม่มี server ของเราเอง · request ออกนอกได้แค่ `https://api.anthropic.com` และ static asset ของเว็บ (same-origin)

## 2. Decisions

### D1. Frontend: React + TypeScript + Vite (ไม่ใช้ Streamlit/Vue)
- Streamlit ต้องมี Python server → ขัด N1
- React มี ecosystem ครบสำหรับ DuckDB-WASM, react-pdf, Anthropic SDK; Vite build static ตรง ๆ
- Vue ก็ได้ แต่ทีม/agent มี pattern React มากกว่า → ลด risk

### D2. เรียก Anthropic API ตรงจาก browser
> **รายละเอียด model / พารามิเตอร์ / tool version / caching ให้ยึด `docs/decisions/ADR-006-claude-api-current-surface.md`** (ข้อความด้านล่างบางส่วนเขียนก่อนตรวจกับ API ปัจจุบัน)
- SDK รองรับ `dangerouslyAllowBrowser: true`; ต้องส่ง header `anthropic-dangerous-direct-browser-access: true`
- Key เก็บใน Zustand store ที่ **ไม่ persist** (memory only) — ดู `09-SECURITY.md`
- Streaming ใช้ `client.messages.stream()` เพื่อ UX; ใช้ **prompt caching** (`cache_control` บน system prompt + tool defs) ลดค่าใช้จ่าย
- Model default **`claude-sonnet-5`** (แก้ 20 ก.ย. 2569 ตาม spike S3: รุ่นปัจจุบัน ถูกกว่า `claude-sonnet-4-5` ตามหน้า pricing ทางการที่ตรวจวันเดียวกัน — ราคา `[UNVERIFIED]` จนกว่า T-301 ตรวจซ้ำ); ให้เลือก `claude-haiku-4-5-20251001` (ประหยัด) / `claude-opus-5` ได้ใน settings (list ค่าคงที่ใน `ai/models.ts`, ไม่เรียก list-models เพื่อลด surface); ต้นทุนคิดจาก `usage` ที่ API คืนเท่านั้น; ขั้นต่ำ prompt cache ต่างกันตามรุ่น (S3 วัด cache hit จริงแล้วบน Haiku 4.5: write 17,882 → read 17,882 tokens)
- web search = server tool คิดค่าบริการต่อครั้ง + ผลค้น ~10.5k input tokens/ครั้ง (S3) → `max_uses` ต่ำ (≤ 3) และแสดงต้นทุนให้ผู้ใช้เห็น
- ราคาตลาด: ใช้ **server tool** `{"type":"web_search_20250305","name":"web_search","max_uses":5}` — Anthropic เป็นคน fetch, browser ไม่แตะ Shopee เลย

### D3. ข้อมูลใน browser: DuckDB-WASM + Parquet + MiniSearch
- ทางเลือกที่ตัดทิ้ง: (a) โหลด JSON ทั้งก้อน — 2.9 M แถวไม่ไหว; (b) SQLite-WASM + sql.js-httpvfs — ได้ แต่ต้อง build DB ไฟล์เดียวใหญ่ + page-level fetch ช้ากว่า parquet column pruning; (c) pre-aggregate อย่างเดียว — citation ลงระดับแถวไม่ได้
- DuckDB-WASM: `SELECT ... FROM read_parquet('https://<origin>/data/budget_lines/pbo/2566/*.parquet') WHERE ...` ใช้ HTTP range + parquet stats → โหลดเฉพาะ row group ที่เกี่ยว
- **ต้องทดสอบ host รองรับ `Range` + CORS (same-origin จึงไม่ต้อง CORS) ตั้งแต่ Phase 2 (T-201)**; fallback: `fetch` ทั้ง shard แล้ว `registerFileBuffer`
- MiniSearch สำหรับ catalog (item_key ~ 10^5) ทำ fuzzy/prefix ภาษาไทยด้วย tokenizer จาก `Intl.Segmenter('th',{granularity:'word'})` (Chrome/Edge/Safari/Firefox รองรับแล้ว; ถ้าไม่มี → fallback n-gram 3)
- Query ทั้งหมดผ่าน `data/repo.ts` (Repository pattern) เพื่อให้ tool ไม่รู้จัก DuckDB โดยตรง และ mock ได้ในเทสต์

**แก้ตาม ADR-002 (spike S1, 20 ก.ย. 2569 — วัดบน GitHub Pages จริง):**
- ค่า default ของ `@duckdb/duckdb-wasm` 1.32.0 คือ `forceFullHTTPReads: true` (โหลดทั้งไฟล์) → ต้องตั้ง `filesystem: {forceFullHTTPReads:false, allowFullHTTPReads:true, reliableHeadRequests:true}` เอง; ผล: `count(*)` 23 KB/5 requests แทน 6.17 MB, เย็น 401–1,542 ms, อุ่น 16–110 ms
- DuckDB-WASM **ดาวน์โหลด parquet extension จาก `extensions.duckdb.org` เอง** (ละเมิด N5) → self-host ใต้ `web/public/duckdb-ext/v<ver>/wasm_eh/` + `SET custom_extension_repository`; และ **CSP meta ไม่ครอบ worker ที่สร้างจาก URL same-origin** → สร้าง worker จาก `blob:` + `importScripts` ให้สืบทอด CSP; ต้องมี integration test ที่ block cross-origin แล้วยังผ่าน
- `repo` ต้องเลือกคอลัมน์แคบ (ดึง `item_name_raw` เฉพาะแถวที่จะแสดง ≤ 50) — ดึงคอลัมน์ข้อความยาวใน range mode อ่านมากกว่าไฟล์ทั้งก้อน; fallback `fetch` ทั้ง shard + `registerFileBuffer` เมื่อคาดว่าอ่าน > 70 % หรือ host ไม่ตอบ 206
- row-group pruning ใช้ได้กับ `agency`/คอลัมน์ตัวเลข แต่**ไม่ได้กับ `item_key`** เพราะ shard sort ตาม agency ก่อน — main thread ทดลอง: sort `item_key` ก่อน → ขนาด +1 %, row group ที่ต้องอ่านต่อ key 3 → 1 (จาก 3) → ทำพร้อม republish ครั้งถัดไป (T-209) ไม่ republish เพื่อเรื่องนี้อย่างเดียว (กัน git history +165 MB)
- ค้นหา: build MiniSearch index ใน browser จาก catalog จริง = 1.7 s (desktop) / **14.3 s (CPU 4×)**, heap +37 MB → **publish prebuilt index + catalog แบบผอม (T-208)**: โหลด 309 ms / 1.5 s (4×), heap +23 MB; `Intl.Segmenter('th')` ยืนยันใน Chromium (Firefox/Safari `[UNVERIFIED]`); folding (ตัดช่องว่างไทย + `ำ`→`า` ก่อน tokenize) ทำให้ค้น "สำนักงาน" ใน text PDF ได้ 0 → 55 hits

### D4. Agent loop อยู่ฝั่ง client
- `ai/agent.ts`: loop จนกว่า `stop_reason != "tool_use"` หรือครบ `MAX_TOOL_ROUNDS = 8`; ทุก tool call/result log ลง `ToolLog` (ใช้ตรวจ citation)
- **Citation integrity**: proposal ที่ AI emit ต้องอ้าง `source_id` ที่ปรากฏใน ToolLog ของ session เท่านั้น; ถ้าไม่พบ → UI ลดระดับเป็น `estimate` + แจ้งเตือน (ป้องกัน hallucinated citation)
- Tool results ตัดที่ 50 แถว + บอก AI ว่ามีอีกกี่แถว (ให้ refine query)

### D5. Proposal เป็น structured JSON (schema ใน `05-FEATURES.md` §5)
- AI ส่งผ่าน tool `emit_proposal` (input schema = Zod → JSON Schema) ไม่ parse จาก free text
- UI render จาก JSON; PDF render จาก JSON เดียวกัน → สอดคล้องกัน
- Save/Load = ดาวน์โหลด/อัปโหลด `.tgbp.json` (รวม ToolLog ย่อสำหรับ citation)

### D6. PDF: `@react-pdf/renderer` ฝั่ง client + ฟอนต์ Sarabun (OFL) bundle
- ทางเลือกที่ตัด: `window.print()` → CSS print (ควบคุมยาก, header/footer ไม่ได้); pdfmake (ไทยได้แต่ layout ตารางยาก); jsPDF+html2canvas (ภาพ ไม่ค้นหาข้อความได้)
- ต้อง register font ที่มี Thai glyph ครบ + `hyphenationCallback` ปิด; ทดสอบสระลอย/วรรณยุกต์ซ้อน

### D9. ภาพประกอบโครงการ = SVG ที่ Claude สร้าง (ไม่มี image-gen provider) — ตัดสินใจโดยคุณนิว 19 ก.ย. 2569
- เหตุผล: รักษา N5 (egress เฉพาะ api.anthropic.com), ไม่ต้องมี key ที่สอง, ไม่มีค่าใช้จ่ายเพิ่ม, SVG แก้/ขยาย/ใส่ใน PDF ได้
- AI ส่งผ่าน tool `emit_illustration` (`{title, caption, svg, kind: "map"|"cross_section"|"isometric"|"diagram"}`); ข้อจำกัด: `viewBox` บังคับ, ≤ 60 KB, ใช้เฉพาะสีจาก palette ที่ส่งให้ใน prompt, ไม่มี `<script>`, `<foreignObject>`, event attributes, `href` ภายนอก, `<style>` ที่มี `url(`
- Sanitize ด้วย DOMPurify (`USE_PROFILES: {svg: true, svgFilters: true}`, `FORBID_TAGS: ['script','foreignObject','use','image']`, `FORBID_ATTR: [/^on/i, 'href', 'xlink:href']`) แล้ว inject เป็น DOM node (ไม่ใช่ `dangerouslySetInnerHTML` กับสตริงดิบ)
- **แก้ตาม spike S5**: DOMPurify profile ข้างบน**ไม่พอ** — `<style>` ที่มี `@import url(https://…)` หลุด 100 % และ `FORBID_ATTR` รับเฉพาะ string (regex `/^on/i` ใช้ไม่ได้ — event attr ถูกตัดโดย profile อยู่แล้ว) → `lib/svgSanitizer.ts` ต้อง **ลบ `<style>` ทั้ง element** (`FORBID_TAGS` เพิ่ม `style`, `animate*`, `set`, `a`) และ **ตัด attribute `style` ทิ้งเสมอ** (main thread พิสูจน์ว่า blocklist `url(` ไม่พอ: `style="mask-image:image-set('https://…' 1x)"` หลุดได้) + ชั้นตรวจซ้ำหลัง DOMPurify: ค่า attribute ใด (ยกเว้น `xmlns*`) ที่มี `://`, ขึ้นต้น `//`, `url(` ที่ไม่ใช่ `url(#id)`, `image-set(`/`image(`/`cross-fade(`/`element(`, `javascript:`, `data:` → ตัด; prompt ต้องสั่งให้ใช้ presentation attributes แทน CSS; `max_tokens ≥ 8,000` และทิ้งผลเมื่อ `stop_reason === 'max_tokens'` (SVG isometric ชน 4,000); แปลง SVG → PNG ใช้ `data:` URL (ไม่ tainted ใต้ CSP เดิม; `blob:` ถูกบล็อก); ฟอนต์ใน SVG ตอน rasterize เป็นฟอนต์ระบบ (ยอมรับ)
- ใน PDF: แปลง SVG → PNG ด้วย `<canvas>` (`Image` + `drawImage`) ที่ 2× ตอน export แล้ววางเป็น `<Image>` ใน react-pdf (react-pdf รองรับ SVG แค่บางส่วน — spike S5)
- ให้ AI ตัดสินใจสร้างเมื่อ: โครงการมีองค์ประกอบเชิงพื้นที่/โครงสร้าง (ถนน, อาคาร, ฝาย, ระบบประปา, ผังเครือข่าย) หรือยอดรวม ≥ 10 ล้านบาท; รายการครุภัณฑ์ล้วน ๆ ไม่ต้อง

### D10. Trend charts: Recharts (bundle) + ข้อมูลจาก catalog/trends และ econ series
- กราฟ 2 แบบเท่านั้น: sparkline (ในตาราง BOQ, 120×32) และ line chart เล็ก (ใน citation drawer / การ์ดสถิติ, ≤ 320×160) — ≤ 10 จุด (ปี), มี tooltip ค่า+ปี, ไม่มี legend ยาว
- ห้ามให้ AI วาดกราฟเอง — AI เรียก `get_price_trend` แล้ว UI render จาก series; AI แค่เขียนคำอธิบาย 1 ประโยค
- Motion: `motion` (framer-motion) สำหรับ enter/exit, count-up ตัวเลข, draw-in ของเส้นกราฟ; ปิดทั้งหมดเมื่อ `prefers-reduced-motion`

### D7. State: Zustand (slices: `session` (key, model), `chat`, `proposal`, `toolLog`, `data` (load status))
- `session` slice ไม่ใช้ `persist` middleware; slice อื่นก็ไม่ persist (ทุกอย่างหายเมื่อปิด tab — ตั้งใจ) ยกเว้น IndexedDB cache ของ data shards (ไม่มีข้อมูลผู้ใช้)

### D8. Hosting: GitHub Pages + GitHub Actions (ตัดสินใจโดยคุณนิว 19 ก.ย. 2569)
- Deploy: workflow `deploy.yml` (trigger push `main` + manual) → `npm ci && npm run build` → `actions/upload-pages-artifact` (`web/dist`) → `actions/deploy-pages`; permissions `pages: write, id-token: write`; concurrency group `pages`
- Project site → URL `https://xzozero5.github.io/thai-government-budget-planner/` → Vite `base` ต้องเป็น `/thai-government-budget-planner/` และทุก data URL ใช้ `import.meta.env.BASE_URL` (ห้าม hard-code `/data/`)
- Routing: **HashRouter** (`/#/workspace`) เพราะ Pages ไม่มี SPA rewrite (ไม่ใช้ 404.html hack)
- Headers: GitHub Pages ตั้ง HTTP header เองไม่ได้ → CSP ใส่ `<meta http-equiv="Content-Security-Policy">` ใน `index.html` (ทำงานได้ทุกอย่างยกเว้น `frame-ancestors`/`report-uri`); COOP/COEP ตั้งไม่ได้ → **DuckDB-WASM ต้องใช้ build ที่ไม่ใช้ threads (eh/mvp)** — ยืนยันใน S1
- Range requests: GitHub Pages (Fastly CDN) ส่ง `Accept-Ranges: bytes` `[UNVERIFIED — S1 ต้องวัดบน URL จริงหลัง deploy ครั้งแรก]`; ถ้าไม่รองรับ → fallback โหลด shard ทั้งไฟล์ (< 24 MB) ตาม D3
- ขนาด: site ≤ 1 GB (soft limit ของ Pages) → เราคุม data ≤ 500 MB; artifact deploy ต่อครั้ง ≤ 10 GB
- ไม่มี server-side อะไรทั้งนั้น สอดคล้อง N1; ทางเลือกที่ตัด: Cloudflare Pages (headers ได้ แต่ต้องมีบัญชี/ตั้งค่าเพิ่ม), Vercel
- CSP (meta): `default-src 'self'; connect-src 'self' https://api.anthropic.com; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; frame-ancestors 'none'`
- DuckDB-WASM ต้องการ `wasm-unsafe-eval` และ worker; GitHub Pages ตั้ง COOP/COEP ไม่ได้ → **ใช้ eh build ไม่ใช้ threads** (บังคับ)
- **CSP จาก `<meta>` ไม่ครอบ dedicated worker ที่โหลดจาก URL same-origin** (worker ใช้ CSP จาก response header ของสคริปต์ตัวเอง ซึ่ง Pages ตั้งไม่ได้) → worker ทุกตัวต้องสร้างจาก `blob:` (สืบทอด CSP ของหน้า) — ADR-002; asset เพิ่ม: `duckdb-ext/**` (parquet extension ~3 MB, same-origin); ยืนยันบน Pages จริง: CSP meta ทำงาน, parquet ตอบ `206`, `*.json.gz` เสิร์ฟเป็น `application/gzip` ไม่มี `Content-Encoding` (client gunzip เอง), SDK ของ Anthropic ทำงานใต้ CSP นี้โดยไม่มี violation (S3)

## 3. Module boundaries (`web/src/`)

| module | รับผิดชอบ | ห้าม |
|---|---|---|
| `ai/` | client, system prompt, tool definitions (Zod), agent loop, model list | แตะ DOM, แตะ DuckDB โดยตรง (ผ่าน `data/repo`) |
| `data/` | manifest loader, DuckDB client, MiniSearch, repo API (`searchCatalog`, `queryLines`, `getDoc`, `getEcon`) | รู้จัก React |
| `features/keygate` | ใส่/ตรวจ key (ping `models.list`? → ใช้ `messages.count_tokens` แทน เพราะถูกและไม่ list), เลือก model | เก็บ key นอก store |
| `features/chat` | UI แชท, streaming render, tool activity indicator | logic proposal |
| `features/proposal` | render proposal JSON, แก้ไข qty/ราคาแบบ inline, recompute totals | เรียก AI ตรง (ผ่าน chat action) |
| `features/citations` | drawer แสดง source: path, sheet/row/page, excerpt, ปุ่ม copy path, ลิงก์ (ถ้ามี `SOURCE_BASE_URL`) | |
| `features/export` | PDF (react-pdf), JSON save/load | |
| `components/ui` | primitives ตาม design tokens | business logic |

## 4. Runtime sequence (happy path)

1. โหลด `manifest.json`, `catalog/facets.json` (เล็ก) → พร้อมใช้; `catalog/items.json.gz` โหลด lazy ตอน tool แรกถูกเรียก (แสดง progress)
2. ผู้ใช้ใส่ key → `count_tokens` ping สำเร็จ → เข้าแชท
3. ผู้ใช้พิมพ์ไอเดีย → agent loop: AI ถามคำถาม (ไม่มี tool) → ผู้ใช้ตอบ → AI เรียก `search_catalog` → `query_budget_lines` (DuckDB โหลด shard ที่จำเป็น) → `get_econ_indicator` → `web_search` (server) → `emit_proposal`
4. UI render proposal + citations; ผู้ใช้ปรับ/ถามต่อ → AI `emit_proposal` เวอร์ชันใหม่ (เก็บ history)
5. Export PDF / Save JSON

## 5. Performance budget (แก้ 20 ก.ย. 2569 ตามผลวัดจริงใน `docs/decisions/SPIKES.md`)
- JS initial (gz): ≤ 400 KB app (ตอนนี้ ~60 KB); Anthropic SDK ~50 KB gz
- **Lazy (โหลดเมื่อ tool แรกถูกเรียก พร้อม progress)**: DuckDB-WASM **~8.6 MB gz** (wasm 7.64 + worker 0.19 + parquet ext 0.69 + js 0.04 — ตัวเลขเดิม 2.5 MB ผิด) · ค้นหา ~3.6 MB gz (prebuilt index 1.60 + catalog ผอม 1.96 — T-208; ถ้าไม่ทำคือ 5.4 MB gz + build index 1.7–14.3 s)
- **Lazy ตอน export**: react-pdf ~456 KB gz + Sarabun Regular/Bold ~90 KB gz; render 4 หน้า 235 ms
- Tool round-trip: `search_catalog` < 200 ms **ไม่รวมเวลาโหลด index** (วัด: 5 query 42 ms desktop / แย่สุด 72 ms ต่อ query ที่ CPU 4× แบบ key_only); `query_budget_lines` ต่อ shard เย็น < 3 s (วัดบน Pages: 0.4–1.5 s — ยังไม่ได้ throttle เครือข่าย `[UNVERIFIED]`), อุ่น < 300 ms (วัด 16–110 ms)
- Memory: DuckDB จำกัด 512 MB; JS heap ของ catalog+index ≈ 23 MB (prebuilt) / 74 MB (build เอง; peak 110 MB); ลงทะเบียน shard พร้อมกันได้ ≤ 12 ไฟล์ (= เพดาน shard ต่อ query; shard ของ query ที่กำลังรันถูก pin ไม่ถูก evict — T-206 F7)
- PRD "initial < 3 MB gz" ยังทำได้ (ของหนักทั้งหมดเป็น lazy) แต่ time-to-first-tool-result บน 4G จะถูกกำหนดโดย DuckDB 8.6 MB → ต้องเริ่ม prefetch หลังผู้ใช้ใส่ key สำเร็จ (ระหว่างที่ AI ยังถามคำถาม) — AC ใหม่ใน T-203/T-408

## 6. สิ่งที่ต้อง spike ก่อน (Phase 2, ทำก่อนเขียน feature)
- S1 DuckDB-WASM + range request บน `vite preview` และบน **GitHub Pages จริง** (deploy spike ผ่าน workflow ไป branch/URL จริง แล้ววัด `Accept-Ranges`, bytes ที่โหลดจริงต่อ query, latency) — ถ้า Pages ไม่รองรับ range ให้ ADR-002 fallback โหลด shard ทั้งไฟล์
- S2 `Intl.Segmenter` th ใน Chrome/Firefox/Safari + MiniSearch ที่ 100k entries (เวลา index, memory)
- S3 Anthropic SDK ใน browser: streaming + web_search tool + client tool ใน loop เดียว, prompt caching hit
- S4 react-pdf + Sarabun: ตารางไทย 3 หน้า, สระ/วรรณยุกต์, เลขไทย/อารบิก
- S5 SVG จาก Claude: ให้ Sonnet สร้าง SVG 5 โจทย์ (ถนน 4 เลน, ฝาย, อาคาร 3 ชั้น, ผังประปาหมู่บ้าน, แผนที่เส้นทาง กทม.–นครนายก) วัดขนาด/คุณภาพ/เวลา + ทดสอบ sanitizer + แปลงเป็น PNG ลง PDF
บันทึกผล spike ลง `docs/decisions/SPIKES.md`
