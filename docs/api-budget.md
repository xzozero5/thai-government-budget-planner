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
| 2569-09-20 | T-306 eval จริง case แรก `equip-aircon-18000btu` (Haiku 4.5, 5 requests, ชนเพดาน case 0.12) — ledger `web/tests/eval/api-spend.json` | **0.1202** (เพดาน T-306 1.80) | **0.2655** |
| 2569-09-20 | T-308 รอบ 1 — รัน case เดิมซ้ำหลังลด token (Haiku 4.5, 7 requests, 2 turns เพราะโมเดลถามกลับก่อน) — **proposal ไม่ถูกบันทึกเพราะบั๊ก harness** (แก้แล้ว `97fa99e`) | **0.1283** | **0.3939** |

### ข้อค้นพบรอบ 2 (หลังลด token)
- prefix cache write 28.4k → **22.8k tokens** (−20 %); ต้นทุนต่อข้อบน Haiku ยัง ≈ **0.13 USD** เพราะ (ก) โมเดลถามกลับ 1 turn ทั้งที่โจทย์บอกให้ตั้งสมมติฐาน (ข) `emit_proposal` ≈ 7.5k output tokens (0.037 USD — ก้อนใหญ่สุด) (ค) ผล `query_budget_lines` ≈ 10k tokens
- เพดานต่อ case 0.12 ตึงเกินสำหรับ flow ครบ → ใช้ `--max-usd-per-case-haiku 0.15` ในรอบ core8 (Sonnet คง 0.35–0.40; ยอดรวมยังถูกบังคับด้วย ledger ≤ 1.80)
- ประมาณการสำหรับผู้ใช้จริง: **Haiku ≈ 0.13 USD/ข้อเสนอ, Sonnet 5 ≈ 0.4 USD/ข้อเสนอ** `[UNVERIFIED — Sonnet ยังไม่ได้วัดจริง คูณจากอัตราราคา 3 เท่า]` → ต้องแสดงในหน้า KeyGate/Settings

### ข้อค้นพบด้านต้นทุนจาก case แรก (2569-09-20)
- prefix system+tools ≈ **28.4k tokens** ต่อ session (cache write ครั้งแรก; Haiku ≈ 0.037 USD, Sonnet 5 ≈ 3 เท่า) — ภาษาไทย ≈ 0.9 token/ตัวอักษร
- ผล `search_catalog`/`query_budget_lines` รอบละ ≈ 10k tokens; `emit_proposal` ≈ 6.4k output tokens
- ด้วยขนาดนี้ core8 ตามแผน (6 Haiku + 2 Sonnet) จะชนเพดานต่อ case เกือบทุกข้อ → **หยุดใช้เงินจนกว่าจะลด token** (T-308 รอบ 1: ย่อ prompt/schema/ผล tool) แล้ววัดใหม่ด้วย case เดิม 1 ข้อก่อนปล่อยที่เหลือ
- ผู้ใช้จริงจ่ายด้วย key ตัวเอง — ต้นทุนต่อข้อเสนอเป็นคุณสมบัติของผลิตภัณฑ์ ไม่ใช่แค่เรื่อง eval
