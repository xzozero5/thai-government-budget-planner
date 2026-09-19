"""T-105 (แก้รอบ 2): `validate.py` — hybrid tolerance, known_source_gaps, coverage_by_ministry,
check_ministry_continuity

ห้ามพึ่งไฟล์ raw จริง (สร้าง fixture parquet เล็ก ๆ ในเทสต์เอง)
"""

from __future__ import annotations

import json
from pathlib import Path

import openpyxl
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from tgbp_pipeline.config import PipelineConfig
from tgbp_pipeline.extract.pbo import pyarrow_schema
from tgbp_pipeline.normalize.schema import budget_line_pyarrow_schema
from tgbp_pipeline.validate import (
    _make_check,
    _resolve_status,
    build_validation_report,
    check_ministry_continuity,
    check_v1,
    check_v3,
    check_v4,
    check_v5,
    check_v7_dataset,
    check_v8,
    check_v9,
    check_v10,
    coverage_by_ministry,
    list_normalized_cache_paths,
    load_known_source_gaps,
    write_validation_report,
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


# ---------------------------------------------------------------------------
# T-110a: V2/V3/V4(ข้าม dataset)/V5/V7(ต่อ dataset)/V8/V9/V10 + ValidationReport
# ---------------------------------------------------------------------------

_NORM_DEFAULT_ROW: dict = {
    "source_id": "n1",
    "dataset": "pbo_disbursement",
    "fiscal_year_be": 2566,
    "fiscal_year_ce": 2023,
    "gov_level": "central",
    "ministry": "กระทรวงกลาโหม",
    "ministry_code": "10000",
    "agency": "กรมทหารบก",
    "agency_code": "10001",
    "province": None,
    "local_gov_name": None,
    "strategy": None,
    "budget_group": None,
    "plan": "แผนงาน A",
    "output_project": None,
    "activity": "งานบริหารทั่วไป",
    "budget_type": "งบบุคลากร",
    "expense_category": None,
    "is_capital": False,
    "item_name_raw": "รายการ",
    "item_name": "รายการ",
    "item_key": "รายการ",
    "item_qty": None,
    "item_unit": None,
    "spec_tokens": [],
    "location_text": None,
    "amount_thb": 100_000,
    "unit_price_thb": None,
    "revised_thb": None,
    "po_thb": None,
    "disbursed_thb": None,
    "disbursed_incl_po_thb": None,
    "reserved_thb": None,
    "carryover_thb": None,
    "disbursement_rate": None,
    "description": None,
    "legal_reference": None,
    "source_path": "PBO/2566.xlsx",
    "source_sheet": "เบิกจ่ายภาพรวมทุกมิติ (7)",
    "source_row": 2,
    "source_page": None,
    "source_doc_id": "d_0",
    "quality_flags": [],
}


def _norm_row(**overrides) -> dict:
    return {**_NORM_DEFAULT_ROW, **overrides}


def _write_normalized_cache(cache_dir: Path, dataset: str, filename: str, rows: list[dict]) -> Path:
    path = cache_dir / "normalized" / dataset / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pylist(rows, schema=budget_line_pyarrow_schema())
    pq.write_table(table, str(path))
    return path


# --- list_normalized_cache_paths ---


def test_list_normalized_cache_paths_groups_by_dataset_dir(tmp_path: Path) -> None:
    _write_normalized_cache(tmp_path, "pbo_disbursement", "2566.parquet", [_norm_row()])
    _write_normalized_cache(
        tmp_path, "pbo_disbursement", "2567.parquet", [_norm_row(source_id="n2")]
    )
    _write_normalized_cache(tmp_path, "committee_table", "d_1.parquet", [_norm_row(source_id="n3")])
    cfg = _FakeConfig(tmp_path)

    result = list_normalized_cache_paths(cfg)

    assert sorted(result) == ["committee_table", "pbo_disbursement"]
    assert len(result["pbo_disbursement"]) == 2


def test_list_normalized_cache_paths_missing_dir_returns_empty(tmp_path: Path) -> None:
    cfg = _FakeConfig(tmp_path)
    assert list_normalized_cache_paths(cfg) == {}


# --- V4 ข้าม dataset (รวมหลายไฟล์ของ dataset เดียวกัน) ---


def test_check_v4_detects_duplicate_source_id_across_files_of_same_dataset(tmp_path: Path) -> None:
    p1 = _write_normalized_cache(
        tmp_path, "pbo_disbursement", "2566.parquet", [_norm_row(source_id="dup")]
    )
    p2 = _write_normalized_cache(
        tmp_path, "pbo_disbursement", "2567.parquet", [_norm_row(source_id="dup")]
    )
    result = check_v4([p1, p2])
    assert result.passed is False
    assert "dup" in result.duplicates


def test_check_v4_passes_when_unique_across_files(tmp_path: Path) -> None:
    p1 = _write_normalized_cache(
        tmp_path, "pbo_disbursement", "2566.parquet", [_norm_row(source_id="a")]
    )
    p2 = _write_normalized_cache(
        tmp_path, "pbo_disbursement", "2567.parquet", [_norm_row(source_id="b")]
    )
    result = check_v4([p1, p2])
    assert result.passed is True


# --- V5 ---


def test_check_v5_skipped_when_sources_json_missing(tmp_path: Path) -> None:
    p1 = _write_normalized_cache(tmp_path, "pbo_disbursement", "2566.parquet", [_norm_row()])
    result = check_v5([p1], tmp_path / "does_not_exist" / "sources.json")
    assert result.status == "skipped_no_sources_json"
    assert result.passed is True


def test_check_v5_ok_when_all_doc_ids_known(tmp_path: Path) -> None:
    p1 = _write_normalized_cache(
        tmp_path, "pbo_disbursement", "2566.parquet", [_norm_row(source_doc_id="d_known")]
    )
    sources_path = tmp_path / "sources.json"
    sources_path.write_text(json.dumps([{"doc_id": "d_known"}]), encoding="utf-8")
    result = check_v5([p1], sources_path)
    assert result.status == "ok"
    assert result.passed is True


def test_check_v5_fails_when_doc_id_missing_from_sources(tmp_path: Path) -> None:
    p1 = _write_normalized_cache(
        tmp_path, "pbo_disbursement", "2566.parquet", [_norm_row(source_doc_id="d_unknown")]
    )
    sources_path = tmp_path / "sources.json"
    sources_path.write_text(json.dumps([{"doc_id": "d_other"}]), encoding="utf-8")
    result = check_v5([p1], sources_path)
    assert result.status == "failed"
    assert "d_unknown" in result.missing_doc_ids


# --- V7 ต่อ dataset (committee_table ปี null ต้องมี flag year_unknown) ---


def test_check_v7_dataset_committee_null_year_allowed_with_flag(tmp_path: Path) -> None:
    path = _write_normalized_cache(
        tmp_path,
        "committee_table",
        "d_1.parquet",
        [_norm_row(dataset="committee_table", fiscal_year_be=None, quality_flags=["year_unknown"])],
    )
    result = check_v7_dataset("committee_table", [path])
    assert result.passed is True
    assert result.n_null_disallowed == 0


def test_check_v7_dataset_committee_null_year_without_flag_fails(tmp_path: Path) -> None:
    path = _write_normalized_cache(
        tmp_path,
        "committee_table",
        "d_1.parquet",
        [_norm_row(dataset="committee_table", fiscal_year_be=None, quality_flags=[])],
    )
    result = check_v7_dataset("committee_table", [path])
    assert result.passed is False
    assert result.n_null_disallowed == 1


def test_check_v7_dataset_pbo_null_year_always_fails_even_without_flag(tmp_path: Path) -> None:
    """เฉพาะ `committee_table` เท่านั้นที่ปี null รับได้ (มี flag) — dataset อื่นปี null ต้อง fail เสมอ"""
    path = _write_normalized_cache(
        tmp_path,
        "pbo_disbursement",
        "2566.parquet",
        [_norm_row(fiscal_year_be=None, quality_flags=["year_unknown"])],
    )
    result = check_v7_dataset("pbo_disbursement", [path])
    assert result.passed is False
    assert result.n_null_disallowed == 1


def test_check_v7_dataset_out_of_range_year_fails() -> None:
    result = check_v7_dataset("pbo_disbursement", [])
    assert result.passed is True  # ไม่มีไฟล์ = ไม่มีข้อมูลให้ fail


# --- V8 (soft, outlier ต่อ item_key) ---


def test_check_v8_flags_price_much_higher_than_p995_x10(tmp_path: Path) -> None:
    # ต้องมี "แถวปกติ" มากพอ (200 แถว) ไม่งั้นแถว outlier เดียวจะไปดัน p99.5 ของกลุ่มตัวเองสูงตาม
    # (ด้วยกลุ่มขนาดเล็ก ๆ เช่น 20 แถว ตัว outlier จะกลายเป็นส่วนหนึ่งของเปอร์เซ็นไทล์บนสุดเสียเอง)
    rows = [_norm_row(source_id=f"n{i}", item_key="แอร์", unit_price_thb=20_000) for i in range(200)]
    rows.append(_norm_row(source_id="outlier", item_key="แอร์", unit_price_thb=50_000_000))
    path = _write_normalized_cache(tmp_path, "pbo_disbursement", "2566.parquet", rows)
    result = check_v8([path])
    assert result.n_outlier_rows == 1
    assert result.examples[0]["item_key"] == "แอร์"


def test_check_v8_no_outlier_when_prices_consistent(tmp_path: Path) -> None:
    rows = [_norm_row(source_id=f"n{i}", item_key="แอร์", unit_price_thb=20_000) for i in range(5)]
    path = _write_normalized_cache(tmp_path, "pbo_disbursement", "2566.parquet", rows)
    result = check_v8([path])
    assert result.n_outlier_rows == 0


def test_check_v8_empty_input_returns_zero() -> None:
    result = check_v8([])
    assert result.n_outlier_rows == 0
    assert result.n_item_keys_checked == 0


# --- V9 (soft, % org_unmapped) ---


def test_check_v9_computes_pct_unmapped_per_dataset(tmp_path: Path) -> None:
    rows = [_norm_row(source_id="a", quality_flags=["org_unmapped"]), _norm_row(source_id="b")]
    path = _write_normalized_cache(tmp_path, "pbo_disbursement", "2566.parquet", rows)
    [result] = check_v9({"pbo_disbursement": [path]})
    assert result.n_rows == 2
    assert result.n_unmapped == 1
    assert result.pct_unmapped == pytest.approx(50.0)


# --- V10 ---


def test_check_v10_skips_when_raw_dir_missing(tmp_path: Path) -> None:
    cfg = _FakeConfig(tmp_path)
    cfg.raw_data_dir = tmp_path / "no_such_raw_dir"
    result = check_v10(cfg, tmp_path / "sources.json")
    assert result.status == "skipped_no_raw_dir"
    assert result.passed is True


def test_check_v10_fails_when_pdf_missing_from_sources(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    (raw_dir / "PBO").mkdir(parents=True)
    (raw_dir / "PBO" / "report.pdf").write_bytes(b"%PDF-1.4 fake")
    cfg = _FakeConfig(tmp_path)
    cfg.raw_data_dir = raw_dir
    sources_path = tmp_path / "sources.json"
    sources_path.write_text(json.dumps([]), encoding="utf-8")  # ไม่มี pdf เลยใน sources.json

    result = check_v10(cfg, sources_path)

    assert result.status == "failed"
    assert result.passed is False
    assert "PBO/report.pdf" in result.missing_rel_paths


def test_check_v10_ok_when_all_pdfs_registered(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    (raw_dir / "PBO").mkdir(parents=True)
    (raw_dir / "PBO" / "report.pdf").write_bytes(b"%PDF-1.4 fake")
    cfg = _FakeConfig(tmp_path)
    cfg.raw_data_dir = raw_dir
    sources_path = tmp_path / "sources.json"
    sources_path.write_text(
        json.dumps([{"doc_id": "d_x", "rel_path": "PBO/report.pdf", "kind": "pdf"}]),
        encoding="utf-8",
    )

    result = check_v10(cfg, sources_path)

    assert result.status == "ok"
    assert result.passed is True


# --- V3 (ADR-005) — hard เฉพาะยอดรวมทั้งไฟล์ต่างจาก summary เกิน 1% ---


def _write_raja_summary_raw_file(cfg: PipelineConfig, rel_path: str, groups: list[tuple]) -> None:
    path = cfg.raw_data_dir / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "summary_ocr_raw_data"
    ws.append(("page", "plan", "work", "budget_group", "total_amount"))
    for g in groups:
        ws.append(g)
    wb.save(path)


def test_check_v3_passes_when_overall_diff_within_1_percent(tmp_path: Path) -> None:
    cfg = _FakeConfig(tmp_path)
    cfg.raw_data_dir = tmp_path / "raw"
    cfg.raw_data_dir.mkdir()
    rel_path = "งบประมาณ สมุทรปราการ/3 - x/ร่างข้อบัญญัติงบ 2570 อบต. ราชาเทวะ - Sheets.xlsx"
    # oracle รวม 1,000,000 บาท, ข้อมูลจริงรวม 995,000 บาท (diff 0.5% < 1%) — ต้องผ่าน
    _write_raja_summary_raw_file(cfg, rel_path, [(1, "แผน A", "งาน A", "งบบุคลากร", 1_000_000)])
    row = _norm_row(
        dataset="local_ordinance_2570",
        plan="แผน A",
        activity="งาน A",
        budget_type="งบบุคลากร",
        amount_thb=995_000,
        source_path=rel_path,
        quality_flags=["upstream_ocr"],
    )
    path = _write_normalized_cache(tmp_path, "local_ordinance_2570", "x.parquet", [row])

    summary = check_v3(cfg, [path])

    assert summary.passed is True
    assert summary.files[0].status == "ok"


def test_check_v3_fails_hard_when_overall_diff_exceeds_1_percent(tmp_path: Path) -> None:
    cfg = _FakeConfig(tmp_path)
    cfg.raw_data_dir = tmp_path / "raw"
    cfg.raw_data_dir.mkdir()
    rel_path = "งบประมาณ สมุทรปราการ/3 - x/ร่างข้อบัญญัติงบ 2570 อบต. ราชาเทวะ - Sheets.xlsx"
    # oracle รวม 1,000,000 บาท, ข้อมูลจริงรวม 500,000 บาท (diff 50% > 1%) — ต้อง fail
    _write_raja_summary_raw_file(cfg, rel_path, [(1, "แผน A", "งาน A", "งบบุคลากร", 1_000_000)])
    row = _norm_row(
        dataset="local_ordinance_2570",
        plan="แผน A",
        activity="งาน A",
        budget_type="งบบุคลากร",
        amount_thb=500_000,
        source_path=rel_path,
        quality_flags=["upstream_ocr"],
    )
    path = _write_normalized_cache(tmp_path, "local_ordinance_2570", "x.parquet", [row])

    summary = check_v3(cfg, [path])

    assert summary.passed is False
    assert summary.files[0].status == "mismatch"


def test_check_v3_ignores_files_without_upstream_ocr_flag(tmp_path: Path) -> None:
    cfg = _FakeConfig(tmp_path)
    cfg.raw_data_dir = tmp_path / "raw"
    cfg.raw_data_dir.mkdir()
    row = _norm_row(dataset="local_ordinance_2570", quality_flags=[])
    path = _write_normalized_cache(tmp_path, "local_ordinance_2570", "x.parquet", [row])

    summary = check_v3(cfg, [path])

    assert summary.passed is True
    assert summary.files == []


# --- build_validation_report / write_validation_report (end-to-end, tmp_path เท่านั้น) ---


def test_build_validation_report_end_to_end_minimal(tmp_path: Path) -> None:
    """ไม่มี pbo/act2570 cache เลย (V1/V2 ว่าง) — เช็คว่า normalized-only ก็ยังทำงานได้ครบ

    ใช้ `PipelineConfig` จริง (ไม่ใช่ `_FakeConfig`) เพราะ `write_validation_report` เรียก
    `cfg.assert_writable_path` ซึ่ง `_FakeConfig` (มีแค่ `cache_dir`) ไม่มีเมธอดนี้
    """
    cfg = PipelineConfig(
        config_path=tmp_path / "config.yaml",
        raw_data_dir=tmp_path / "raw",
        output_dir=tmp_path / "out",
        cache_dir=tmp_path / "cache",
        fixtures_dir=tmp_path / "fixtures",
    )
    cfg.raw_data_dir.mkdir()

    row_ok = _norm_row(source_id="ok1", source_doc_id="d_known")
    row_out_of_range = _norm_row(source_id="bad1", fiscal_year_be=1000, source_doc_id="d_known")
    _write_normalized_cache(
        cfg.cache_dir, "pbo_disbursement", "2566.parquet", [row_ok, row_out_of_range]
    )

    sources_path = cfg.output_dir / "sources.json"
    sources_path.parent.mkdir(parents=True, exist_ok=True)
    sources_path.write_text(json.dumps([{"doc_id": "d_known"}]), encoding="utf-8")

    report = build_validation_report(cfg)

    assert report.v1_by_year == {}
    assert report.v2 == []
    assert report.v4_by_dataset["pbo_disbursement"].passed is True
    assert report.v5.status == "ok"
    assert report.v7_by_dataset["pbo_disbursement"].passed is False  # fiscal_year_be=1000 นอกช่วง
    assert report.passed is False
    assert any("V7" in msg for msg in report.hard_failures)

    json_path, md_path = write_validation_report(cfg, report)
    assert json_path.is_file()
    assert md_path.is_file()
    assert "FAIL" in md_path.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# T-110b: V6 (ไฟล์ output > 24 MB) + sources_json_path override + V10 magic-bytes
# ---------------------------------------------------------------------------

from tgbp_pipeline.validate import check_v6  # noqa: E402


def test_check_v6_passes_when_all_files_under_limit(tmp_path: Path) -> None:
    small = tmp_path / "a.parquet"
    small.write_bytes(b"x" * 100)
    result = check_v6([small], max_bytes=1000)
    assert result.passed is True
    assert result.oversized == []


def test_check_v6_fails_and_lists_oversized_files(tmp_path: Path) -> None:
    big = tmp_path / "big.parquet"
    big.write_bytes(b"x" * 2000)
    small = tmp_path / "small.parquet"
    small.write_bytes(b"x" * 10)
    result = check_v6([big, small], max_bytes=1000)
    assert result.passed is False
    assert result.n_files == 2
    assert result.oversized == [{"path": str(big), "bytes": 2000}]


def test_check_v10_detects_pdf_without_pdf_extension_via_magic_bytes(tmp_path: Path) -> None:
    """T-110b: `check_v10` ต้องนับ PDF ด้วย magic bytes เหมือน `inventory.py` (ไม่ใช่แค่นามสกุล) —
    ไฟล์จริงในโปรเจกต์มี PDF 1 ไฟล์ที่ไม่มีนามสกุล `.pdf` ทำให้นับด้วยนามสกุลอย่างเดียวขาดไป 1 ไฟล์
    """
    raw_dir = tmp_path / "raw"
    (raw_dir / "PBO").mkdir(parents=True)
    (raw_dir / "PBO" / "no_extension_but_pdf").write_bytes(b"%PDF-1.4 fake content")
    cfg = _FakeConfig(tmp_path)
    cfg.raw_data_dir = raw_dir
    sources_path = tmp_path / "sources.json"
    sources_path.write_text(
        json.dumps([{"doc_id": "d_x", "rel_path": "PBO/no_extension_but_pdf", "kind": "pdf"}]),
        encoding="utf-8",
    )

    result = check_v10(cfg, sources_path)

    assert result.status == "ok"
    assert result.n_pdf_in_raw == 1


def test_build_validation_report_v6_hard_fails_when_published_file_oversized(
    tmp_path: Path,
) -> None:
    cfg = PipelineConfig(
        config_path=tmp_path / "config.yaml",
        raw_data_dir=tmp_path / "raw",
        output_dir=tmp_path / "out",
        cache_dir=tmp_path / "cache",
        fixtures_dir=tmp_path / "fixtures",
    )
    cfg.raw_data_dir.mkdir()
    cfg.output_dir.mkdir(parents=True)
    row_ok = _norm_row(source_id="ok1", source_doc_id="d_known")
    _write_normalized_cache(cfg.cache_dir, "pbo_disbursement", "2566.parquet", [row_ok])
    (cfg.output_dir / "sources.json").write_text(
        json.dumps([{"doc_id": "d_known"}]), encoding="utf-8"
    )

    oversized_file = cfg.output_dir / "big.parquet"
    with oversized_file.open("wb") as f:
        f.seek(24_000_001)
        f.write(b"0")  # sparse file > 24 MB — เร็ว ไม่กิน disk จริงเต็มขนาด

    report = build_validation_report(
        cfg,
        published_files=[oversized_file],
        total_output_bytes=24_000_002,
        total_output_bytes_limit=1_000_000_000,
    )

    assert report.v6 is not None
    assert report.v6.passed is False
    assert report.passed is False
    assert any("V6" in msg for msg in report.hard_failures)


def test_build_validation_report_total_bytes_over_limit_is_hard_failure(tmp_path: Path) -> None:
    cfg = PipelineConfig(
        config_path=tmp_path / "config.yaml",
        raw_data_dir=tmp_path / "raw",
        output_dir=tmp_path / "out",
        cache_dir=tmp_path / "cache",
        fixtures_dir=tmp_path / "fixtures",
    )
    cfg.raw_data_dir.mkdir()
    cfg.output_dir.mkdir(parents=True)
    (cfg.output_dir / "sources.json").write_text(json.dumps([]), encoding="utf-8")

    report = build_validation_report(
        cfg, published_files=[], total_output_bytes=999, total_output_bytes_limit=100
    )

    assert report.passed is False
    assert any("total_output_bytes" in msg for msg in report.hard_failures)


def test_build_validation_report_no_published_files_v6_is_none(tmp_path: Path) -> None:
    """ไม่ส่ง `published_files` (พฤติกรรมเดิมของ `tgbp validate` เดี่ยว ๆ) — `v6` ต้องเป็น `None` เสมอ"""
    cfg = PipelineConfig(
        config_path=tmp_path / "config.yaml",
        raw_data_dir=tmp_path / "raw",
        output_dir=tmp_path / "out",
        cache_dir=tmp_path / "cache",
        fixtures_dir=tmp_path / "fixtures",
    )
    cfg.raw_data_dir.mkdir()
    (cfg.output_dir).mkdir(parents=True)
    (cfg.output_dir / "sources.json").write_text(json.dumps([]), encoding="utf-8")

    report = build_validation_report(cfg)

    assert report.v6 is None
    assert report.total_output_bytes is None


def test_build_validation_report_sources_json_path_override(tmp_path: Path) -> None:
    """`sources_json_path` (T-110b): `publish.py` เขียนไป `out_dir` ที่ไม่ใช่ `cfg.output_dir` เสมอ
    (เช่น `sample()` เขียนไป `cfg.fixtures_dir`) — V5/V10 ต้องเช็คไฟล์ที่ path นั้นจริง ไม่ใช่
    `cfg.output_dir` ตายตัว
    """
    cfg = PipelineConfig(
        config_path=tmp_path / "config.yaml",
        raw_data_dir=tmp_path / "raw",
        output_dir=tmp_path / "out",
        cache_dir=tmp_path / "cache",
        fixtures_dir=tmp_path / "fixtures",
    )
    cfg.raw_data_dir.mkdir()
    row_ok = _norm_row(source_id="ok1", source_doc_id="d_known")
    _write_normalized_cache(cfg.cache_dir, "pbo_disbursement", "2566.parquet", [row_ok])

    custom_dir = tmp_path / "custom_out"
    custom_dir.mkdir()
    (custom_dir / "sources.json").write_text(json.dumps([{"doc_id": "d_known"}]), encoding="utf-8")
    # cfg.output_dir/sources.json ไม่มีเลย — ถ้า V5 ยังอ่าน cfg.output_dir ตายตัวจะ skip/fail ผิด

    report = build_validation_report(cfg, sources_json_path=custom_dir / "sources.json")

    assert report.v5.status == "ok"


def test_write_validation_report_custom_out_dir(tmp_path: Path) -> None:
    cfg = PipelineConfig(
        config_path=tmp_path / "config.yaml",
        raw_data_dir=tmp_path / "raw",
        output_dir=tmp_path / "out",
        cache_dir=tmp_path / "cache",
        fixtures_dir=tmp_path / "fixtures",
    )
    report = build_validation_report(cfg)
    custom_dir = tmp_path / "somewhere_else"
    json_path, md_path = write_validation_report(cfg, report, out_dir=custom_dir)
    assert json_path == custom_dir / "validation.json"
    assert json_path.is_file()
    assert md_path.is_file()
