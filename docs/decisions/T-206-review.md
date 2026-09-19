# T-206 — Review ขอบเขตโมดูล + คุณภาพของ data access layer (Phase 2)

ผู้ทบทวน: `architect` · วันที่: 20 ก.ย. 2569 · ขอบเขต: `web/src/data/**`, `web/src/lib/svgSanitizer.ts`,
`web/src/app/**` (harness), `web/vite.config.ts`, `web/playwright.config.ts`,
`web/scripts/build-search-index.mjs`, `web/tests/e2e/data/**`

โหมดงาน: **read-only** (ไฟล์นี้เป็นไฟล์เดียวที่เขียน) · ไม่ได้เรียก Anthropic API · ไม่ได้อ่าน `web/.env.local`
· ไม่ได้รัน e2e/ไม่ได้แตะ `web/public/data/**` (มี agent อื่นกำลัง republish)

---

## 0. สรุป go/no-go

**Conditional go** — สถาปัตยกรรมและขอบเขตโมดูลของ Phase 2 **ผ่าน** (ไม่มีการละเมิด 04 §3, ไม่มี
egress ข้าม origin ใน `data/`, N5/ADR-002 ครบทั้ง 5 ข้อ) แต่ **ห้ามเริ่ม T-302 (`ai/tools/*`) ก่อนปิด
blocker 3 ข้อ** ด้านล่าง เพราะทั้งสามข้อเปลี่ยน **สัญญา (contract) ของ API** ที่ tool layer จะพึ่ง —
แก้ทีหลังแปลว่าต้องรื้อ schema ของ tool result ที่ Phase 3 เขียนไปแล้ว

| ด้าน | สถานะ |
|---|---|
| Module boundaries (04 §3) | ผ่าน — ไม่มี React/DOM เกินจำเป็นใน `data/`, ไม่มี import จาก `spikes/`, harness ถูกตัดจริงที่ระดับ module resolution, ไม่มีวงจร import |
| N5 / ADR-002 ใน `duckdb.ts` | ผ่านครบ 5 ข้อ; ไม่พบทางที่ input จาก AI/ผู้ใช้ไปถึง SQL text หรือ URL |
| ความถูกต้องเชิงข้อมูล (N3) | **ไม่ผ่าน 2 จุด** — ลำดับผลลัพธ์ไม่ deterministic และแถวที่ validate ไม่ผ่านถูกทิ้งเงียบ ๆ |
| API fit สำหรับ Phase 3 | **ไม่พอ** — ขาด `shardPaths` ใน result, ขาด key→item, ขาด `total`, ขาดค้นเอกสารข้ามไฟล์, ขาด coverage_notes ใน getLines/getDoc |
| Performance / memory | เสี่ยง — `catalog/items.json.gz` (5.4 MB gz / ~40 MB heap) ถูกโหลดเต็มและ cache ถาวรเมื่อเรียก `getCatalogItem` ครั้งแรก (ลบล้างประโยชน์ของ T-208 ไปครึ่งหนึ่ง) |
| `svgSanitizer.ts` | **พบ bypass จริง** (ยืนยันถึงขั้น browser ยิง request ออกจริง) — ดู §6 |
| Test quality | ดีกว่าค่าเฉลี่ยมาก แต่มีช่องว่างสำคัญ 6 จุด และมี assertion ที่ไม่ได้ทดสอบอะไร 3 จุด |
| CI | เสี่ยงเรื่องเวลา/ความเปราะ (สอง vite build × publicDir 181 MB + DuckDB 38 MB ต่อ test) |

---

## 1. ตาราง findings

severity: **B** = blocker (ต้องปิดก่อน Phase 3), **M** = major (ปิดใน Phase 3 ตอนต้น), **m** = minor

