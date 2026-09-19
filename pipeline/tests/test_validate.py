"""T-105 (แก้รอบ 2): `validate.py` — hybrid tolerance, known_source_gaps, coverage_by_ministry,
check_ministry_continuity

ห้ามพึ่งไฟล์ raw จริง (สร้าง fixture parquet เล็ก ๆ ในเทสต์เอง)
"""

from __future__ import annotations

import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from tgbp_pipeline.extract.pbo import pyarrow_schema
from tgbp_pipeline.validate import (
    _make_check,
    _resolve_status,
    check_ministry_continuity,
    check_v1,
    coverage_by_ministry,
    load_known_source_gaps,
)

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

_DEFAULT_ROW: dict = {
    "source_id": "0" * 16,
    "dataset": "pbo_disbursement",
    "fiscal_year_be": 2566,
    "fiscal_year_ce": 2023,
    "ministry": "กระทรวงกลาโหม",
    "agency": "กรมทหารบก",
    "strategy": None,
    "plan": None,
    "output_project": None,
    "activity": None,
    "budget_type": None,
    "is_capital": False,
    "capital_type_raw": None,
    "item_name_raw": "รายการ",
    "amount_thb": 0,
    "revised_thb": 0,
    "po_thb": None,
    "disbursed_thb": None,
    "disbursed_incl_po_thb": None,
    "reserved_thb": None,
    "carryover_thb": None,
    "remaining_committed_thb": None,
    "remaining_uncommitted_thb": None,
    "remaining_in_progress_thb": None,
    "remaining_reserved_extended_thb": None,
    "remaining_total_thb": None,
    "disbursement_rate": None,
    "amount_unit_source": "million_thb",
    "source_path": "PBO/2566.xlsx",
    "source_sheet": "เบิกจ่ายภาพรวมทุกมิติ (7)",
    "source_row": 2,
    "source_doc_id": "d_" + "0" * 12,
    "quality_flags": [],
}


def _row(**overrides) -> dict:
    return {**_DEFAULT_ROW, **overrides}


def _write_pbo_cache(cache_dir: Path, year: int, rows: list[dict]) -> Path:
    path = cache_dir / "pbo" / f"{year}.parquet"
    path.parent.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pylist(rows, schema=pyarrow_schema())
    pq.write_table(table, str(path))
    return path


def _write_oracle(cache_dir: Path, year: int, entry: dict) -> None:
    path = cache_dir / "pbo" / "oracle.json"
    data = {}
    if path.is_file():
        data = json.loads(path.read_text(encoding="utf-8"))
    data[str(year)] = entry
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


class _FakeConfig:
    """แทน `PipelineConfig` เฉพาะ `cache_dir` ที่ `validate.py` ใช้จริง (`assert_writable_path`
    ของ config ตัวจริงไม่ถูกเรียกใน validate.py — ไม่จำเป็นต้อง mock ทั้งก้อน)"""

    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = cache_dir


# ---------------------------------------------------------------------------
# _make_check — hybrid tolerance (± 0.01% หรือ ± 1,000 บาท แล้วแต่มากกว่า)
# ---------------------------------------------------------------------------


def test_make_check_absolute_floor_passes_tiny_base_value() -> None:
    """PO ทั้งสิ้น ปี 2564/2565 จริง: oracle=14,900 บาท, computed=15,000 บาท (diff 100 บาท,
    diff% ~0.67% > 0.01% เดิม) — ต้องผ่านด้วย absolute floor 1,000 บาท
    """
    check = _make_check("PO ทั้งสิ้น", 0.0149, 15_000)
    assert check.passed is True


def test_make_check_fails_when_diff_exceeds_absolute_floor_and_relative() -> None:
    check = _make_check("พรบ.", 100.0, 200_000_000)  # oracle 100 ล้านบาท vs computed 200 ล้านบาท
    assert check.passed is False


def test_make_check_relative_tolerance_still_applies_for_large_base() -> None:
    # oracle 3,000,000 ล้านบาท (3 ล้านล้านบาทเป็นบาท) diff 1 ล้านบาท (0.000033%) → ผ่าน
    oracle_baht = 3_000_000 * 1_000_000
    check = _make_check("พรบ.", 3_000_000.0, oracle_baht + 1_000_000)
    assert check.passed is True
    # diff ใหญ่กว่า 0.01% ของฐานใหญ่ (และใหญ่กว่า 1,000 บาทด้วย) → ไม่ผ่าน
    check2 = _make_check("พรบ.", 3_000_000.0, oracle_baht + 1_000_000_000)
    assert check2.passed is False


