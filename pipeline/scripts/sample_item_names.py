"""T-103: สร้างชุดตัวอย่าง `ชื่อรหัสงบประมาณ` จริงจาก `PBO/2566.xlsx` สำหรับ label เป็น fixture

อ่านสด (streaming, `openpyxl` `read_only`) จาก sheet ที่ชื่อขึ้นต้น `เบิกจ่ายภาพรวมทุกมิติ` (03 §4.1)
เก็บเฉพาะ `source_row` (เลขแถว Excel จริง), `budget_type` (คอลัมน์ `งบรายจ่าย`, index 7),
`item_name` (คอลัมน์ `ชื่อรหัสงบประมาณ`, index 9) — ข้ามแถว Grand Total ด้วยการตรวจเนื้อหา
(ปี 2566 มีแถว Grand Total ที่แถว 2 — ดู `docs/02-DATA-INVENTORY.md` §A1) ไม่ใช่ตรวจเลขแถว

สุ่มแบบ **stratified ตาม `budget_type`** ด้วย seed คงที่ (`--seed`, default 42) น้ำหนักเริ่มต้นเน้น
`งบลงทุน` (ครุภัณฑ์/สิ่งก่อสร้าง) ≥ 60% ของกลุ่มตัวอย่าง ตามที่ 03 §5 ข้อ 2 ระบุว่าเป็นเป้าหมายหลัก
ของการเทียบราคา — สัดส่วนที่เหลือกระจายไปยัง budget_type อื่นเพื่อความหลากหลาย

หมายเหตุสำคัญ: สคริปต์นี้เก็บ **เฉพาะ raw/source_row/budget_type** เท่านั้น — **ไม่แตะ**
field `expected` ใด ๆ (province/amphoe/tambon/qty/unit/spec_tokens/item_key_contains/...)
เพราะฟิลด์เหล่านั้นต้อง label โดยคนอ่านชื่อจริงทีละรายการ
(ห้าม label ด้วย output ของ `item_parser.py` เอง มิฉะนั้นจะเป็น circular test —
ดู 03 §5 ข้อ 2 และ backlog ของ T-103) `pipeline/tests/fixtures/item_names.yaml` ที่ commit จริง
จึงเป็นไฟล์ที่เขียนทับผลลัพธ์ของสคริปต์นี้ด้วยมือ (เพิ่ม `expected` ต่อเคส)

ใช้งาน:
    PYTHONUTF8=1 python -m uv run python scripts/sample_item_names.py --n 200 --seed 42
"""

from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

import openpyxl
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tgbp_pipeline.config import load_config  # noqa: E402

SHEET_PREFIX = "เบิกจ่ายภาพรวมทุกมิติ"
BUDGET_TYPE_COL = 7  # 0-based index ของคอลัมน์ "งบรายจ่าย" (22 คอลัมน์แรก — 03 §4.1)
ITEM_NAME_COL = 9  # 0-based index ของคอลัมน์ "ชื่อรหัสงบประมาณ"
MAX_COL = 22

# น้ำหนักต่อ budget_type สำหรับ n=200 (เน้นงบลงทุน ≥ 60% ตามที่ระบุใน backlog T-103)
# ปรับสัดส่วนตาม n จริงถ้า --n ไม่ใช่ 200 (คำนวณสัดส่วนคงที่จากตารางนี้)
_STRATA_WEIGHTS: dict[str, float] = {
    "งบลงทุน": 0.65,
    "งบอุดหนุน": 0.15,
    "งบดำเนินงาน": 0.10,
    "งบรายจ่ายอื่น": 0.06,
    "งบบุคลากร": 0.04,
}


def _find_sheet_name(wb: openpyxl.Workbook) -> str:
    for name in wb.sheetnames:
        if name.startswith(SHEET_PREFIX):
            return name
    raise ValueError(f"ไม่พบ sheet ที่ชื่อขึ้นต้นด้วย '{SHEET_PREFIX}' ใน {wb.sheetnames}")