| # | sev | เรื่อง | หลักฐาน (ไฟล์:บรรทัด) | ข้อเสนอแก้ | ผู้รับผิดชอบ |
|---|---|---|---|---|---|
| F1 | **B** | **ลำดับผลลัพธ์ไม่ deterministic** — phase 1 `ORDER BY amount_thb DESC NULLS LAST LIMIT n` ไม่มี tiebreaker; แถวที่ค่าเท่ากัน (มีเยอะมากในข้อมูลงบ เช่น 0/ค่าซ้ำ) จะสลับลำดับได้ระหว่าง range/full mode, ระหว่าง shard order, และหลัง republish ⇒ citation ที่ AI อ้างในบทสนทนาเดียวกันอาจ reproduce ไม่ได้ (N3) | `repo.ts:62-68`, `repo.ts:394`, `repo.ts:401-403` | เติม `, source_id ASC` ท้ายทุก entry ของ `ORDER_BY_SQL` (รวม `source_id` เองก็ยังคงถูก) + e2e assert ว่า range กับ full คืน `source_id` **ลำดับเดียวกัน** (ตอนนี้เทสต์ `.sort()` ก่อนเทียบ ซึ่งกลบปัญหานี้พอดี — `tests/e2e/data/duckdb-repo.spec.ts:204-206`) | `frontend-dev` (T-203 follow-up) |
| F2 | **B** | **แถวที่ Zod validate ไม่ผ่านถูกทิ้งเงียบ ๆ** — `parseBudgetLine` คืน `null` แล้ว loop ข้ามไป ไม่มีตัวนับ/ไม่มี warning; ผลข้างเคียงคือ `truncated = totalMatched > rows.length` กลายเป็น `true` ทั้งที่ข้อมูลไม่ได้ถูกตัด และ AI ได้แถวน้อยกว่าที่ขอโดยไม่รู้ตัว | `repo.ts:370-378`, `repo.ts:417-425`, `repo.ts:465-471`, `repo.ts:493-499` | นับ `droppedRows` แล้วใส่ใน `QueryLinesResult` + `console.warn` พร้อม `source_id`; คำนวณ `truncated` จาก `totalMatched > limit` (ไม่ใช่ `rows.length`); tool layer ต้องรายงาน `droppedRows > 0` ให้ AI | `frontend-dev` |
| F3 | **B** | **`QueryLinesResult` ไม่คืน `shardPaths`** (มีแค่ `shardsScanned: number`) แต่ `getLines`/`getNeighborLines` **บังคับ** ต้องมี `shardHints` ⇒ Phase 3 ทำ `get_budget_line` ตาม 05 §3 (`{source_ids}` ล้วน) **ไม่ได้เลย**; 05 §3 ระบุ output ของ `query_budget_lines` ว่าต้องมี `shards_loaded: string[]` อยู่แล้ว | `repo.ts:145-152`, `repo.ts:428`, `repo.ts:442-454`, `docs/05-FEATURES.md` §3 | เพิ่ม `shardPaths: string[]` ใน `QueryLinesResult` (และใน `BudgetLine` แต่ละแถวควรมี shard ต้นทางด้วย เพราะ multi-shard query ไม่รู้ว่าแถวไหนมาจากไฟล์ไหน — ใช้ `filename=true` ของ `read_parquet` หรือแมพจาก `source_path`) | `frontend-dev` + `ai-engineer` |
| F4 | **M** | **`items-slim.json.gz` ไม่ถูกตรวจ `data_version`** — ตรวจเฉพาะ `search-index.json.gz`; ถ้า pipeline republish catalog แล้วลืมรัน `build-search-index.mjs` ระบบจะใช้ slim เก่าเงียบ ๆ และ `i` จะชี้ผิดรายการใน `catalog/items.json.gz` ใหม่ ⇒ `getCatalogItem(i)` คืน **รายการผิด** พร้อม `sample_source_ids`/`shards` ผิด (N3 ระดับ citation) | `search.ts:200-234` (โหลด slim ที่ 202-203, ตรวจเวอร์ชันเฉพาะ index ที่ 216-218), `searchTypes.ts:38-45` | ตรวจ `slimFile.data_version === manifest.data_version` ก่อนใช้ → ไม่ตรงให้ throw (ไม่ใช่ fallback เงียบ เพราะ fallback build index จาก slim เก่าก็ยังผิดเหมือนกัน) + unit test | `frontend-dev` (T-208) |
| F5 | **M** | **artifact ของ T-208 ไม่อยู่ใน `manifest.files`** — `items-slim.json.gz` / `search-index.json.gz` มีในโฟลเดอร์แต่ไม่มีใน manifest ⇒ ไม่มี sha256/bytes ให้ตรวจ, `manifest` ไม่รู้จัก (ขัดกับข้อเสนอ T-202 ใน SPIKES.md ตารางท้ายไฟล์) และไม่มีใครรู้ว่าไฟล์ stale | `web/public/data/catalog/` มี 2 ไฟล์นี้ แต่ `manifest.json.files` มีเฉพาะ `catalog/facets.json`, `catalog/items.json.gz`, `catalog/orgs.json`, `catalog/trends/*` (ตรวจกับ `web/tests/fixtures/data/manifest.json`) | ให้ `build-search-index.mjs` เขียน entry กลับเข้า manifest (bytes+sha256) หรือให้ pipeline เรียก script นี้เป็นขั้นตอนหนึ่งของ `publish` | `data-engineer` (T-208/T-209) |
| F6 | **M** | **โหลด catalog เต็ม 5.4 MB gz (~40 MB heap) เมื่อเรียก `getCatalogItem` ครั้งแรก และ cache ถาวร** — ซึ่ง `search_catalog` ของ 05 §3 ต้องคืน "สถิติราคาต่อหน่วย" ทุกครั้ง ⇒ **การค้นครั้งแรกจะดึง catalog เต็มเสมอ** ทำให้ T-208 (3.6 MB gz / heap 23 MB) แทบไม่ได้ผลจริง | `search.ts:290-316`, `docs/04-ARCHITECTURE.md` §5, `docs/05-FEATURES.md` §3 | ADR ใหม่ (ดู §7 ADR-006): publish `catalog/items/{hh}.json.gz` (sharding แบบเดียวกับ `catalog/trends/`) แล้ว `getCatalogItem` โหลดเฉพาะ shard ที่ต้องใช้; ทางเลือกชั่วคราวที่ถูกกว่า = ใส่ `unit_price`/`amount` stats (6 ตัวเลข) ลง slim แล้วเหลือเฉพาะ `keys`/`shards`/`sample_source_ids` ใน catalog เต็ม | `architect` → `data-engineer` |
| F7 | **M** | **LRU evict ของ full-mode ไล่ evict shard ของ query ที่กำลังรันอยู่เอง** — `MAX_REGISTERED_SHARDS = 9` แต่ `MAX_SHARDS_TO_SCAN = 12` และ `runWithFallback` register ทุก shard พร้อมกันด้วย `Promise.all`; แต่ละครั้งที่ register จะ evict ตัวเก่าสุด ⇒ query 12 shard ในโหมด full จะโดน drop 3 ไฟล์แรกของตัวเองแน่นอน แล้วเงียบ ๆ กลับไปอ่านผ่าน HTTP (ช้าลง หรือพังถ้า host ไม่รองรับ range ซึ่งเป็นเหตุผลที่ fallback มาตั้งแต่แรก) | `duckdb.ts:43-45`, `duckdb.ts:347-366`, `duckdb.ts:399`, `repo.ts:46`, `repo.ts:338`, `repo.ts:345` | ให้ `ensureShardRegistered` รับ "pin set" ของ query ปัจจุบัน (ห้าม evict) + ตั้ง `MAX_REGISTERED_SHARDS ≥ MAX_SHARDS_TO_SCAN` + test ที่ register 12 ไฟล์แล้วต้องยังอยู่ครบระหว่าง query | `frontend-dev` |
| F8 | **M** | **`getLines`/`getNeighborLines`/`getDoc` ไม่คืน `coverageNotes`** — แต่ AC ของ T-302 ข้อ (1) บังคับว่า "tool result แนบ coverage_notes" ⇒ `get_budget_line` (ตัวที่ AI ใช้ตอน cite จริง!) จะไม่มี note ADR-004/ADR-005/V9 ติดไปด้วย | `repo.ts:442`, `repo.ts:476`, `repo.ts:508-533` | คืน `coverageNotes` จากทุกฟังก์ชันอ่านข้อมูล (ใช้ `collectCoverageNotes(manifest, shardHints)` ซ้ำได้ทันที — `repo.ts:296-320`) | `frontend-dev` |
| F9 | **M** | **popularity boost แรงเกินจนกลบความตรงของข้อความ** — `score × (1 + ln(1+n_lines))`: ช่วง n_lines จริง 1…53,806 ให้ตัวคูณ 1.7…11.9 (≈7 เท่า) ขณะที่ช่วงของคะแนน MiniSearch ระหว่าง "ตรงทุก token" กับ "ตรงบาง token" มักต่างกันแค่ 1.1–2 เท่า **ทดสอบจริง** (main thread, index เล็กด้วย options ชุดจริง): query `ก่อสร้างอาคาร` → raw score: `ก่อสร้างอาคาร` 1.987 > `ก่อสร้างอาคารเรียน` 1.811; หลัง boost (n=50 vs n=900) กลายเป็น 9.798 vs **14.129** ⇒ **สลับอันดับ** | `search.ts:106-110`, `search.ts:161` | ลดความชัน: ใช้ `1 + log10(1+n_lines)` (ตัวคูณ 1.3…5.7) หรือ normalize เป็น `n_lines / max_n_lines` ที่ถ่วงน้ำหนัก ≤ 1.5×, และเพิ่ม **โบนัสความครบของ token** (`terms.length / queryTokens.length`) ซึ่งตอนนี้ไม่มีเลย; test ต้อง assert ว่า key ที่ตรงเป๊ะอยู่อันดับ 1 | `frontend-dev` (T-204) |
| F10 | **M** | **sanitizer bypass จริง (CSS escape)** — ดู §6 ทั้งหมด | `svgSanitizer.ts:99-139`, `svgSanitizer.ts:217-227` | เปลี่ยนจาก blocklist เป็น allowlist ของ **ค่า** attribute + ปฏิเสธค่าที่มี `\` (ADR-007) | `frontend-dev` + `architect` |
| F11 | m | `dataUrl()` ไม่ยืนยันว่าผลลัพธ์เป็น same-origin — ถ้ามีใครตั้ง Vite `base` เป็น absolute URL (CDN) ในอนาคต ทุก fetch ของ data layer จะออกนอก origin ทันทีโดยไม่มีอะไรจับได้ (N5 เป็น non-negotiable จึงควรมี guard ที่โค้ด ไม่ใช่แค่ convention) | `manifest.ts:38-66`, `repo.ts:236-238` | ใน `dataUrl()`/`toAbsoluteDataUrl()` assert `new URL(url, location.href).origin === location.origin` มิฉะนั้น throw | `frontend-dev` |
| F12 | m | `orderBy` ไม่ถูก validate ตอน runtime — ค่าที่ไม่อยู่ใน `ORDER_BY_SQL` ทำให้ SQL กลายเป็น `ORDER BY undefined` (ไม่ใช่ injection เพราะเป็นการ lookup object แต่จะ error แปลก ๆ) และ error นั้นจะไป trigger fallback ที่ดาวน์โหลด shard เต็มทั้ง 12 ไฟล์โดยไม่จำเป็น | `repo.ts:394`, `repo.ts:332-361` | ใส่ Zod schema ที่ boundary ของ `repo` (หรืออย่างน้อย `?? 'amount_desc'` แบบตรวจ key) + ให้ fallback ทำงานเฉพาะ error ที่เข้าข่ายเครือข่าย/range เท่านั้น | `frontend-dev` |
| F13 | m | `sources.json` (324 KB) ถูก fetch + `JSON.parse` + Zod validate **ใหม่ทุกครั้ง** ที่เรียก `getDoc` (ไม่มี cache ต่างจาก `loadManifest`/`loadEcon`) | `repo.ts:514-515`, `manifest.ts:165-180`, `econ.ts:22-39` | cache promise เดียวแบบเดียวกับ `loadManifest` + `resetSourcesCache()` สำหรับ test | `frontend-dev` |
| F14 | m | `getDoc` คืน **ทุก chunk** ของเอกสาร (ไฟล์ใหญ่สุดใน production 1.3 MB gz) เมื่อไม่ระบุ `page` — ขณะที่ 05 §3 กำหนด `max_chunks ≤ 6` และห้ามยัดข้อมูลดิบทั้งก้อนเข้า context (CLAUDE §7) | `repo.ts:530-532` | เพิ่มพารามิเตอร์ `query?`/`maxChunks?` แล้วใช้ `searchDocChunksText` ภายใน (มีอยู่แล้วที่ `search.ts:333-344`) | `frontend-dev` |
| F15 | m | `prefetchDb(onProgress)` เพิ่ม listener ลง Set แต่ **ไม่มีทาง unsubscribe** — React component ที่เรียกซ้ำจะสะสม listener (จะเจอจริงใน T-408) | `duckdb.ts:297-308`, `duckdb.ts:217` | คืน `unsubscribe()` หรือรับ `AbortSignal` | `frontend-dev` (T-408) |
| F16 | m | registered shard buffers (เพดาน 150 MB) อยู่ **นอก** `SET memory_limit = '400MB'` ของ DuckDB ⇒ เพดานจริงรวม ~550 MB สูงกว่างบ "512 MB" ใน 04 §5; ตัวเลข 150 MB ไม่ได้มาจากการวัด | `duckdb.ts:40`, `duckdb.ts:43`, `docs/04-ARCHITECTURE.md` §5 | วัดจริง 1 ครั้งแล้วปรับให้รวมกันไม่เกิน 512 MB หรือแก้ตัวเลขใน 04 §5 พร้อมเหตุผล | `architect` |
| F17 | m | `web/src/data/testFixtures.ts` + `duckdbTestDoubles.ts` อยู่ใน `src/` (ไม่ใช่ `tests/`) — ตรวจแล้ว **ไม่มีโค้ด production import** (grep ทั้ง `src/`,`scripts/`,`tests/`) และไม่เข้า bundle เพราะไม่ reachable จาก entry แต่ `testFixtures.ts` import `node:fs` ⇒ ถ้าวันหนึ่งมีคนเผลอ import จะพัง build แบบงง ๆ | `src/data/testFixtures.ts:11-12`, `src/data/duckdbTestDoubles.ts:1-8` | เพิ่มกฎ ESLint `no-restricted-imports` ห้ามไฟล์ที่ไม่ใช่ `*.test.ts` import 2 ไฟล์นี้ (ถูกกว่าการย้ายไฟล์ซึ่งต้องแก้ tsconfig) | `frontend-dev` |

### สิ่งที่ตรวจแล้วและ "ผ่าน" (ไม่ต้องแก้)

- **N5 / ADR-002 ครบทั้ง 5 ข้อ**: (1) `filesystem` config เป๊ะ `duckdb.ts:250-258` + test `duckdb.test.ts:62-76`; (2) self-host extension `duckdb.ts:183-186, 262-267` + test ผูกเวอร์ชัน `duckdb.test.ts:29-56`; (3) worker จาก `blob:` `duckdb.ts:169-176`; (4) two-phase column pruning `repo.ts:398-425`; (5) fallback `registerFileBuffer` `duckdb.ts:373-400`
- **ไม่มีทางที่ input จาก AI/ผู้ใช้ไปถึง SQL text**: `itemKeys`/`keyword`/`province`/`agencyContains`/`min/maxAmount`/`excludeFlags`/`dataset`/`fiscalYears`/`ministryCodes` ทั้งหมดเป็น `?` + params (`repo.ts:168-216`); `LIKE` escape wildcards เอง (`repo.ts:163-166`); ชื่อคอลัมน์ไม่เคยมาจาก input; `orderBy` เป็น lookup ของ record คงที่; `shardPaths` ถูกตรวจกับ `manifest.files` เสมอ (`repo.ts:248-254`) และ `sqlStringLiteral` ปฏิเสธ `'`/`\`/`;` (`repo.ts:221-226`) ซึ่งเป็นไปไม่ได้อยู่แล้วหลัง `encodeURIComponent` ใน `dataUrl`
- **`data/` ไม่มี React** (grep ยืนยัน) และใช้ DOM เท่าที่จำเป็นจริง (`window.location` 4 จุด เพื่อทำ absolute URL ให้ blob worker — มีคอมเมนต์อธิบายเหตุผลที่ `repo.ts:228-238`) · **ไม่มี import จาก `spikes/`** (มีแค่การอ้างถึงในคอมเมนต์) · **ไม่มีวงจร import** (`types ← manifest ← {repo, search, econ, trends}`, `econ ← trends`, `duckdb ← repo` เป็น DAG)
- **`totalMatched`**: `count(*) OVER ()` คำนวณก่อน `LIMIT` ตามลำดับประมวลผลของ SQL — ถูกต้อง (`repo.ts:401-408`)
- **`coverageNotes`**: ผูกกับ **shard ที่เลือกจริง** ไม่ใช่ params (ถูกต้องกว่า เพราะ caller ส่ง `shardPaths` เองได้) และ note ที่ไม่มี `fiscal_year_be` ครอบทุกปีของ dataset — ตรงกับข้อมูลจริง (ADR-004 2562, no_oracle 2567, ADR-005 ราชาเทวะ ผูก `local_ordinance_2570/2570`, V9 org_unmapped ของ `committee_table`+`local_ordinance_2570` แบบไม่ระบุปี) `repo.ts:296-320`, `manifest.ts:232-246`
- **`excludeFlags` default** = `['corrupt_row','lump_sum_category']` และส่ง `[]` แล้วไม่มี `NOT list_contains` เลย (`repo.ts:53, 209-213` + test)
- **bigint → number**: `castBigIntToDouble: true` + `normalizeValue` (`duckdb.ts:250, 412-414`); เพดานค่าจริง ~2.4e10 ≪ 2^53 พร้อมเหตุผลเขียนไว้ที่ `types.ts:69-76` — ปลอดภัย
- **`inflation.ts`**: ไม่มี interpolate, `fromYearBe` ไม่มี fallback, `toYearBe` fallback เฉพาะเมื่อ `allowLatestAvailable: true` พร้อม warning, บังคับ `series.indicator === index` (`inflation.ts:156-190`) — ตรงตาม N3
- **`trends.ts`**: แยก basis เด็ดขาด (`TrendSeriesSchema.refine` ที่ `types.ts:267-281` + `buildPriceTrend` ที่ `trends.ts:111-149`), caveat "ราคาต่อรายการ ไม่ใช่ราคาต่อหน่วย" / "ข้อมูลปี 2562 ไม่ครบ (ADR-004)" / "ตัวอย่างน้อย" ครบ
- **`econ.ts`**: `verified: false` เป็น literal เสมอ ไม่ได้อ่านจาก record พร้อมเหตุผล (`econ.ts:66-74`) — ดีมาก, `trends.ts:240` ก็เช่นกัน
- **harness ถูกตัดจาก production จริง**: สลับที่ระดับ `resolve.alias` ก่อน Rollup เห็น `import()` (`vite.config.ts:24-35` + `DataHarnessRoute.stub.tsx:1-12`) — **ถูกต้องและจำเป็น** (การ fold `import.meta.env.MODE` อย่างเดียวไม่พอจริงตามที่คอมเมนต์อธิบาย) ข้อควรระวังเดียวคือลำดับ alias (`@/app/...` ต้องมาก่อน `@`) ซึ่งมีคอมเมนต์เตือนไว้แล้ว **ทางที่ง่ายกว่า**: ไม่มีที่ปลอดภัยเท่านี้ ถ้าจะลดความเปราะ ให้เพิ่ม assertion ใน CI ว่า `dist/assets/**` ต้องไม่มีสตริง `__data-harness` (ตอนนี้ยืนยันด้วยมือครั้งเดียวตามคอมเมนต์)