def test_make_check_none_oracle_always_passes() -> None:
    assert _make_check("คงเหลือกรณีไม่มีหนี้ผูกพัน", None, 12345).passed is True


# ---------------------------------------------------------------------------
# load_known_source_gaps
# ---------------------------------------------------------------------------


def test_load_known_source_gaps_missing_file_returns_empty(tmp_path: Path) -> None:
    assert load_known_source_gaps(tmp_path / "does_not_exist.yaml") == {}


def test_load_known_source_gaps_reads_real_file() -> None:
    """`pipeline/data/known_source_gaps.yaml` ต้องมี entry ของ PBO 2562 ตามที่ main thread ยืนยัน"""
    gaps = load_known_source_gaps()
    entry = gaps["pbo_disbursement"][2562]
    assert entry["oracle_total_mthb"] == 3_000_000.0
    assert "กระทรวงกลาโหม" in entry["missing_ministries"]
    assert "กระทรวงเกษตรและสหกรณ์" in entry["partial_ministries"]


# ---------------------------------------------------------------------------
# _resolve_status — known gap override (source_incomplete / failed)
# ---------------------------------------------------------------------------


def test_resolve_status_no_gap_entry_returns_base(tmp_path: Path) -> None:
    cfg = _FakeConfig(tmp_path)
    passed, status, coverage_pct, notes = _resolve_status(
        cfg, "pbo_disbursement", 2566, True, gaps={}
    )
    assert (passed, status, coverage_pct, notes) == (True, "ok", None, [])


def test_resolve_status_within_tolerance_is_source_incomplete(tmp_path: Path) -> None:
    _write_pbo_cache(
        tmp_path,
        2562,
        [_row(ministry="กระทรวงกลาโหม", amount_thb=79_240_000_000_000)],  # 79.24 ล้านล้านบาท
    )
    gaps = {
        "pbo_disbursement": {
            2562: {
                "oracle_total_mthb": 100_000_000.0,  # ทำให้ coverage = 79.24%
                "coverage_pct": 79.24,
                "note": "known gap test",
            }
        }
    }
    cfg = _FakeConfig(tmp_path)
    passed, status, coverage_pct, notes = _resolve_status(
        cfg, "pbo_disbursement", 2562, False, gaps=gaps
    )
    assert passed is False
    assert status == "source_incomplete"
    assert coverage_pct == pytest.approx(79.24, abs=0.01)
    assert notes and "known source gap" in notes[0]


def test_resolve_status_coverage_drifted_beyond_tolerance_fails(tmp_path: Path) -> None:
    _write_pbo_cache(
        tmp_path, 2562, [_row(ministry="กระทรวงกลาโหม", amount_thb=50_000_000_000_000)]
    )
    gaps = {
        "pbo_disbursement": {
            2562: {"oracle_total_mthb": 100_000_000.0, "coverage_pct": 79.24, "note": "x"}
        }
    }
    cfg = _FakeConfig(tmp_path)
    passed, status, coverage_pct, notes = _resolve_status(
        cfg, "pbo_disbursement", 2562, False, gaps=gaps
    )
    assert passed is False
    assert status == "failed"
    assert "เปลี่ยนจากที่บันทึกไว้" in notes[0]


# ---------------------------------------------------------------------------
# check_v1 end-to-end กับ known_source_gaps จริง (2562)
# ---------------------------------------------------------------------------


