# T-307 — Security review: AI layer + data layer (Phase 3)

ผู้ทบทวน: `security-reviewer` · วันที่: 20 ก.ย. 2569 · โหมด: **read-only** (ไฟล์นี้เป็นไฟล์เดียวที่เขียน)

ขอบเขต: `web/src/ai/**`, `web/src/data/**`, `web/src/lib/svgSanitizer.ts`, `web/src/app/**`,
`web/index.html`, `web/vite-plugins/cspMeta.ts`, `web/vite.config.ts`, `web/package.json`,
`.githooks/pre-commit`, `.github/workflows/*.yml`, `.gitignore`

ไม่ได้เรียก Anthropic API · ไม่ได้อ่านเนื้อหา `web/.env.local` (ตรวจแค่สถานะ gitignore) · ไม่ได้รันคำสั่ง git
ที่เปลี่ยนสถานะ · ไม่ได้แก้โค้ด

---

## 0. สรุปผู้บริหาร (go/no-go)

| คำถาม | คำตอบ |
|---|---|
| ยิง API จริงใน eval ได้ไหม | **GO (มีเงื่อนไข)** — เส้นทางของ key ในโค้ดปัจจุบันสะอาด: ไม่มี storage ใด ๆ ใน `web/src/**`, ไม่ log key/headers, baseURL เป็นค่าคงที่, error ของ SDK ไม่พก key, pre-commit hook เปิดใช้งานจริง (`core.hooksPath=.githooks`), `web/.env.local` ถูก ignore และไม่ถูก track · เงื่อนไข: eval runner ต้องอ่าน key ฝั่ง Node เท่านั้น, ห้ามตั้ง `VITE_EVAL_*` ตอน vite build, ต้อง scrub transcript/ledger/artifact |
| เข้า Phase 4 ได้ไหม | **CONDITIONAL GO** — ต้องปิด **H1** และ **H2** ก่อน เพราะทั้งคู่เปลี่ยนสัญญาที่ UI จะพึ่ง (ที่เก็บ client object / รูปร่างของ ToolLog + validator) แก้ทีหลัง = รื้อ store และ schema ของ `.tgbp.json` · ควรปิด M1/M2 พร้อมกัน |
| มี critical ไหม | **ไม่มี** |
| svgSanitizer รอบ 3 | ไม่พบ bypass ใหม่ (38 เคส + ReDoS probe รันจริงบน jsdom) — แต่ยังไม่ได้ยืนยันซ้ำบน Chromium |

---

## 1. ตาราง findings

severity: **H** = high · **M** = medium · **L** = low/info