---

## 2. Boundaries (04 §3) — สรุป

| ข้อกำหนด | ผล |
|---|---|
| `data/` ไม่รู้จัก React | ✅ (grep: ไม่มี import react ใน `src/data/**`, `src/lib/svgSanitizer.ts`) |
| `data/` ไม่มี DOM เกินจำเป็น | ✅ เท่าที่จำเป็น (`window.location` 4 จุด) — **หมายเหตุ**: ถ้า Phase 4+ อยากย้าย data layer เข้า worker จะต้องเปลี่ยน 4 จุดนี้เป็น `self.location`/config ที่ inject เข้ามา |
| ไม่มี module ใด import จาก `spikes/` | ✅ |
| test helper ไม่เข้า production | ✅ (ดู F17 สำหรับการกันไว้ล่วงหน้า) |
| harness ไม่เข้า production bundle | ✅ |
| วงจร import | ✅ ไม่มี |
| `ai/` ไม่แตะ DuckDB ตรง | ยังไม่มีโค้ด `ai/` — `BudgetRepo` interface (`repo.ts:547-561`) mock ได้จริง แต่ **ยังไม่ครอบคลุม search/econ/trends** (ดู §4) |

---

## 3. N5 / ADR-002 — จุดที่ URL ถูกสร้าง (ตรวจครบทุกจุด)