def test_check_v1_2562_real_gap_is_source_incomplete_not_pass(tmp_path: Path) -> None:
    """ใช้ known_source_gaps.yaml จริง (ไม่ mock) — เทียบ cache สังเคราะห์ที่ coverage ตรงตามบันทึก"""
    rows = [
        _row(
            ministry="กระทรวงศึกษาธิการ",
            amount_thb=int(2_377_340.247 * 1_000_000),
            revised_thb=0,
            po_thb=0,
            disbursed_thb=0,
            disbursed_incl_po_thb=0,
            reserved_thb=0,
            carryover_thb=0,
            remaining_committed_thb=0,
            remaining_uncommitted_thb=None,
            remaining_in_progress_thb=0,
            remaining_reserved_extended_thb=None,
            remaining_total_thb=0,
        )
    ]
    _write_pbo_cache(tmp_path, 2562, rows)
    _write_oracle(
        tmp_path,
        2562,
        {
            "kind": "grand_total",
            "values": {
                "amount_thb": 2_377_340.247,
                "revised_thb": None,
                "po_thb": None,
                "disbursed_thb": None,
                "disbursed_incl_po_thb": None,
                "reserved_thb": None,
                "carryover_thb": None,
                "remaining_committed_thb": None,
                "remaining_uncommitted_thb": None,
                "remaining_in_progress_thb": None,
                "remaining_reserved_extended_thb": None,
                "remaining_total_thb": None,
            },
        },
    )
    cfg = _FakeConfig(tmp_path)
    result = check_v1(cfg, 2562)
    assert result.status == "source_incomplete"
    assert result.passed is False
    assert result.coverage_pct == pytest.approx(79.24, abs=0.5)


# ---------------------------------------------------------------------------
# coverage_by_ministry
# ---------------------------------------------------------------------------


def test_coverage_by_ministry_flags_missing_and_partial(tmp_path: Path, monkeypatch) -> None:
    rows = [
        _row(ministry="กระทรวงมหาดไทย", amount_thb=100_000_000),
        _row(ministry="กระทรวงเกษตรและสหกรณ์", amount_thb=5_000_000),
    ]
    _write_pbo_cache(tmp_path, 2562, rows)
    cfg = _FakeConfig(tmp_path)

    import tgbp_pipeline.validate as validate_mod

    monkeypatch.setattr(
        validate_mod,
        "load_known_source_gaps",
        lambda: {
            "pbo_disbursement": {
                2562: {
                    "missing_ministries": ["กระทรวงกลาโหม"],
                    "partial_ministries": ["กระทรวงเกษตรและสหกรณ์"],
                }
            }
        },
    )

    result = coverage_by_ministry(cfg, 2562)
    assert result["กระทรวงมหาดไทย"]["status"] == "ok"
    assert result["กระทรวงเกษตรและสหกรณ์"]["status"] == "partial"
    assert result["กระทรวงกลาโหม"]["status"] == "missing"
    assert result["กระทรวงกลาโหม"]["amount_mthb"] == 0.0


# ---------------------------------------------------------------------------
# check_ministry_continuity
# ---------------------------------------------------------------------------


def test_check_ministry_continuity_reports_missing_vs_neighbors(tmp_path: Path) -> None:
    _write_pbo_cache(tmp_path, 2561, [_row(ministry="กระทรวงกลาโหม", amount_thb=1)])
    _write_pbo_cache(tmp_path, 2562, [_row(ministry="กระทรวงมหาดไทย", amount_thb=1)])
    _write_pbo_cache(
        tmp_path,
        2563,
        [
            _row(ministry="กระทรวงกลาโหม", amount_thb=1),
            _row(ministry="กระทรวงมหาดไทย", amount_thb=1),
        ],
    )
    cfg = _FakeConfig(tmp_path)

    result = check_ministry_continuity(cfg, [2561, 2562, 2563])
    assert result[2562] == ["กระทรวงกลาโหม"]  # มีปี 2561/2563 แต่ไม่มีปี 2562
    assert result[2561] == ["กระทรวงมหาดไทย"]  # อยู่ใน neighbor ถัดไป (2562) แต่ไม่มีใน 2561
    assert result[2563] == []  # ปีสุดท้าย เทียบแค่ neighbor ก่อนหน้า (2562) ซึ่งมีครบใน 2563 แล้ว


def test_check_ministry_continuity_missing_year_file_treated_as_empty(tmp_path: Path) -> None:
    _write_pbo_cache(tmp_path, 2561, [_row(ministry="กระทรวงกลาโหม", amount_thb=1)])
    cfg = _FakeConfig(tmp_path)
    # ปี 2562 ไม่มีไฟล์ cache เลย (เช่นยังไม่ extract) — ไม่ควร raise
    result = check_ministry_continuity(cfg, [2561, 2562])
    assert result[2562] == ["กระทรวงกลาโหม"]