| # | sev | เรื่อง | หลักฐาน (ไฟล์:บรรทัด) | ผลกระทบ | ข้อเสนอแก้ | ผู้รับผิดชอบ |
|---|---|---|---|---|---|---|
| **H1** | **H** | **object `Anthropic` เปิดเผย `apiKey` เป็น own enumerable property** — `createClient()` คืน instance ที่มีทั้ง `apiKey` และ `_options.apiKey` ตรง ๆ | `web/src/ai/client.ts:21-23` · **ยืนยันด้วยการรัน**: `Object.keys(client)` มี `_options` และ `apiKey`; descriptor ของ `apiKey` คือ enumerable:true, writable:true; `Object.keys(c._options)` = apiKey, authToken, webhookKey, dangerouslyAllowBrowser, baseURL | ถ้า Phase 4 เก็บ client ไว้ใน Zustand slice `session` (04 §D7 ระบุ slice session (key, model)) แล้วมีใครใส่ `persist`/`devtools`/`partialize` ที่ spread ทั้ง slice, หรือ save `.tgbp.json` แบบ walk ทั้ง store, หรือเปิด React DevTools → **key หลุดทันที** (ละเมิด N2) | (ก) ห้ามเก็บ instance `Anthropic` (หรือสิ่งที่อ้างถึงมัน) ใน store/React state — เก็บใน module-scope variable ใน `ai/` แล้ว export เฉพาะฟังก์ชัน setKey / clearKey / runAgentTurn (ข) ถ้าจำเป็นต้องมี ref ใน store ให้ใช้ WeakMap หรือ `Object.defineProperty` แบบ enumerable:false (ค) เพิ่ม unit test: snapshot ของ store และ payload ของ `.tgbp.json` ต้องไม่ match `sk-ant-` | `frontend-dev` + `ai-engineer` |
| **H2** | **H** | **Citation integrity ตรวจแค่ "มีตัวตน" ไม่ตรวจ "ค่าตรง"** — ToolLog เก็บเฉพาะ id (Set/Map ของ string) validator จึงยืนยันได้แค่ว่า source_id / doc_id / (indicator, year) เคยปรากฏ | `web/src/ai/toolLog.ts:85-95` (เก็บแต่ id), `web/src/ai/tools/proposal.ts:181-192` (isCitationResolved), `proposal.ts:352-358` (comparables ตรวจแค่ hasSourceId), `proposal.ts:27-32` (quote/page เป็น free text ไม่ถูกตรวจ), `proposal.ts:283-288` (ตรวจแค่ qty × unit_price = total) | โมเดลอ้าง source_id จริง แต่ใส่ amount_thb / unit_price_thb / agency / item_name / fiscal_year_be ที่ **แต่งขึ้น** ใน comparables และ BOQ ได้ผ่านฉลุย; quote ของเอกสารแต่งได้ทั้งประโยคตราบใดที่ doc_id เคยอ่าน; econ ตรวจปี/ตัวชี้วัดแต่ไม่ตรวจค่า ⇒ **N3 ผ่านได้ด้วย pointer ถูก + ตัวเลขผิด** ซึ่งคือสิ่งที่ N3 ตั้งใจป้องกัน | ToolLog ต้องเก็บ value fingerprint: ต่อ source_id เก็บ amount_thb, unit_price_thb, item_name_raw, agency, fiscal_year_be; ต่อ (doc_id, page) เก็บ hash/ข้อความของ chunk ที่ส่งให้โมเดลจริง; ต่อ (indicator, year) เก็บ value · `validateAndNormalizeProposal` เทียบ comparables ทุกฟิลด์, เทียบ unit_price_thb ของ BOQ line ที่ basis=historical กับแถวที่ cite (±tolerance), บังคับ quote ต้องเป็น substring ของ chunk ที่อ่านจริง → ไม่ตรง = warning + ลดเป็น estimate/low (แพทเทิร์นเดียวกับ price_derivation ที่ `proposal.ts:267-281`) | `ai-engineer` |
| **M1** | M | **delimiter ของ tool result เป็นสตริงคงที่และ payload ไม่ถูก escape** — เนื้อหาเอกสาร/ผลค้นเว็บปิด delimiter เองได้ | `web/src/ai/tools/toolKit.ts:49-57` · **ยืนยันด้วยการรัน**: JSON.stringify ไม่ escape อักขระ `<` หรือ `/` ⇒ chunk ที่มีสตริงปิด tag ทำให้ tool_result.content มี closing tag **2 ครั้ง** ข้อความหลังจากนั้นดูเหมือนอยู่นอกเขตข้อมูล | ลดพลังของมาตรการ 09 §3 (tool result ห่อด้วย delimiter ชัด) — prompt injection จาก PDF/web ปลอมเป็นคำสั่งระบบได้ | ใช้ nonce สุ่มต่อ session ใน delimiter (tool_result_data nonce=...) สร้างพร้อม ToolLog แล้วประกาศ nonce ใน system prompt และ/หรือ strip สตริงปิด tag ออกจาก payload ก่อน serialize · ห่อ error content (`toolKit.ts:59-70`) ด้วยวิธีเดียวกัน | `ai-engineer` |
| **M2** | M | **ไม่มีเพดานค่าใช้จ่ายโดยปริยายใน agent loop** — maxCostUsdPerTurn / maxCostUsdPerSession เป็น undefined ถ้าผู้เรียกไม่ส่ง (มีแต่ maxToolRounds ที่ default 8) | `web/src/ai/agent.ts:385-388`, `agent.ts:420-433` | ถ้า Phase 4 ลืมส่ง budget → 8 รอบ × max_tokens 16,000 + web search 3 ครั้ง/turn โดยไม่มีเพดานเงิน (สินทรัพย์ที่ปกป้อง = เงินของผู้ใช้) | ประกาศ DEFAULT_MAX_COST_USD_PER_TURN / _PER_SESSION แล้วใช้เมื่อผู้เรียกไม่ระบุ; แสดงยอดสะสมใน UI (event usage มีให้แล้ว) | `ai-engineer` |
| **M3** | M | **dataUrl() ยังไม่ assert same-origin** (T-206 F11 ยังไม่ถูกแก้) | `web/src/data/manifest.ts:58-66`, `web/src/data/repo.ts` (toAbsoluteDataUrl) | BASE_URL เป็นค่า build-time (ยังไม่ใช่ input ของผู้โจมตี) แต่ N5 เป็น non-negotiable ที่ควรมี guard ที่โค้ด ไม่ใช่แค่ convention | assert ว่า `new URL(url, location.href).origin === location.origin` มิฉะนั้น throw + unit test | `frontend-dev` |
| **M4** | M | **CSP meta ขาด base-uri / form-action / object-src** (default-src ไม่ครอบสามตัวนี้) | `web/vite-plugins/cspMeta.ts:13` | แท็ก base href ที่ถูกแทรก (ถ้ามี HTML injection) เปลี่ยน base ของ URL สัมพัทธ์ทั้งหน้าได้ แม้ script-src self ยังอยู่ | เติม base-uri none; form-action none; object-src none · frame-ancestors ใช้ใน meta ไม่ได้ (ยอมรับแล้ว 04 §D8) · style-src unsafe-inline ยังยอมรับได้เพราะ default-src/img-src เป็น self ซึ่งปิดทางโหลดทรัพยากรภายนอกจาก CSS แต่ต้องทบทวนซ้ำตอนใส่ Recharts/motion | `architect` + `frontend-dev` |
| **M5** | M | **CI ไม่มี npm audit และไม่มี pip-audit** ทั้งที่ 09 §4 บังคับ | `.github/workflows/ci.yml` (ทั้งไฟล์ — มีแค่ lint/typecheck/test/build/CSP-grep/e2e) | 09 §5 C8 ไม่มีอะไรบังคับจริง; dependency ที่มีช่องโหว่จะเข้ามาได้เงียบ ๆ | เพิ่ม step npm audit --audit-level=high (job web) และ pip-audit (job pipeline) · เพิ่ม step สแกน dist ว่าต้องไม่มีไฟล์ .map และไม่มีสตริง sk-ant- / VITE_EVAL / DataHarness (ทำให้ C9 เป็นอัตโนมัติ) | `main thread` |
| **M6** | M | **emit_proposal ไม่มีเพดานขนาด input** — boq มี .min(1) แต่ไม่มี .max(); objectives / scope_and_specs / assumptions / comparables / risks / open_questions / citations_web ไม่มีเพดาน; ทุก string ไม่มี .max() | `web/src/ai/tools/proposal.ts:136-154` (เทียบกับ `emitIllustration.ts:21-26` ที่มีเพดานครบ) | ถูกจำกัดโดย max_tokens 16,000 ในทางปฏิบัติ แต่ object นี้จะถูกเขียนลง `.tgbp.json` (Phase 5) และ render ทั้งก้อน → DoS ฝั่ง client / ไฟล์บวม | ใส่ .max() ทุก array (เช่น boq ≤ 200, comparables ≤ 50) และ .max(2000) กับ string ยาว (summary, rationale, similarity_note, text) | `ai-engineer` |
| **M7** | M | **ไม่มี test ตรวจ sha256 ของ DuckDB parquet extension ที่ self-host** | `web/public/duckdb-ext/README.md:31` (มี sha256 เขียนไว้) แต่ไม่มีเทสต์ไหนอ่านค่านี้; 09 §4 เขียนว่า ตรวจ hash ตอน build | ถ้าไฟล์ extension ถูกแทนที่ (บน host หรือใน repo) จะไม่มีใครจับได้ — และมันคือ wasm ที่รันในหน้าเว็บของเรา | เพิ่ม vitest ที่ hash ไฟล์ใต้ `v1.4.3/wasm_eh/` แล้วเทียบกับค่าคงที่ (ผูกกับเวอร์ชันเหมือนที่ `duckdb.test.ts:29-56` ทำอยู่แล้ว) | `frontend-dev` |
| L1 | L | dangerouslyAllowBrowser — ความเสี่ยงที่เหลือคือ XSS ใดก็ได้ในหน้าเว็บอ่าน key จากหน่วยความจำ JS ได้ และยังไม่มีข้อความเตือนผู้ใช้ | `web/src/ai/client.ts:21-23`; ยังไม่มี UI keygate | ผู้ใช้ไม่รู้ว่าควรใช้ key แบบไหน | keygate ต้องมีข้อความไทย: ใช้ key ที่สร้างใน **workspace แยก** + ตั้ง **spend limit** + เพิกถอนได้ทันที และอธิบายว่า key อยู่ในแท็บนี้เท่านั้นและหายเมื่อปิด | `frontend-dev` |
| L2 | L | web_search ไม่จำกัดโดเมน และ query เป็นข้อความที่โมเดลแต่งเอง (อาจมีเนื้อหาบทสนทนาของผู้ใช้ติดไป) | `web/src/ai/requestBuilder.ts:125-134` (max_uses 3, ไม่มี allowed_domains/blocked_domains) | ช่องทาง exfiltrate ข้อความผู้ใช้ผ่าน query (ไปที่ Anthropic + search provider) — browser ไม่ได้ยิงเอง จึงไม่ละเมิด N5 | มาตรการที่มีแล้ว: event server_tool พก query (`agent.ts:266-269`) และปิด web search ได้ (`agent.ts:107-109`) → **Phase 4 ต้องแสดง query ทุกครั้ง** และมีสวิตช์ปิด; พิจารณา blocked_domains | `frontend-dev` |
| L3 | L | string ของ tool input บางตัวไม่มีเพดานความยาว | `web/src/ai/tools/queryBudgetLines.ts:32-45` (keywords, agency, province, ministry_code), `findDocuments.ts:8-16` (query, agency) — เทียบกับ `searchCatalog.ts:14` ที่มี .max(200) | bounded ด้วย max_tokens; เป็นเรื่องความสม่ำเสมอมากกว่าความเสี่ยงจริง | ใส่ .max(200) ให้ครบ | `ai-engineer` |
| L4 | L | **info (ตรวจแล้วปลอดภัย)** error ของ SDK ไม่พก key | `web/node_modules/@anthropic-ai/sdk/error.d.mts` — APIError.headers คือ **response** headers ไม่ใช่ request; `internal/utils/log.js:105-107` redact authorization / x-api-key; `agent.ts:184` อ่านแค่ retry-after | — | คงไว้; ห้าม log object err ดิบใน error boundary (ให้ผ่าน redactSecrets) | — |
| L5 | L | proposal_id / illustration_id ใช้ Math.random() | `proposal.ts:437-439`, `emitIllustration.ts:36-38` | ปลอดภัยสำหรับการใช้งานปัจจุบัน (เป็น id ภายใน) แต่ห้ามใช้เป็น capability/secret ในอนาคต | บันทึกไว้เป็นข้อจำกัด | — |
| L6 | L | `web/src/ai/testing/fakeAnthropic.ts` อยู่ใน `src/` (แพทเทิร์นเดียวกับ T-206 F17) | `web/src/ai/testing/fakeAnthropic.ts` | ไม่ reachable จาก entry (ยืนยันจากการ grep dist ที่มี JS ก้อนเดียวและไม่มีสตริงที่เกี่ยวข้อง) | ขยาย ESLint no-restricted-imports ให้ครอบ `@/ai/testing/*` จากไฟล์ที่ไม่ใช่ไฟล์ test | `frontend-dev` |