| จุด | ที่มาของค่า | ปลอดภัย? |
|---|---|---|
| `dataUrl(path)` | `BASE_URL` + path จาก manifest/ค่าคงที่ | ✅ `assertSafeRelativePath` กัน `/`, `//`, scheme, `..` + `encodeURIComponent` ต่อ segment (`manifest.ts:38-66`) — ข้อเดียวที่ยังไม่กันคือ `BASE_URL` ที่เป็น absolute URL (F11) |
| `toAbsoluteDataUrl` | `dataUrl()` + `window.location.href` | ✅ (F11 เหมือนกัน) |
| `buildExtensionRepositoryUrl` | `BASE_URL` + `window.location.origin` | ✅ same-origin บังคับด้วย `location.origin` |
| worker/wasm URL | Vite `?url` (same-origin เสมอ) | ✅ |
| `ensureShardRegistered(url)` | มาจาก `toAbsoluteDataUrl` เท่านั้น | ✅ |
| `fetch` ใน `manifest.ts` | `dataUrl()` เท่านั้น | ✅ |
| e2e ยืนยัน | block cross-origin ทุกตัวแล้ว query ยังผ่าน และ `blockedCrossOrigin === []` | ✅ `tests/e2e/data/duckdb-repo.spec.ts:154-180` |

