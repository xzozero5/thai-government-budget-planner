# 03 — Data Pipeline Spec (Phase 1)

Owner agent: `data-engineer` · Reviewer: `po`, `architect` · ภาษา: Python 3.11+
Input: `./เพราะ AI ไม่ใช่แค่ CHATBOT/` (read-only) · Output: `web/public/data/`

## 1. เป้าหมาย

แปลงข้อมูลผสม (xlsx/xls/docx/pptx/pdf-with-text) ให้เป็นชุดข้อมูลที่
1. **browser โหลดได้ตามต้องการ** (ทุกไฟล์ < 24 MB, มี manifest)
2. **ทุกแถวชี้กลับต้นทางได้** (`source_id` → file/sheet/row/page)
3. **ค้นหาข้ามปี/หน่วยงานได้ด้วยชื่อรายการที่ normalize แล้ว**
4. reproducible: รัน `tgbp build` ซ้ำได้ผลเหมือนเดิม (deterministic hash)

## 2. โครงสร้าง package

```
pipeline/
├── pyproject.toml            # deps: pandas, pyarrow, duckdb, openpyxl, xlrd, pdfplumber, pypdf,
│                             #       python-docx, python-pptx, pydantic, typer, rapidfuzz, pythainlp(optional)
├── config.yaml               # raw_dir, out_dir, limits, year range
├── tgbp_pipeline/
│   ├── cli.py                # typer: inventory | extract | normalize | validate | publish | build | sample
│   ├── inventory.py          # เดินโฟลเดอร์ → sources.json (ทุกไฟล์ รวม PDF scan)
│   ├── extract/
│   │   ├── pbo.py            # A1
│   │   ├── act2570.py        # A2 + A3
│   │   ├── local_sheets.py   # A4 (อบจ./อบต./ทน. Sheets)
│   │   ├── committee_xlsx.py # A5 xlsx/xls (generic table detector)
│   │   ├── pdf_text.py       # PDF ที่มี text layer → pages + tables
│   │   └── office_text.py    # docx/pptx → text
│   ├── normalize/
│   │   ├── schema.py         # pydantic BudgetLine, SourceDoc, EconIndicator
│   │   ├── thai_text.py      # unicode NFC, ลบ U+200B, แก้ ํา→ำ, ตัวเลขไทย→อารบิก, whitespace
│   │   ├── item_parser.py    # สกัด province/amphoe/tambon, qty/unit, spec tokens, item_key
│   │   ├── org_master.py     # map ชื่อกระทรวง/กรม → รหัส (จาก A2 Data Dict + fuzzy)
│   │   └── money.py          # ล้านบาท→บาท, '-'→null, ตัวเลขไทย
│   ├── validate.py           # กฎใน §6 → validation_report.md
│   ├── publish.py            # parquet shards + catalog + manifest + fixtures
│   └── util/hash.py          # source_id = sha1(rel_path|sheet|row) [:16]
└── tests/                    # pytest + fixtures เล็ก (สร้างเองใน tests/fixtures ไม่ใช้ raw จริง)
```

CLI:
```
tgbp inventory                 # → out/sources.json + docs/02 section auto-appendix
tgbp extract --dataset pbo|act2570|local|committee|pdf|office|all
tgbp normalize
tgbp validate                  # exit code 1 ถ้า hard-rule fail
tgbp publish                   # parquet/json.gz/manifest.json
tgbp build --dataset all       # ทั้งหมดตามลำดับ
tgbp sample --rows 1000        # สร้าง web/tests/fixtures/data/ สำหรับ dev/test ฝั่ง web
```
ทุกขั้นเขียน intermediate ไว้ที่ `pipeline/.cache/` (gitignored) เป็น parquet เพื่อรันซ้ำเร็ว

## 3. Canonical schema

