"""T-105/T-110a: `tgbp validate` — 03-DATA-PIPELINE.md §6

T-105 implement **V1** (oracle ของ PBO), **V4** (source_id unique), **V7** (fiscal_year_be
range) — T-110a (ส่วนนี้) เติม **V2** (เรียก `extract.act2570.check_v2` ตรง ๆ), **V3** (ADR-005:
hard เฉพาะยอดรวมทั้งไฟล์ราชาเทวะต่างจาก summary เกิน 1%; รายกลุ่มเป็น flag
`group_total_mismatch` ที่ normalize stage เติมไว้แล้ว — ดู `normalize/run.py`), **V5**
(source_doc_id ⊆ sources.json), **V7 ต่อ dataset** (นับ `committee_table` ที่ปี null +
flag `year_unknown` เป็นข้อยกเว้น), **V8** (unit_price outlier ต่อ item_key, soft — รายงานเฉย ๆ
**ไม่เขียน flag กลับลง parquet** เพราะ publish stage (ยังไม่ทำในรอบนี้) เป็นคนตัดสิน schema
สุดท้ายที่จะ publish), **V9** (% org_unmapped ต่อ dataset, soft), **V10** (จำนวน PDF ใน raw
เทียบ sources.json) แล้วประกอบเป็น `ValidationReport` (+ markdown) — เขียนไว้ที่
`.cache/validation/` ก่อน (publish จะ copy ไป `web/public/data/` ทีหลัง คนละ task)

ทุก V-check ในไฟล์นี้ทำงานบน **normalized cache** (`.cache/normalized/{dataset}/*.parquet`)
ยกเว้น V1 (PBO extract-stage cache, มี oracle) และ V2 (act2570 extract-stage cache, มี oracle)
ที่ยังต้องใช้ extract-stage cache เพราะ oracle ผูกกับขั้นตอนนั้น

แก้ 19 ก.ย. 2569 (รอบ 2 — หลัง main thread ตรวจ cache จริง):
- **V1 tolerance เป็น hybrid**: ผ่านเมื่อ `|diff| ≤ max(0.01% × |oracle|, 1,000 บาท)` — กันเคส
  คอลัมน์ค่าน้อยมาก (เช่น "PO ทั้งสิ้น" ปี 2564/2565 ต่างแค่ ~100 บาทจาก rounding ของ pivot cache
  แต่ diff สัมพัทธ์เกิน 0.01% เพราะฐานเล็ก)
- **known source gap** (`pipeline/data/known_source_gaps.yaml`): ปีที่ยืนยันแล้วว่าข้อมูลขาด
  ทั้งกระทรวง (เช่น PBO 2562) แต่ตัดสินใจเก็บไว้ใช้ต่อ — `check_v1` คืนสถานะ `source_incomplete`
  (ไม่ใช่ pass) แทนที่จะ fail ทื่อ ๆ ถ้า coverage ที่คำนวณสดยังตรงกับที่บันทึกไว้ (± 0.5 จุด %)
- `coverage_by_ministry` / `check_ministry_continuity`: ใช้โดย T-110 (manifest/facets) และ
  `tgbp validate` เพื่อรายงานกระทรวงที่ขาดหายเทียบปีข้างเคียง (soft, รายงานเฉย ๆ ไม่ตัดสิน)
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd
import pyarrow.compute as pc
import pyarrow.parquet as pq
import yaml

from tgbp_pipeline.config import PipelineConfig
from tgbp_pipeline.extract.local_sheets import check_v3_raja
from tgbp_pipeline.extract.pbo import DATASET as PBO_DATASET
from tgbp_pipeline.extract.pbo import MONEY_COLUMNS, load_oracle

# 03 §6 V1: ยอดรวม ± 0.01% (หรือ ± 1,000 บาท แล้วแต่ค่าไหนมากกว่า — ดู module docstring)
V1_TOLERANCE_PCT = 0.01
V1_TOLERANCE_ABS_BAHT = 1_000
# 03 §6 V7: fiscal_year_be ∈ [2558, 2570]
V7_MIN_FISCAL_YEAR_BE = 2558
V7_MAX_FISCAL_YEAR_BE = 2570

# known_source_gaps.yaml — coverage ที่คำนวณสดต้องอยู่ในกรอบนี้ (จุด %) ของค่าที่บันทึกไว้
# ถึงจะยังถือว่า "รู้อยู่แล้ว" (source_incomplete); เกินกรอบ = coverage เปลี่ยนไปโดยไม่ได้ตั้งใจ = fail
KNOWN_GAP_COVERAGE_TOLERANCE_PCT_POINTS = 0.5

KNOWN_SOURCE_GAPS_PATH = Path(__file__).resolve().parent.parent / "data" / "known_source_gaps.yaml"


@dataclass
class ColumnCheck:
    label: str
    oracle_million: float | None
    computed_baht: int
    diff_pct: float | None
    passed: bool


@dataclass
class V1Result:
    year: int
    kind: str
    passed: bool
    # "ok" | "failed" | "no_oracle" | "source_incomplete" (known_source_gaps.yaml)
    status: str = "ok"
    coverage_pct: float | None = None
    checks: list[ColumnCheck] = field(default_factory=list)
    ministry_checks: dict[str, list[ColumnCheck]] = field(default_factory=dict)
    n_rows: int | None = None
    expected_rows: int | None = None
    notes: list[str] = field(default_factory=list)


@dataclass
class V4Result:
    passed: bool
    n_rows: int
    n_unique: int
    duplicates: list[str] = field(default_factory=list)


@dataclass
class V7Result:
    passed: bool
    n_out_of_range: int
    examples: list[int] = field(default_factory=list)


def _pct_diff(oracle_baht: float, computed_baht: float) -> float:
    if oracle_baht == 0:
        return 0.0 if computed_baht == 0 else float("inf")
    return abs(computed_baht - oracle_baht) / abs(oracle_baht) * 100


def _make_check(label: str, oracle_million: float | None, computed_baht: int) -> ColumnCheck:
    if oracle_million is None:
        # oracle เป็น '-' ในไฟล์ต้นฉบับ (พบใน 2558 บางคอลัมน์ "คงเหลือ...") — ไม่มีค่าให้เทียบ
        return ColumnCheck(
            label=label,
            oracle_million=None,
            computed_baht=computed_baht,
            diff_pct=None,
            passed=True,
        )
    oracle_baht = oracle_million * 1_000_000
    diff_pct = _pct_diff(oracle_baht, computed_baht)
    diff_baht = abs(computed_baht - oracle_baht)
    # hybrid: ผ่านถ้า diff ≤ 0.01% ของ oracle "หรือ" ≤ 1,000 บาท (กันคอลัมน์ฐานเล็กมาก)
    tolerance_baht = max(V1_TOLERANCE_PCT / 100 * abs(oracle_baht), V1_TOLERANCE_ABS_BAHT)
    return ColumnCheck(
        label=label,
        oracle_million=oracle_million,
        computed_baht=computed_baht,
        diff_pct=diff_pct,
        passed=diff_baht <= tolerance_baht,
    )


def _column_sum(table, column: str, mask=None) -> int:
    col = table.column(column)
    if mask is not None:
        col = col.filter(mask)
    value = pc.sum(col).as_py()
    return int(value) if value is not None else 0


def load_known_source_gaps(path: Path | None = None) -> dict:
    """โหลด `pipeline/data/known_source_gaps.yaml` — คืน `{}` ถ้าไม่มีไฟล์ (ไม่ raise)"""
    target = path if path is not None else KNOWN_SOURCE_GAPS_PATH
    if not target.is_file():
        return {}
    return yaml.safe_load(target.read_text(encoding="utf-8")) or {}


def _resolve_status(
    cfg: PipelineConfig,
    dataset: str,
    year: int,
    base_passed: bool,
    gaps: dict | None = None,
) -> tuple[bool, str, float | None, list[str]]:
    """เทียบกับ `known_source_gaps.yaml` — คืน (passed, status, coverage_pct, notes)

    ถ้าไม่มี entry สำหรับ (dataset, year) → คืนผลตาม `base_passed` ตรง ๆ (ok/failed)
    ถ้ามี entry และ coverage สดยังตรงกับที่บันทึกไว้ (± `KNOWN_GAP_COVERAGE_TOLERANCE_PCT_POINTS`
    จุด %) → `source_incomplete` (ไม่ใช่ pass แต่ไม่ fail แข็ง); ถ้า coverage เปลี่ยนไปเกินกรอบ → fail
    """
    gaps = gaps if gaps is not None else load_known_source_gaps()
    entry = (gaps.get(dataset) or {}).get(year)
    if entry is None:
        return base_passed, ("ok" if base_passed else "failed"), None, []

    cache_path = cfg.cache_dir / "pbo" / f"{year}.parquet"
    table = pq.read_table(str(cache_path), columns=["amount_thb"])
    extracted_total_mthb = _column_sum(table, "amount_thb") / 1_000_000
    oracle_total_mthb = entry["oracle_total_mthb"]
    coverage_pct = (extracted_total_mthb / oracle_total_mthb * 100) if oracle_total_mthb else 0.0
    recorded_pct = entry["coverage_pct"]
    diff_points = abs(coverage_pct - recorded_pct)

    if diff_points <= KNOWN_GAP_COVERAGE_TOLERANCE_PCT_POINTS:
        note = (
            f"known source gap ({dataset} {year}): coverage {coverage_pct:.2f}% "
            f"(บันทึกไว้ {recorded_pct:.2f}% ± {KNOWN_GAP_COVERAGE_TOLERANCE_PCT_POINTS} จุด) — "
            f"{str(entry.get('note', '')).strip()}"
        )
        return False, "source_incomplete", coverage_pct, [note]

    note = (
        f"coverage ของ {dataset} {year} เปลี่ยนจากที่บันทึกไว้ใน known_source_gaps.yaml เกินกรอบ: "
        f"ได้ {coverage_pct:.2f}% คาด {recorded_pct:.2f}% "
        f"(± {KNOWN_GAP_COVERAGE_TOLERANCE_PCT_POINTS} จุด) — ต้องตรวจสอบใหม่"
    )
    return False, "failed", coverage_pct, [note]


def check_v1(cfg: PipelineConfig, year: int) -> V1Result:
    """V1: ยอดรวมต่อปีของ PBO (ทุกคอลัมน์เงิน) เทียบ oracle ในไฟล์ ± 0.01% (03 §6)"""
    oracle_all = load_oracle(cfg)
    oracle = oracle_all.get(str(year))
    if oracle is None:
        raise ValueError(
            f"ไม่มี oracle สำหรับปี {year} ใน oracle.json — รัน `tgbp extract --dataset pbo` ก่อน"
        )

    cache_path = cfg.cache_dir / "pbo" / f"{year}.parquet"
    if not cache_path.is_file():
        raise FileNotFoundError(f"ไม่มี cache {cache_path} — รัน `tgbp extract --dataset pbo` ก่อน")

    kind = oracle["kind"]

    if kind == "none":
        table = pq.read_table(str(cache_path), columns=[])
        n_rows = table.num_rows
        expected = oracle.get("expected_rows")
        notes = ["ไม่มี oracle ในไฟล์ต้นทาง (02 §A1) — ตรวจเฉพาะจำนวนแถว (soft rule)"]
        if expected is not None and n_rows != expected:
            notes.append(f"จำนวนแถวไม่ตรงคาดการณ์: ได้ {n_rows:,} คาด {expected:,}")
        return V1Result(
            year=year,
            kind="none",
            passed=True,
            status="no_oracle",
            n_rows=n_rows,
            expected_rows=expected,
            notes=notes,
        )

    if kind == "grand_total":
        money_field_names = [name for _, name, _ in MONEY_COLUMNS]
        table = pq.read_table(str(cache_path), columns=money_field_names)
        checks = [
            _make_check(label, oracle["values"].get(name), _column_sum(table, name))
            for _, name, label in MONEY_COLUMNS
        ]
        base_passed = all(c.passed for c in checks)
        passed, status, coverage_pct, gap_notes = _resolve_status(
            cfg, PBO_DATASET, year, base_passed
        )
        return V1Result(
            year=year,
            kind=kind,
            passed=passed,
            status=status,
            coverage_pct=coverage_pct,
            checks=checks,
            notes=gap_notes,
        )

    if kind == "sheet1_ministry":
        table = pq.read_table(str(cache_path), columns=["ministry", "amount_thb"])
        total_check = _make_check(
            "พรบ. (รวมทั้งหมด)", oracle["values"].get("amount_thb"), _column_sum(table, "amount_thb")
        )
        ministry_col = table.column("ministry")
        ministry_checks: dict[str, list[ColumnCheck]] = {}
        for ministry_name, oracle_val in oracle.get("by_ministry", {}).items():
            mask = pc.equal(ministry_col, ministry_name)
            computed = _column_sum(table, "amount_thb", mask)
            ministry_checks[ministry_name] = [_make_check("พรบ.", oracle_val, computed)]
        base_passed = total_check.passed and all(
            c.passed for checks in ministry_checks.values() for c in checks
        )
        passed, status, coverage_pct, gap_notes = _resolve_status(
            cfg, PBO_DATASET, year, base_passed
        )
        return V1Result(
            year=year,
            kind=kind,
            passed=passed,
            status=status,
            coverage_pct=coverage_pct,
            checks=[total_check],
            ministry_checks=ministry_checks,
            notes=gap_notes,
        )

    if kind == "sheet1_total":
        ministry_filter = oracle["ministry_filter"]
        columns = ["ministry", "is_capital", "amount_thb", "revised_thb", "disbursed_thb"]
        table = pq.read_table(str(cache_path), columns=columns)
        ministry_mask = pc.equal(table.column("ministry"), ministry_filter)

        checks: list[ColumnCheck] = []
        for split, is_capital in (("current", False), ("capital", True)):
            split_mask = pc.and_(ministry_mask, pc.equal(table.column("is_capital"), is_capital))
            for field_name in ("amount_thb", "revised_thb", "disbursed_thb"):
                oracle_val = oracle["values"][split].get(field_name)
                computed = _column_sum(table, field_name, split_mask)
                checks.append(_make_check(f"{split}.{field_name}", oracle_val, computed))
        for field_name in ("amount_thb", "revised_thb", "disbursed_thb"):
            oracle_val = oracle["values"]["total"].get(field_name)
            computed = _column_sum(table, field_name, ministry_mask)
            checks.append(_make_check(f"total.{field_name}", oracle_val, computed))

        base_passed = all(c.passed for c in checks)
        passed, status, coverage_pct, gap_notes = _resolve_status(
            cfg, PBO_DATASET, year, base_passed
        )
        return V1Result(
            year=year,
            kind=kind,
            passed=passed,
            status=status,
            coverage_pct=coverage_pct,
            checks=checks,
            notes=gap_notes,
        )

    raise ValueError(f"ไม่รู้จัก oracle kind: {kind!r} (ปี {year})")


def check_v4(cache_paths: list[Path]) -> V4Result:
    """V4: `source_id` unique ทั้ง dataset (hard rule, 03 §6)"""
    ids: list[str] = []
    for path in cache_paths:
        table = pq.read_table(str(path), columns=["source_id"])
        ids.extend(table.column("source_id").to_pylist())

    counter = Counter(ids)
    duplicates = [sid for sid, n in counter.items() if n > 1]
    return V4Result(
        passed=not duplicates, n_rows=len(ids), n_unique=len(counter), duplicates=duplicates[:20]
    )


def check_v7(
    cache_path: Path,
    min_year: int = V7_MIN_FISCAL_YEAR_BE,
    max_year: int = V7_MAX_FISCAL_YEAR_BE,
) -> V7Result:
    """V7: `fiscal_year_be` ∈ [2558, 2570] (hard rule, 03 §6)"""
    table = pq.read_table(str(cache_path), columns=["fiscal_year_be"])
    years = [y for y in table.column("fiscal_year_be").to_pylist() if y is not None]
    out_of_range = [y for y in years if not (min_year <= y <= max_year)]
    return V7Result(
        passed=not out_of_range,
        n_out_of_range=len(out_of_range),
        examples=sorted(set(out_of_range))[:10],
    )


# ---------------------------------------------------------------------------
# coverage_by_ministry / check_ministry_continuity — ให้ T-110 ใช้ต่อ (manifest/facets)
# ---------------------------------------------------------------------------


def _ministry_sums_mthb(cache_path: Path) -> dict[str, float]:
    """ผลรวม `amount_thb` (พรบ.) ต่อกระทรวง หน่วยล้านบาท — `{}` ถ้าไม่มีไฟล์ cache ปีนั้น"""
    if not cache_path.is_file():
        return {}
    table = pq.read_table(str(cache_path), columns=["ministry", "amount_thb"])
    grouped = table.group_by("ministry").aggregate([("amount_thb", "sum")])
    ministries = grouped.column("ministry").to_pylist()
    sums = grouped.column("amount_thb_sum").to_pylist()
    return {
        m: (s or 0) / 1_000_000 for m, s in zip(ministries, sums, strict=False) if m is not None
    }


def coverage_by_ministry(
    cfg: PipelineConfig, year: int, dataset: str = PBO_DATASET
) -> dict[str, dict]:
    """สรุปยอด "พรบ." รายกระทรวงของปีที่ระบุ + สถานะเทียบ `known_source_gaps.yaml` (ถ้ามี)

    คืน `{ministry: {"amount_mthb": ..., "status": "ok"|"missing"|"partial"}}` — T-110 เอาไปใส่
    `catalog/facets.json` (`coverage_notes`) ต่อ
    """
    cache_path = cfg.cache_dir / "pbo" / f"{year}.parquet"
    sums = _ministry_sums_mthb(cache_path)

    gaps = load_known_source_gaps()
    entry = (gaps.get(dataset) or {}).get(year) or {}
    missing = set(entry.get("missing_ministries", []))
    partial = set(entry.get("partial_ministries", []))

    result: dict[str, dict] = {}
    for ministry, amount in sums.items():
        status = "missing" if ministry in missing else "partial" if ministry in partial else "ok"
        result[ministry] = {"amount_mthb": amount, "status": status}
    for ministry in missing - set(sums):
        result[ministry] = {"amount_mthb": 0.0, "status": "missing"}
    return result


def check_ministry_continuity(cfg: PipelineConfig, years: list[int]) -> dict[int, list[str]]:
    """soft, รายงานเฉย ๆ: กระทรวงที่มีในปีข้างเคียง (ก่อน/หลัง) แต่ไม่มีในปีนี้เลย

    `years` ต้องเรียงจากน้อยไปมาก — ใช้จับ gap แบบ 2562 ในปีที่ไม่มี oracle (เช่น 2567) ด้วย
    **ไม่ตัดสินว่าเป็นปัญหาจริงหรือแค่เปลี่ยนชื่อกระทรวง** (เช่น วิทยาศาสตร์ฯ→อว. ปี 2563,
    `องค์กรปกครองส่วนท้องถิ่น` เริ่มมีปี 2563) — แค่รายงานให้คนตรวจสอบต่อ
    """
    ministries_by_year: dict[int, set[str]] = {
        y: set(_ministry_sums_mthb(cfg.cache_dir / "pbo" / f"{y}.parquet")) for y in years
    }
    result: dict[int, list[str]] = {}
    for i, year in enumerate(years):
        neighbors: set[str] = set()
        if i > 0:
            neighbors |= ministries_by_year[years[i - 1]]
        if i < len(years) - 1:
            neighbors |= ministries_by_year[years[i + 1]]
        result[year] = sorted(neighbors - ministries_by_year[year])
    return result


# ---------------------------------------------------------------------------
# T-110a: normalized-cache discovery helpers
# ---------------------------------------------------------------------------

NORMALIZED_CACHE_DIRNAME = "normalized"


def list_normalized_cache_paths(cfg: PipelineConfig) -> dict[str, list[Path]]:
    """`{dataset: [parquet ทั้งหมดของ dataset นั้น]}` จาก `.cache/normalized/` — `{}` ถ้ายังไม่มี"""
    root = cfg.cache_dir / NORMALIZED_CACHE_DIRNAME
    if not root.is_dir():
        return {}
    result: dict[str, list[Path]] = {}
    for sub in sorted(root.iterdir()):
        if sub.is_dir():
            files = sorted(sub.glob("*.parquet"))
            if files:
                result[sub.name] = files
    return result


# ---------------------------------------------------------------------------
# V3 (03 §6, ADR-005): hard เฉพาะยอดรวมทั้งไฟล์ราชาเทวะต่างจาก summary เกิน 1%
# รายกลุ่มเป็น soft — ดู flag `group_total_mismatch` ที่ `normalize/run.py` เติมไว้แล้ว
# ---------------------------------------------------------------------------

V3_HARD_TOLERANCE_PCT = 1.0
_RAJA_OCR_FLAG = "upstream_ocr"


@dataclass
class V3FileResult:
    rel_path: str
    status: str  # "ok" | "mismatch" | "no_summary_sheet"
    passed: bool
    n_rows: int
    computed_total_thb: int
    oracle_total_thb: float | None
    diff_pct: float | None
    n_group_mismatches: int


@dataclass
class V3Summary:
    passed: bool
    files: list[V3FileResult] = field(default_factory=list)


def check_v3(cfg: PipelineConfig, local_ordinance_paths: list[Path]) -> V3Summary:
    """V3: หาไฟล์ราชาเทวะ (flag `upstream_ocr`) ในบรรดา `local_ordinance_2570` แล้วเทียบยอดรวม
    ทั้งไฟล์กับ `summary_ocr_raw_data` ของ raw ต้นทาง — hard เฉพาะ diff > 1% (ADR-005)
    """
    from tgbp_pipeline.normalize.run import load_raja_summary_oracle

    files: list[V3FileResult] = []
    for path in local_ordinance_paths:
        table = pq.read_table(
            str(path),
            columns=[
                "source_path",
                "plan",
                "activity",
                "budget_type",
                "amount_thb",
                "quality_flags",
            ],
        )
        flags_col = table.column("quality_flags").to_pylist()
        if not any(_RAJA_OCR_FLAG in (f or []) for f in flags_col):
            continue

        rel_path = table.column("source_path")[0].as_py()
        oracle = load_raja_summary_oracle(cfg, rel_path)
        if not oracle:
            files.append(
                V3FileResult(
                    rel_path=rel_path,
                    status="no_summary_sheet",
                    passed=True,
                    n_rows=table.num_rows,
                    computed_total_thb=0,
                    oracle_total_thb=None,
                    diff_pct=None,
                    n_group_mismatches=0,
                )
            )
            continue

        records = [
            {
                "plan": table.column("plan")[i].as_py(),
                "activity": table.column("activity")[i].as_py(),
                "budget_type": table.column("budget_type")[i].as_py(),
                "amount_thb": table.column("amount_thb")[i].as_py(),
                "quality_flags": flags_col[i] or [],
            }
            for i in range(table.num_rows)
        ]
        v3 = check_v3_raja(records, oracle)
        oracle_total = sum(v for v in oracle.values() if v is not None)
        computed_total = sum(
            r["amount_thb"] or 0 for r in records if "amount_outlier" not in r["quality_flags"]
        )
        diff_pct = (
            abs(computed_total - oracle_total) / abs(oracle_total) * 100 if oracle_total else 0.0
        )
        passed = diff_pct <= V3_HARD_TOLERANCE_PCT
        files.append(
            V3FileResult(
                rel_path=rel_path,
                status="ok" if passed else "mismatch",
                passed=passed,
                n_rows=table.num_rows,
                computed_total_thb=computed_total,
                oracle_total_thb=oracle_total,
                diff_pct=diff_pct,
                n_group_mismatches=len(v3.diffs),
            )
        )
    return V3Summary(passed=all(f.passed for f in files), files=files)


# ---------------------------------------------------------------------------
# V5 (03 §6): ทุก `source_doc_id` มีใน sources.json (hard)
# ---------------------------------------------------------------------------


@dataclass
class V5Result:
    status: str  # "ok" | "failed" | "skipped_no_sources_json"
    passed: bool
    n_rows_checked: int
    missing_doc_ids: list[str] = field(default_factory=list)


def check_v5(cache_paths: list[Path], sources_json_path: Path) -> V5Result:
    if not sources_json_path.is_file():
        return V5Result(status="skipped_no_sources_json", passed=True, n_rows_checked=0)
    sources = json.loads(sources_json_path.read_text(encoding="utf-8"))
    known_doc_ids = {d["doc_id"] for d in sources}

    missing: set[str] = set()
    n_rows = 0
    for path in cache_paths:
        table = pq.read_table(str(path), columns=["source_doc_id"])
        n_rows += table.num_rows
        for doc_id in table.column("source_doc_id").to_pylist():
            if doc_id is not None and doc_id not in known_doc_ids:
                missing.add(doc_id)
    passed = not missing
    return V5Result(
        status="ok" if passed else "failed",
        passed=passed,
        n_rows_checked=n_rows,
        missing_doc_ids=sorted(missing)[:20],
    )


# ---------------------------------------------------------------------------
# V7 ต่อ dataset (03 §6): fiscal_year_be ∈ [2558, 2570]; `committee_table` ปี null
# อนุญาตเฉพาะเมื่อมี flag `year_unknown` (แถวอื่นปี null = fail)
# ---------------------------------------------------------------------------

_COMMITTEE_DATASET = "committee_table"
_YEAR_UNKNOWN_FLAG = "year_unknown"


@dataclass
class V7DatasetResult:
    dataset: str
    passed: bool
    n_rows: int
    n_out_of_range: int
    n_null_disallowed: int
    examples_out_of_range: list[int] = field(default_factory=list)


def check_v7_dataset(
    dataset: str,
    cache_paths: list[Path],
    min_year: int = V7_MIN_FISCAL_YEAR_BE,
    max_year: int = V7_MAX_FISCAL_YEAR_BE,
) -> V7DatasetResult:
    n_rows = 0
    out_of_range: list[int] = []
    n_null_disallowed = 0
    for path in cache_paths:
        table = pq.read_table(str(path), columns=["fiscal_year_be", "quality_flags"])
        years = table.column("fiscal_year_be").to_pylist()
        flags_col = table.column("quality_flags").to_pylist()
        n_rows += len(years)
        for year, flags in zip(years, flags_col, strict=True):
            if year is None:
                if dataset == _COMMITTEE_DATASET and _YEAR_UNKNOWN_FLAG in (flags or []):
                    continue
                n_null_disallowed += 1
                continue
            if not (min_year <= year <= max_year):
                out_of_range.append(year)

    passed = not out_of_range and n_null_disallowed == 0
    return V7DatasetResult(
        dataset=dataset,
        passed=passed,
        n_rows=n_rows,
        n_out_of_range=len(out_of_range),
        n_null_disallowed=n_null_disallowed,
        examples_out_of_range=sorted(set(out_of_range))[:10],
    )


# ---------------------------------------------------------------------------
# V8 (03 §6, soft): unit_price_thb outlier > p99.5 × 10 ของ item_key เดียวกัน — รายงานเฉย ๆ
# (การเขียน flag `unit_price_outlier` กลับลง parquet เป็นหน้าที่ publish stage — นอกขอบเขต T-110a)
# ---------------------------------------------------------------------------

V8_OUTLIER_MULTIPLIER = 10


@dataclass
class V8Result:
    n_item_keys_checked: int
    n_rows_checked: int
    n_outlier_rows: int
    examples: list[dict] = field(default_factory=list)


def check_v8(cache_paths: list[Path]) -> V8Result:
    frames = []
    for path in cache_paths:
        table = pq.read_table(str(path), columns=["item_key", "unit_price_thb"])
        frames.append(table.to_pandas())
    if not frames:
        return V8Result(n_item_keys_checked=0, n_rows_checked=0, n_outlier_rows=0)

    df = pd.concat(frames, ignore_index=True)
    df = df[df["item_key"].notna() & df["unit_price_thb"].notna() & (df["unit_price_thb"] > 0)]
    if df.empty:
        return V8Result(n_item_keys_checked=0, n_rows_checked=0, n_outlier_rows=0)

    p995 = df.groupby("item_key")["unit_price_thb"].quantile(0.995)
    threshold = (p995 * V8_OUTLIER_MULTIPLIER).rename("_threshold")
    joined = df.join(threshold, on="item_key")
    outliers = joined[joined["unit_price_thb"] > joined["_threshold"]]
    examples = (
        outliers.sort_values("unit_price_thb", ascending=False)
        .head(15)[["item_key", "unit_price_thb", "_threshold"]]
        .rename(columns={"_threshold": "threshold_p995_x10"})
        .to_dict("records")
    )
    return V8Result(
        n_item_keys_checked=int(df["item_key"].nunique()),
        n_rows_checked=len(df),
        n_outlier_rows=len(outliers),
        examples=examples,
    )


# ---------------------------------------------------------------------------
# V9 (03 §6, soft): % `org_unmapped` ต่อ dataset
# ---------------------------------------------------------------------------

V9_WARN_THRESHOLD_PCT = 5.0
_ORG_UNMAPPED_FLAG = "org_unmapped"


@dataclass
class V9DatasetResult:
    dataset: str
    n_rows: int
    n_unmapped: int
    pct_unmapped: float


def check_v9(cache_paths_by_dataset: dict[str, list[Path]]) -> list[V9DatasetResult]:
    results: list[V9DatasetResult] = []
    for dataset, paths in cache_paths_by_dataset.items():
        n_rows = 0
        n_unmapped = 0
        for path in paths:
            table = pq.read_table(str(path), columns=["quality_flags"])
            flags_col = table.column("quality_flags").to_pylist()
            n_rows += len(flags_col)
            n_unmapped += sum(1 for f in flags_col if f and _ORG_UNMAPPED_FLAG in f)
        pct = (n_unmapped / n_rows * 100) if n_rows else 0.0
        results.append(
            V9DatasetResult(dataset=dataset, n_rows=n_rows, n_unmapped=n_unmapped, pct_unmapped=pct)
        )
    return results


# ---------------------------------------------------------------------------
# V10 (03 §6): ทุก PDF ใน raw ปรากฏใน sources.json (hard; skip ถ้าไม่มี raw dir)
# ---------------------------------------------------------------------------


@dataclass
class V10Result:
    status: str  # "ok" | "failed" | "skipped_no_raw_dir" | "skipped_no_sources_json"
    passed: bool
    n_pdf_in_raw: int
    n_pdf_in_sources: int
    missing_rel_paths: list[str] = field(default_factory=list)


def check_v10(cfg: PipelineConfig, sources_json_path: Path) -> V10Result:
    """V10 (03 §6): ทุก PDF ใน raw ปรากฏใน sources.json

    แก้ 19 ก.ย. 2569 (T-110b): นับ PDF ใน raw ด้วย**ตรรกะเดียวกับ `inventory.py`**
    (`inventory.detect_kind` — magic bytes, ไม่ใช่แค่นามสกุลไฟล์) เพราะมีไฟล์ PDF จริง 1 ไฟล์ที่
    ไม่มีนามสกุล `.pdf` (ตรวจพบจาก `%PDF` magic bytes เท่านั้น) ทำให้นับด้วยนามสกุลอย่างเดียวได้
    raw=261 ไม่ตรงกับ sources.json (kind="pdf") ที่ได้ 262 — ใช้ `inventory.detect_kind()` ที่
    export เป็น public แล้ว (N7 ไม่สร้าง magic-byte sniffer ซ้ำ)
    """
    from tgbp_pipeline.inventory import detect_kind

    if not cfg.raw_data_dir.is_dir():
        return V10Result(
            status="skipped_no_raw_dir", passed=True, n_pdf_in_raw=0, n_pdf_in_sources=0
        )
    raw_pdfs = {
        p.relative_to(cfg.raw_data_dir).as_posix()
        for p in cfg.raw_data_dir.rglob("*")
        if p.is_file() and detect_kind(p) == "pdf"
    }
    if not sources_json_path.is_file():
        return V10Result(
            status="skipped_no_sources_json",
            passed=True,
            n_pdf_in_raw=len(raw_pdfs),
            n_pdf_in_sources=0,
        )
    sources = json.loads(sources_json_path.read_text(encoding="utf-8"))
    source_pdfs = {d["rel_path"] for d in sources if d.get("kind") == "pdf"}
    missing = sorted(raw_pdfs - source_pdfs)
    passed = not missing
    return V10Result(
        status="ok" if passed else "failed",
        passed=passed,
        n_pdf_in_raw=len(raw_pdfs),
        n_pdf_in_sources=len(source_pdfs),
        missing_rel_paths=missing[:20],
    )


# ---------------------------------------------------------------------------
# V6 (03 §6, hard): ไม่มีไฟล์ output > 24 MB — คำนวณได้เฉพาะ**หลัง publish** (T-110b) เพราะต้องมี
# รายการไฟล์ที่เขียนจริงใน `web/public/data/` (`tgbp validate` เดี่ยว ๆ ที่ทำงานกับ `.cache/`
# อย่างเดียวจึงส่ง `published_files=None` แล้ว v6=None ตามเดิม — ไม่กระทบพฤติกรรมเดิม)
# ---------------------------------------------------------------------------

V6_MAX_FILE_BYTES = 24_000_000


@dataclass
class V6Result:
    passed: bool
    n_files: int
    max_bytes: int
    oversized: list[dict] = field(default_factory=list)  # [{"path": str, "bytes": int}]


def check_v6(file_paths: list[Path], max_bytes: int = V6_MAX_FILE_BYTES) -> V6Result:
    oversized: list[dict] = []
    for path in file_paths:
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if size > max_bytes:
            oversized.append({"path": str(path), "bytes": size})
    return V6Result(
        passed=not oversized, n_files=len(file_paths), max_bytes=max_bytes, oversized=oversized
    )


# ---------------------------------------------------------------------------
# ValidationReport — ประกอบผล V1-V10 ทั้งหมด + markdown
# ---------------------------------------------------------------------------


@dataclass
class ValidationReport:
    generated_at: str
    v1_by_year: dict[int, V1Result] = field(default_factory=dict)
    v2: list = field(default_factory=list)
    v3: V3Summary | None = None
    v4_by_dataset: dict[str, V4Result] = field(default_factory=dict)
    v5: V5Result | None = None
    v6: V6Result | None = None
    v7_by_dataset: dict[str, V7DatasetResult] = field(default_factory=dict)
    v8: V8Result | None = None
    v9_by_dataset: list[V9DatasetResult] = field(default_factory=list)
    v10: V10Result | None = None
    total_output_bytes: int | None = None
    total_output_bytes_limit: int | None = None
    hard_failures: list[str] = field(default_factory=list)
    notable_statuses: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.hard_failures

    def to_dict(self) -> dict:
        return asdict(self)


def build_validation_report(
    cfg: PipelineConfig,
    *,
    published_files: list[Path] | None = None,
    total_output_bytes: int | None = None,
    total_output_bytes_limit: int | None = None,
    sources_json_path: Path | None = None,
) -> ValidationReport:
    """ประกอบ `ValidationReport` จาก extract-stage cache (V1/V2) + normalized cache (V3-V10)

    `published_files`/`total_output_bytes*` (T-110b, optional): ส่งเข้ามาจาก `publish.py`
    **หลัง**เขียนไฟล์ทั้งหมดจริงใน `web/public/data/` แล้วเท่านั้น เพื่อคำนวณ V6 (ไม่มีไฟล์ > 24 MB)
    และเช็ครวม ≤ 500 MB (hard, ไม่ใช่ V-number ทางการแต่เป็นกฎ CLAUDE.md §5.1) — `tgbp validate`
    เดี่ยว ๆ (ทำงานกับ `.cache/` เท่านั้น ไม่รู้จักไฟล์ที่ publish แล้ว) เรียกแบบไม่ส่งพารามิเตอร์เหล่านี้
    เหมือนเดิม (`v6=None`, ไม่กระทบพฤติกรรมเดิม/เทสต์เดิม)

    `sources_json_path` (T-110b, optional): path ของ `sources.json` ที่ใช้ตรวจ V5/V10 — ปกติคือ
    `cfg.output_dir / "sources.json"` (ค่าเริ่มต้น) แต่ `publish.py`/`sample()` (T-112) เขียนไป
    `out_dir` ที่อาจไม่ใช่ `cfg.output_dir` เสมอ (เช่น `cfg.fixtures_dir` หรือ `tmp_path` ในเทสต์)
    """
    sources_path = (
        sources_json_path if sources_json_path is not None else cfg.output_dir / "sources.json"
    )
    from tgbp_pipeline.extract.act2570 import check_v2 as check_v2_act2570

    hard_failures: list[str] = []
    notable_statuses: list[str] = []

    # --- V1 (extract-stage, ทุกปี PBO ที่มี cache) ---
    v1_by_year: dict[int, V1Result] = {}
    pbo_cache_dir = cfg.cache_dir / "pbo"
    if pbo_cache_dir.is_dir():
        years = sorted(int(p.stem) for p in pbo_cache_dir.glob("*.parquet") if p.stem.isdigit())
        for year in years:
            result = check_v1(cfg, year)
            v1_by_year[year] = result
            if result.status == "failed":
                hard_failures.append(f"V1 PBO {year}: failed")
            elif result.status in ("source_incomplete", "no_oracle"):
                notable_statuses.append(f"V1 PBO {year}: {result.status}")

    # --- V2 (extract-stage act2570) ---
    act2570_cache_dir = cfg.cache_dir / "act2570"
    v2_results: list = []
    if (act2570_cache_dir / "oracle.json").is_file():
        v2_results = check_v2_act2570(act2570_cache_dir)
        for r in v2_results:
            if r.status == "failed":
                hard_failures.append(f"V2 {r.rel_path}: failed")

    # --- normalized cache discovery (V3-V10) ---
    cache_paths_by_dataset = list_normalized_cache_paths(cfg)
    all_paths = [p for paths in cache_paths_by_dataset.values() for p in paths]

    # --- V3 (ADR-005) ---
    v3 = check_v3(cfg, cache_paths_by_dataset.get("local_ordinance_2570", []))
    if not v3.passed:
        mismatched = [f.rel_path for f in v3.files if not f.passed]
        hard_failures.append(
            f"V3: ยอดรวมราชาเทวะต่างจาก summary เกิน {V3_HARD_TOLERANCE_PCT}%: {mismatched}"
        )

    # --- V4 ต่อ dataset ---
    v4_by_dataset = {ds: check_v4(paths) for ds, paths in cache_paths_by_dataset.items()}
    for ds, r in v4_by_dataset.items():
        if not r.passed:
            hard_failures.append(f"V4 {ds}: source_id ซ้ำ {len(r.duplicates)} รายการ")

    # --- V5 ---
    v5 = check_v5(all_paths, sources_path)
    if v5.status == "failed":
        hard_failures.append(
            f"V5: source_doc_id ไม่พบใน sources.json {len(v5.missing_doc_ids)} รายการ"
        )
    elif v5.status == "skipped_no_sources_json":
        notable_statuses.append("V5: skipped (ไม่มี sources.json — รัน `tgbp inventory` ก่อน)")

    # --- V7 ต่อ dataset ---
    v7_by_dataset = {
        ds: check_v7_dataset(ds, paths) for ds, paths in cache_paths_by_dataset.items()
    }
    for ds, r in v7_by_dataset.items():
        if not r.passed:
            hard_failures.append(
                f"V7 {ds}: {r.n_out_of_range} แถวปีนอกช่วง, "
                f"{r.n_null_disallowed} แถวปี null ที่ไม่ได้รับอนุญาต"
            )

    # --- V8 (soft) ---
    v8 = check_v8(all_paths)

    # --- V9 (soft) ---
    v9_by_dataset = check_v9(cache_paths_by_dataset)
    for r in v9_by_dataset:
        if r.pct_unmapped >= V9_WARN_THRESHOLD_PCT:
            notable_statuses.append(
                f"V9 {r.dataset}: org_unmapped {r.pct_unmapped:.1f}% (>= {V9_WARN_THRESHOLD_PCT}%)"
            )

    # --- V10 ---
    v10 = check_v10(cfg, sources_path)
    if v10.status == "failed":
        hard_failures.append(
            f"V10: PDF ใน raw ที่ไม่อยู่ใน sources.json {len(v10.missing_rel_paths)} ไฟล์"
        )
    elif v10.status.startswith("skipped"):
        notable_statuses.append(f"V10: {v10.status}")

    # --- V6 (hard, เฉพาะเมื่อเรียกจาก publish.py หลังเขียนไฟล์จริงแล้ว) ---
    v6: V6Result | None = None
    if published_files is not None:
        v6 = check_v6(published_files)
        if not v6.passed:
            hard_failures.append(f"V6: ไฟล์ output > 24 MB {len(v6.oversized)} ไฟล์")

    if total_output_bytes is not None and total_output_bytes_limit is not None:
        if total_output_bytes > total_output_bytes_limit:
            hard_failures.append(
                f"total_output_bytes: {total_output_bytes:,} เกินเพดาน "
                f"{total_output_bytes_limit:,} bytes"
            )

    return ValidationReport(
        generated_at=datetime.now(UTC).isoformat(),
        v1_by_year=v1_by_year,
        v2=v2_results,
        v3=v3,
        v4_by_dataset=v4_by_dataset,
        v5=v5,
        v6=v6,
        v7_by_dataset=v7_by_dataset,
        v8=v8,
        v9_by_dataset=v9_by_dataset,
        v10=v10,
        total_output_bytes=total_output_bytes,
        total_output_bytes_limit=total_output_bytes_limit,
        hard_failures=hard_failures,
        notable_statuses=notable_statuses,
    )


def render_validation_markdown(report: ValidationReport) -> str:
    lines: list[str] = []
    lines.append("# TGBP validation report")
    lines.append("")
    lines.append(f"สร้างเมื่อ: {report.generated_at}")
    lines.append("")
    status_word = "PASS" if report.passed else "FAIL"
    lines.append(f"## สถานะรวม: **{status_word}**")
    lines.append("")

    if report.hard_failures:
        lines.append("### Hard failures")
        lines.append("")
        for msg in report.hard_failures:
            lines.append(f"- {msg}")
        lines.append("")

    if report.notable_statuses:
        lines.append("### สถานะที่ต้องรู้ (ไม่ทำให้ fail แต่สำคัญ)")
        lines.append("")
        for msg in report.notable_statuses:
            lines.append(f"- {msg}")
        lines.append("")

    lines.append("## V1 — PBO oracle ต่อปี")
    lines.append("")
    lines.append("| ปี | status | passed |")
    lines.append("|---|---|---|")
    for year, r in sorted(report.v1_by_year.items()):
        lines.append(f"| {year} | {r.status} | {r.passed} |")
    lines.append("")

    lines.append("## V2 — act2570 A3 subset")
    lines.append("")
    lines.append("| rel_path | format | status |")
    lines.append("|---|---|---|")
    for r in report.v2:
        lines.append(f"| `{r.rel_path}` | {r.format} | {r.status} |")
    lines.append("")

    if report.v3 is not None:
        lines.append("## V3 — ราชาเทวะ (ADR-005)")
        lines.append("")
        lines.append("| rel_path | status | diff_pct | n_group_mismatches |")
        lines.append("|---|---|---|---|")
        for f in report.v3.files:
            diff = f"{f.diff_pct:.2f}%" if f.diff_pct is not None else "-"
            lines.append(f"| `{f.rel_path}` | {f.status} | {diff} | {f.n_group_mismatches} |")
        lines.append("")

    lines.append("## V4 — source_id unique ต่อ dataset")
    lines.append("")
    lines.append("| dataset | n_rows | n_unique | passed |")
    lines.append("|---|---|---|---|")
    for ds, r in sorted(report.v4_by_dataset.items()):
        lines.append(f"| {ds} | {r.n_rows:,} | {r.n_unique:,} | {r.passed} |")
    lines.append("")

    if report.v5 is not None:
        lines.append(
            f"## V5 — source_doc_id ⊆ sources.json: {report.v5.status} "
            f"({report.v5.n_rows_checked:,} แถวตรวจ)"
        )
        lines.append("")

    lines.append("## V7 — fiscal_year_be ต่อ dataset")
    lines.append("")
    lines.append("| dataset | n_rows | out_of_range | null_disallowed | passed |")
    lines.append("|---|---|---|---|---|")
    for ds, r in sorted(report.v7_by_dataset.items()):
        lines.append(
            f"| {ds} | {r.n_rows:,} | {r.n_out_of_range} | {r.n_null_disallowed} | {r.passed} |"
        )
    lines.append("")

    if report.v6 is not None:
        lines.append(
            f"## V6 — ไม่มีไฟล์ output > 24 MB: {'PASS' if report.v6.passed else 'FAIL'} "
            f"({report.v6.n_files:,} ไฟล์ตรวจ)"
        )
        lines.append("")
        if report.v6.oversized:
            lines.append("| path | bytes |")
            lines.append("|---|---|")
            for item in report.v6.oversized:
                lines.append(f"| `{item['path']}` | {item['bytes']:,} |")
            lines.append("")

    if report.total_output_bytes is not None:
        lines.append(
            f"## รวมขนาด web/public/data/: {report.total_output_bytes:,} bytes "
            f"(เพดาน {report.total_output_bytes_limit:,})"
        )
        lines.append("")

    if report.v8 is not None:
        lines.append(
            f"## V8 — unit_price outlier (soft): {report.v8.n_outlier_rows:,} แถว "
            f"จาก {report.v8.n_item_keys_checked:,} item_key"
        )
        lines.append("")

    lines.append("## V9 — % org_unmapped ต่อ dataset (soft)")
    lines.append("")
    lines.append("| dataset | n_rows | n_unmapped | pct |")
    lines.append("|---|---|---|---|")
    for r in report.v9_by_dataset:
        lines.append(f"| {r.dataset} | {r.n_rows:,} | {r.n_unmapped:,} | {r.pct_unmapped:.2f}% |")
    lines.append("")

    if report.v10 is not None:
        lines.append(
            f"## V10 — PDF raw vs sources.json: {report.v10.status} "
            f"(raw={report.v10.n_pdf_in_raw:,}, sources={report.v10.n_pdf_in_sources:,})"
        )
        lines.append("")

    return "\n".join(lines) + "\n"


def write_validation_report(
    cfg: PipelineConfig, report: ValidationReport, out_dir: Path | None = None
) -> tuple[Path, Path]:
    """เขียน `validation.json` + `validation_report.md`

    ค่าเริ่มต้นเขียนที่ `.cache/validation/`; T-110b (`publish.py`) ส่ง `out_dir=cfg.output_dir`
    เพื่อเขียนฉบับสุดท้าย (รวม V6) ตรงไปที่ `web/public/data/` แทนการ copy ไฟล์ซ้ำ
    """
    target_dir = out_dir if out_dir is not None else (cfg.cache_dir / "validation")
    out_dir = cfg.assert_writable_path(target_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    json_path = out_dir / "validation.json"
    json_path.write_text(
        json.dumps(report.to_dict(), ensure_ascii=False, indent=2, sort_keys=True, default=str),
        encoding="utf-8",
        newline="\n",
    )

    md_path = out_dir / "validation_report.md"
    md_path.write_text(render_validation_markdown(report), encoding="utf-8", newline="\n")

    return json_path, md_path