---

## 4. API fit สำหรับ Phase 3 (05 §3)

| tool (05 §3) | ฟังก์ชันใน `data/` ที่จะเรียก | ช่องว่าง |
|---|---|---|
| `search_catalog` | `searchCatalog()` + `getCatalogItem(i)` ต่อผลลัพธ์ | ไม่คืน `total` (05 บอกว่าต้องมี); สถิติราคา/`keys`/`shards` ต้องโหลด catalog เต็ม 40 MB (**F6**); ไม่มี filter `gov_level`/`budget_type` ตาม spec; `getCatalogItem` ต้องเรียก N ครั้งต่อผลลัพธ์ ⇒ ควรมี `getCatalogItems(i[])` |
| `query_budget_lines` | `queryLines()` | ไม่มี `shards_loaded` (**F3**); ลำดับไม่ deterministic (**F1**); แถวหายเงียบ (**F2**); ไม่มี `keywords: string[]` (มีแค่ `keyword` เดี่ยว) |
| `get_budget_line` | `getLines(sourceIds, shardHints)` | **ต้องมี shardHints** ที่ยังไม่มีใครคืนให้ (**F3**); ไม่คืน coverage_notes (**F8**) |
| `find_documents` | — | **ไม่มีเลย** ต้องเพิ่ม `searchDocs({query, collection, agency, fiscalYear, hasTextOnly, limit})` ที่ค้น `sources.json` (title_guess/topic/agency_guess) ด้วย `foldThai` |
| `read_document` | `getDoc(docId, {page})` + `searchDocChunksText(chunks, q)` | ไม่มี `query`/`maxChunks` ใน `getDoc` (**F14**); **ไม่มีการค้นข้อความข้ามเอกสาร** — `searchDocChunksText` ทำงานกับ chunk ของเอกสารเดียวที่โหลดมาแล้วเท่านั้น (ถ้า Phase 3 ต้องการ "ค้นทุกเอกสาร" จะต้องโหลด 142 ไฟล์ = ทำไม่ได้ ⇒ ต้องให้ pipeline ทำ doc-level index หรือยอมรับว่า `find_documents` ค้นได้แค่ metadata) |
| `get_econ_indicator` | `getEconValue(indicator, yearBe)` วนตาม indicators × years | พอใช้ (คืน `{value:null, note}` ถูกตาม AC T-302 ข้อ 5) |
| `adjust_for_inflation` | `getEconSeries()` → `adjustForInflation()` | พอใช้ (แต่ tool layer ต้องจำว่าต้องโหลด series ก่อน ⇒ ควรมี wrapper ใน facade) |
| `get_price_trend` | `getPriceTrend({key, trend})` / `getEconTrend(indicator)` | **ช่องว่าง**: tool รับ `key: string` แต่ `getPriceTrend` ต้องการ `trend` shard name ด้วย และ **ไม่มีฟังก์ชันหา item จาก `key`** (`itemsById` ใช้ `i` เป็น key เท่านั้น) ⇒ ต้องเพิ่ม `getCatalogItemByKey(key)` |
| `emit_illustration` | `sanitizeSvg()` | พอใช้ (แต่ดู §6) — ยังขาดการบังคับ `viewBox="0 0 800 450"` และ policy `max_tokens`/`stop_reason` ซึ่งอยู่ฝั่ง `ai/` |
| `emit_proposal` | — | ไม่เกี่ยวกับ data layer |

### ข้อเสนอ facade `web/src/data/index.ts` (ออกแบบ ไม่ implement)

หลักการ: `ai/tools/*` **import จาก `@/data` เท่านั้น** (ห้าม import `duckdb.ts`/`search.ts` ตรง) และทุกอย่าง
เป็น interface เดียวที่ mock ได้ในเทสต์ด้วย object literal

