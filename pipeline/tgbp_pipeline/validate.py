"""T-105: `tgbp validate` (บางส่วน) — 03-DATA-PIPELINE.md §6

Implement เฉพาะ **V1** (oracle ของ PBO), **V4** (source_id unique), **V7** (fiscal_year_be
range) ตามขอบเขตของ T-105 — T-110 จะเติม V2/V3/V5/V6/V8/V9/V10 และประกอบเป็น
`validation_report.md` / `validation.json` ทีหลัง

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

from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import pyarrow.compute as pc
import pyarrow.parquet as pq
import yaml

from tgbp_pipeline.config import PipelineConfig
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