### 3.1 `BudgetLine` (ตาราง `budget_lines`)
| field | type | หมายเหตุ |
|---|---|---|
| `source_id` | string(16) | sha1(`dataset|rel_path|sheet|row_index`)[:16] — **คงที่ข้ามการรัน** |
| `dataset` | enum | `pbo_disbursement` \| `act_2570_draft` \| `act_2570_province` \| `local_ordinance_2570` \| `local_subsidy_2570` \| `committee_table` |
| `fiscal_year_be` / `fiscal_year_ce` | int16 | 2558–2570 / 2015–2027 |
| `gov_level` | enum | `central` \| `local` \| `state_enterprise` |
| `ministry` / `ministry_code` | string | code จาก A2 Data Dict (null ถ้า map ไม่ได้) |
| `agency` / `agency_code` | string | หน่วยงาน/กรม/อปท. |
| `province` | string | จาก item_name หรือโฟลเดอร์ (null ได้) |
| `local_gov_name` | string | ชื่อ อปท. (เฉพาะ local) |
| `strategy` / `plan` / `output_project` / `activity` | string | ยุทธศาสตร์/แผนงาน/ผลผลิต-โครงการ/งาน |
| `budget_type` | string | งบบุคลากร/ดำเนินงาน/ลงทุน/อุดหนุน/รายจ่ายอื่น/งบกลาง |
| `expense_category` | string | objc_8_name / expense_category / sub_category |
| `is_capital` | bool | รายจ่ายลงทุน |
| `item_name_raw` | string | ตามต้นฉบับ (หลัง NFC เท่านั้น) |
| `item_name` | string | หลัง thai_text.clean |
| `item_key` | string | ตัดสถานที่/จำนวน/หน่วยงานออก, lower, collapse space — ใช้ group |
| `item_qty` / `item_unit` | float / string | "1 เครื่อง" → 1, "เครื่อง" (null ถ้าไม่พบ) |
| `spec_tokens` | list<string> | เช่น `["18000 BTU","inverter","ติดผนัง"]` |
| `location_text` | string | ส่วนที่ตัดออกจาก item_name (ตำบล/อำเภอ/จังหวัด/ชื่อสถานที่) |
| `amount_thb` | int64 | จำนวนที่ตั้ง (พ.ร.บ./ข้อบัญญัติ) — **บาท** |
| `unit_price_thb` | int64 | `amount_thb / item_qty` เมื่อ qty > 0 (null ได้) |
| `revised_thb` / `po_thb` / `disbursed_thb` / `disbursed_incl_po_thb` / `reserved_thb` / `carryover_thb` | int64 | PBO เท่านั้น |
| `disbursement_rate` | float | disbursed/revised (null ถ้า revised=0) |
| `description` / `legal_reference` | string | local sheets |
| `source_path` | string | relative path จาก raw root (unicode ตามจริง) |
| `source_sheet` | string | |
| `source_row` | int32 | 1-based ตาม Excel |
| `source_page` | int32 | เลขหน้า PDF ต้นฉบับ (local sheets มี) |
| `source_doc_id` | string | FK → `sources.json` |
| `quality_flags` | list<string> | เช่น `ocr_suspect`, `amount_outlier`, `qty_parsed_low_conf` |

### 3.2 `SourceDoc` (`sources.json` — ทุกไฟล์ในโฟลเดอร์ดิบ)
```json
{
  "doc_id": "d_3f9a...", "rel_path": "กมธ.ติดตามงบ/ครั้งที่ 4 (4 มิ.ย. 2569)/วาระบ่าย (NDLP ศธ.)/2_ราคากลาง21.pdf",
  "kind": "pdf|xlsx|xls|docx|pptx|jpg|other", "bytes": 734211, "sha1": "...",
  "pages": 5, "has_text_layer": true, "extracted": true,
  "title_guess": "ราคากลาง21", "collection": "committee|province_budget|open_sso|pbo",
  "meeting_no": 4, "meeting_date": "2569-06-04", "topic": "วาระบ่าย (NDLP ศธ.)", "agency_guess": "สำนักงานเทคโนโลยีเพื่อการเรียนการสอนฯ",
  "province": null, "gov_level": null, "fiscal_years": [2568],
  "text_chunks_file": "docs/d_3f9a.json.gz" , "note": "OCR out of scope" 
}
```