```ts
// web/src/data/index.ts — สัญญาเดียวที่ ai/ พึ่งได้ (T-302 ต้อง import แค่ไฟล์นี้)
export interface DataResultMeta {
  coverageNotes: CoverageNote[];
  /** shard ที่ผลลัพธ์นี้มาจากจริง — ใช้เป็น shardHints ของ getLines รอบถัดไป (F3) */
  shardPaths: string[];
  /** แถวที่อ่านได้แต่ validate ไม่ผ่าน (ต้องรายงานให้ AI — F2) */
  droppedRows: number;
}

export interface CatalogHit {
  i: number; key: string; name: string; nLines: number; years: number[];
  lowSpecificity: boolean; hasUnitPrice: boolean; trendShard?: string; score: number;
}
export interface CatalogDetail extends CatalogHit {
  keys: string[]; keysTruncated: boolean; shardPaths: string[];
  unitPrice?: PriceStats; amount?: PriceStats; topAgencies: string[]; sampleSourceIds: string[];
}

export interface DataFacade {
  // --- catalog ---
  searchCatalog(q: string, opts?: SearchCatalogOptions): Promise<{ hits: CatalogHit[]; total: number }>;
  getCatalogDetails(refs: { i: number }[] | { key: string }[]): Promise<CatalogDetail[]>;   // F6/F9
  // --- budget lines ---
  queryLines(params: QueryLinesParams): Promise<QueryLinesResult & DataResultMeta>;
  getLines(sourceIds: string[], shardHints: string[]): Promise<{ rows: BudgetLine[] } & DataResultMeta>;
  getNeighborLines(sourceId: string, n: number, shardHint: string): Promise<{ rows: BudgetLine[] } & DataResultMeta>;
  // --- documents ---
  searchDocs(q: FindDocumentsParams): Promise<{ docs: SourceDocLite[]; total: number }>;      // ใหม่
  readDoc(docId: string, opts?: { query?: string; pages?: number[]; maxChunks?: number }):
    Promise<{ doc: SourceDoc; chunks: DocChunk[] | null; note?: string; totalChunks: number }>;
  // --- econ / trends ---
  getEconValues(indicators: string[], yearsBe: number[]): Promise<EconValueResult[]>;
  adjustForInflation(input: Omit<AdjustForInflationInput, 'series'>): Promise<AdjustForInflationResult>; // โหลด series ให้เอง
  getPriceTrend(ref: { kind: 'item'; key: string } | { kind: 'indicator'; key: string }):
    Promise<PriceTrend | EconTrend | null>;
  // --- context สำหรับ system prompt (cached block) ---
  facets(): Promise<Facets>;
  dataVersion(): Promise<string>;
}

export const data: DataFacade;                 // singleton จริง
export function createDataFacade(overrides: Partial<DataFacade>): DataFacade;  // สำหรับเทสต์
```

เหตุผลของรูปแบบนี้: (ก) ทุกเมธอดที่อ่านข้อมูลงบคืน `DataResultMeta` เหมือนกันหมด ⇒ AC T-302 ข้อ 1
ทำครั้งเดียวจบ; (ข) `getPriceTrend` รับ `key` ตรงตาม 05 §3 แล้วไปหา `trendShard` ให้เอง; (ค)
`adjustForInflation` ใน facade เป็น async ที่โหลด series ให้ ส่วนฟังก์ชัน pure เดิมใน `inflation.ts` ยังอยู่
(ทดสอบง่าย); (ง) ทุกอย่างเป็น interface เดียว ⇒ `ai/tools/*.test.ts` สร้าง fake ได้โดยไม่ต้อง mock fetch

---

## 5. Performance / memory

| ประเด็น | สถานะ |
|---|---|
| LRU ของ shard | มี แต่ evict ตัวเองได้ (**F7**) และ buffer อยู่นอก `memory_limit` (**F16**) |
| catalog เต็ม 40 MB | โหลดเมื่อ `getCatalogItem` ครั้งแรก และ **ค้างในหน่วยความจำตลอด session** (`search.ts:186, 293-301`) ⇒ **ควรเปลี่ยนเป็นโหลดเฉพาะ entry ได้** (F6 / ADR-006) |
| prefetch | มี `prefetchDb()` ตาม 04 §5 (ขาด unsubscribe — F15) แต่ **ยังไม่มี prefetch ของ search index/slim** (3.6 MB gz) ทั้งที่ 04 §5 บอกว่าโหลด "ตอน tool แรก" — ควร prefetch คู่กับ DuckDB หลังใส่ key สำเร็จ |
| re-rank บน main thread | แก้คอขวด `Intl.Segmenter` ต่อ hit แล้ว (`search.ts:114-142` ใช้ scan สตริงแทน) — ดีและมีคอมเมนต์อธิบายเหตุผลพร้อมตัวเลข; ที่เหลือคือ `matches.sort()` ของหลักหมื่น hit ต่อ query (ยอมรับได้) |
| query ช้าจากเลขสั้น | แก้แล้วด้วย `buildIndexQuery` + `isExactOnlyTerm` (`search.ts:63-86`) |
| popularity boost | แรงเกิน (**F9**) |

---

## 6. `svgSanitizer.ts` — security review อิสระ (พบ bypass จริง)

ทดลองด้วยสคริปต์ใน scratchpad (นอก repo): (ก) 25 เคสโจมตีผ่าน jsdom + dompurify 3.4.15 ชุดเดียวกับ
unit test, (ข) ยืนยันผลกระทบจริงด้วย Chromium (Playwright) + local HTTP server 2 ตัว (host / "evil")
นับ request ที่เข้ามาจริง

### 6.1 เคสที่ **หลุด** (ยืนยันแล้ว)

**ช่องโหว่: ค่า attribute ที่ใช้ CSS escape sequence** — presentation attribute ของ SVG ถูก parse ด้วย
CSS parser ซึ่งถอด escape ให้ (`\000075rl(` → `url(`, `\00002f\00002f` → `//`) แต่ชั้นตรวจของเราเทียบ
**สตริงดิบ** เท่านั้น (`hasDisallowedUrlReference` หา `url(` ตรงตัว, `hasExternalReference` หา `://`,
`//`, `(//`, `image-set(` ฯลฯ) ⇒ ไม่มีกฎข้อไหน match

input ที่หลุด (ผ่าน `sanitizeSvg` โดยค่ายังอยู่ครบ):

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <rect width="5" height="5" fill="\000075rl(\00002f\00002fevil.example/g.svg#g)"/>
</svg>
```

attribute ที่ยืนยันว่า **รอดจาก DOMPurify + ชั้นของเรา** ด้วยค่าเดียวกันนี้:
`fill`, `stroke`, `filter`, `mask`, `clip-path`, `marker-start`, `stop-color`
(`cursor` ไม่รอด เพราะ DOMPurify ตัดชื่อ attribute นี้ทิ้งอยู่แล้ว)

**ผลกระทบจริงใน browser (Chromium 1243 ของ Playwright)**: หน้าเว็บที่ inline SVG นี้ **ยิง HTTP
request ออกไปยัง origin ภายนอกจริง** — evil server ได้รับ `/g.svg`, `/m.svg`, `/mk.svg` และ request
list ของหน้ามี `/f.svg` ครบ (จาก `fill`, `mask`, `marker-start`, `filter` ตามลำดับ)
⇒ **ละเมิด N5 ในทางเทคนิค** แม้ CSP `default-src 'self'` ของ production จะบล็อกการโหลดจริงไว้อีกชั้น
(D9 ระบุชัดว่า "ไม่ควรพึ่ง CSP อย่างเดียว") — severity **major ไม่ใช่ blocker** เพราะ CSP เป็น backstop
และเส้นทาง rasterize เป็น PNG ใช้ `<img>` ซึ่งไม่โหลด external resource อยู่แล้ว

**ข้อเสนอแก้ (ADR-007)** — เปลี่ยนจาก blocklist เป็น allowlist ของ *ค่า*:
1. ปฏิเสธทั้งไฟล์ (หรือตัด attribute) เมื่อค่าใด ๆ มี `\` — SVG ที่ AI สร้างไม่เคยต้องใช้ CSS escape
2. สำหรับ attribute กลุ่ม "รับ URL ได้" (`fill`, `stroke`, `filter`, `mask`, `clip-path`, `marker-*`,
   `stop-color`, `flood-color`, `lighting-color`, `color`, `cursor`, `fill-opacity`… ) บังคับให้ค่าต้อง match
   grammar ที่แคบ: `#rrggbb|#rgb|rgb(...)|ชื่อสีใน allowlist|none|currentColor|url(#[A-Za-z0-9_.:-]+)|ตัวเลข+หน่วย`
