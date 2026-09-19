# งบการใช้ Anthropic API (เครดิตรวม **5 USD** — คุณนิว 20 ก.ย. 2569: "ใช้อย่างประหยัด")

Key อยู่ที่ `web/.env.local` (`VITE_EVAL_ANTHROPIC_API_KEY`; gitignored + pre-commit hook กัน `sk-ant-`). **ห้าม** print/log/เขียนค่า key ลงไฟล์ใด ๆ; อ่านฝั่ง Node เท่านั้น — ห้ามอ้าง `import.meta.env.VITE_EVAL_*` ในโค้ดที่ถูก bundle (Vite จะ inline ลง JS)

## การจัดสรร (เพดานแข็ง — เกินต้องหยุดและรายงาน)
| งาน | เพดาน | วิธีประหยัด |
|---|---|---|
| Phase 2 — spike S3 (SDK ใน browser) | 0.10 | Haiku 4.5, `max_tokens` ≤ 300, ≤ 8 requests, web search ≤ 1 ครั้ง |
| Phase 2 — spike S5 (SVG) | 0.30 | 3 โจทย์ (Sonnet 2 + Haiku 1), โจทย์ละ 1 ครั้ง, `max_tokens` ≤ 4,000 |
| Phase 3 — พัฒนา agent loop/tools | 0.00 | **SDK mocked ทั้งหมด** (unit test) — ไม่เรียก API จริง |
| Phase 3 — eval รอบแรก (T-306) | 1.80 | subset 8 โจทย์จาก 20 (รวมเคสบังคับ 4 เคสจาก T-113), Haiku 4.5 เป็นหลัก + Sonnet 2 โจทย์, prompt caching, tool result ≤ 20 แถว, `max_tokens` จำกัด, judge แบบ rule-based (ไม่ใช้ LLM judge) |
| Phase 3 — แก้ prompt แล้วรันซ้ำ (T-308) | 0.80 | เฉพาะโจทย์ที่ตก |
| Phase 6 — eval รอบสุดท้าย (T-604) | 1.40 | 8 โจทย์ชุดเดิม + 2 โจทย์ใหม่ |
| สำรอง | 0.60 | |
| **รวม** | **5.00** | |

- eval ครบ 20 โจทย์ด้วย Sonnet ตามแผนเดิม (≈ 0.5 USD/proposal → ~10 USD) **เกินเครดิต** → ลดขอบเขตตามตาราง; โจทย์ที่ไม่ได้รันจริงให้ระบุใน `docs/eval-report.md` ว่า `not_run (budget)` — ถ้าต้องการรันครบ ต้องเติมเครดิต (`[ASK-HUMAN]` ข้อ 3)
- ทุก request ที่เรียกจริงต้องลง ledger (`web/spikes/api-spend.json`, ภายหลัง `web/tests/eval/api-spend.json`): model, tokens (in/out/cache), web_search_requests, est_cost_usd, แหล่งราคา + วันที่ตรวจ; ยอดสะสมสรุปใน `docs/STATUS.md`
- ราคาต่อ token: ledger ของ spike ใช้ราคาจาก `https://docs.claude.com/en/docs/about-claude/pricing` (ตรวจ 2026-09-20 โดย agent); main thread ยังไม่ได้ตรวจซ้ำเอง `[UNVERIFIED]` — ยอดจริงให้ยึดหน้า Console ของคุณนิว

## ยอดใช้สะสม
| วันที่ | งาน | ใช้จริง (USD) | สะสม |
|---|---|---|---|
| 2569-09-20 | Phase 2 spikes: S3 0.0500 (6 req, Haiku 4.5: streaming, tool loop, web_search ×1, cache write+read) + S5 0.0953 (3 SVG: `claude-sonnet-5` ×2, Haiku 4.5 ×1) — ledger `web/spikes/api-spend.json` | **0.1453** (เพดาน 0.40) | **0.1453** |
