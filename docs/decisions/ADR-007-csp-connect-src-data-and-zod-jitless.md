# ADR-007 — CSP: อนุญาต `data:` ใน `connect-src` และปิด JIT ของ Zod (ปิด B-001)

- สถานะ: ยอมรับ (2569-09-21) · ผู้ตัดสิน: main thread · ทบทวนโดย `security-reviewer` ใน T-602 (NEW-M1, §4): "ยอมรับได้สำหรับ MVP — ไม่กระทบ N5 — ควรมี ADR + แผนถอดออก"
- เบี่ยงจาก: `docs/04-ARCHITECTURE.md` §D8 และ `docs/09-SECURITY.md` §2 (เดิม `connect-src 'self' https://api.anthropic.com`)
- **ลำดับที่เกิดจริง**: โค้ดถูกแก้ก่อนมี ADR (`715f520`, เร่ง deploy สำหรับ demo) — ขัด CLAUDE.md §6 ข้อ 4; ADR นี้เขียนย้อนหลังและบันทึกไว้ตรง ๆ

## บริบท
e2e T-409 (production build จริง + CSP meta จริง) พบ CSP violation ทุก session (B-001): `script-src` บล็อก eval ×3 และ `connect-src` บล็อก `fetch('data:application/octet-stream;base64,AGFzbQ…')` รายงานแรกเดาว่าเป็น DuckDB — main thread ไล่จาก bundle แล้วพบต้นตอจริง:
1. **eval ×3** = Zod 4 ตรวจว่า runtime ใช้ JIT ได้ไหมด้วย `new Function("")` ใน try/catch (`zod/v4/core/util.js#allowsEval`) — ถูกบล็อก ถูกจับ แล้ว fallback เอง แต่ browser ยังนับเป็น violation
2. **`data:`** = yoga-layout ใน `@react-pdf/renderer@4.9.0` ฝัง wasm เป็น base64 data URI แล้วโหลดด้วย `fetch()` ตอน export PDF — ถูกบล็อกแล้ว fallback ไป decode เอง

## การตัดสินใจ
1. `web/src/lib/zodConfig.ts`: `z.config({ jitless: true })` และ import เป็นอย่างแรกใน `main.tsx` → ไม่มี probe, ไม่มี violation · **ไม่เปิด `'unsafe-eval'`**
2. `web/vite-plugins/cspMeta.ts`: `connect-src 'self' data: https://api.anthropic.com` — เฉพาะ directive นี้ directive อื่นไม่ขยาย
3. e2e `happy-path.spec.ts` บังคับ `cspViolations() == []` ตลอด flow (เดิมแค่เตือน)

## เหตุผล
- `data:` URI บรรจุข้อมูลในตัว URL เอง **ไม่มีปลายทางเครือข่าย** → ใช้ส่งข้อมูลออกนอกเครื่องไม่ได้; N5 ("ห้าม fetch ข้าม origin นอกจาก api.anthropic.com") ยังเป็นจริงทุกประการ
- ไม่เพิ่ม capability: `script-src 'wasm-unsafe-eval'` อนุญาต `WebAssembly.instantiate(ArrayBuffer)` อยู่แล้ว
- เกณฑ์ C3 ของ 09 §5 ("ไม่มี CSP violation") สำคัญในฐานะ **tripwire** — ถ้าปล่อยให้มี violation "ที่รู้ว่าไม่เป็นไร" ค้างทุก session violation จริงตัวถัดไปจะจมหาย
- ทางเลือกที่ไม่เลือก: `'unsafe-eval'` (เปิดช่อง XSS→code exec), `blob:` (เป็น URL ที่มี origin จริง แย่กว่า), ปิด CSP ตอน export

## ผลที่ตามมา / ความเสี่ยงคงเหลือ
- **เสีย tripwire ของ `data:`**: dependency ใหม่ที่ `fetch(data:…)` จะไม่ขึ้น violation อีก — bundle ปัจจุบันมีจุดที่อ้าง `data:application` 2 แห่ง (react-pdf = ใช้จริง, worker ของ DuckDB = โค้ด emscripten ที่ไม่ถูกเรียก)
- `eval`/`new Function` ใน worker ของ DuckDB (EM_ASM/EM_JS ของ side module, apache-arrow) **ไม่ถูกเรียก** ในการใช้งานจริง (e2e query parquet จริงแล้ว violation = 0) — ถ้าวันหนึ่งถูกเรียกจะถูกบล็อกและ query นั้นล้ม: ให้แก้ที่ต้นเหตุ **ห้ามเติม `'unsafe-eval'`**
- Zod jitless ทำให้ parse object ช้าลงเล็กน้อย — ไม่มีนัยสำคัญกับ payload ของเรา (proposal ≤ 200 บรรทัด)

## เงื่อนไขถอด `data:` ออก (post-MVP — BACKLOG)
ทำได้เมื่ออย่างใดอย่างหนึ่งเป็นจริง: (1) Vite plugin ของเราแทน `fetch(<dataURI>)` ของ yoga ด้วย `WebAssembly.instantiate(bytes)` โดยมี `ProposalDocument.test.tsx` คุม (2) `@react-pdf/renderer`/`yoga-layout` รุ่นใหม่ใช้ `wasmBinary`/`instantiateWasm` แล้ว — ถอดแล้ว e2e ต้องยัง `cspViolations() == []`
