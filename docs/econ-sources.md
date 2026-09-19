# Econ Indicators — แหล่งข้อมูลและสถานะ (T-111)

> **ทุกค่าในไฟล์นี้และใน `pipeline/data/econ/indicators.source.json` มีสถานะ `verified:false` ทั้งหมด**
> ยังไม่มีใครตรวจสอบย้อนกลับไปยังต้นฉบับอีกครั้ง — ห้าม hard-code เป็นข้อเท็จจริงในโค้ด/UI จนกว่าจะมีคน mark `verified:true`
> ทุกค่าที่ไม่ใช่ `null` มาจากหน้าเว็บ/API ที่ **fetch แล้วเห็นตัวเลขจริง** ในวันที่ `retrieved_at = 2026-09-19` (ไม่มีค่าใดเติมจากความจำ — รอบสองเพิ่มการเรียก `index.tpso.go.th` API โดยตรง)
> ไฟล์นี้เป็น input ให้ T-110 (publish → `web/public/data/econ/indicators.json` + series view) — **ยังไม่ publish ในงานนี้**

สถานะไฟล์: `pipeline/data/econ/indicators.source.json` — schema `{schema_version, records:[EconIndicator]}` ตาม `docs/03-DATA-PIPELINE.md` §3.5, เรียงตาม (indicator, year_ce)

## สรุป coverage (หลังรอบสอง)

| indicator | ช่วงปีที่ต้องการ (พ.ศ.) | จำนวนปีที่มีค่า | หมายเหตุสั้น |
|---|---|---|---|
| `gdp_growth_pct` | 2558–2569 | 11/12 (2558–2568) | secondary — World Bank (ไม่เปลี่ยนจากรอบแรก) |
| `usd_thb_avg` | 2558–2569 | 11/12 (2558–2568) | secondary — World Bank (ไม่เปลี่ยนจากรอบแรก) |
| `inflation_pct` | 2558–2569 | **11/12 (2558–2568)** | **อัปเดตรอบสอง**: แหล่งหลักเปลี่ยนเป็น สนค. (TPSO) โดยตรง; World Bank ย้ายไปเป็น crosscheck ใน note |
| `cpi_headline_index` | 2558–2569 | **11/12 (2558–2568)** | **อัปเดตรอบสอง**: แหล่งหลักเปลี่ยนเป็น สนค. (TPSO) โดยตรง, ปีฐาน 2566=100; World Bank (2010=100) ย้ายไปเป็น crosscheck ใน note |
| `government_budget_total_mthb` | 2558–2569 | **12/12** | ไม่เปลี่ยนจากรอบแรก (wikipedia อ้างอิงราชกิจจานุเบกษา + cross-check ปี 2569 กับเอกสาร PBO รัฐสภา) |
| `min_wage_bangkok_thb` | 2558–2569 | 1/12 (เฉพาะ 2568) | ไม่เปลี่ยนจากรอบแรก — ยังไม่ได้ลองรอบสอง (priority ต่ำสุด, หมดเวลา) |
| `min_wage_avg_thb` | 2558–2569 | 0/12 | ไม่มีค่าเฉลี่ยทางการ — ตามกฎ N3 ห้ามคำนวณเอง (ตามการออกแบบ) |
| `construction_material_index` | 2558–2569 | **11/12 (2558–2568)** | **ใหม่รอบสอง**: `averageIndex` รายปีทางการจาก `/api/cmi/year` (หมวด 0 = ดัชนีรวม), ปีฐาน 2558=100; 2569 ยังไม่เผยแพร่ |
| `cmi_steel` | 2559–2569 | **10/11 (2559–2568)** | ใหม่รอบสอง — หมวด 4 (เหล็กและผลิตภัณฑ์เหล็ก) |
| `cmi_cement` | 2559–2569 | **10/11** | ใหม่รอบสอง — หมวด 2 (ซีเมนต์) |
| `cmi_concrete` | 2559–2569 | **10/11** | ใหม่รอบสอง — หมวด 3 (ผลิตภัณฑ์คอนกรีต) |
| `cmi_wood` | 2559–2569 | **10/11** | ใหม่รอบสอง — หมวด 1 (ไม้และผลิตภัณฑ์ไม้) |
| `cmi_tiles` | 2559–2569 | **10/11** | **indicator ใหม่** (main thread เพิ่ม spec) — หมวด 5 (กระเบื้อง) |
| `cmi_paint` | 2559–2569 | **10/11** | **indicator ใหม่** — หมวด 6 (วัสดุฉาบผิว) |
| `cmi_sanitary` | 2559–2569 | **10/11** | **indicator ใหม่** — หมวด 7 (สุขภัณฑ์) |
| `cmi_electrical_plumbing` | 2559–2569 | **10/11** | **indicator ใหม่** — หมวด 8 (อุปกรณ์ไฟฟ้าและประปา, รวม) |
| `cmi_other` | 2559–2569 | **10/11** | **indicator ใหม่** — หมวด 9 (วัสดุก่อสร้างอื่น ๆ รวมยางมะตอย) |
| `cmi_electrical` | 2559–2569 | 0/11 | คงเป็น null ตามมติ main thread — ใช้ `cmi_electrical_plumbing` แทน (ดูด้านล่าง) |
| `cmi_plumbing` | 2559–2569 | 0/11 | คงเป็น null — ใช้ `cmi_electrical_plumbing` แทน |
| `cmi_asphalt_petroleum` | 2559–2569 | 0/11 | คงเป็น null — ใช้ `cmi_other` แทน |
| `diesel_avg_thb_per_l` | 2559–2569 | 0/11 | ลองรอบสองแล้ว ยังไม่พบ (ดูด้านล่าง) |
| `gasoline95_avg_thb_per_l` | 2559–2569 | 0/11 | เหมือนข้างต้น |