### 3.3 `DocChunk` (`docs/<doc_id>.json.gz`) — PDF/docx/pptx ที่มี text
`{doc_id, page, chunk_no, text, tables: [{page, rows: [[...]]}]}` chunk ≈ 800–1,200 ตัวอักษร ไม่ตัดกลางบรรทัดตาราง

### 3.4 `CatalogItem` (`catalog/items.json.gz`) — aggregate ต่อ `item_key` × `fiscal_year_be`
`{item_key, display_name (ตัวอย่างชื่อที่พบบ่อยสุด), n_lines, n_agencies, years:[...], qty_unit, unit_price: {min, p25, median, p75, max, n}, amount: {...}, budget_type, top_agencies:[...], sample_source_ids:[≤5]}`
ใช้เป็นดัชนี full-text ใน browser (MiniSearch) และเป็นคำตอบ "ราคาที่รัฐเคยตั้ง" ระดับสรุป
นอกจากนี้ publish `catalog/trends/{item_key_hash}.json` เฉพาะ item_key ที่มีข้อมูล ≥ 3 ปี: `{item_key, unit, series:[{year_be, median_unit_price_thb, p25, p75, n}]}` สำหรับ trend chart (ไฟล์เล็ก โหลดตามต้องการ) — ถ้าจำนวนไฟล์เกิน 20k ให้รวมเป็น shard ตามตัวอักษรแรกของ hash

### 3.5 `EconIndicator` (`econ/indicators.json`)
```json
{"indicator":"cpi_headline_index","year_ce":2023,"year_be":2566,"value":107.58,"unit":"index 2019=100",
 "source_name":"กระทรวงพาณิชย์ (สนค.)","source_url":"https://...","retrieved_at":"2026-09-20","verified":false,"note":""}
```
ชุดขั้นต่ำ: `cpi_headline_index`, `inflation_pct`, `gdp_growth_pct`, `min_wage_bangkok_thb`, `min_wage_avg_thb`, `diesel_avg_thb_per_l`, `usd_thb_avg`, `construction_material_index`, `government_budget_total_mthb` สำหรับปี 2558–2569 (2570 ถ้ามีประกาศ)
**เพิ่มเพื่อ trend chart** (สนค. ดัชนีราคาวัสดุก่อสร้าง รายหมวด, ค่าเฉลี่ยรายปี): `cmi_steel` (เหล็กและผลิตภัณฑ์เหล็ก), `cmi_cement`, `cmi_concrete`, `cmi_wood`, `cmi_tiles`, `cmi_paint`, `cmi_sanitary`, `cmi_electrical_plumbing`, `cmi_other` — **ตามหมวดทางการ 10 หมวดของ สนค.** (ยืนยันจาก `index.tpso.go.th/api/cmi/master` 19 ก.ย. 2569: สนค. ไม่แยกไฟฟ้า/ประปา และไม่มีหมวดยางมะตอย → `cmi_electrical`, `cmi_plumbing`, `cmi_asphalt_petroleum` เดิมคงไว้เป็น null + note ชี้ไปตัวแทน; tool `get_price_trend` ต้องไม่เสนอ 3 ตัวนี้) + ราคาน้ำมัน `diesel_avg_thb_per_l`, `gasoline95_avg_thb_per_l` — ทุกตัว 10 ปีย้อนหลัง (2559–2569) เพื่อให้ `get_price_trend` วาดกราฟได้โดยไม่ต้อง search
`econ/indicators.json` ต้องมี `series` view ด้วย: `{indicator, label_th, unit, points:[{year_be, value}], source_name, source_url, verified}` (สร้างจากรายการเดี่ยวตอน publish)
**ทุกค่าเริ่มที่ `verified:false`** จนกว่าคนจะตรวจ — UI แสดงป้าย

## 4. กฎ extract ต่อชุดข้อมูล

