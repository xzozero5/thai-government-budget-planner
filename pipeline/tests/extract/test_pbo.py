"""T-105: `extract/pbo.py` + `validate.check_v1` — gotchas ยืนยันแล้วใน 02 §A1 / 03 §4.1

ห้ามพึ่งไฟล์ raw จริง (สร้าง fixture xlsx เล็ก ๆ ในเทสต์เอง) ยกเว้นเทสต์ที่ mark
`@pytest.mark.rawdata`
"""

from __future__ import annotations

import dataclasses
from pathlib import Path

import openpyxl
import pyarrow.parquet as pq
import pytest
import yaml

from tgbp_pipeline.config import PipelineConfig
from tgbp_pipeline.extract.pbo import (
    EXPECTED_HEADER,
    PboHeaderMismatchError,
    discover_year_files,
    extract_year,
    load_oracle,
)
from tgbp_pipeline.util.hash import doc_id_for_path
from tgbp_pipeline.util.hash import source_id as compute_source_id
from tgbp_pipeline.validate import check_v1

DATASET = "pbo_disbursement"


def _write_config(tmp_path: Path) -> Path:
    pipeline_dir = tmp_path / "pipeline"
    pipeline_dir.mkdir()
    (tmp_path / "raw").mkdir()
    (tmp_path / "web" / "public" / "data").mkdir(parents=True)
    (tmp_path / "web" / "tests" / "fixtures" / "data").mkdir(parents=True)

    config_path = pipeline_dir / "config.yaml"
    config_path.write_text(
        yaml.safe_dump(
            {
                "raw_data_dir": "../raw",
                "output_dir": "../web/public/data",
                "cache_dir": ".cache",
                "fixtures_dir": "../web/tests/fixtures/data",
            }
        ),
        encoding="utf-8",
    )
    return config_path


def _row(
    year: int = 2566,
    ministry: str = "กระทรวงกลาโหม",
    agency: str = "กรมทหารบก",
    strategy: str = "ยุทธศาสตร์ A",
    plan: str = "แผนงาน A",
    output_project: str = "ผลผลิต A",
    activity: str = "งาน A",
    budget_type: str = "งบลงทุน",
    capital_type: str | None = "รายจ่ายลงทุน",
    item_name: object = "เครื่องปรับอากาศ แบบแยกส่วน ขนาด 18,000 บีทียู",
    amount: object = 1.5,
    revised: object = 1.5,
    po: object = 0.1,
    disbursed: object = 1.0,
    disbursed_incl_po: object = 1.1,
    reserved: object = 0.4,
    carryover: object = 0.05,
    remaining_committed: object = 0.0,
    remaining_uncommitted: object = "-",
    remaining_in_progress: object = 0.0,
    remaining_reserved_extended: object = "-",
    remaining_total: object = 0.0,
) -> tuple:
    return (
        year,
        ministry,
        agency,
        strategy,
        plan,
        output_project,
        activity,
        budget_type,
        capital_type,
        item_name,
        amount,
        revised,
        po,
        disbursed,
        disbursed_incl_po,
        reserved,
        carryover,
        remaining_committed,
        remaining_uncommitted,
        remaining_in_progress,
        remaining_reserved_extended,
        remaining_total,
    )


def _grand_total_row(money_values: tuple) -> tuple:
    assert len(money_values) == 12
    return ("Grand Total",) * 10 + money_values


def _write_pbo_workbook(
    path: Path,
    data_rows: list[tuple],
    sheet_suffix: str = " (7)",
    extra_columns: int = 0,
    sheet1_rows: list[tuple] | None = None,
    header_override: tuple | None = None,
) -> str:
    wb = openpyxl.Workbook()
    ws = wb.active
    sheet_name = f"เบิกจ่ายภาพรวมทุกมิติ{sheet_suffix}"
    ws.title = sheet_name

    header: list = list(header_override) if header_override is not None else list(EXPECTED_HEADER)
    if extra_columns:
        header += [f"คอลัมน์{i + 1}" for i in range(extra_columns)]
    ws.append(header)

    for row in data_rows:
        if extra_columns:
            row = tuple(row) + (None,) * extra_columns
        ws.append(row)

    if sheet1_rows is not None:
        ws1 = wb.create_sheet("Sheet1", 0)
        for row in sheet1_rows:
            ws1.append(row)

    wb.save(path)
    return sheet_name