รวม **250 records** ใน `indicators.source.json` (เพิ่มจาก 195 — เพิ่ม 5 indicator ใหม่ × 11 ปี = 55 แถว), ค่าที่ไม่ใช่ null = **158 records (63.2%)** เพิ่มจาก 46/195 (23.6%) ในรอบแรก

---

## รอบสอง (T-111 ครั้งที่ 2): พบ API ทางการของ สนค. (TPSO) โดยตรง

**Lead ที่ยืนยัน**: `https://index.tpso.go.th` เป็น Next.js SPA แต่มี JSON API ที่เรียกด้วย `curl`/`requests` ตรง ๆ ได้ **โดยไม่ต้องใช้ cookie/CSRF token/login ใด ๆ** (ทดสอบแล้วว่า request ที่ไม่มี Referer/cookie ก็ได้ 200 OK เหมือนกัน) มี rate limit แบบ header `x-rate-limit-limit: 10s` (สังเกตจาก response headers จริง) — ระหว่าง fetch รอบนี้เว้น ≥ 1 วินาทีต่อ request เสมอ และไม่ยิงถี่เกินจำเป็น (รวมทุก request ในรอบสองไม่เกิน ~30 ครั้ง)

### วิธี reverse-engineer (สำหรับอัปเดตรอบถัดไป หรือถ้า build เปลี่ยน)

1. `curl -A "Mozilla/5.0" https://index.tpso.go.th/` → grep `"buildId":"..."` จาก HTML (Next.js ฝัง `__NEXT_DATA__`)
2. `curl https://index.tpso.go.th/_next/static/<buildId>/_buildManifest.js` → หา route ที่สนใจ (เช่น `/materials-price-index/weight-index/[id]`) แล้วดู array ท้ายสุดที่เป็นชื่อไฟล์ `.js` ของ chunk หน้านั้น
3. `curl https://index.tpso.go.th/_next/static/chunks/pages/<path-to-chunk>.js` แล้ว grep `"/api/` เพื่อดู endpoint ที่หน้านั้นเรียก และ grep `.concat("/api/"` สำหรับ endpoint ที่สร้าง URL แบบ dynamic (`"/api/".concat(prefix,"/year")` เป็นต้น)
4. อ่าน logic ในไฟล์ (minified แต่ยัง grep payload shape ได้) เพื่อดู body ที่ต้องส่งตอน POST

### Endpoint ที่ใช้จริงในรอบนี้

