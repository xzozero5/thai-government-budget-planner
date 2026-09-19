# `duckdb-ext/` — self-hosted DuckDB parquet extension (ADR-002)

ที่มา: `@duckdb/duckdb-wasm@1.32.0` (eh build, ไม่มี threads — ดู `package.json`, ยึดตาม
`docs/decisions/ADR-002-duckdb-wasm-range-and-self-hosted-extension.md`) พยายาม `read_parquet()`
ครั้งแรกจะไปโหลด `parquet.duckdb_extension.wasm` จาก `https://extensions.duckdb.org` เองโดยอัตโนมัติ
ซึ่งเป็น egress ข้าม origin ที่ไม่ใช่ `api.anthropic.com` และละเมิด **N5** (`CLAUDE.md` §2) — จึง
ต้อง vendor ไฟล์นี้ไว้ใน repo แล้วสั่ง DuckDB โหลดจาก origin ของเราเอง (`web/src/data/duckdb.ts`:
`SET custom_extension_repository = '<origin>/<BASE_URL>duckdb-ext'; INSTALL parquet; LOAD parquet;`)

## ไฟล์ในโฟลเดอร์นี้

```
duckdb-ext/
└── v1.4.3/
    └── wasm_eh/
        └── parquet.duckdb_extension.wasm
```

โครงสร้าง `<version>/<platform>/<extname>.duckdb_extension.wasm` เป็น layout ที่ DuckDB คาดไว้เอง
(เติมต่อท้าย `custom_extension_repository` โดยอัตโนมัติ) — **ห้ามเปลี่ยนชื่อ/ย้ายไฟล์**

## เวอร์ชันที่ผูกกัน (บังคับอัปเดตพร้อมกัน)

| รายการ | ค่า |
|---|---|
| `@duckdb/duckdb-wasm` (npm, `web/package.json`) | **1.32.0** |
| DuckDB engine version ที่ 1.32.0 ผูกด้วย (`db.getVersion()`, ยืนยันจริงใน spike S1) | **v1.4.3** |
| platform/target | `wasm_eh` (exception-handling build, ไม่ใช้ threads — บังคับตาม `docs/04-ARCHITECTURE.md` §D8: GitHub Pages ตั้ง COOP/COEP ไม่ได้ จึงใช้ threads ไม่ได้) |
| ไฟล์ | `parquet.duckdb_extension.wasm` |
| ขนาด | 3,045,039 bytes |
| sha256 | `22765c8f7dc741cda2b571a66ac7bb355295d7d69a6c37e5315b265672984f55` |

ค่าคงที่ `DUCKDB_EXTENSION_VERSION_PATH = 'v1.4.3'` และ `EXPECTED_DUCKDB_WASM_PACKAGE_VERSION =
'1.32.0'` ใน `web/src/data/duckdb.ts` ต้องตรงกับตารางนี้เสมอ — มี unit test
(`web/src/data/duckdb.test.ts`) ที่ fail ถ้า `@duckdb/duckdb-wasm` ใน `package.json` เปลี่ยนเวอร์ชัน
โดยไม่มีใครมาอัปเดตทั้งไฟล์นี้และค่าคงที่พร้อมกัน

## ที่มาของไฟล์ .wasm (ต้นทางทางการของ DuckDB)

ดาวน์โหลดโดย `architect` ระหว่างทำ spike T-201/S1 (20 ก.ย. 2569) จาก URL ทางการของ DuckDB:

```
https://extensions.duckdb.org/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm
```

(ดู `web/spikes/results/s1.json` §"debug-ext" และ `docs/decisions/SPIKES.md` §S1 ผล 5 — เป็น URL
เดียวกับที่ DuckDB-WASM พยายามยิงเองตอน `read_parquet()` ถ้าไม่ self-host) ไฟล์ยังคงเป็นไฟล์ที่ DuckDB
เซ็นไว้ตามปกติ (ไม่ต้องเปิด `allowUnsignedExtensions` — ADR-002 ข้อ 2)

Vendor ไว้ก่อนแล้วที่ `web/spikes/vendor/duckdb-ext/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm`
(ของ spike, ห้ามแก้ตาม `CLAUDE.md`) — ไฟล์ใต้โฟลเดอร์นี้ (`web/public/duckdb-ext/`) เป็นสำเนาไบต์ต่อไบต์
ของไฟล์นั้น เพื่อให้ `npm run build` คัดลอกไปที่ `web/dist/duckdb-ext/**` และ deploy ไป GitHub Pages
พร้อมกับแอปจริง (ต้องอยู่ใน git ตาม `CLAUDE.md` §5.1 — ไม่ใช่ output ของ pipeline)

## วิธีอัปเดตเมื่ออัปเกรด `@duckdb/duckdb-wasm`

1. หาว่าเวอร์ชัน npm ใหม่ผูกกับ DuckDB engine เวอร์ชันอะไร — รันแอปครั้งเดียวแล้วเรียก
   `(await getDb()).db.getVersion()` (หรือดู changelog ของ `@duckdb/duckdb-wasm` บน GitHub)
2. ดาวน์โหลดไฟล์ extension ของเวอร์ชันนั้นจาก
   `https://extensions.duckdb.org/v<engine-version>/wasm_eh/parquet.duckdb_extension.wasm`
   (ยืนยัน sha256 กับแหล่งทางการ/เทียบกับ build ที่ทดสอบแล้วถ้ามี)
3. วางไว้ที่ `web/public/duckdb-ext/v<engine-version>/wasm_eh/parquet.duckdb_extension.wasm`
   (สร้างโฟลเดอร์เวอร์ชันใหม่ — **อย่าลบเวอร์ชันเก่าจนกว่าจะ deploy สำเร็จและ smoke test ผ่าน**)
4. แก้ `EXPECTED_DUCKDB_WASM_PACKAGE_VERSION` และ `DUCKDB_EXTENSION_VERSION_PATH` ใน
   `web/src/data/duckdb.ts` ให้ตรงกับเวอร์ชันใหม่ทั้งคู่ พร้อมอัปเดตตารางในไฟล์นี้ (bytes/sha256 ใหม่)
5. รัน `npm run test` (unit test เวอร์ชันจะ fail ถ้าอัปเดตไม่ครบ) แล้วรัน `npm run test:e2e`
   (integration ต้องเห็น `LOAD parquet` สำเร็จจริงกับไฟล์ใหม่) ก่อน merge
6. อัปเดต workflow deploy (T-605) ให้แน่ใจว่า `web/public/duckdb-ext/**` ยังถูกคัดลอกไปด้วย (เป็น
   ส่วนหนึ่งของ `web/public/` อยู่แล้ว ไม่ต้องแก้ workflow ปกติ)