### 4.1 PBO (A1)
- เลือก sheet ที่ชื่อขึ้นต้น `เบิกจ่ายภาพรวมทุกมิติ`; อ่านด้วย `openpyxl read_only` แล้ว **ตัดที่ 22 คอลัมน์แรก** (2567 มี 16384 คอลัมน์)
- drop แถว `Grand Total` **ด้วยการตรวจเนื้อหา ไม่ใช่เลขแถว** (2561/2567/2568 ไม่มีแถวนี้ — 02 §A1) และเก็บค่า Grand Total ทุกคอลัมน์เงินไว้ใน `.cache/pbo/oracle.json`; `'-'`→null; คอลัมน์เงิน ×1,000,000 → int64 (round)
- `fiscal_year_be` จากคอลัมน์ `ปีงบประมาณ` (ตรวจว่าตรงชื่อไฟล์ ไม่ตรง → flag)
- `source_row` = แถว Excel จริง (header=1; ข้อมูลเริ่มแถว 3 ถ้ามี Grand Total มิฉะนั้นแถว 2)
- memory: stream ทีละ 50k แถว → parquet ชิ้น ๆ ใน `.cache/` (ไฟล์ 2564 มี 450k แถว)

### 4.2 ร่าง พ.ร.บ. 2570 (A2) และ subset จังหวัด (A3)
- A2: sheet `Data` ตรง ๆ; เก็บ `min/agc` เป็น code; `p_total_bud` เป็นบาทอยู่แล้ว
- A3: header detector — หาแถวแรกที่มี ≥ 5 เซลล์ไม่ว่างและมีคำว่า `กระทรวง` หรือ `หน่วยงาน`; แถวก่อนหน้า = title → parse "N รายการ | งบรวม X บาท" ไว้ตรวจสอบ
- dedupe ไฟล์ซ้ำ (เชียงใหม่/สมุทรปราการ มีไฟล์ฉบับเต็มเหมือนกัน) ด้วย sha1 → ถ้าเหมือน ให้ `source_path` ชี้ไฟล์แรกตามลำดับตัวอักษร และบันทึก `duplicates:[...]` ใน sources.json

### 4.3 Local sheets (A4)
- ราชาเทวะ: อ่านทุก sheet ที่ header = `page, plan, work, ...` ยกเว้น `ocr_raw_data`, `pivot_*`, `summary_*` (ใช้ `summary_*` เป็น oracle ตรวจยอดต่อแผนงาน)
- อบจ. ชม.: map `REF_DOC_Page→source_page, Budgetary_Plan→plan, Budgetary_USER→activity, Budgetary_TYPE→budget_type, Budgetary_TYPE2→expense_category, Project→item_name, number→item_qty, amount→amount_thb, Division/Divison→agency`
- ไฟล์อื่นใน A4 ที่ `[UNVERIFIED]` → ใช้ generic column mapper (fuzzy ชื่อคอลัมน์ ↔ canonical) และถ้า map ไม่ได้ ≥ 3 ฟิลด์หลัก (item, amount, plan) → skip + รายงาน
- `local_gov_name`, `province`, `gov_level` จากชื่อไฟล์/โฟลเดอร์

### 4.4 Committee xlsx/xls (A5) — generic
- ทุก sheet: หา table region (แถว header ที่มี ≥ 4 เซลล์ข้อความ + แถวถัดไปมีตัวเลข) → DataFrame → พยายาม map canonical; ถ้าไม่ได้ → เก็บเป็น `DocChunk` แบบ table (ให้ AI อ่านเป็นข้อความ) ไม่ใส่ `budget_lines`
- `.XLS` → xlrd; ถ้า xlrd เปิดไม่ได้ → skip + รายงานใน validation_report (เครื่อง dev ไม่มี LibreOffice; ใช้ได้ถ้าพบ `soffice` ใน PATH)

### 4.5 PDF / docx / pptx
- ทุก PDF: pypdf (จำนวนหน้า + text 3 หน้าแรก; fallback pdfplumber) → `has_text_layer = chars_per_page ≥ 200` — ไม่ใช้ poppler CLI (เครื่อง dev ไม่มี `pdfinfo`)
- มี text layer และ bytes ≤ 100 MB → pdfplumber per page: text + `extract_tables()`; ตารางที่มีคอลัมน์ตัวเลข → พยายาม map เป็น `committee_table` (เช่น OPEN SSO ผลเบิกจ่าย, ราคากลาง)
- docx/pptx → text ต่อ paragraph/slide → chunks
- ไม่มี text layer → `extracted:false`, `note:"OCR out of scope"`