3. คงกฎเดิม (`://`, `//`, `url(` ที่ไม่ใช่ `#`, `image-set(`…) ไว้เป็นชั้นสอง
4. เพิ่ม unit test จาก input ข้างบนทั้ง 7 attribute

### 6.2 เคสที่ **ป้องกันได้แล้ว** (ทดลองแล้วไม่หลุด)

`xml:base` · `<set attributeName="href">` · `<animate values="url(...)">` · `<tref xlink:href>` ·
`<pattern>`+`<image>` · `<feImage href>` และผ่าน prefix namespace อื่น (`xl:href`) · `<font-face-uri>` ·
`<style>` + CDATA + `@import` · `<svg>` ซ้อนที่มี `<script>`/`<image>` · numeric entity ใน `url()`
(`&#104;ttps://`) · `image-set(`/`-webkit-image-set(` ใน presentation attribute · `style` บน root ·
`OnLoad`/`STYLE` ตัวพิมพ์ผสม · `<!DOCTYPE`/`<!ENTITY` (ปฏิเสธตั้งแต่ระดับสตริง) ·
`url()` แบบ relative ที่ชี้ไฟล์อื่น (`url(other.svg#g)` → ถูกตัด เพราะไม่ขึ้นต้นด้วย `#`)

### 6.3 ข้อสังเกตอื่น (ไม่ใช่ช่องโหว่)

- `hasDangerousScheme` บล็อก `data:` ทุกที่ในค่า attribute — เข้มกว่าที่ D9 เขียน แต่โอเค (AI ไม่ควรฝัง data URI)
- `node()` re-parse จากสตริงที่ sanitize แล้วด้วย `image/svg+xml` ทุกครั้ง ⇒ ไม่มีช่อง mXSS จากการ
  re-parse แบบ HTML — ถูกต้องตาม D9 แต่ **ต้องเขียนเป็นกฎให้ผู้เรียก**: ห้ามเอา `result.svg` (สตริง) ไป
  ใส่ `dangerouslySetInnerHTML` หรือ innerHTML ของ HTML context เด็ดขาด ให้ใช้ `node()` เท่านั้น
  (ควรเพิ่มประโยคนี้ใน 04 §D9 และใน AC ของ T-309/T-407)

---

## 7. ADR ที่ควรเขียนเพิ่ม

| ADR | เรื่อง | ทำไมต้องเป็น ADR (ไม่ใช่แค่ backlog) |
|---|---|---|
| **ADR-006** | catalog detail sharding: `catalog/items/{hh}.json.gz` + บังคับตรวจ `data_version` ของ slim + ลงทะเบียน artifact T-208 ใน `manifest.files` | เปลี่ยน **รูปแบบไฟล์ที่ publish** และขัดกับ 04 §5 ที่บอกว่า "ค้นหา ~3.6 MB gz" (ความจริงคือ +5.4 MB ทันทีที่ tool แรกต้องการสถิติราคา) — F4/F5/F6 |
| **ADR-007** | SVG sanitizer: เปลี่ยนเป็น allowlist ของค่า attribute + ปฏิเสธ CSS escape | 04 §D9 เขียนนโยบายปัจจุบันไว้ชัด ("ตัด `style` เสมอ + ห้ามค่าที่อ้างภายนอก") และ review นี้พิสูจน์ว่านโยบายแบบ blocklist ไม่พอ — F10/§6 |
| (ไม่ต้อง ADR) | F1/F2/F3/F8 เป็นการ **เติม** สัญญาของ `repo`/facade ไม่ได้ขัดกับ 04 → แก้ที่ backlog + §3 ของ 04 (ตาราง `data/`) ได้เลย | |

---

## 8. Test quality

**ที่ควรชม**: fake ของ DuckDB แยกเป็น double จริง (ไม่ mock ทั้งโมดูล) ⇒ ทดสอบ SQL/params ที่ส่งจริงได้;
`duckdb.test.ts:29-56` ผูกเวอร์ชัน library กับไฟล์ extension (กัน ADR-002 regression จริง);
`search.prebuilt.test.ts` รัน build script เป็น child process จริงแล้วโหลดกลับ; e2e ตรวจ 206 จาก **ใน
worker** และ block cross-origin จริง — ทั้งหมดนี้เป็นเทสต์ที่ "ถ้าพังจะจับได้จริง"

**assertion ที่ไม่ได้ทดสอบอะไร (ควรลบ/แก้)**

| จุด | ปัญหา |
|---|---|
| `repo.test.ts:159` | `` `%${evilKeyword.replace(/'/g, "'")}%`.replace("'", "'") `` — `replace` ทั้งสองครั้งเป็น no-op (แทน `'` ด้วย `'`) ทำให้ดูเหมือนมีการ escape ทั้งที่ไม่มี; และคอมเมนต์บรรทัด 160 บอกว่า "ต้องเป็น pattern ที่ escape แล้ว ไม่ใช่คำดิบ" แต่ assertion บรรทัด 161-163 ตรวจว่า **มีคำดิบอยู่** (ตรงข้ามกับคอมเมนต์) |
| `search.production.test.ts:52` | `expect(loadMs).toBeGreaterThan(0)` — tautology |
| `search.production.test.ts:64-70` | assert แค่ "top-5 มี key ที่มี substring" ⇒ ผ่านได้แม้อันดับ 1 จะเป็นผลลัพธ์ที่ผิดจากปัญหา F9 (เทสต์นี้ **ยอมรับ** พฤติกรรมที่เรากำลังจะแก้) |
| `repo.test.ts:447-455` | ตรวจว่า `budgetRepo.*` เป็น `function` — ได้จาก type system อยู่แล้ว |