def _read_cache_records(cache_path: Path) -> list[dict]:
    return pq.read_table(str(cache_path)).to_pylist()


# ---------------------------------------------------------------------------
# กรณีพื้นฐาน: มี Grand Total (2558-2560, 2562-2566)
# ---------------------------------------------------------------------------


def test_extract_year_with_grand_total_basic(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    pbo_dir = cfg.raw_data_dir / "PBO"
    pbo_dir.mkdir(parents=True)
    path = pbo_dir / "2566.xlsx"

    row1 = _row(ministry="กระทรวงกลาโหม", amount=1.5, revised=1.5, disbursed=1.0)
    row2 = _row(ministry="กระทรวงมหาดไทย", amount=2.5, revised=2.5, disbursed=2.0)
    # ผลรวมของ 2 แถว (money defaults ใน _row: po=0.1, disbursed_incl_po=1.1, reserved=0.4,
    # carryover=0.05, remaining_committed/in_progress=0.0,
    # remaining_uncommitted/reserved_extended='-')
    grand_total = _grand_total_row((4.0, 4.0, 0.2, 3.0, 2.2, 0.8, 0.1, 0.0, "-", 0.0, "-", 0.0))
    sheet_name = _write_pbo_workbook(path, [grand_total, row1, row2])

    result = extract_year(cfg, 2566, path)

    assert result.rows_written == 2
    assert result.n_grand_total_rows == 1
    assert result.sheet_name == sheet_name

    records = _read_cache_records(result.cache_path)
    # Grand Total อยู่ที่แถว Excel 2 (header=1) → ข้อมูลจริงเริ่มแถว 3
    assert [r["source_row"] for r in records] == [3, 4]
    assert records[0]["ministry"] == "กระทรวงกลาโหม"
    assert records[0]["amount_thb"] == 1_500_000
    assert records[0]["is_capital"] is True
    assert records[0]["amount_unit_source"] == "million_thb"

    oracle = load_oracle(cfg)["2566"]
    assert oracle["kind"] == "grand_total"
    assert oracle["values"]["amount_thb"] == 4.0

    v1 = check_v1(cfg, 2566)
    assert v1.kind == "grand_total"
    assert v1.passed is True


def test_extract_year_without_grand_total_no_sheet1_is_no_oracle(tmp_path: Path) -> None:
    """ปีที่ไม่มี Grand Total และไม่มี Sheet1 → oracle kind='none'; source_row เริ่มแถว 2"""
    cfg = PipelineConfig.load(_write_config(tmp_path))
    pbo_dir = cfg.raw_data_dir / "PBO"
    pbo_dir.mkdir(parents=True)
    path = pbo_dir / "2567.xlsx"

    row1 = _row(year=2567)
    sheet_name = _write_pbo_workbook(path, [row1], sheet_suffix=" (8)")

    result = extract_year(cfg, 2567, path)

    assert result.rows_written == 1
    assert result.n_grand_total_rows == 0
    records = _read_cache_records(result.cache_path)
    assert [r["source_row"] for r in records] == [2]

    oracle = load_oracle(cfg)["2567"]
    assert oracle["kind"] == "none"
    assert oracle["n_rows"] == 1
    # 2567 มี expected_rows คงที่ (221,571) — ปีอื่นที่ไม่มี oracle เลยไม่ควรมี key นี้ตั้งไว้ผิด
    assert oracle["expected_rows"] == 221_571

    v1 = check_v1(cfg, 2567)
    assert v1.kind == "none"
    assert v1.passed is True
    assert v1.n_rows == 1
    assert any("ไม่ตรงคาดการณ์" in note for note in v1.notes)
    assert sheet_name.startswith("เบิกจ่ายภาพรวมทุกมิติ")


# ---------------------------------------------------------------------------
# Sheet1 นำหน้า — 2561-style (แคบ, รายกระทรวงทั้งหมด) และ 2568-style (กว้าง, กระทรวงเดียว)
# ---------------------------------------------------------------------------


def test_extract_year_sheet1_ministry_style_2561(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    pbo_dir = cfg.raw_data_dir / "PBO"
    pbo_dir.mkdir(parents=True)
    path = pbo_dir / "2561.xlsx"

    row1 = _row(year=2561, ministry="กระทรวงกลาโหม", amount=1.5)
    row2 = _row(year=2561, ministry="กระทรวงมหาดไทย", amount=2.5)

    sheet1_rows = [
        ("ป้ายชื่อแถว", "ผลรวม ของ พรบ. (ล้านบาท)"),
        ("กระทรวงกลาโหม", 1.5),
        ("กระทรวงมหาดไทย", 2.5),
        ("ผลรวมทั้งหมด", 4.0),
    ]
    _write_pbo_workbook(path, [row1, row2], sheet_suffix=" (15)", sheet1_rows=sheet1_rows)

    result = extract_year(cfg, 2561, path)
    assert result.n_grand_total_rows == 0

    oracle = load_oracle(cfg)["2561"]
    assert oracle["kind"] == "sheet1_ministry"
    assert oracle["values"]["amount_thb"] == 4.0
    assert oracle["by_ministry"] == {"กระทรวงกลาโหม": 1.5, "กระทรวงมหาดไทย": 2.5}

    v1 = check_v1(cfg, 2561)
    assert v1.kind == "sheet1_ministry"
    assert v1.passed is True
    assert set(v1.ministry_checks) == {"กระทรวงกลาโหม", "กระทรวงมหาดไทย"}


def test_extract_year_sheet1_ministry_style_2561_fails_when_mismatched(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    pbo_dir = cfg.raw_data_dir / "PBO"
    pbo_dir.mkdir(parents=True)
    path = pbo_dir / "2561.xlsx"

    row1 = _row(year=2561, ministry="กระทรวงกลาโหม", amount=1.5)
    sheet1_rows = [
        ("ป้ายชื่อแถว", "ผลรวม ของ พรบ. (ล้านบาท)"),
        ("กระทรวงกลาโหม", 999.0),  # จงใจไม่ตรงกับข้อมูลจริง (1.5)
        ("ผลรวมทั้งหมด", 999.0),
    ]
    _write_pbo_workbook(path, [row1], sheet_suffix=" (15)", sheet1_rows=sheet1_rows)

    extract_year(cfg, 2561, path)
    v1 = check_v1(cfg, 2561)
    assert v1.passed is False


def test_extract_year_sheet1_total_style_2568(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    pbo_dir = cfg.raw_data_dir / "PBO"
    pbo_dir.mkdir(parents=True)
    path = pbo_dir / "2568.xlsx"

    ministry = "สำนักนายกรัฐมนตรี"
    row_current = _row(
        year=2568,
        ministry=ministry,
        capital_type="รายจ่ายประจำ",
        amount=5.0,
        revised=5.0,
        disbursed=4.0,
    )
    row_capital = _row(
        year=2568,
        ministry=ministry,
        capital_type="รายจ่ายลงทุน",
        amount=2.0,
        revised=2.0,
        disbursed=1.5,
    )

    group_header = (
        None,
        "รายจ่ายประจำ",
        None,
        None,
        "รายจ่ายลงทุน",
        None,
        None,
        "ผลรวม ผลรวม ของ พรบ. (ล้านบาท)",
        "ผลรวม ผลรวม ของ งบฯ หลังโอน/ปป. ทั้งสิ้น (ล้านบาท)",
        "ผลรวม ผลรวม ของ เบิกจ่ายทั้งสิ้น (ล้านบาท)",
    )
    header_row = (
        "ป้ายชื่อแถว",
        "ผลรวม ของ พรบ. (ล้านบาท)",
        "ผลรวม ของ งบฯ หลังโอน/ปป. ทั้งสิ้น (ล้านบาท)",
        "ผลรวม ของ เบิกจ่ายทั้งสิ้น (ล้านบาท)",
        "ผลรวม ของ พรบ. (ล้านบาท)",
        "ผลรวม ของ งบฯ หลังโอน/ปป. ทั้งสิ้น (ล้านบาท)",
        "ผลรวม ของ เบิกจ่ายทั้งสิ้น (ล้านบาท)",
        None,
        None,
        None,
    )
    data_row = (ministry, 5.0, 5.0, 4.0, 2.0, 2.0, 1.5, 7.0, 7.0, 5.5)
    total_row = ("ผลรวมทั้งหมด", 5.0, 5.0, 4.0, 2.0, 2.0, 1.5, 7.0, 7.0, 5.5)

    _write_pbo_workbook(
        path,
        [row_current, row_capital],
        sheet_suffix=" (8)",
        sheet1_rows=[group_header, header_row, data_row, total_row],
    )

    result = extract_year(cfg, 2568, path)
    assert result.n_grand_total_rows == 0

    oracle = load_oracle(cfg)["2568"]
    assert oracle["kind"] == "sheet1_total"
    assert oracle["ministry_filter"] == "สำนักนายกรัฐมนตรี"
    assert oracle["values"]["total"]["amount_thb"] == 7.0

    v1 = check_v1(cfg, 2568)
    assert v1.kind == "sheet1_total"
    assert v1.passed is True


# ---------------------------------------------------------------------------
# คอลัมน์เกิน 22 (ปี 2567 max_column=16384) — ต้องถูกตัดทิ้งโดยไม่กระทบผล
# ---------------------------------------------------------------------------


def test_extract_year_ignores_columns_beyond_22(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    pbo_dir = cfg.raw_data_dir / "PBO"
    pbo_dir.mkdir(parents=True)
    path = pbo_dir / "2567.xlsx"

    row1 = _row(year=2567)
    _write_pbo_workbook(path, [row1], sheet_suffix=" (8)", extra_columns=8)

    result = extract_year(cfg, 2567, path)
    assert result.rows_written == 1
    records = _read_cache_records(result.cache_path)
    assert (
        set(records[0].keys())
        - {
            "source_id",
            "dataset",
            "fiscal_year_be",
            "fiscal_year_ce",
            "ministry",
            "agency",
            "strategy",
            "plan",
            "output_project",
            "activity",
            "budget_type",
            "is_capital",
            "capital_type_raw",
            "item_name_raw",
            "amount_thb",
            "revised_thb",
            "po_thb",
            "disbursed_thb",
            "disbursed_incl_po_thb",
            "reserved_thb",
            "carryover_thb",
            "remaining_committed_thb",
            "remaining_uncommitted_thb",
            "remaining_in_progress_thb",
            "remaining_reserved_extended_thb",
            "remaining_total_thb",
            "disbursement_rate",
            "amount_unit_source",
            "source_path",
            "source_sheet",
            "source_row",
            "source_doc_id",
            "quality_flags",
        }
        == set()
    )


# ---------------------------------------------------------------------------
# '-' → null, ค่าติดลบ, ชื่อว่าง, ปีไม่ตรงชื่อไฟล์
# ---------------------------------------------------------------------------


def test_extract_year_dash_becomes_null(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    pbo_dir = cfg.raw_data_dir / "PBO"
    pbo_dir.mkdir(parents=True)
    path = pbo_dir / "2566.xlsx"

    row1 = _row(po="-", reserved="-")
    _write_pbo_workbook(path, [row1])

    result = extract_year(cfg, 2566, path)
    record = _read_cache_records(result.cache_path)[0]
    assert record["po_thb"] is None
    assert record["reserved_thb"] is None


def test_extract_year_negative_amount_flag(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    pbo_dir = cfg.raw_data_dir / "PBO"
    pbo_dir.mkdir(parents=True)
    path = pbo_dir / "2566.xlsx"

    row1 = _row(carryover=-0.5)
    _write_pbo_workbook(path, [row1])

    result = extract_year(cfg, 2566, path)
    record = _read_cache_records(result.cache_path)[0]
    assert record["carryover_thb"] == -500_000
    assert "negative_amount" in record["quality_flags"]
    assert result.flag_counts["negative_amount"] == 1


def test_extract_year_corrupt_row_text_in_money_column_nulls_all_money_fields(
    tmp_path: Path,
) -> None:
    """แถวเสียจริงแบบ PBO/2562.xlsx แถว 226: คอลัมน์เงินมีข้อความปน ('งบลงทุน' แทนตัวเลข)

    → null ทุกฟิลด์เงินของแถวนั้น + flag `corrupt_row` (คง item_name_raw/มิติไว้เพื่อ citation)
    """
    cfg = PipelineConfig.load(_write_config(tmp_path))
    pbo_dir = cfg.raw_data_dir / "PBO"
    pbo_dir.mkdir(parents=True)
    path = pbo_dir / "2566.xlsx"

    good_row = _row(ministry="กระทรวงกลาโหม", amount=1.5)
    corrupt_row = _row(
        ministry="สำนักนายกรัฐมนตรี",
        agency="กรมประชาสัมพันธ์",
        item_name="แผนงานบูรณาการเสริมสร้างความเข้มแข็งและยั่งยืนให้กับเศรษฐกิจ",
        amount=607006457005,  # ล้านบาท — เกิน threshold มหาศาล (จริงจาก PBO/2562.xlsx แถว 226)
        revised=7006457005,
        po="งบลงทุน",  # ข้อความหลุดมาแทนตัวเลข (จริงจากไฟล์)
        disbursed="รายจ่ายลงทุน",
        disbursed_incl_po="ชุดผสมหัวอาหารแกนนอน 3 ตัน",
    )
    _write_pbo_workbook(path, [good_row, corrupt_row])

    result = extract_year(cfg, 2566, path)
    assert result.flag_counts["corrupt_row"] == 1
    records = _read_cache_records(result.cache_path)

    good = next(r for r in records if r["ministry"] == "กระทรวงกลาโหม")
    assert good["amount_thb"] == 1_500_000
    assert "corrupt_row" not in good["quality_flags"]

    bad = next(r for r in records if r["ministry"] == "สำนักนายกรัฐมนตรี")
    assert "corrupt_row" in bad["quality_flags"]
    money_cols = [
        "amount_thb",
        "revised_thb",
        "po_thb",
        "disbursed_thb",
        "disbursed_incl_po_thb",
        "reserved_thb",
        "carryover_thb",
        "remaining_committed_thb",
        "remaining_uncommitted_thb",
        "remaining_in_progress_thb",
        "remaining_reserved_extended_thb",
        "remaining_total_thb",
    ]
    assert all(bad[c] is None for c in money_cols)
    # มิติ/item_name_raw ต้องคงไว้ตามจริงเพื่อ citation — ไม่ใช่ null ไปด้วย
    assert bad["agency"] == "กรมประชาสัมพันธ์"
    assert bad["item_name_raw"] == "แผนงานบูรณาการเสริมสร้างความเข้มแข็งและยั่งยืนให้กับเศรษฐกิจ"


def test_extract_year_corrupt_row_extreme_magnitude_without_text_still_flagged(
    tmp_path: Path,
) -> None:
    """ค่าตัวเลขล้วน (ไม่มีข้อความปน) แต่ใหญ่เกิน 1e13 บาท ก็ต้องถือว่าเป็นแถวเสียเช่นกัน"""
    cfg = PipelineConfig.load(_write_config(tmp_path))
    pbo_dir = cfg.raw_data_dir / "PBO"
    pbo_dir.mkdir(parents=True)
    path = pbo_dir / "2566.xlsx"

    row1 = _row(amount=20_000_000)  # 20,000,000 ล้านบาท = 2e13 บาท > threshold
    _write_pbo_workbook(path, [row1])

    result = extract_year(cfg, 2566, path)
    record = _read_cache_records(result.cache_path)[0]
    assert "corrupt_row" in record["quality_flags"]
    assert record["amount_thb"] is None


def test_extract_year_v1_excludes_corrupt_row_from_sum(tmp_path: Path) -> None:
    """V1 ต้องไม่นับแถว corrupt_row (ค่าถูก null ไปแล้ว sum จึงข้ามอัตโนมัติ)"""
    cfg = PipelineConfig.load(_write_config(tmp_path))
    pbo_dir = cfg.raw_data_dir / "PBO"
    pbo_dir.mkdir(parents=True)
    path = pbo_dir / "2566.xlsx"

    row1 = _row(amount=1.5, revised=1.5, disbursed=1.0)
    corrupt = _row(amount=607006457005, po="งบลงทุน")
    # ผลรวมนับเฉพาะ row1 (money defaults: po=0.1, disbursed_incl_po=1.1, reserved=0.4,
    # carryover=0.05) — ตัด corrupt แถวออกทั้งหมด (ทุกฟิลด์เงินถูก null ไปแล้ว)
    grand_total = _grand_total_row((1.5, 1.5, 0.1, 1.0, 1.1, 0.4, 0.05, 0.0, "-", 0.0, "-", 0.0))
    _write_pbo_workbook(path, [grand_total, row1, corrupt])

    extract_year(cfg, 2566, path)
    v1 = check_v1(cfg, 2566)
    assert v1.status == "ok"
    assert v1.passed is True


def test_extract_year_empty_item_name_flag(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    pbo_dir = cfg.raw_data_dir / "PBO"
    pbo_dir.mkdir(parents=True)
    path = pbo_dir / "2566.xlsx"

    row1 = _row(item_name="-")
    row2 = _row(item_name=None)
    _write_pbo_workbook(path, [row1, row2])

    result = extract_year(cfg, 2566, path)
    records = _read_cache_records(result.cache_path)
    assert all(r["item_name_raw"] is None for r in records)
    assert all("empty_item_name" in r["quality_flags"] for r in records)
    assert result.flag_counts["empty_item_name"] == 2


def test_extract_year_year_mismatch_flag(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    pbo_dir = cfg.raw_data_dir / "PBO"
    pbo_dir.mkdir(parents=True)
    path = pbo_dir / "2566.xlsx"

    row1 = _row(year=2565)  # ไฟล์ชื่อ 2566.xlsx แต่แถวบอกปี 2565
    _write_pbo_workbook(path, [row1])

    result = extract_year(cfg, 2566, path)
    record = _read_cache_records(result.cache_path)[0]
    assert record["fiscal_year_be"] == 2565
    assert record["fiscal_year_ce"] == 2022
    assert "year_mismatch" in record["quality_flags"]
    assert result.flag_counts["year_mismatch"] == 1


# ---------------------------------------------------------------------------
# header เพี้ยน → raise ชัดเจน
# ---------------------------------------------------------------------------


def test_extract_year_header_mismatch_raises(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    pbo_dir = cfg.raw_data_dir / "PBO"
    pbo_dir.mkdir(parents=True)
    path = pbo_dir / "2566.xlsx"

    bad_header = list(EXPECTED_HEADER)
    bad_header[4] = "แผนงานที่เปลี่ยนชื่อ"  # เพี้ยนคอลัมน์ที่ 5
    _write_pbo_workbook(path, [_row()], header_override=tuple(bad_header))

    with pytest.raises(PboHeaderMismatchError, match="แผนงาน"):
        extract_year(cfg, 2566, path)


# ---------------------------------------------------------------------------
# source_id คงที่ข้ามการรัน (golden) + ตรงกับสูตร util.hash.source_id
# ---------------------------------------------------------------------------


def test_extract_year_source_id_stable_and_matches_hash_formula(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    pbo_dir = cfg.raw_data_dir / "PBO"
    pbo_dir.mkdir(parents=True)
    path = pbo_dir / "2566.xlsx"
    sheet_name = _write_pbo_workbook(path, [_row(), _row(ministry="กระทรวงมหาดไทย")])

    result1 = extract_year(cfg, 2566, path)
    ids_run1 = [r["source_id"] for r in _read_cache_records(result1.cache_path)]

    result2 = extract_year(cfg, 2566, path)  # รันซ้ำ (เขียนทับไฟล์เดิม)
    ids_run2 = [r["source_id"] for r in _read_cache_records(result2.cache_path)]

    assert ids_run1 == ids_run2
    expected = [
        compute_source_id(DATASET, "PBO/2566.xlsx", sheet_name, 2),
        compute_source_id(DATASET, "PBO/2566.xlsx", sheet_name, 3),
    ]
    assert ids_run1 == expected

    doc_id = doc_id_for_path("PBO/2566.xlsx")
    records = _read_cache_records(result1.cache_path)
    assert all(r["source_doc_id"] == doc_id for r in records)


# ---------------------------------------------------------------------------
# --limit-rows
# ---------------------------------------------------------------------------


def test_extract_year_limit_rows(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    pbo_dir = cfg.raw_data_dir / "PBO"
    pbo_dir.mkdir(parents=True)
    path = pbo_dir / "2566.xlsx"
    rows = [_row(ministry=f"กระทรวง {i}") for i in range(10)]
    _write_pbo_workbook(path, rows)

    result = extract_year(cfg, 2566, path, limit_rows=3)
    assert result.rows_written == 3
    # --limit-rows ต้องเขียนไป {year}.partial.parquet เสมอ ไม่ใช่ {year}.parquet
    assert result.cache_path.name == "2566.partial.parquet"


def test_extract_year_limit_rows_does_not_touch_full_cache_or_oracle(tmp_path: Path) -> None:
    """regression: `--limit-rows` ต้องไม่ทับ `{year}.parquet`/oracle.json/headers.json ของ
    การรันเต็มที่มีอยู่ก่อนแล้ว (บั๊กจริงที่เคยเกิด: rawdata test เขียนทับ `.cache/pbo/2566.parquet`
    จนเหลือ 5,000 แถว — main thread ตรวจพบ 19 ก.ย. 2569)
    """
    cfg = PipelineConfig.load(_write_config(tmp_path))
    pbo_dir = cfg.raw_data_dir / "PBO"
    pbo_dir.mkdir(parents=True)
    path = pbo_dir / "2566.xlsx"
    rows = [_row(ministry=f"กระทรวง {i}") for i in range(10)]
    _write_pbo_workbook(path, rows)

    full_result = extract_year(cfg, 2566, path)  # รันเต็มก่อน
    assert full_result.rows_written == 10
    full_cache_path = full_result.cache_path
    full_bytes_before = full_cache_path.read_bytes()
    full_mtime_before = full_cache_path.stat().st_mtime_ns
    oracle_before = load_oracle(cfg)["2566"]
    headers_path = cfg.cache_dir / "pbo" / "headers.json"
    headers_before = headers_path.read_text(encoding="utf-8")

    partial_result = extract_year(cfg, 2566, path, limit_rows=2)  # แล้วรัน partial ทับ

    assert partial_result.rows_written == 2
    assert partial_result.cache_path != full_cache_path
    assert partial_result.cache_path.name == "2566.partial.parquet"

    # ไฟล์เต็มต้องไม่เปลี่ยนเลย (ทั้ง byte และ mtime)
    assert full_cache_path.read_bytes() == full_bytes_before
    assert full_cache_path.stat().st_mtime_ns == full_mtime_before
    assert pq.read_table(str(full_cache_path)).num_rows == 10
    # oracle.json / headers.json ต้องไม่ถูกแก้ด้วยการรัน partial
    assert load_oracle(cfg)["2566"] == oracle_before
    assert headers_path.read_text(encoding="utf-8") == headers_before


# ---------------------------------------------------------------------------
# discover_year_files
# ---------------------------------------------------------------------------


def test_discover_year_files_only_existing(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    pbo_dir = cfg.raw_data_dir / "PBO"
    pbo_dir.mkdir(parents=True)
    (pbo_dir / "2566.xlsx").write_bytes(b"x")
    (pbo_dir / "2567.xlsx").write_bytes(b"x")

    found = discover_year_files(cfg)
    assert list(found.keys()) == [2566, 2567]


# ---------------------------------------------------------------------------
# rawdata: extract ปี 2566 จริง --limit-rows 5000 แล้วตรวจ schema
# ---------------------------------------------------------------------------


@pytest.mark.rawdata
def test_rawdata_extract_2566_limit_5000_schema(tmp_path: Path) -> None:
    """ต้องอ่าน raw จริงเท่านั้น (raw_data_dir) — **ห้ามเขียนลง `pipeline/.cache` จริงเด็ดขาด**

    เคยมีบั๊กจริง (19 ก.ย. 2569): เทสต์นี้เคยใช้ `PipelineConfig.load()` ตรง ๆ (cache_dir จริง)
    แล้วเขียนทับ `.cache/pbo/2566.parquet` (188,800 แถว) เหลือแค่ 5,000 แถว — แก้โดย (1) สร้าง
    cfg ใหม่ด้วย `dataclasses.replace(cache_dir=tmp_path)` (2) `--limit-rows` เขียนไฟล์
    `.partial.parquet` แยกอยู่แล้ว (double safety สองชั้น)
    """
    real_cfg = PipelineConfig.load()
    path = real_cfg.raw_data_dir / "PBO" / "2566.xlsx"
    if not path.is_file():
        pytest.skip("ไม่มีโฟลเดอร์ข้อมูลดิบจริงบนเครื่องนี้")

    cfg = dataclasses.replace(real_cfg, cache_dir=tmp_path / "cache")

    result = extract_year(cfg, 2566, path, limit_rows=5000)
    assert result.rows_written == 5000
    assert result.cache_path.name == "2566.partial.parquet"
    assert result.cache_path.is_relative_to(tmp_path)

    table = pq.read_table(str(result.cache_path))
    assert table.num_rows == 5000
    expected_columns = {
        "source_id",
        "dataset",
        "fiscal_year_be",
        "fiscal_year_ce",
        "ministry",
        "agency",
        "amount_thb",
        "revised_thb",
        "po_thb",
        "disbursed_thb",
        "disbursed_incl_po_thb",
        "reserved_thb",
        "carryover_thb",
        "remaining_committed_thb",
        "remaining_uncommitted_thb",
        "remaining_in_progress_thb",
        "remaining_reserved_extended_thb",
        "remaining_total_thb",
        "amount_unit_source",
        "source_path",
        "source_sheet",
        "source_row",
        "source_doc_id",
        "quality_flags",
    }
    assert expected_columns <= set(table.column_names)