## 5. Normalize rules (`normalize/`)

1. Unicode NFC; ลบ `U+200B`, `U+FEFF`; `ํา`→`ำ`; ตัวเลขไทย→อารบิก; `,` ในตัวเลข; whitespace collapse
2. `item_parser`:
   - regex สถานที่: `(ตำบล|ต\.)\s*\S+`, `(อำเภอ|อ\.)\s*\S+`, `(จังหวัด|จ\.)\s*\S+`, `หมู่ที่ \d+`, `บ้าน\S+`, ชื่อหน่วยงานที่ตรง org_master → ย้ายไป `location_text`, `province`
   - qty/unit: `(\d[\d,\.]*)\s*(เครื่อง|คัน|ชุด|ตัว|หลัง|แห่ง|รายการ|ราย|คน|ตร\.ม\.|เมตร|กม\.|ไร่|ต้น|เล่ม|ระบบ|งาน|โครงการ|แห่ง)` ท้ายข้อความก่อนสถานที่
   - spec tokens: `\d[\d,]*\s*(บีทียู|BTU|ตัน|ล้อ|ฟุต|นิ้ว|kW|กิโลวัตต์|แรงม้า|ที่นั่ง|ลิตร|ซีซี|GB|TB|นิ้ว)`, คำว่า inverter/ติดผนัง/ตั้งพื้น/แขวน
   - `item_key` = item_name − location − qty phrase − org names → lower → strip punctuation → collapse
   - ทดสอบด้วยชุด 200 ตัวอย่างใน `tests/fixtures/item_names.yaml` (target: province ถูก ≥ 95 %, qty ถูก ≥ 90 % บนชุดที่มี qty)
3. `org_master`: master จาก A2 Data Dict (min/agc code) + alias table (`org_aliases.yaml`, เติมได้) + rapidfuzz ≥ 92 → code; ต่ำกว่า → null + flag `org_unmapped`; **ยกเว้นชื่อ อปท.** (ขึ้นต้น `เทศบาล`/`องค์การบริหารส่วน`) ไม่ใช้ fuzzy — exact/alias เท่านั้น เพราะชื่อสั้นคล้ายกันแต่คนละที่ (02 §A2)
4. money: ล้านบาท→บาท ปัดเป็น int; ค่าติดลบใน PBO เก็บตามจริง + flag `negative_amount`

## 6. Validation (`tgbp validate`) — hard rules ต้องผ่านทั้งหมด

| # | กฎ | ระดับ |
|---|---|---|
| V1 | ยอดรวมต่อปีของ PBO (ทุกคอลัมน์เงิน) = oracle ในไฟล์ ± 0.01 %: (a) แถว Grand Total (2558–2560, 2562–2566) (b) 2561: `Sheet1` แถว `ผลรวมทั้งหมด` (เฉพาะ พรบ.) + รายกระทรวง (c) 2568: `Sheet1` เฉพาะสำนักนายกรัฐมนตรี (e) 2562: ไฟล์ต้นทางไม่ครบ → สถานะ `source_incomplete` ตาม `known_source_gaps.yaml` (ADR-004); tolerance = max(0.01 %, 1,000 บาท); ไม่นับแถว `corrupt_row` (d) 2567: **ไม่มี oracle** → รายงาน `no_oracle` + ตรวจจำนวนแถว = 221,571 (soft) — แก้ 19 ก.ย. 2569 หลังตรวจไฟล์จริง | hard (a–c) / soft (d) |
| V2 | A3 (subset จังหวัด) แต่ละไฟล์: จำนวนแถว = N ใน title และผลรวม = X ใน title | hard |
| V3 | ราชาเทวะ: ผลรวมต่อ (plan, work, budget_group) = `summary_ocr_raw_data` | hard (ยกเว้นแถวที่ flag outlier — รายงาน) |
| V4 | `source_id` unique ทั้ง dataset | hard |
| V5 | ทุก `budget_lines.source_doc_id` มีใน sources.json | hard |
| V6 | ไม่มีไฟล์ output > 24 MB | hard |
| V7 | `fiscal_year_be` ∈ [2558, 2570] | hard |
| V8 | `unit_price_thb` outlier (> p99.5 ×10 ของ item_key เดียวกัน) → flag ไม่ fail | soft |
| V9 | สัดส่วน `org_unmapped` < 5 % ของแถว (ต่อ dataset) | soft → รายงาน |
| V10 | ทุก PDF ใน raw ปรากฏใน sources.json (นับไฟล์ตรง) | hard |