---

## 2. N2 — เส้นทางของ API key (ตรวจครบทุกทาง)

| เส้นทาง | ผล |
|---|---|
| localStorage / sessionStorage / IndexedDB / document.cookie / persist( / window.name / Cache API | **ไม่พบใน `web/src/**` เลย** (grep ทั้งโฟลเดอร์) — เจอเฉพาะใน `web/spikes/src/s3.ts:223-225` ซึ่งเป็น *ตัวตรวจ* ของ S3 และ `web/spikes/results/s3.json:155-156` ที่บันทึกว่าว่างจริง |
| URL / hash / history state | ไม่มีโค้ดอ่าน key จาก URL; HashRouter ใช้เฉพาะ route |
| `console.*` | มีแค่ 5 จุดใน `web/src/data/search.ts:269,284,303,422,429` — เนื้อหาเป็น data_version / shard path ไม่เกี่ยวกับ key |
| error message / stack trace | `client.ts:31-37`, `agent.ts:176-202` แปลงเป็นข้อความไทยคงที่; ไม่เคยพิมพ์ err ดิบ; SDK error ไม่พก key (L4) |
| onEvent ของ agent | `AgentEvent` ทุก variant (`agent.ts:79-87`) ไม่มีฟิลด์ที่พก key / headers / raw request |
| ToolLog | `toolLog.ts` เก็บแต่ id และตัวเลขของข้อมูล — ไม่มีอะไรเกี่ยวกับ key |
| `.tgbp.json` (Phase 5) | **ยังไม่มีโค้ด** → ข้อกำหนดบังคับใน §9 |
| transcript ของ eval | **ยังไม่มีโค้ด** (`web/tests/eval/**` ยังไม่ถูกสร้าง ณ เวลาตรวจ) → ข้อกำหนดใน §9 |
| object `Anthropic` ใน state | **เสี่ยง — H1** |
| baseURL | ไม่ตั้งจาก argument ใด ๆ (`client.ts:21-23`) ใช้ค่า default ของ SDK; SDK ใส่ header anthropic-dangerous-direct-browser-access ให้เอง (ยืนยันที่ `node_modules/@anthropic-ai/sdk/client.mjs:833`) |
| repo / CI | `git grep sk-ant-` = ไม่มี key จริงที่ไหนเลย (เจอแต่ pattern ใน hook/เอกสาร); `.env.*` ถูก ignore (`.gitignore:24`, `git check-ignore` ยืนยัน `web/.env.local`); hook ใช้งานจริง (`core.hooksPath=.githooks`); ไม่มี secret ใน workflow ทั้งสองไฟล์; permissions เป็น least-privilege (ci: contents read · deploy: contents read + pages write + id-token write) |

---

## 3. N5 — Egress (ตรวจครบทุกจุดที่สร้าง request)

| จุด | ที่มาของ URL | ผล |
|---|---|---|
| fetch ใน `data/**` | `dataUrl()` เท่านั้น (`manifest.ts:72-76`, `documents.ts`, `duckdb.ts:411`) | same-origin — assertSafeRelativePath กัน `/`, `//`, scheme, `..` + encodeURIComponent ต่อ segment (`manifest.ts:38-66`) ยกเว้น guard ของ BASE_URL (M3) |
| DuckDB worker | blob: + importScripts(absoluteUrl) (`duckdb.ts:169-182`) | ตาม ADR-002 ข้อ 3 (สืบทอด CSP ของหน้า) |
| DuckDB extension repo | `new URL(BASE_URL + duckdb-ext, location.origin)` (`duckdb.ts:191-194`) + allowUnsignedExtensions:false | same-origin บังคับด้วย location.origin |
| wasm / worker asset | Vite ?url (`duckdb.ts:205-215`) | same-origin เสมอ |
| Anthropic SDK | api.anthropic.com (default baseURL) | ข้อยกเว้นเดียวของ N5 |
| XMLHttpRequest / WebSocket / EventSource / sendBeacon / import(dynamic url) / link-script-img ภายนอก / font CDN | **ไม่มีเลยใน `web/src/**`** (grep) — ฟอนต์อยู่ที่ `web/public/fonts/` | ผ่าน |
| web_search | Anthropic เป็นคน fetch (server tool) | browser ไม่แตะโดเมนภายนอก |

**CSP (production, จาก `web/dist/index.html` ที่มีอยู่จริง)**

default-src self · connect-src self + https://api.anthropic.com · script-src self + wasm-unsafe-eval · worker-src self + blob: · style-src self + unsafe-inline · font-src self · img-src self + data:

ครอบ: script / connect / worker(blob) / font / img · **ไม่ครอบ**: frame-ancestors (meta ใช้ไม่ได้ — ยอมรับตาม 04 §D8), base-uri, form-action, report-uri (M4) · img-src data: จำเป็นสำหรับเส้นทาง SVG → PNG ของ D9 · style-src unsafe-inline ยังเปิดอยู่ (ทบทวนซ้ำใน Phase 4)

---

## 4. Prompt injection (tool result → พฤติกรรมโมเดล)

**มาตรการที่มีอยู่และทำงานจริง**

- ห่อผลลัพธ์ด้วย delimiter + ประโยคกำกับว่าเป็นข้อมูลไม่ใช่คำสั่ง ทุกครั้ง (`toolKit.ts:49-57`, ใช้ใน `createTool.run` `toolKit.ts:141`)
- system prompt มีย่อหน้าตรงประเด็น TOOL_DATA_TRUST_RULES_TH (`systemPrompt.ts:148`) ครอบกรณี ขอให้เปิดเผย API key โดยเฉพาะ
- tool input ผ่าน Zod ก่อนรัน handler เสมอ (`toolKit.ts:135-138`) — ไม่มี tool ไหนรับ SQL
- `emit_proposal` ตัด citation ที่ไม่อยู่ใน ToolLog + ลดระดับ basis/confidence (`proposal.ts:194-249`) มี adversarial test 11 เคส (`proposal.adversarial.test.ts`)
- URL ใน proposal ต้องเป็น https และเคยปรากฏในผล web_search จริง (`proposal.ts:190`, `proposal.ts:322-331`; บันทึกที่ `agent.ts:271-278` เฉพาะ https)
- SVG ทุกภาพผ่าน sanitizeSvg (`emitIllustration.ts:50-53`), ≤ 3 ภาพ/session, ≤ 60 KB
- เพดานรอบ 8 (`agent.ts:36`), web_search max_uses 3 (`models.ts:142`), ผลลัพธ์ ≤ 50 แถว และ string ≤ 300 ตัวอักษร (`toolKit.ts:19-32`), read_document ≤ 6 chunk × 2,000 ตัวอักษร, query_budget_lines ต้องระบุ item_key หรือ keyword+ปี/กระทรวง มิฉะนั้น QueryTooBroadError

**ช่องว่างที่เหลือ (เรียงตามความสำคัญ)**

1. **M1** — delimiter ถูกปิดได้จากเนื้อหาเอกสาร/ผลค้นเว็บ (ยืนยันแล้วด้วยการรัน)
2. **H2** — อ้าง source_id จริงแล้วใส่ตัวเลขปลอมได้
3. ประเมินรายข้อตามโจทย์: (ก) ปลอม source_id — **ทำไม่ได้แล้วจริง** (ข) URL อันตรายใน proposal — **ทำไม่ได้แล้วจริง** (ต้องมาจาก web_search และเป็น https) (ค) SVG ฝังข้อมูล/ลิงก์ — sanitizer ตัด href / url() ภายนอก / style ทั้งหมด (ดู §5) แต่ **ข้อความในภาพ** ยังใส่อะไรก็ได้ (prompt ห้ามใส่จำนวนเงินเป็น soft rule เท่านั้น) (ง) scan ข้อมูลมหาศาล/ค่าใช้จ่ายบาน — คุมด้วย MAX_SHARDS_TO_SCAN / QueryTooBroadError / limit ≤ 50 แต่ **ไม่มีเพดานเงิน default** (M2) (จ) exfiltrate ข้อความผู้ใช้ผ่าน query ของ web_search — ทำได้ในทางทฤษฎี ลดด้วยการแสดง query เสมอ (L2)
4. เนื้อหา error ของ tool ไม่ถูกห่อ delimiter (`toolKit.ts:59-70`)

---

## 5. svgSanitizer.ts — review อิสระรอบที่ 3

**ยืนยันด้วยการรัน**: เขียนสคริปต์ทดสอบ **นอก repo** ที่
`C:\Users\NEW_TH~1\AppData\Local\Temp\claude\D--ScreenPipe\2e056486-ae86-4c4b-b6d8-96c17e5c2228\scratchpad\sec\svgbypass.test.ts`
และ `.../scratchpad/sec/mxss.test.ts` แล้วรันด้วย vitest/jsdom ของโปรเจกต์
(`npx vitest run --config .../scratchpad/sec/vitest.sec.config.mjs`) — **38 เคสโจมตี + ReDoS probe ผ่านทั้งหมด ไม่พบ bypass**

เคสที่ทดสอบแล้ว **บล็อกได้**: CSS escape แบบ `\000075rl(\00002f\00002f...` บน fill, stroke, filter, mask,
clip-path, marker-start, stop-color, color, flood-color, lighting-color (ครบทั้ง 7 ตัวที่ T-206 §6.1 เคยหลุด) ·
backslash ที่เข้ารหัสเป็น HTML entity (`&#92;`) · url(https://...), url(//...), url(https:%2f%2f...), url(data:...) ·
รูปแบบ fallback `url(#a) url(//evil...)` · `cursor="url(...), auto"` · javascript: · xlink:href / href / prefix อื่น
(`xl:href`, `q:href`) · feImage, pattern>image, textPath href, set, animate · style element ที่มี @import ·
attribute style / STYLE (รวม image-set()) · svg ซ้อนที่มี script · onload · requiredExtensions · nesting 300 ชั้น

**ReDoS**: ค่า attribute ตัวอักษรยาว 200,000 ตัว และ `rgb(` ที่ไม่ปิดวงเล็บ + comma 50,000 ตัว → รวมทั้งสองเคส
< 5 วินาที (พฤติกรรมเชิงเส้น — COLOR_TOKEN มี bound `{1,30}` และ alternation ไม่ทับซ้อน)

**ข้อจำกัดของการทดสอบนี้ (ระบุตรง ๆ)**: รันบน **jsdom เท่านั้น ไม่ได้รันบน Chromium** — bypass ที่ T-206 พบนั้น
ยืนยันผลกระทบจริงได้เพราะรันบน Chromium + evil server · แนะนำให้ย้ายคอร์ปัส 7 attribute (มีใน
`svgSanitizer.test.ts` แล้ว) ไปเป็น e2e ที่นับ request จริงก่อนปิด Phase 4

**ข้อสังเกตที่เหลือ (ไม่ใช่ช่องโหว่ แต่ต้องเขียนเป็นกฎ)**

- `result.svg` (สตริง) ถูก serialize ด้วย XMLSerializer ⇒ markup ในข้อความถูก escape เป็น entity · **ยืนยันด้วยการรัน**: `node()` คืน DOM ที่มี img/script = 0 element ทุกเคส (title / desc / text) · ต้องเขียนเป็นกฎบังคับว่า **ห้ามเอา `result.svg` ไปใส่ innerHTML หรือ dangerouslySetInnerHTML เด็ดขาด ให้ใช้ `node()` เท่านั้น** (ซ้ำกับข้อเสนอ T-206 §6.3 ซึ่งยังไม่ถูกเขียนลง 04 §D9)
- hasDangerousScheme บล็อก data: ทุกที่ — เข้มกว่า D9 แต่ยอมรับได้

---

## 6. Injection ฝั่ง data (ทบทวนอิสระ ไม่พึ่งข้อสรุปของ T-206)

| ประเด็น | ผล |
|---|---|
| input จากโมเดลไปถึง SQL text | **ไม่มีทาง** — dataset / fiscalYears / ministryCodes / province / itemKeys / keyword / agencyContains / min-maxAmount / excludeFlags เป็น `?` + params ทั้งหมด (`repo.ts:205-250`); LIKE escape `\ % _` เอง (`repo.ts:199-201`); orderBy เป็น lookup ของ record คงที่ (T-206 F12 ยังคงเป็น minor) |
| shardPaths | ไม่เคยมาจากโมเดล — มาจาก catalog (`queryBudgetLines.ts:139-141,163`) หรือจาก ToolLog (`getBudgetLine.ts:90-102`) และถูกตรวจกับ manifest.files ก่อนใช้ทุกครั้ง; embed ลง SQL ผ่าน sqlStringLiteral ที่ปฏิเสธ quote / backslash / semicolon (`repo.ts:253-258`) |
| path traversal (dataUrl / getDoc / trend shard hh) | assertSafeRelativePath + encodeURIComponent ต่อ segment (`manifest.ts:38-66`); docId ของโมเดลถูกใช้ค้นใน sources.json ที่โหลดมาแล้ว ไม่ได้ต่อเข้ากับ path โดยตรง (`documents.ts`); text_chunks_file มาจากไฟล์ข้อมูลของเราเอง |
| ReDoS | regex ทั้งหมดใน `thaiText.ts:32-75`, `search.ts:67-147`, `svgSanitizer.ts:116-126` เป็นเชิงเส้นหรือมี bound — ไม่พบ catastrophic backtracking |
| prototype pollution | ทุก JSON ที่โหลดผ่าน Zod (`manifest.ts:97-113`); ไม่มี deep-merge ของ object ที่ไม่น่าเชื่อถือ · จุดเดียวที่คัดลอก key แบบ dynamic คือ sortKeysDeep (`systemPrompt.ts:46-61`) ซึ่งรับเฉพาะข้อมูลของเราเอง — แนะนำ (ไม่บังคับ) ให้ใช้ `Object.create(null)` |
| ขนาด input ที่ไม่จำกัด | SVG 60 KB มีแล้ว · **ขาด**: emit_proposal (M6) และ string ของ tool input บางตัว (L3) |

---

## 7. Supply chain / build / CI

| ประเด็น | ผล |
|---|---|
| lockfile | `web/package-lock.json` (lockfileVersion 3) + `pipeline/uv.lock` commit แล้ว; ทุก entry ที่มี resolved มี integrity ครบ (0 ตัวที่ขาด) |
| lifecycle script | มีเพียง esbuild 0.25.12 และ fsevents 2.3.3 (dev/optional ที่รู้จักดี) — dependency production ทั้ง 9 ตัวไม่มี install script |
| การ pin | @anthropic-ai/sdk 0.127.0, @duckdb/duckdb-wasm 1.32.0, dompurify 3.4.15, minisearch 7.2.0, yaml 2.9.1 pin เป๊ะ (ดี) · zod, zustand, react, react-router-dom ใช้ caret (ยอมรับได้เพราะมี lockfile + npm ci) |
| npm audit | **ยืนยันด้วยการรัน**: found 0 vulnerabilities (prod 52 / dev 385 / รวม 437) |
| pip-audit | **ไม่ได้รัน** (ไม่มี uv หรือ pip-audit ใน PATH ของเซสชันนี้) |
| DuckDB-WASM | self-host ครบ (`web/public/duckdb-ext/v1.4.3/`), ไม่โหลดจาก jsDelivr / extensions.duckdb.org, allowUnsignedExtensions:false · **ขาด test ตรวจ hash (M7)** |
| source map / .env ใน dist | **ยืนยันด้วยการรัน** บน `web/dist` ที่มีอยู่: ไม่มีไฟล์ .map, ไม่มี sourceMappingURL, ไม่มีสตริง sk-ant- / VITE_EVAL / DataHarness, มี CSP meta ครบ · หมายเหตุ: bundle ปัจจุบัน **ยังไม่รวม `ai/**`** (ยังไม่ถูก wire เข้า `App.tsx` — assets มี JS ก้อนเดียว) ⇒ ต้องตรวจซ้ำหลัง Phase 4 |
| workflow permissions | least privilege ทั้งสองไฟล์; ไม่มี secret; `deploy.yml` ผูกกับ workflow_run ของ ci ที่สำเร็จและเป็น push เท่านั้น |
| pre-commit hook | ครอบ `sk-ant-[A-Za-z0-9_-]{8,}` ในบรรทัดที่เพิ่ม, ไฟล์ > 24 MB, `.env*` (ยกเว้น `.env.example`) — **เปิดใช้งานจริง** (`core.hooksPath=.githooks`) · ช่องว่าง: ไม่ตรวจ key รูปแบบอื่น และตรวจเฉพาะบรรทัดที่เพิ่ม (พอสำหรับ MVP; false positive จาก key ปลอมใน test = hook ทำงานถูกต้องตามที่ออกแบบ) |

---

## 8. Checklist 09 §5 (C1–C10)

| # | สถานะ | หมายเหตุ |
|---|---|---|
| C1 | **ยังตรวจไม่ได้** (ยังไม่มี UI) | static: ไม่มี storage API ใน `web/src/**` เลย; S3 เคยวัดจริงแล้วว่าว่าง (`web/spikes/results/s3.json:155-156`) |
| C2 | **ผ่านบางส่วน** | จุดที่ยิง request มีแค่ 5 ชนิด (ดู §3) ทั้งหมดเป็น same-origin หรือ api.anthropic.com; e2e ของ data layer block cross-origin แล้ว (T-206 §3) — ต้องวัดซ้ำจาก DevTools หลังมี UI |
| C3 | **ผ่านบางส่วน** | CSP meta อยู่ใน `dist/index.html` จริง + CI grep ตรวจ (`ci.yml`) · ยังไม่มี e2e ที่ inject img ข้าม origin แล้ว assert ว่าถูกบล็อก |
| C4 | **ยังตรวจไม่ได้** | ยังไม่มี markdown renderer → §9 ข้อ 3 |
| C5 | **ผ่านบางส่วน** | เส้นทาง error ไม่แตะ key (`client.ts`, `agent.ts:176-202`, SDK redact เอง) · ยังไม่มี error boundary ให้ทดสอบ |
| C6 | **ไม่ผ่าน (ยังไม่มีโค้ด)** | ไม่มี idle timer และไม่มี pagehide handler → §9 ข้อ 1 |
| C7 | **ยังตรวจไม่ได้** | ยังไม่มีตัวเขียน `.tgbp.json` → §9 ข้อ 8 |
| C8 | **ไม่ผ่านเชิงกระบวนการ** | npm audit = 0 vulnerabilities (รันเอง) แต่ **ไม่มีใน CI**; pip-audit ไม่ได้รันและไม่มีใน CI (M5) |
| C9 | **ผ่าน** (บน build ปัจจุบัน) | ไม่มี .map, ไม่มี .env / key ใน dist; ต้องตรวจซ้ำหลัง Phase 4 และควรทำเป็น step ใน CI (M5) |
| C10 | **ผ่านบางส่วน** | 38/38 เคสถูกบล็อกบน jsdom (§5) · ยังไม่ได้ยืนยันบน Chromium ว่าไม่มี request ออกจริง |

---

## 9. ข้อกำหนดบังคับสำหรับ Phase 4 / Phase 5

1. **key ไม่อยู่ใน state ที่ serialize ได้** — ห้าม persist / devtools บน slice ที่ถืออะไรก็ตามที่อ้างถึง client; เก็บ instance `Anthropic` ใน module scope ของ `ai/` เท่านั้น; ล้างเมื่อผู้ใช้กดออก / pagehide / tab ซ่อน > 60 นาที / เกินงบและผู้ใช้ไม่ต่อ (09 §1)
2. **ทุกอย่างที่มาจากโมเดลหรือจากข้อมูลดิบ render เป็น text node เท่านั้น** — รายการที่ต้องระวังเป็นพิเศษ: proposal.title / summary / objectives / scope_and_specs.items / assumptions.text / boq.item / spec / rationale / unit / category / comparables.item_name / agency / similarity_note / risks / open_questions / audit_findings.text, citations.note และ citations.quote, warnings, not_found.error, coverage_notes.note, confidence_note, price_basis_note, item_name_raw, agency, ministry, local_gov_name, description, legal_reference, source_path, source_sheet, doc.title_guess, doc.rel_path, chunk.text, chunk.tables, illustration.title / caption · **ห้าม dangerouslySetInnerHTML ทั้ง repo** — บังคับด้วย ESLint no-restricted-syntax (ยังไม่มีกฎนี้)
3. **ถ้าจะ render markdown จากโมเดล** — react-markdown + rehype-sanitize schema เข้มงวด, skipHtml, allowlist scheme เฉพาะ https (ไม่มี javascript: / data:), ไม่มี raw HTML, ไม่ autolink scheme อื่น
4. **SVG** — ใช้ `sanitizeSvg(...).node()` เท่านั้น (ห้ามใช้สตริง `.svg` กับ innerHTML); ห่อใน container ที่ contain: content และ pointer-events ไม่ทะลุไปยัง element ภายใน; แสดง warnings ให้ผู้ใช้เห็น
5. **ลิงก์ภายนอกทุกเส้น** (citations_web.url, source_url ของ econ/trend, URL จาก web_search) — บังคับ https, `target="_blank" rel="noopener noreferrer"`, **ไม่** prefetch / preconnect / prerender, **ไม่** โหลดรูป / favicon / OG จากโดเมนนั้น, แสดง host เต็มให้ผู้ใช้เห็นก่อนคลิก
6. **web_search โปร่งใส** — แสดง query จาก event server_tool ทุกครั้ง + สวิตช์ปิดที่ต่อกับ enableWebSearch:false
7. **Error boundary + redactSecrets(s)** (แทนที่ `sk-ant-` ตามด้วยตัวอักษรด้วย `sk-ant-...`) ใช้กับทุก `console.*` และทุกข้อความ error ที่แสดงบน UI; ห้าม log object err ดิบ
8. **Phase 5 `.tgbp.json`** — serializer แบบ whitelist (ประกอบ object ใหม่ทีละฟิลด์ ห้าม spread ทั้ง store), ตัด raw request / headers / ToolLog ส่วนที่ไม่จำเป็น + test ที่ assert ว่าไฟล์ที่ save ไม่มี sk-ant- / x-api-key / authorization
9. **keygate copy** — เตือนให้ใช้ key จาก workspace แยกที่ตั้ง spend limit ไว้ และอธิบายว่า key อยู่ในแท็บนี้เท่านั้น หายเมื่อปิด

---

## 10. สิ่งที่ไม่ได้ตรวจ / ข้อจำกัดของรายงานนี้

- **ไม่ได้เรียก Anthropic API** และ **ไม่ได้อ่านเนื้อหา `web/.env.local`** (ตรวจเฉพาะว่าถูก ignore และไม่ถูก track)
- **ไม่ได้รัน e2e (Playwright)** และ **ไม่ได้ build ใหม่** — ข้อสรุปเรื่อง dist มาจาก build ที่มีอยู่แล้ว (timestamp 20 ก.ย. 03:39) ซึ่ง **ยังไม่รวม `ai/**`** เพราะยังไม่ถูก wire เข้า `App.tsx`
- **sanitizer ทดสอบบน jsdom เท่านั้น** ไม่ได้ทดสอบบน Chromium / Firefox / Safari (ต่างจาก T-206 ที่ยืนยันด้วย Chromium + evil server จริง) ⇒ ข้อสรุป ไม่พบ bypass มีข้อจำกัดนี้
- **pip-audit ไม่ได้รัน** (ไม่มี uv / pip-audit ใน PATH); `pipeline/**` อยู่นอกขอบเขต
- **`web/tests/eval/**` ยังไม่มีอยู่จริง** ณ เวลาตรวจ ⇒ ตรวจ eval runner ไม่ได้; สิ่งที่มีคือ `web/spikes/runner/lib/key.mjs` ซึ่งอ่าน key ฝั่ง Node, ตรวจ prefix, ไม่ print และไม่เขียนลงไฟล์ — และ `web/spikes/results/*.json` ที่ commit แล้วไม่มี key (ตรวจด้วย git grep)
- **`web/src/app/dataHarness/**` ไม่พบไฟล์ครึ่ง ๆ กลาง ๆ** (ไม่ถูกแก้ตั้งแต่ 01:56) และยังถูกตัดออกจาก production bundle จริง (ยืนยันจากการ grep dist)
- รัน unit test เฉพาะ `src/ai` + `src/lib` = **250 ผ่าน / 24 ไฟล์** ไม่ได้รันทั้ง suite (`search.production.test.ts` แตะ `web/public/data` ที่ agent อื่นอาจกำลังเขียน)
- ไม่ได้ตรวจ `pipeline/**`, `web/scripts/**`, `docs/**` อื่น ๆ และไม่ได้ทบทวนซ้ำข้อ F1–F17 ของ T-206 ที่ไม่เกี่ยวกับความปลอดภัย (ตรวจเฉพาะ F10 sanitizer และ F11 same-origin guard)
