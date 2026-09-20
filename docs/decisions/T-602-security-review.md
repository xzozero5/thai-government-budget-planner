# T-602 — Security review รอบ Phase 6 (09-SECURITY §5 C1–C10)

ผู้ทบทวน: agent `security-reviewer` (read-only) · 2569-09-21 · ฐานที่ตรวจ: HEAD `2092521`
รันจริง: `npm audit --omit=dev` (0 vulnerabilities), vitest 37 ไฟล์/340 tests, Playwright 17 tests บน production build (port 4181), grep `dist/assets/*.js`
main thread ย่อจากรายงานเต็ม + ใส่สถานะการแก้ (`[ ]` ยังไม่แก้ / `[x]` แก้แล้ว)

## 1. Checklist
| # | สถานะ | หลักฐานย่อ |
|---|---|---|
| C1 storage | ผ่าน (รันจริง) | e2e dump localStorage/sessionStorage/cookie/IndexedDB/history.state/hash → ไม่มี key ทั้งก่อน/หลัง reload; unit spy Storage API = 0 ครั้ง |
| C2 egress | ผ่าน (รันจริง) | `foreignOriginRequests() == []` ตลอด flow เต็ม (DuckDB + query + export PDF จริง) |
| C3 CSP | ผ่าน (รันจริง) | `cspViolations() == []` → B-001 ปิดจริงทั้งส่วน eval (Zod jitless) และ `data:` (yoga ของ react-pdf) |
| C4 XSS | ผ่าน | ไม่มี markdown renderer; ทุกอย่างจากโมเดลเป็น text node + มี test |
| C5 error ไม่รั่ว key | ผ่านบางส่วน | error paths 4 เคส + redact ผ่าน แต่ **ไม่มี error boundary** → NEW-H1 |
| C6 idle/pagehide | ผ่าน (unit) | ไม่มี e2e → NEW-L6 |
| C7 `.tgbp.json` | ผ่าน | whitelist ทีละ field + `.strict()` + ตรวจขนาดก่อน parse |
| C8 supply chain | ผ่านบางส่วน | npm audit 0 + อยู่ใน CI; **pip-audit ยังไม่มี** → NEW-M3 |
| C9 bundle สะอาด | ผ่าน | ไม่มี `.map`/`VITE_`/harness/สตริงรูป key จริง; ยังไม่มี step ใน CI → NEW-L3 |
| C10 SVG | ผ่าน (Chromium จริง) | 10 เคสโจมตีผ่านพร้อมนับ request |

## 2. Finding รอบ T-307
H1 ปิด (key/client อยู่ใน module scope ของ `keyHolder`; dynamic import ใหม่ไม่ทำให้ key หลุด — เหลือ race เล็ก → NEW-L1) · H2 ปิด · M1 ปิดด้วย escaping (nonce ต่อสายแล้วแต่ไม่ได้ประกาศใน system prompt → NEW-L2) · M2, M3, M4, M6, M7 ปิด · M5 ปิดบางส่วน (NEW-M3, NEW-L3) · L1 เปิดบางส่วน (NEW-L5) · L2, L3 ปิด · L6 เปิดแต่ mitigate ด้วย CI grep dist (NEW-L10)

## 3. Finding ใหม่
### HIGH
- [ ] **NEW-H1 ไม่มี React error boundary ทั้ง repo** — error ระหว่าง render จากข้อมูลที่ผู้โจมตีคุมได้ (ไฟล์ `.tgbp.json`, ค่าจากโมเดล) ทำให้ทั้งแท็บขาว + React log error ดิบโดยไม่ผ่าน `redactSecrets` · repro (ยืนยันจากโค้ด + primitive ใน node): `.tgbp.json` ที่ `proposalVersions[0].createdAt = 1e16` ผ่าน schema (`z.number()` ไม่มีขอบเขต) → `formatThaiBuddhistDate(new Date(1e16))` โยน `RangeError` ระหว่าง render · แก้: `app/AppErrorBoundary` ครอบ Routes (redact ก่อนแสดง/log) + boundary ย่อยรอบ ProposalPane ใน LoadPage/workspace + จำกัดช่วง `createdAt` + e2e