- **`GET /api/cmi/master`** และ **`GET /api/cpig/master`** — คืน metadata: `yearBase` (ปีฐานที่รองรับ), `categories` (รหัสหมวดสินค้า + ชื่อไทย/อังกฤษ), `types`, `period` (ช่วงข้อมูลที่มี), `lastUpdated`
- **`POST /api/cmi/year`** — ดัชนีราคาวัสดุก่อสร้างเฉลี่ยรายปี (**เป็นค่าที่ สนค. คำนวณ/เผยแพร่เองเป็นรายปีอยู่แล้ว ไม่ใช่ค่าที่ทีมนี้ derived เฉลี่ย 12 เดือนเอง**)
  ```
  POST https://index.tpso.go.th/api/cmi/year
  Content-Type: application/json
  {"YearBase":2558,"TimeOption":true,"Categories":["0","1","2","3","4","5","6","7","8","9"],
   "Period":{"StartYear":2558,"StartMonth":1,"EndYear":2569,"EndMonth":12}}
  ```
  → คืน array ต่อ `commodityCode`, แต่ละตัวมี `years:[{year, averageIndex, averageChange, months:[]}]`
  **สังเกต**: endpoint นี้ไม่สนใจค่า `Period` ที่ส่งไปจริง ๆ — คืนข้อมูลเต็มประวัติเท่าที่มี (2558–2568) เสมอไม่ว่าจะใส่ Period อะไร; ปี 2569 (2026) **ไม่มีใน response เลย** (ทดสอบแล้วทั้งแบบ `/api/cmi/year` และ `/api/cmi/filter` ด้วย `SpecificTimes` ครบ 12 เดือนของ 2569 — คืน `[]` ว่างทั้งคู่) แม้ `/api/cmi/master` จะรายงาน `period.end={"year":2569,"month":8}` ก็ตาม (อาจเป็น cutoff ของระบบ ไม่ใช่ข้อมูล CMI ที่เผยแพร่จริง)
- **`POST /api/cpig/year`** — ดัชนีราคาผู้บริโภคทั่วไปเฉลี่ยรายปี (CPI ทั่วไป, general CPI)
  ```
  POST https://index.tpso.go.th/api/cpig/year
  Content-Type: application/json
  {"YearBase":2566,"TimeOption":true,"Categories":["00000"],"Types":["TG"],
   "Period":{"StartYear":2558,"StartMonth":1,"EndYear":2569,"EndMonth":12}}
  ```
  → `commodityCode:"00000"` = "รวมทุกรายการ" (ALL COMMODITIES = ดัชนีรวม/headline), `Types:["TG"]` = "ดัชนีราคาผู้บริโภคทั่วไปของ **ประเทศ**" (ตัวเลือกอื่นใน master: `10`=กรุงเทพปริมณฑล, `CC`=ภาคกลาง, `EE`=ภาคตะวันออก/เหนือ(สังเกตชื่อ), `NN`=ภาคเหนือ, `SS`=ภาคใต้ — เผื่ออยากทำ breakdown รายภาคในอนาคต) → คืน `years:[{year, averageIndex, averageChange, months:[]}]` เช่นกัน ปี 2569 ไม่มีใน response (ปีล่าสุดที่มี = 2568)
- **ตัวอื่นที่เจอแต่ยังไม่ได้ใช้** (เก็บไว้เผื่ออัปเดตรอบหน้า): `/api/cpil/master`+`/api/cpil/year` (ดัชนีราคาผู้บริโภคพื้นฐาน — core CPI), `/api/cpiu/master` (ดัชนีอีกชุด), `/api/cmip/master`+`/api/cmip/filter` (ราคาวัสดุก่อสร้างรายจังหวัด ไม่ใช่ดัชนีรายหมวด), `/api/ppi/*` (Producer Price Index), `/api/imex/*` (Export-Import price), `/api/rfti/*` (Road Freight), `/api/k/*` (ค่า K/escalation factor — อาจมีประโยชน์ถ้าต้องการ index ค่าปรับราคางานก่อสร้าง)

### `construction_material_index` และ `cmi_*` (9 หมวด) — ปีฐาน 2558=100 เดียวตลอดช่วง