**ช่องว่างที่ควรมี test ก่อนเข้า Phase 3**

1. **ลำดับ deterministic**: query เดียวกัน 2 รอบ (range vs full, และ shard order สลับ) ต้องได้ `source_id` **เรียงเหมือนกัน** (F1)
2. **แถวที่ validate ไม่ผ่าน**: fake ให้ phase 2 คืน record ที่ผิด schema 1 แถว แล้ว assert `droppedRows === 1` และ `truncated` ยังถูก (F2)
3. **LIKE escape**: `keyword: "50%"` / `"a_b"` ต้องกลายเป็น `%50\%%` / `%a\_b%` (ตอนนี้ไม่มีเทสต์เลยทั้งที่ `likeContainsPattern` มี logic escape อยู่ — `repo.ts:163-166`)
4. **`items-slim.json.gz` data_version ไม่ตรง** → ต้อง fail/warn (F4) — ตอนนี้มีเทสต์เฉพาะ index ไม่ตรง
5. **full-mode 12 shard** ต้องไม่ evict ตัวเอง (F7)
6. **`getNeighborLines`** ไม่มี unit test เลย (มีแค่ผ่าน `getLines`) — และเป็นทางเดียวที่ `source_sheet`/`source_row` ± n ถูกใช้ (T-407)
7. **coverage note ของ ADR-005 (ราชาเทวะ / `local_ordinance_2570`)** — เทสต์ปัจจุบันครอบเฉพาะ ADR-004 (2562), no_oracle (2567), org_unmapped (committee_table)
8. **sanitizer**: 7 attribute จาก §6.1

---

## 9. ความเสี่ยง CI

| ความเสี่ยง | ข้อเท็จจริง | ข้อเสนอ |
|---|---|---|
| เวลา build ซ้ำสอง | `playwright.config.ts:35-53` มี webServer 2 ตัว: `vite preview` (ต้องมี `dist` จาก step `npm run build` ก่อน) และ `vite build --mode e2e-harness --outDir dist-e2e-harness` ⇒ **copy publicDir 181 MB สองรอบ** (`web/public/data` 178 MB + `duckdb-ext` 3 MB) | ให้ project `chromium-data` ใช้ build เดียวกัน (เปิด harness ด้วย env var ตอน build ปกติในงาน CI เท่านั้น) หรือ cache `dist-e2e-harness` ระหว่าง run |
| โหลด DuckDB ซ้ำทุก test | 6 test ในสเปคเดียว แต่ละตัวเปิด page ใหม่ (cache เย็น) ⇒ ดาวน์โหลด wasm 34 MB + ext 3 MB ต่อ test จาก `vite preview` (ไม่บีบอัด) — ตั้ง `timeout: 120_000` ไว้แล้วเพราะเหตุนี้ | ใช้ `test.describe.serial` + reuse page/context หนึ่งตัวสำหรับ test ที่ไม่ต้องการ instance ใหม่ (มีแค่ test `mode:"full"` ที่ต้องการหน้าใหม่จริง ๆ) |
| `npm run test` (vitest) แตะข้อมูล production | `search.production.test.ts` อ่าน `web/public/data` (catalog 5.4 MB gz → ~40 MB heap) และ `catalogIntegrity`/`budgetLines.parquet` อ่าน parquet fixture — ทั้งหมดรันใน CI ทุก push | ยอมรับได้ แต่ควรย้าย `search.production.test.ts` ไปเป็น job แยก/`--project slow` เพราะมันจะ **skip เงียบ ๆ** ถ้าไฟล์หาย (`describe.skipIf`) ⇒ CI เขียวทั้งที่ไม่ได้ทดสอบอะไร |
| retries=2 ใน CI | `playwright.config.ts:10` — test ที่เปราะจะกินเวลา ×3 | คงไว้ แต่ต้องดู flake rate หลังรันจริงรอบแรก |
| e2e ผูกกับตัวเลขข้อมูลจริง | `duckdb-repo.spec.ts:86, 97, 107` hard-code `1844`, `754`, `29145+30843+31092` ⇒ **จะแดงทันทีที่ pipeline republish** (กำลังเกิดขึ้นตอนนี้) | อ่านค่าคาดหวังจาก `manifest.json` (`files[].rows`) แทน hard-code ตัวเลข |

---

## 10. สิ่งที่ยังไม่ได้ตรวจในรอบนี้ (ระบุตรง ๆ)

- **ไม่ได้รัน e2e** (`chromium-data`) และไม่ได้รัน test ที่พึ่ง `web/public/data` — มี agent อื่นกำลังเขียนทับ
  ⇒ ข้อสรุปเรื่อง CI มาจากการอ่าน config + ขนาดไฟล์จริง ไม่ใช่การจับเวลา
- **ไม่ได้ยืนยันตัวอย่าง "ก่อสร้างอาคาร → ปรับปรุงซ่อมแซมอาคารเรียน (n=53,806)" กับ catalog production**
  ด้วยเหตุผลเดียวกัน — สิ่งที่ยืนยันคือ **กลไก**: สร้าง index เล็กด้วย options ชุดจริงแล้วเห็นการสลับอันดับ
  (raw 1.987 vs 1.811 → หลัง boost 9.798 vs 14.129)
- รันเฉพาะ unit test 5 ไฟล์ (`svgSanitizer`, `repo`, `duckdb`, `trends`, `search.matching`) = **106 ผ่าน**
  ไม่ได้รันทั้ง suite
- ไม่ได้ตรวจ `pipeline/**` (นอกขอบเขต) และไม่ได้ตรวจว่า pipeline สร้าง `catalog/items.json.gz` ที่มี
  `i` เสถียรข้าม build หรือไม่ — ซึ่งเป็นสมมติฐานที่ F4 พึ่งอยู่
- ไม่ได้ทดสอบ sanitizer บน Firefox/Safari (ทดสอบ Chromium ตัวเดียว); jsdom กับ browser จริงอาจ
  parse ต่างกันในเคสขอบอื่น ๆ ที่ยังไม่เจอ