### MEDIUM
- [ ] **NEW-M1** `connect-src data:` ขัดกับ 04 §D8 / 09 §2 โดยไม่มี ADR → เขียน ADR + sync เอกสาร
- [ ] **NEW-M2** กฎ ESLint กัน HTML injection แคบไป: ไม่จับ `insertAdjacentHTML`, `document.write`, `srcdoc`, `createContextualFragment`, `dangerouslySetInnerHTML` แบบ object property, `new Function`, `eval`; ควรจำกัด `new DOMParser()` เฉพาะ `src/lib/svgSanitizer.ts`
- [ ] **NEW-M3** pip-audit ยังไม่มีใน CI (สถานะ dependency ฝั่ง Python = ยังไม่ยืนยัน)
- [ ] **NEW-M4** prompt injection ผ่านข้อความที่ UI ฉีดเข้า user role: `citation.web.rejectRequest` ใส่ **URL เต็ม** จากผลค้นเว็บ, ข้อความขอภาพใหม่ใส่ `illustrationRef.title` → ส่งเฉพาะ host / ตัดความยาว + strip newline ด้วย helper เดียว (ประเมิน ไม่ได้ทดลองกับโมเดลจริง; blast radius = ข้อเสนอเพี้ยน)
- [ ] **NEW-M5** ตัวตรวจ https 3 แบบไม่เท่ากัน (`citationLabel.isHttpsUrl` ไม่ปฏิเสธ userinfo และ `CitationChip` render `<a>` เอง; PDF ใช้ `startsWith('https://')`) + ไฟล์ `.tgbp.json` ที่โหลดมาไม่ผ่านด่าน https ของ validator → รวมเป็นฟังก์ชันกลางใน `@/lib` + กรอง URL ตอน parse ไฟล์

### LOW
- [ ] NEW-L1 `submitKey`: `clearKey()` ระหว่างรอ dynamic import ถูกเขียนทับ; import reject → `keyStatus` ค้าง `verifying` → generation counter + try/catch
- [ ] NEW-L2 nonce ไม่ถูกประกาศใน system prompt → ประกาศในบล็อกไม่ cache หรือบันทึกว่า escaping พอ
- [ ] NEW-L3 CI ไม่มี step ตรวจ dist (`*.map`, `sourceMappingURL`, สตริงรูป key)
- [ ] NEW-L4 action ของ third party (`astral-sh/setup-uv`) ไม่ได้ pin SHA
- [ ] NEW-L5 copy ยังไม่แนะนำ "ใช้ key จาก workspace แยกที่ตั้ง spend limit"
- [ ] NEW-L6 `touchActivity()` ถูกเรียกเฉพาะตอนส่งข้อความ → ผู้ใช้ที่แก้ BOQ/อ่าน 60 นาทีถูกล้าง key (พลาดไปทางปลอดภัย); ไม่มี e2e idle/bfcache
- [ ] NEW-L7 `svgToPng`: ขนาด canvas มาจาก viewBox ของโมเดลโดยไม่มีเพดาน → clamp ≤ 4000 px
- [ ] NEW-L8 `/load` ปุ่มบันทึกเขียน `rawText` ดิบกลับออกไป → re-serialize จากข้อมูลที่ parse แล้ว
- [ ] NEW-L9 โฟลเดอร์ว่างจากคำสั่งพิมพ์ผิด `web/srcfeaturesabout/`, `web/srcfeatureskeygate/`
- [ ] NEW-L10 ESLint ยังไม่ห้าม import `@/ai/testing/*` จากโค้ด production (mitigate ด้วย CI grep)

## 4. ความเห็นเรื่อง `connect-src data:`
ยอมรับได้สำหรับ MVP และไม่กระทบ N5: `data:` URI ไม่มีปลายทางเครือข่าย (exfiltration = 0) และ `wasm-unsafe-eval` อนุญาต instantiate จาก ArrayBuffer อยู่แล้วจึงไม่ได้เพิ่ม capability — ราคาที่จ่ายคือ **เสีย tripwire** (dependency ใหม่ที่ fetch `data:` จะไม่ขึ้น violation) · bundle ปัจจุบันมีจุดแตะ `data:application` 2 แห่ง: react-pdf (yoga wasm — ต้นตอ B-001 ข) และ worker ของ DuckDB (โค้ด emscripten ที่ไม่ถูกใช้) · `eval`/`new Function` ใน worker ของ DuckDB (EM_ASM/EM_JS, apache-arrow) **ไม่ถูกเรียก** ในการใช้งานจริง (ยืนยันจาก e2e: query parquet จริงแล้ว violation = 0) — ถ้าวันหนึ่งถูกเรียกจะถูกบล็อก **ห้ามแก้ด้วย `'unsafe-eval'`**
ทางเลือกที่ดีกว่า (ภายหลัง): (1) Vite plugin แทน `fetch(dataURI)` ของ yoga ด้วย `WebAssembly.instantiate(bytes)` แล้วถอด `data:` (2) รออัปสตรีม (3) คงไว้ + ADR + CI allowlist ของไฟล์ที่อ้าง `data:application`

## 5. สิ่งที่ไม่ได้ตรวจ
ไม่ได้เรียก API จริง · ไม่ได้ build ใหม่ (ใช้ `dist` ของ HEAD `2092521`) → ต้อง grep dist ซ้ำหลังงานขนานปิด · ไม่ได้รัน vitest ทั้ง suite/lint/typecheck · ไม่ได้รัน project `chromium-data` · pipeline (Python) และ pip-audit ไม่ได้ตรวจ · NEW-H1 ยังไม่ได้ repro บนเบราว์เซอร์จริง · NEW-M4 เป็นการประเมิน · ไม่ได้ทบทวน `svgSanitizer.ts` ซ้ำ, `web/spikes`, `web/scripts`, `run-eval.mjs`