- ทดสอบเรียกด้วย `YearBase:2564` เทียบกับ `YearBase:2558` แล้วพบว่า **API คำนวณ re-base ให้ทั้ง series ใหม่ได้เองตามปีฐานที่ขอ** (ทั้งสองปีฐานคืนค่าครบ 2558–2568 เหมือนกัน ตัวเลขต่างกันตามสูตร rebase) → **ไม่มีปัญหา `base_year_differs`** ถ้าเลือกใช้ปีฐานเดียวตลอดทั้งช่วงที่ขอ (ต่างจากที่กังวลไว้ในรอบแรก) เลือกใช้ **2558=100** เพราะตรงกับฉบับ PDF รายเดือนที่เคยตรวจสอบไว้ในรอบแรก (`price.moc.go.th/price/fileuploader/file_csi/Csi.pdf`)
- Mapping หมวดทางการจาก `/api/cmi/master` (commodityCode → indicator ที่ใช้ในไฟล์นี้):

  | code | ชื่อไทย | ชื่ออังกฤษ | indicator |
  |---|---|---|---|
  | 0 | ดัชนีรวม | All Commodities | `construction_material_index` |
  | 1 | ไม้และผลิตภัณฑ์ไม้ | Lumber and Wood Products | `cmi_wood` |
  | 2 | ซีเมนต์ | Cement | `cmi_cement` |
  | 3 | ผลิตภัณฑ์คอนกรีต | Concrete Ingredient | `cmi_concrete` |
  | 4 | เหล็กและผลิตภัณฑ์เหล็ก | Iron Products | `cmi_steel` |
  | 5 | กระเบื้อง | Tiles | `cmi_tiles` (**ใหม่**) |
  | 6 | วัสดุฉาบผิว | Paints | `cmi_paint` (**ใหม่**) |
  | 7 | สุขภัณฑ์ | Sanitary Ware | `cmi_sanitary` (**ใหม่**) |
  | 8 | อุปกรณ์ไฟฟ้าและประปา | Electrical and Plumbing | `cmi_electrical_plumbing` (**ใหม่**, รวมไฟฟ้า+ประปา) |
  | 9 | วัสดุก่อสร้างอื่น ๆ | Others | `cmi_other` (**ใหม่**, รวมยางมะตอย) |

- **มติ mapping (ยืนยันโดย main thread ก่อนรอบนี้, ตรงกับข้อสังเกตรอบแรก)**: `cmi_electrical`, `cmi_plumbing`, `cmi_asphalt_petroleum` **คงเป็น `null` ทุกปี** พร้อม note `not_published_by_source: ใช้ cmi_electrical_plumbing / cmi_other แทน` — เพราะ สนค. เผยแพร่หมวด 8 เป็น "อุปกรณ์ไฟฟ้าและประปา" รวมเดียว ไม่แยกไฟฟ้า/ประปา และไม่มีหมวดยางมะตอย/ปิโตรเลียมแยกต่างหาก (ยางมะตอยรวมอยู่ในหมวด 9 "วัสดุก่อสร้างอื่น ๆ" ร่วมกับสินค้าอื่น) เอกสาร `docs/03-DATA-PIPELINE.md` §3.5 ได้แก้ตามนี้แล้ว
- **ปี 2569 (2026)**: null ทุกหมวด — สนค. ยังไม่เผยแพร่ข้อมูลปีนี้ในระบบ CMI ณ วันที่ fetch (ดูรายละเอียดการทดสอบด้านบน)

### `cpi_headline_index`, `inflation_pct` — เปลี่ยนแหล่งหลักเป็น สนค. (TPSO), ย้าย World Bank เป็น crosscheck

- **ค่าที่ได้จาก TPSO** (`cpi_headline_index`, ปีฐาน 2566=100; `inflation_pct` = `averageChange` YoY ของดัชนีเฉลี่ยรายปี, %):

  | ปี พ.ศ. | cpi_headline_index (TPSO, 2566=100) | inflation_pct (TPSO, %YoY) | inflation_pct (World Bank, %YoY) เดิม |
  |---|---|---|---|
  | 2558 | 90.39 | -0.90 | -0.90 |
  | 2559 | 90.56 | 0.19 | 0.19 |
  | 2560 | 91.16 | 0.66 | 0.66 |
  | 2561 | 92.13 | 1.07 | 1.07 |
  | 2562 | 92.78 | 0.71 | 0.71 |
  | 2563 | 92.00 | -0.85 | -0.85 |
  | 2564 | 93.13 | 1.23 | 1.23 |
  | 2565 | 98.79 | 6.08 | 6.08 |
  | 2566 | 100.00 | 1.23 | 1.23 |
  | 2567 | 100.40 | 0.40 | 0.40 |
  | 2568 | 100.26 | -0.14 | -0.13 |

