# Bug tracker (qa-engineer)

รูปแบบ: `B-xxx` — severity (`high`/`medium`/`low`) · สถานะ · ขั้นตอน reproduce · คาดหวัง vs จริง · ไฟล์ที่น่าจะเกี่ยว

แยก **"พบจริง" (reproduced ด้วย test อัตโนมัติ)** ออกจาก **"สงสัย" (สังเกตแต่ยังไม่ยืนยัน)** เสมอ

---

## B-001 — DuckDB-WASM ยิง CSP violation จริง (script-src eval + connect-src data:) ระหว่าง flow ปกติ

- **สถานะ**: **ปิดแล้ว (2569-09-21, `715f520`)** — ต้นตอจริงไม่ใช่ DuckDB: (ก) `eval` ×3 = Zod 4 probe `new Function("")` → `web/src/lib/zodConfig.ts` (jitless) (ข) `connect-src data:` = yoga-layout ของ react-pdf `fetch(data:…wasm)` ตอน export → อนุญาต `data:` ใน connect-src (ไม่เปิด unsafe-eval); e2e happy-path บังคับ `cspViolations() == []` แล้ว — รอ security-reviewer ทบทวนการอนุญาต `data:` ใน T-602
- **Severity**: high
- **ประเภท**: security (N5 / 09-SECURITY §2, §5 C2/C3)
- **พบจาก**: `web/tests/e2e/happy-path.spec.ts` (T-409) — รันกับ **production build จริง** (`npm run build` แล้ว `npm run preview`, CSP meta ที่ inject จริงตาม `vite-plugins/cspMeta.ts`) ไม่ใช่ dev server (dev server ไม่มี CSP meta จึงไม่เคยเจอเคสนี้มาก่อน — และ `tests/e2e/data/duckdb-repo.spec.ts` เดิมรันผ่าน harness build `--mode e2e-harness` ที่เรียก `data.queryLines()` ตรง ๆ ไม่ผ่านชั้น AI tool/Zod จึงไม่ trigger code path เดียวกัน)

### ขั้นตอน reproduce
1. `cd web && npm run build && npm run preview -- --port 4173`
2. เปิด `http://localhost:4173/thai-government-budget-planner/#/` ด้วย Chromium จริง (ไม่ใช่ dev server)
3. ใส่ API key (ปลอมก็ได้ถ้า mock `messages/count_tokens`) แล้วเข้า `/workspace`
4. ส่งข้อความให้ AI เรียก `query_budget_lines` อย่างน้อย 1 ครั้ง (ทำให้ `data.queryLines()` ทำงานผ่านชั้น AI tool จริง ซึ่งเป็นจุดแรกที่ DuckDB-WASM ต้อง instantiate)
5. เปิด DevTools → Console (หรือฟัง `window.addEventListener('securitypolicyviolation', ...)`)

### คาดหวัง
ไม่มี CSP violation ใด ๆ ปรากฏใน console ตลอด flow (09-SECURITY §5 C3 กำหนดไว้ชัดเจน — "injected `<img src=https://example.com>` ถูกบล็อก" คือพฤติกรรมที่ต้องการ **เฉพาะเนื้อหาที่ไม่รู้จัก** ไม่ใช่ dependency หลักของแอปเอง)

### จริง
พบ CSP violation 6 รายการต่อ session (นับซ้ำได้จากทั้ง `console` message และ `securitypolicyviolation` event):
```
script-src: eval   (×3)
connect-src: data  (×1, จาก fetch ของ data:application/octet-stream;base64,AGFzbQEAAAAB... — ขึ้นต้นด้วย \0asm คือ WASM binary header)
```
ข้อความเต็มจาก Chromium console:
```
Refused to connect to 'data:application/octet-stream;base64,AGFzbQEAAAAB...' because it
violates the following Content Security Policy directive: "connect-src 'self' https://api.anthropic.com".
```
`script-src 'self' 'wasm-unsafe-eval'` (ตาม 04-ARCHITECTURE.md §D8) อนุญาตเฉพาะ `WebAssembly.instantiate`
แบบ eval-based เท่านั้น — ไม่ครอบคลุม `eval()`/`new Function()` ธรรมดา และ `connect-src` ไม่มี `data:` เลย
จึงบล็อกทั้งสองอย่าง

**สิ่งที่ไม่ใช่บั๊ก (ยืนยันแล้ว)**: flow ยังทำงานสำเร็จต่อได้ทั้งหมด (query คืนผล, proposal render, export PDF/JSON
ผ่าน) — แปลว่ามี fallback ภายในของ `@duckdb/duckdb-wasm` เองที่ทนต่อการถูกบล็อกนี้ได้ (ไม่ throw ให้ผู้ใช้เห็น)
แต่การพึ่งพา "บล็อกแล้วยัง fallback ได้" เป็นความเสี่ยงที่ไม่ควรปล่อยไว้ระยะยาว (browser อื่น/เวอร์ชันอื่นของ
dependency นี้อาจไม่มี fallback เดียวกัน, และทุก violation ที่เกิดจริงคือสัญญาณว่านโยบาย CSP ที่ตั้งใจไว้ไม่ได้
ป้องกันครบตามที่คิด)