ผลลัพธ์ `web/public/data/validation_report.md` + `validation.json` (สรุปตัวเลข) และ pipeline ต้องอัปเดตหัวข้อ E ใน `docs/02-DATA-INVENTORY.md` ด้วยขนาดจริง

## 7. Publish layout (`web/public/data/`)

```
manifest.json                       # version, built_at, files[{path, bytes, sha256, rows, dataset, fiscal_year_be, ministry_code}], schema_version
sources.json                        # SourceDoc[] (ทั้งหมด รวม scan)
budget_lines/
  pbo/{year}/{ministry_code}.parquet          # zstd, row_group 64k, sorted by agency, item_key
  act2570/{ministry_code}.parquet
  act2570_province/{province}.parquet
  local/{province}/{local_gov_slug}.parquet
  committee/{doc_id}.parquet
catalog/items.json.gz               # CatalogItem[]  (+ items.minisearch.json.gz = prebuilt index ถ้า build ในเวลา < 5 s บน browser ไม่ทัน)
catalog/orgs.json                   # org master (code, name, aliases, level, ministry)
catalog/facets.json                 # distinct ministries/years/budget_types/provinces + counts
docs/{doc_id}.json.gz               # DocChunk[]
econ/indicators.json
```
- **ทุก parquet ต้อง < 24 MB** — ถ้า (year, ministry) ยังใหญ่ ให้แตกเป็น `_part{n}.parquet` และลง manifest ทุกชิ้น
- คอลัมน์ string ที่ซ้ำมาก (ministry/agency/plan/budget_type) ใช้ dictionary encoding; parquet statistics เปิดเพื่อให้ DuckDB skip row groups
- `tgbp sample --rows 1000` → `web/tests/fixtures/data/` โครงเดียวกัน (ไว้ dev/test ฝั่ง web โดยไม่ต้องรอ pipeline เต็ม)

## 8. Tests (pytest)

- unit: `thai_text`, `item_parser` (200 cases), `money`, `org_master`, header detector, hash คงที่
- integration: fixture xlsx เล็ก ๆ ที่สร้างในเทสต์ (mimic โครง PBO รวม Grand Total, `'-'`, Sheet1 นำหน้า, คอลัมน์เกิน) → extract → validate ผ่าน
- ห้าม test พึ่งไฟล์ raw จริง (CI ไม่มี) ยกเว้น mark `@pytest.mark.rawdata` ที่ skip ถ้าไม่มีโฟลเดอร์

## 9. Definition of Done (Phase 1)
- [ ] `tgbp build --dataset all` รันจบบนเครื่อง dev, `validate` ผ่าน hard rules ทั้งหมด
- [ ] `manifest.json` + ทุกไฟล์ใน §7 มีจริง, ไม่มีไฟล์ > 24 MB
- [ ] `validation_report.md` แนบสถิติ: แถวต่อ dataset, % org mapped, % qty parsed, จำนวน PDF มี/ไม่มี text layer
- [ ] `docs/02-DATA-INVENTORY.md` §E อัปเดตขนาดจริง, `[UNVERIFIED]` ในหัวข้อ A3–A5 ถูกแทนด้วยผลจริง
- [ ] `econ/indicators.json` มีครบทุก indicator/ปี พร้อม source_url (verified:false ได้)
- [ ] fixtures สำหรับ web ถูกสร้าง
- [ ] pytest ผ่าน, ruff ผ่าน