def _iter_candidates(xlsx_path: Path) -> list[dict]:
    """สตรีมทุกแถว → คืน dict `{source_row, budget_type, item_name}` (unique item_name แรกสุด)"""
    wb = openpyxl.load_workbook(xlsx_path, read_only=True)
    try:
        sheet_name = _find_sheet_name(wb)
        ws = wb[sheet_name]
        seen_item_names: set[str] = set()
        candidates: list[dict] = []
        rows = ws.iter_rows(min_row=2, max_col=MAX_COL, values_only=True)
        for excel_row, row in enumerate(rows, start=2):
            # ตรวจเนื้อหา ไม่ใช่เลขแถว — Grand Total ปี 2566 อยู่แถว 2 (02 §A1)
            if row and row[0] == "Grand Total":
                continue
            item_name = row[ITEM_NAME_COL]
            budget_type = row[BUDGET_TYPE_COL]
            if not item_name or not isinstance(item_name, str):
                continue
            if item_name in seen_item_names:
                continue
            seen_item_names.add(item_name)
            candidates.append(
                {"source_row": excel_row, "budget_type": budget_type, "item_name": item_name}
            )
        return candidates
    finally:
        wb.close()


def _stratified_sample(candidates: list[dict], n: int, seed: int) -> list[dict]:
    rng = random.Random(seed)
    by_type: dict[str, list[dict]] = {}
    for c in candidates:
        by_type.setdefault(c["budget_type"], []).append(c)

    targets = {bt: round(n * w) for bt, w in _STRATA_WEIGHTS.items()}
    # budget_type ที่ไม่อยู่ใน _STRATA_WEIGHTS (ไม่ควรมีตาม 02 §A1 แต่กันเหนียว) เก็บสัดส่วนที่เหลือ
    remaining_types = [bt for bt in by_type if bt not in targets]
    sampled: list[dict] = []
    for bt, target_n in targets.items():
        pool = by_type.get(bt, [])
        k = min(target_n, len(pool))
        sampled.extend(rng.sample(pool, k))
    for bt in remaining_types:
        pool = by_type[bt]
        k = min(1, len(pool))
        sampled.extend(rng.sample(pool, k))

    # เติมให้ครบ n ถ้าปัดเศษแล้วขาด (สุ่มเพิ่มจากที่เหลือทุก stratum ตามน้ำหนักเดิม)
    if len(sampled) < n:
        chosen_names = {c["item_name"] for c in sampled}
        leftover = [c for c in candidates if c["item_name"] not in chosen_names]
        rng.shuffle(leftover)
        sampled.extend(leftover[: n - len(sampled)])

    rng.shuffle(sampled)
    return sampled[:n]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--n", type=int, default=200)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--year", default="2566")
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="path สำหรับเขียนผลลัพธ์ดิบ (yaml skeleton ไม่มี `expected`) — ไม่ระบุ = print stdout เท่านั้น",
    )
    args = parser.parse_args()

    cfg = load_config()
    xlsx_path = cfg.raw_data_dir / "PBO" / f"{args.year}.xlsx"
    if not xlsx_path.is_file():
        raise SystemExit(f"ไม่พบไฟล์: {xlsx_path}")

    candidates = _iter_candidates(xlsx_path)
    print(f"unique item_name ทั้งหมด: {len(candidates)}", file=sys.stderr)

    sample = _stratified_sample(candidates, args.n, args.seed)
    strata_count: dict[str, int] = {}
    for c in sample:
        strata_count[c["budget_type"]] = strata_count.get(c["budget_type"], 0) + 1
    print(f"สุ่มได้ {len(sample)} รายการ (seed={args.seed}) — สัดส่วนต่อ budget_type:", file=sys.stderr)
    for bt, cnt in sorted(strata_count.items(), key=lambda kv: -kv[1]):
        print(f"  {bt}: {cnt} ({cnt / len(sample):.1%})", file=sys.stderr)

    skeleton = [
        {"raw": c["item_name"], "source_row": c["source_row"], "budget_type": c["budget_type"]}
        for c in sample
    ]

    if args.out:
        resolved_out = Path(args.out).resolve()
        if resolved_out == cfg.raw_data_dir or cfg.raw_data_dir in resolved_out.parents:
            raise SystemExit("ปฏิเสธการเขียนไฟล์ใต้ raw_data_dir (N6)")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open("w", encoding="utf-8") as f:
            yaml.dump(skeleton, f, allow_unicode=True, sort_keys=False)
        print(f"เขียน skeleton (ไม่มี 'expected') ไปที่ {args.out}", file=sys.stderr)
    else:
        yaml.dump(skeleton, sys.stdout, allow_unicode=True, sort_keys=False)


if __name__ == "__main__":
    main()