### ต้นตอที่น่าจะเกี่ยว (ยังไม่ยืนยัน 100% — ส่งต่อให้ data-engineer/security-reviewer)
- **ไม่ใช่โค้ดใน `web/src/**`** — grep `data:application`/`toDataURL`/base64 wasm ใน `src/data/duckdb.ts` ไม่พบ
  จุดที่แอปเรียกเอง (`web/src/data/duckdb.ts`)
- น่าจะมาจาก dependency `@duckdb/duckdb-wasm@1.32.0` เอง (fallback instantiation strategy บางกรณี) หรือ
  ไลบรารีอื่นที่ bundle มาด้วย (`zod@4.6.5` core มี comment เรื่อง `@__PURE__`/dynamic code ใน build log
  ที่อาจเกี่ยวกับ `eval`/`new Function`; `hyparquet-compressors`/`minisearch` ยังไม่ตรวจ)
- ต้องหาว่า violation เกิดตอน **DuckDB init** (prefetch หลังใส่ key) หรือตอน **query จริงครั้งแรก** — ยังไม่
  แยกละเอียด (ต้องดู stack trace ของ violation ซึ่ง `securitypolicyviolation` event ไม่ให้ stack มา ต้องเปิด
  DevTools Sources → breakpoint on CSP violation ด้วยมือ)

### ผลกระทบถ้าไม่แก้
- Deploy จริงบน GitHub Pages (CSP มีผลจริงเหมือนที่ทดสอบนี่พอดี เพราะไม่มี server ตั้ง header เอง — เป็น meta
  tag เดียวกัน) ผู้ใช้ทุกคนจะเจอ CSP violation ใน console ทุก session ที่ใช้แชท/citation — ไม่กระทบ UX ที่สังเกต
  ได้ตอนนี้ (มี fallback) แต่เป็นความเสี่ยงเงียบที่ควรปิดก่อน release (07-TESTING.md/09-SECURITY.md ระบุ "ไม่มี
  CSP violation" เป็นเกณฑ์ผ่านของ Phase 3/6 ตรง ๆ)

### ไฟล์ที่น่าจะเกี่ยว
- `web/vite-plugins/cspMeta.ts` (นโยบาย CSP)
- `web/src/data/duckdb.ts` (จุดเรียก DuckDB-WASM)
- `node_modules/@duckdb/duckdb-wasm` (ต้นตอที่น่าจะเป็นจริง — ต้องตรวจว่ามีตัวเลือก config ปิด fallback นี้
  หรือเปลี่ยนวิธี instantiate ได้ไหม เช่น `MANUAL_INSTANTIATION`/`instantiateWasm` callback)

### สถานะใน test suite
ไม่ได้ block `web/tests/e2e/happy-path.spec.ts` (soft-report ผ่าน `console.warn` + comment อ้างอิง B-001 นี้
แทนการ assert เป็น `[]` ตรง ๆ — ดูเหตุผลในไฟล์ตรงจุดนั้น) เพื่อไม่ให้ suite ทั้งชุดแดงจากบั๊กที่ qa-engineer
แก้เองไม่ได้ (อยู่นอกขอบเขตงาน T-409 ที่ห้ามแก้ `web/src/**`) — **แนะนำให้เปิด task แยกสำหรับแก้ B-001 แล้วเปลี่ยน
บรรทัดนั้นกลับเป็น `expect(audit.cspViolations()).toEqual([])` เมื่อแก้เสร็จ**


---

## B-002 — ค้นเอกสารคืนไฟล์ระบบ (`.DS_Store`, kind "other") ปนกับเอกสารจริง

- **สถานะ**: **ปิดแล้ว (2569-09-21)** · **Severity**: low · **ประเภท**: data/UX · พบโดย main thread ระหว่าง QA B5
- **ข้อเท็จจริง**: `sources.json` มี 1 รายการที่เป็น `.DS_Store` (โฟลเดอร์ย่อยของ "งบประมาณ สมุทรปราการ") — **เป็นไปตามที่ออกแบบ** (`pipeline/tgbp_pipeline/inventory.py` ลงทะเบียนทุกไฟล์ + มี test `test_detect_kind_ds_store_is_other`) ไฟล์จริงบนดิสก์ครบทุกไฟล์ใน json (B5 ผ่านเมื่อไม่นับ `.DS_Store` ตามที่ 08 §B5 ระบุ)
- **บั๊กจริง**: `web/src/data/documents.ts#matchesDocFilters` ไม่กรอง kind "other" → `find_documents` อาจคืนไฟล์ระบบให้โมเดล/ผู้ใช้
- **แก้**: ไม่คืน kind "other" เว้นแต่ขอ kind นั้นตรง ๆ (ไม่ต้อง republish ข้อมูล; `data_version` ไม่เปลี่ยน)