- **ข้อสังเกตคุณภาพข้อมูลสำคัญ**: `inflation_pct` จาก สนค. (TPSO) กับ World Bank **ตรงกันแทบทุกปี (10/11 ปีเท่ากันเป๊ะถึงทศนิยม 2 ตำแหน่ง, ปี 2568 ต่างกัน 0.01 จุด — 0.14 vs 0.13 น่าจะเป็นแค่ปัดเศษ)** สมเหตุสมผลเพราะ % เปลี่ยนแปลงไม่ขึ้นกับปีฐาน (base-year-independent) และ World Bank น่าจะใช้ตัวเลขที่ประเทศไทยรายงานเป็นต้นทางอยู่แล้ว → เป็นการ cross-validate ที่ดีว่าเลขที่ดึงจาก TPSO API ถูกต้อง ไม่ได้ parse ผิด
- ส่วน `cpi_headline_index` (ระดับดัชนี ไม่ใช่ %) ต่างกันมากระหว่าง TPSO (90–100, ฐาน 2566) กับ World Bank (110–122, ฐาน 2010) — **เป็นเรื่องปกติเพราะปีฐานต่างกัน ห้ามนำสอง series นี้มาต่อกันหรือเทียบกันตรง ๆ** (ค่า World Bank เดิมถูกย้ายไปเก็บใน `note` ของแต่ละ record ในชื่อ `crosscheck_worldbank: <value> (base 2010=100)`)
- ปี 2569 (2026): null ทั้งคู่ — สนค. ยังไม่เผยแพร่ (ปีล่าสุดที่มี = 2568)

### `diesel_avg_thb_per_l`, `gasoline95_avg_thb_per_l` — ลองรอบสองแล้วยังไม่พบ

- ตรวจ `index.tpso.go.th` แล้ว **ไม่มีดัชนี/ราคาน้ำมันอยู่ในระบบนี้เลย** (มีแต่ CMI, CPI, PPI, RFTI, Export-Import price, K) — ต้องกลับไปที่ EPPO เหมือนรอบแรก
- ลองซ้ำ `eppo.go.th/index.php/th/energy-information/static-energy/price-petroleum` และหน้า `/data-energy-statistic/energy-price-th/ราคาขายปลีกน้ำมัน/` อีกครั้ง (WebFetch) — ยังพบเฉพาะไฟล์ Excel ราคา**รายวัน**ล่าสุด (เช่น `pt-price-st-2026-9-18.xlsx`, `pt-price-st-2026-9-17.xlsx`) ไม่มีลิงก์ไฟล์สรุปรายปีย้อนหลังที่ fetch เจอในเวลาที่จัดสรร
- ยังไม่ได้ลอง: ค้นหาผ่าน `data.go.th` (Thailand Open Data) ว่ามี dataset ราคาน้ำมันเฉลี่ยรายปีหรือไม่ — งานนี้ควรทำต่อในรอบถัดไปถ้ามีเวลา

### `min_wage_bangkok_thb` (ปีอื่นนอกจาก 2568) — ยังไม่ได้ลองในรอบสอง (priority ต่ำสุด, หมดเวลา session นี้)

ดูรายละเอียดแหล่งที่ลองแล้วในรอบแรก (ด้านล่าง) — ยังไม่มีการเปลี่ยนแปลง

---

## รายละเอียดจากรอบแรก (ยังใช้ได้/ไม่เปลี่ยน)

### `gdp_growth_pct`, `usd_thb_avg` — World Bank Open Data (ไม่เปลี่ยนจากรอบแรก)

