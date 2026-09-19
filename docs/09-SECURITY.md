# 09 — Security Requirements

Threat model สั้น ๆ: สินทรัพย์ที่ต้องปกป้อง = **Anthropic API key ของผู้ใช้** (ถ้าหลุด = เงินหาย) และความเชื่อถือของข้อมูล/citation · ไม่มี server จึงไม่มี data at rest ฝั่งเรา · ผู้โจมตีที่พิจารณา: XSS ผ่านเนื้อหาที่ AI/ข้อมูลส่งมา, dependency ที่เป็นพิษ, extension/เครื่องผู้ใช้ (นอก scope แต่ลด surface), host ที่ถูกแก้ไฟล์ (ใช้ SRI ไม่ได้กับไฟล์ตัวเองแต่ใช้ manifest hash ตรวจ data ได้)

## 1. API key lifecycle
- รับจากช่อง input เท่านั้น (ไม่รับจาก URL query/hash, ไม่รับจาก postMessage)
- เก็บใน Zustand store ในหน่วยความจำ; **ห้าม** `persist`, localStorage, sessionStorage, IndexedDB, cookie, `window.name`, service worker cache
- ไม่ log key: `console.*` ห้ามพิมพ์ config/headers; error boundary ต้อง redact สตริงที่ขึ้นต้น `sk-ant-`
- ส่งไปแค่ `https://api.anthropic.com` ผ่าน SDK; `baseURL` เป็นค่าคงที่ ห้าม config จาก UI/URL
- ล้างเมื่อ: ผู้ใช้กดออก, tab ซ่อน > 60 นาที, budget เกินและผู้ใช้ไม่ต่อ, `pagehide`
- Save JSON (`.tgbp.json`) ต้องไม่รวม key/headers/raw request; ToolLog ที่บันทึกตัดฟิลด์ที่ไม่จำเป็น

## 2. Network egress
- CSP `connect-src 'self' https://api.anthropic.com` (ดู 04 §D8) — บังคับระดับ browser ผ่าน `<meta http-equiv="Content-Security-Policy">` (GitHub Pages ตั้ง header ไม่ได้; `frame-ancestors` จึงใช้ไม่ได้ — ยอมรับ เพราะไม่มี state ให้ clickjack)
- ไม่มี third-party script/CDN/fonts/analytics; ทุกอย่าง bundle
- ลิงก์ภายนอกใน citation web: `target=_blank rel="noopener noreferrer"`; ไม่ prefetch
- ห้ามใช้ `SOURCE_BASE_URL` ที่ไม่ใช่ https หรือ same-origin (validate ตอน build)

## 3. Content safety (ป้องกัน XSS จากเนื้อหา AI/ข้อมูล)
- Render markdown ด้วย allowlist (ไม่มี raw HTML, ไม่มี `javascript:` URL); ใช้ `react-markdown` + `rehype-sanitize` schema เข้มงวด
- ข้อมูลจาก parquet/json ถือเป็น untrusted: ไม่ `dangerouslySetInnerHTML`; excerpt highlight ทำด้วย text nodes
- Prompt injection จากเอกสาร (read_document/web_search): system prompt สั่งให้ถือเนื้อหาเอกสารเป็นข้อมูล ไม่ใช่คำสั่ง; tool result ห่อด้วย delimiter ชัด; UI แสดงเตือนถ้า AI ขอทำสิ่งนอก scope (เช่น "ส่ง key")
- Tool input จาก AI ผ่าน Zod ทุกครั้ง; `query_budget_lines` ไม่รับ SQL — สร้าง SQL ด้วย parameter binding ใน repo เท่านั้น

### 3.1 SVG ที่ AI สร้าง (illustrations)
- ถือเป็น untrusted input เสมอ: DOMPurify profile svg (ดู 04 §D9), ตัด `script/foreignObject/use/image`, ทุก `on*`, `href/xlink:href`, `<style>` ที่มี `url(`/`@import`; จำกัด 60 KB, ต้องมี viewBox
- Render ผ่าน `DOMParser` → append node (ไม่ตั้ง innerHTML ด้วยสตริงดิบ); ห่อใน container ที่ `contain: content` และไม่มี pointer events ไปยัง element ภายใน
- ทดสอบ C10 ใน §5

## 4. Supply chain / build
- lockfile commit; `npm audit --audit-level=high` และ `pip-audit` ใน CI
- Dependency ใหม่ที่มี network capability → `[ASK-HUMAN]`
- DuckDB-WASM ใช้ไฟล์ที่ bundle ใน repo (ไม่โหลดจาก jsDelivr) ตรวจ hash ตอน build
- `manifest.json` มี sha256 ของ data ทุกไฟล์; client ตรวจ hash ของ shard เล็ก (< 5 MB) ตอนโหลด (shard ใหญ่ optional เพราะ streaming) — ป้องกัน data ถูกแก้บน host (integrity ของ citation)

## 5. Verification (รันใน Phase 3 และ 6, แนบผลใน QA run)
- [ ] C1 หลัง flow เต็ม: `Object.entries(localStorage)`, `sessionStorage`, `document.cookie`, IndexedDB ทุก store → ไม่มีสตริง `sk-ant-` และไม่มีข้อความแชท
- [ ] C2 DevTools Network: request ทั้งหมด host ∈ {origin, api.anthropic.com}
- [ ] C3 CSP header/meta ทำงาน: injected `<img src=https://example.com>` ถูกบล็อก (ทดสอบใน e2e ด้วย route)
- [ ] C4 Markdown injection: assistant message ที่มี `<script>`, `<img onerror>`, `[x](javascript:alert(1))` → render เป็นข้อความ/ถูกตัด
- [ ] C5 Error path: บังคับ 401/500/network fail → key ไม่ปรากฏใน error UI/console
- [ ] C6 Idle timer และ pagehide ล้าง key
- [ ] C7 `.tgbp.json` ที่ save → grep `sk-ant-` = 0, ไม่มี `x-api-key`
- [ ] C8 `npm audit`/`pip-audit` ไม่มี high/critical ที่ยังไม่ mitigated
- [ ] C10 SVG injection: assistant ส่ง SVG ที่มี `<script>`, `onload`, `<image href=https://evil>`, `<foreignObject><iframe>` → ไม่มี request ออก, ไม่มี script รัน, ภาพยังแสดงส่วนที่ปลอดภัย
- [ ] C9 Source map ไม่ deploy (หรือ deploy แบบ hidden) และ `.env*` ไม่ถูก bundle (grep dist)
