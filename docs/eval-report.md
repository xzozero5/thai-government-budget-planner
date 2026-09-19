# T-306 Eval Report — REAL RUN (เรียก API จริง)

- วันที่: 2026-09-19T23:53:13.360Z
- Tier ที่รัน: core8 (case=equip-aircon-18000btu)
- Judge: **rule-based** (ADR-006 ข้อ 10 / docs/07-TESTING.md §4) — ไม่ใช่ LLM-as-judge รอบนี้
- commit: 22460c8

| case | model | สถานะ | auto_pass | turns | tool calls | citation precision | cost (USD) | cache hit % |
|---|---|---|---|---|---|---|---|---|
| equip-aircon-18000btu | claude-haiku-4-5-20251001 | run | FAIL | 2 | 8 | 1.00 | 0.1283 | 100 |
| equip-notebook-office | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| equip-truck-diesel-1ton | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| construction-road-concrete | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| construction-weir-low-specificity | claude-sonnet-5 | not_run (budget) | - | - | - | - | - | - |
| construction-sport-field | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| construction-building-3floor | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| training-vocational-program | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| it-system-document-management | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| local-tradition-festival | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| longtail-item-keyword-fallback | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| fiscal-year-2562-gap | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| unit-price-n1-total-station | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| no-data-informational-query | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| hallucination-lure-1997-price | claude-sonnet-5 | not_run (budget) | - | - | - | - | - | - |
| audit-aircon-price-check | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| audit-road-cost-per-km | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| equip-radio-communication | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| training-digital-literacy | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |
| local-water-supply-village | claude-haiku-4-5-20251001 | not_run (budget) | - | - | - | - | - | - |

**รวมค่าใช้จ่ายของ case ที่มีผลรันในรายงานนี้: 0.1283 USD** (โหมดจริงรวม transcript ของรอบก่อนใน `web/tests/eval/real-runs/` ด้วย — ยอดสะสมจริงดูที่ ledger)

## รายการ `not_run (budget)`
- equip-notebook-office (claude-haiku-4-5-20251001) — not_run (budget)
- equip-truck-diesel-1ton (claude-haiku-4-5-20251001) — not_run (budget)
- construction-road-concrete (claude-haiku-4-5-20251001) — not_run (budget)
- construction-weir-low-specificity (claude-sonnet-5) — not_run (budget)
- construction-sport-field (claude-haiku-4-5-20251001) — not_run (budget)
- construction-building-3floor (claude-haiku-4-5-20251001) — not_run (budget)
- training-vocational-program (claude-haiku-4-5-20251001) — not_run (budget)
- it-system-document-management (claude-haiku-4-5-20251001) — not_run (budget)
- local-tradition-festival (claude-haiku-4-5-20251001) — not_run (budget)
- longtail-item-keyword-fallback (claude-haiku-4-5-20251001) — not_run (budget)
- fiscal-year-2562-gap (claude-haiku-4-5-20251001) — not_run (budget)
- unit-price-n1-total-station (claude-haiku-4-5-20251001) — not_run (budget)
- no-data-informational-query (claude-haiku-4-5-20251001) — not_run (budget)
- hallucination-lure-1997-price (claude-sonnet-5) — not_run (budget)
- audit-aircon-price-check (claude-haiku-4-5-20251001) — not_run (budget)
- audit-road-cost-per-km (claude-haiku-4-5-20251001) — not_run (budget)
- equip-radio-communication (claude-haiku-4-5-20251001) — not_run (budget)
- training-digital-literacy (claude-haiku-4-5-20251001) — not_run (budget)
- local-water-supply-village (claude-haiku-4-5-20251001) — not_run (budget)

## เหตุผลที่ตก (เฉพาะ case ที่ auto_pass=false)
### equip-aircon-18000btu
- **min_boq_lines**: boq.length=0 (ต้องการ >= 1)
- **must_have_basis**: ไม่พบ basis: historical
- **must_cite_dataset**: ไม่พบ dataset ที่คาดไว้ (pbo_disbursement) ในผลลัพธ์ tool ใด ๆ ของ case นี้ (พบจริง: ไม่มีเลย)
- **grand_total_range**: ไม่มี proposal.totals.grand_total_thb ให้ตรวจ
- **cost_within_cap**: totalCostUsd=0.1283 USD (เพดานต่อ case: 0.1200 USD)

## หมายเหตุ
- รันจริงด้วย Anthropic API — ดูค่าใช้จ่ายสะสมทั้งหมดที่ `web/tests/eval/api-spend.json`