- **แหล่งที่ใช้จริง**: World Bank Open Data API (`api.worldbank.org`) — ดึงด้วย `curl` ตรงและอ่าน JSON response จริงในเครื่องมือ Bash ของ session รอบแรก
  - GDP growth: `NY.GDP.MKTP.KD.ZG` → `https://api.worldbank.org/v2/country/THA/indicator/NY.GDP.MKTP.KD.ZG?format=json&date=2014:2026&per_page=50`
  - Exchange rate: `PA.NUS.FCRF` (period average, LCU per US$) → `https://api.worldbank.org/v2/country/THA/indicator/PA.NUS.FCRF?format=json&date=2014:2026&per_page=50`
- ปี 2569 (2026) เป็น null — ปีปฏิทินยังไม่จบ ไม่มีข้อมูลเต็มปี
- **วิธีอัปเดตปีถัดไป**: เรียก World Bank API เดิมด้วย `date` range ใหม่

### `government_budget_total_mthb` — coverage เต็ม 12/12 ปี (ไม่เปลี่ยนจากรอบแรก)

- **แหล่ง**: หน้าวิกิพีเดีย "งบประมาณแผ่นดินของไทย" (`https://th.wikipedia.org/wiki/งบประมาณแผ่นดินของไทย`) — มี reference อ้างอิง **ราชกิจจานุเบกษา** พ.ร.บ.งบประมาณรายจ่ายประจำปีแต่ละฉบับต่อท้ายทุกแถว
- **cross-check ปี 2569**: ยืนยันตรงกันกับเอกสาร "วิเคราะห์ร่างพระราชบัญญัติงบประมาณรายจ่ายประจำปีงบประมาณ พ.ศ. 2569" โดย **สำนักงบประมาณของรัฐสภา (PBO)** (`https://web.parliament.go.th/assets/portals/82/news/1597/1_1597.pdf`) — ตรงกับตัวเลขในวิกิพีเดีย 100%
- **ตัวเลข** (ล้านบาท): 2558=2,575,000 · 2559=2,720,000 (+เพิ่มเติม 56,000) · 2560=2,733,000 (+190,000) · 2561=2,900,000 (+150,000) · 2562=3,000,000 · 2563=3,200,000 · 2564=3,285,962 · 2565=3,100,000 · 2566=3,185,000 · 2567=3,480,000 (+122,000) · 2568=3,752,700 · 2569=3,780,600
- **วิธีอัปเดตปีถัดไป**: หลัง พ.ร.บ.งบประมาณปีใหม่ประกาศในราชกิจจานุเบกษา → ตรวจ `bb.go.th/topic3.php?gid=862&mid=545` โดยตรงแทนวิกิพีเดียถ้าเป็นไปได้

### `min_wage_bangkok_thb` — มีเฉพาะปี 2568

- **แหล่ง**: หน้าวิกิพีเดีย "ค่าจ้างขั้นต่ำในประเทศไทย" — ประกาศคณะกรรมการค่าจ้าง **ฉบับที่ 13** มีผลตั้งแต่ 1 มกราคม 2568: กรุงเทพมหานคร/นครปฐม/นนทบุรี/ปทุมธานี/สมุทรปราการ/สมุทรสาคร = **372 บาท/วัน**
- **ข้อควรระวัง (ยังไม่ยืนยัน)**: มีข่าวว่า ครม. เห็นชอบอัตรา 400 บาท/วัน สำหรับพื้นที่ กทม. เฉพาะกิจการโรงแรม/สถานบริการ มีผล 1 ก.ค. 2568 — เป็นอัตรา**เฉพาะกลุ่มอาชีพ** ไม่ใช่อัตราทั่วไป จึงไม่ได้แทนที่ 372 ในไฟล์นี้
- **ปีอื่น (2558–2567, 2569) = null** — แหล่งที่ลองแล้วไม่สำเร็จ: mol.go.th, wikipedia (มีเฉพาะฉบับล่าสุด), km.fti.or.th, library.parliament.go.th (403), khaosod.co.th (Cloudflare challenge)
- **วิธีอัปเดต/เติมข้อมูลย้อนหลัง**: ค้นหาประกาศคณะกรรมการค่าจ้างแต่ละฉบับ (ฉบับที่ 8–14) ในราชกิจจานุเบกษาโดยตรง (ratchakitcha.soc.go.th) — ระวัง PDF สแกนไม่มี text layer (N4 ห้าม OCR)

