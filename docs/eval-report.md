# T-306 Eval Report — REAL RUN (เรียก API จริง)

- วันที่: 2026-09-20T11:14:42.205Z
- Tier ที่รัน: core8
- Judge: **rule-based** (ADR-006 ข้อ 10 / docs/07-TESTING.md §4) — ไม่ใช่ LLM-as-judge รอบนี้
- commit: e287afe

| case | model | สถานะ | auto_pass | turns | tool calls | citation precision | cost (USD) | cache hit % |
|---|---|---|---|---|---|---|---|---|
| equip-aircon-18000btu | claude-haiku-4-5-20251001 | run | PASS | 2 | 14 | 0.50 | 0.1827 | 100 |
| equip-notebook-office | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| equip-truck-diesel-1ton | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| construction-road-concrete | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| construction-weir-low-specificity | claude-sonnet-5 | run | PASS | 1 | 15 | 1.00 | 0.3983 | 100 |
| construction-sport-field | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| construction-building-3floor | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| training-vocational-program | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| it-system-document-management | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| local-tradition-festival | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| longtail-item-keyword-fallback | claude-haiku-4-5-20251001 | run | PASS | 2 | 12 | 0.00 | 0.2023 | 100 |
| fiscal-year-2562-gap | claude-haiku-4-5-20251001 | run | FAIL | 2 | 18 | 0.90 | 0.2219 | 100 |
| unit-price-n1-total-station | claude-haiku-4-5-20251001 | run | FAIL | 2 | 16 | 1.00 | 0.1418 | 100 |
| no-data-informational-query | claude-haiku-4-5-20251001 | run | PASS | 2 | 0 | 1.00 | 0.0091 | 100 |
| hallucination-lure-1997-price | claude-sonnet-5 | not_run (budget) | - | - | - | - | - | - |
| audit-aircon-price-check | claude-haiku-4-5-20251001 | run | FAIL | 2 | 11 | 0.83 | 0.1913 | 100 |
| audit-road-cost-per-km | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| equip-radio-communication | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| training-digital-literacy | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| local-water-supply-village | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |

**รวมค่าใช้จ่ายของ case ที่มีผลรันในรายงานนี้: 1.3473 USD** (โหมดจริงรวม transcript ของรอบก่อนใน `web/tests/eval/real-runs/` ด้วย — ยอดสะสมจริงดูที่ ledger)

## รายการ `not_run (budget)`
- equip-notebook-office (claude-haiku-4-5-20251001) — not_run (budget)
- equip-truck-diesel-1ton (claude-haiku-4-5-20251001) — not_run (budget)
- construction-road-concrete (claude-haiku-4-5-20251001) — not_run (budget)
- construction-sport-field (claude-haiku-4-5-20251001) — not_run (budget)
- construction-building-3floor (claude-haiku-4-5-20251001) — not_run (budget)
- training-vocational-program (claude-haiku-4-5-20251001) — not_run (budget)
- it-system-document-management (claude-haiku-4-5-20251001) — not_run (budget)
- local-tradition-festival (claude-haiku-4-5-20251001) — not_run (budget)
- hallucination-lure-1997-price (claude-sonnet-5) — not_run (budget)
- audit-road-cost-per-km (claude-haiku-4-5-20251001) — not_run (budget)
- equip-radio-communication (claude-haiku-4-5-20251001) — not_run (budget)
- training-digital-literacy (claude-haiku-4-5-20251001) — not_run (budget)
- local-water-supply-village (claude-haiku-4-5-20251001) — not_run (budget)

## เหตุผลที่ตก (เฉพาะ case ที่ auto_pass=false)
### fiscal-year-2562-gap
- **must_cite_dataset**: ไม่พบ dataset ที่คาดไว้ (pbo_disbursement) ในผลลัพธ์ tool ใด ๆ ของ case นี้ (พบจริง: ไม่มีเลย)
- **cost_within_cap**: totalCostUsd=0.2219 USD (เพดานต่อ case: 0.2200 USD)

### unit-price-n1-total-station
- **min_boq_lines**: boq.length=0 (ต้องการ >= 1)
- **must_have_basis**: ไม่พบ basis: historical

### audit-aircon-price-check
- **must_have_basis**: ไม่พบ basis: historical

## หมายเหตุ
- รันจริงด้วย Anthropic API — ดูค่าใช้จ่ายสะสมทั้งหมดที่ `web/tests/eval/api-spend.json`
