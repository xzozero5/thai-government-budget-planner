# TGBP validation report

สร้างเมื่อ: 2026-09-19T15:51:59.164960+00:00

## สถานะรวม: **PASS**

### สถานะที่ต้องรู้ (ไม่ทำให้ fail แต่สำคัญ)

- V1 PBO 2562: source_incomplete
- V1 PBO 2567: no_oracle
- V9 committee_table: org_unmapped 62.6% (>= 5.0%)
- V9 local_ordinance_2570: org_unmapped 13.0% (>= 5.0%)

## V1 — PBO oracle ต่อปี

| ปี | status | passed |
|---|---|---|
| 2558 | ok | True |
| 2559 | ok | True |
| 2560 | ok | True |
| 2561 | ok | True |
| 2562 | source_incomplete | False |
| 2563 | ok | True |
| 2564 | ok | True |
| 2565 | ok | True |
| 2566 | ok | True |
| 2567 | no_oracle | True |
| 2568 | ok | True |

## V2 — act2570 A3 subset

| rel_path | format | status |
|---|---|---|
| `งบประมาณ สมุทรปราการ/1 - งบฟังก์ชันที่มาลงในสมุทรปราการ/ร่าง พ.ร.บ. งบ 2570 เฉพาะส่วนราชการที่มีรายการในสมุทรปราการ - Excel.xlsx` | B | no_oracle |
| `งบประมาณ สมุทรปราการ/2 - งบ อบจ. สมุทรปราการ/ร่าง พ.ร.บ. งบ 2570 เฉพาะเงินอุดหนุน อบจ. สมุทรปราการ - Excel.xlsx` | B | no_oracle |
| `งบประมาณ เชียงใหม่/1 - งบฟังก์ชันที่มาลงในเชียงใหม่/ร่าง พ.ร.บ. งบ 2570 เฉพาะส่วนราชการที่มีรายการในเชียงใหม่ - Excel.xlsx` | A | ok |
| `งบประมาณ เชียงใหม่/2 - งบ อบจ. เชียงใหม่/ร่าง พ.ร.บ. งบ 2570 เฉพาะเงินอุดหนุน อบจ. เชียงใหม่ - Excel.xlsx` | B | no_oracle |
| `งบประมาณ เชียงใหม่/3 - งบเทศบาลนครเชียงใหม่/ร่าง พ.ร.บ. งบ 2570 เฉพาะเงินอุดหนุน ทน. เชียงใหม่ - Excel.xlsx` | B | no_oracle |
| `งบประมาณ เชียงใหม่/4 - งบเงินอุดหนุนเทศบาล + อบต. ในเชียงใหม่/ร่าง พ.ร.บ. งบ 2570 เฉพาะเงินอุดหนุนเทศบาลในเชียงใหม่ - Excel.xlsx` | B | no_oracle |

## V3 — ราชาเทวะ (ADR-005)

| rel_path | status | diff_pct | n_group_mismatches |
|---|---|---|---|
| `งบประมาณ สมุทรปราการ/3 - งบ อบต. ราชาเทวะ/ร่างข้อบัญญัติงบ 2570 อบต. ราชาเทวะ - Sheets.xlsx` | ok | 0.21% | 10 |

## V4 — source_id unique ต่อ dataset

| dataset | n_rows | n_unique | passed |
|---|---|---|---|
| act_2570_draft | 96,470 | 96,470 | True |
| act_2570_province | 730 | 730 | True |
| committee_table | 3,325 | 3,325 | True |
| local_ordinance_2570 | 2,646 | 2,646 | True |
| local_subsidy_2570 | 2,720 | 2,720 | True |
| pbo_disbursement | 2,887,730 | 2,887,730 | True |

## V5 — source_doc_id ⊆ sources.json: ok (2,993,621 แถวตรวจ)

## V7 — fiscal_year_be ต่อ dataset

| dataset | n_rows | out_of_range | null_disallowed | passed |
|---|---|---|---|---|
| act_2570_draft | 96,470 | 0 | 0 | True |
| act_2570_province | 730 | 0 | 0 | True |
| committee_table | 3,325 | 0 | 0 | True |
| local_ordinance_2570 | 2,646 | 0 | 0 | True |
| local_subsidy_2570 | 2,720 | 0 | 0 | True |
| pbo_disbursement | 2,887,730 | 0 | 0 | True |

## V6 — ไม่มีไฟล์ output > 24 MB: PASS (795 ไฟล์ตรวจ)

## รวมขนาด web/public/data/: 180,555,250 bytes (เพดาน 500,000,000)

## V8 — unit_price outlier (soft): 1 แถว จาก 45,584 item_key

## V9 — % org_unmapped ต่อ dataset (soft)

| dataset | n_rows | n_unmapped | pct |
|---|---|---|---|
| act_2570_draft | 96,470 | 0 | 0.00% |
| act_2570_province | 730 | 0 | 0.00% |
| committee_table | 3,325 | 2,080 | 62.56% |
| local_ordinance_2570 | 2,646 | 345 | 13.04% |
| local_subsidy_2570 | 2,720 | 0 | 0.00% |
| pbo_disbursement | 2,887,730 | 117,193 | 4.06% |

## V10 — PDF raw vs sources.json: ok (raw=262, sources=262)

## สถิติ field ต่อ dataset (DoD 03 §9 ข้อ 3)

| dataset | n_rows | org mapped | qty parsed | unit_price | province |
|---|---|---|---|---|---|
| act_2570_draft | 96,470 | 96,470 (100.0%) | 10,929 (11.3%) | 8,487 (8.8%) | 18,080 (18.7%) |
| act_2570_province | 730 | 155 (21.2%) | 51 (7.0%) | 6 (0.8%) | 730 (100.0%) |
| committee_table | 3,325 | 1,245 (37.4%) | 314 (9.4%) | 309 (9.3%) | 3,325 (100.0%) |
| local_ordinance_2570 | 2,646 | 2,301 (87.0%) | 4 (0.2%) | 76 (2.9%) | 2,646 (100.0%) |
| local_subsidy_2570 | 2,720 | 2,720 (100.0%) | 319 (11.7%) | 319 (11.7%) | 2,720 (100.0%) |
| pbo_disbursement | 2,887,730 | 2,770,537 (95.9%) | 461,831 (16.0%) | 85,864 (3.0%) | 2,213,488 (76.7%) |

## PDF text layer / extracted (จาก sources.json)

รวม PDF: 262 | มี text layer: 119 | ไม่มี text layer: 143 | extracted: 119 | ไม่ extracted: 143