### `min_wage_avg_thb` — null ทั้งหมด (ตามการออกแบบ)

ประเทศไทยกำหนดค่าจ้างขั้นต่ำแยกตามจังหวัด/กลุ่มพื้นที่ ไม่มีหน่วยงานใดประกาศ "ค่าเฉลี่ยประเทศ" อย่างเป็นทางการ → เก็บเป็น `null` ทุกปีโดยเจตนา

---

## ข้อสังเกตคุณภาพข้อมูลรวม (สำหรับคนตรวจ)

1. **สัดส่วนความครอบคลุมเพิ่มขึ้นมากในรอบสอง (23.6% → 63.2%)** หลังพบ API ทางการของ สนค. (`index.tpso.go.th`) ที่เรียกตรงได้โดยไม่ต้องผ่าน browser/JS rendering — บทเรียนสำคัญ: เว็บที่หน้าตาเป็น SPA ไม่ได้แปลว่าไม่มี API สาธารณะ ต้องลอง reverse-engineer จาก `_next/static/<buildId>/_buildManifest.js` + chunk JS ก่อนจะสรุปว่า "fetch ไม่ได้"
2. `cpi_headline_index`/`inflation_pct` ตอนนี้เป็นตัวเลขทางการจาก สนค. โดยตรงแล้ว (ไม่ใช่ secondary source อีกต่อไป) — `inflation_pct` ตรงกับ World Bank เกือบเป๊ะทุกปี (ดูตารางด้านบน) ยืนยันความถูกต้อง
3. `cmi_*` ยังมี 3 indicator (`cmi_electrical`, `cmi_plumbing`, `cmi_asphalt_petroleum`) ที่เป็น null ถาวรตาม mapping จริงของ สนค. — ไม่ใช่ช่องว่างที่ต้องพยายามเติมอีก (เว้นแต่เปลี่ยน spec หรือหาแหล่งอื่นที่แยกไฟฟ้า/ประปา/ยางมะตอยจริง ๆ)
4. `diesel_avg_thb_per_l`, `gasoline95_avg_thb_per_l`, และ `min_wage_bangkok_thb` (ปีก่อน 2568) ยังไม่พบแหล่งที่ fetch ได้ในเวลาที่จัดสรร — ควรเป็นงานย่อยเฉพาะรอบหน้า (EPPO ต้องหา endpoint ราคาย้อนหลัง, ค่าแรงต้องไล่ราชกิจจานุเบกษาทีละฉบับ)
5. ทุก record ที่ `value` เป็น `null` มี `note` อธิบายแหล่งที่ลองแล้วโดยละเอียด เพื่อให้รอบถัดไปไม่ต้องเริ่มค้นใหม่จากศูนย์

## Checklist ก่อนใช้งานจริง (สำหรับคนตรวจ/PO)

- [ ] ตรวจว่าตัวเลข TPSO (`cpi_headline_index`, `inflation_pct`, `cmi_*`) ที่ดึงจาก API ตรงกับตัวเลขที่ สนค. แถลงในรายงาน PDF/ข่าวจริงหรือไม่ (สุ่มตรวจ 2-3 ปี — เทียบกับตัวเลข CMI พ.ย. 2567 ที่เคย fetch จาก PDF ในรอบแรก: หมวดเหล็ก 130.4, ซีเมนต์ 99.1 ฯลฯ เทียบกับ `averageIndex` รายเดือนที่คำนวณจาก API หากต้องการความละเอียดสูงสุด)
- [ ] ยืนยันอัตราค่าจ้างขั้นต่ำ กทม. ปลายปี 2568 (372 หรือ 400 บาท/วัน) จากราชกิจจานุเบกษาโดยตรง
- [ ] หา endpoint ราคาน้ำมันเฉลี่ยรายปีของ EPPO ในรอบหน้า (ยังไม่พบ)
- [ ] mark `verified:true` ทีละ record หลังตรวจแล้วเท่านั้น (อย่า mark ยกชุด)
