"""T-106: `extract/act2570.py` — ยืนยันจากไฟล์จริง 19 ก.ย. 2569 (ดู module docstring ของ
`act2570.py` สำหรับรายละเอียดที่ตรวจซ้ำ) — ห้ามพึ่งไฟล์ raw จริงยกเว้น `@pytest.mark.rawdata`
"""

from __future__ import annotations

import shutil
from pathlib import Path

import openpyxl
import pyarrow.parquet as pq
import pytest
import yaml

from tgbp_pipeline.config import PipelineConfig
from tgbp_pipeline.extract.act2570 import (
    DATASET_DRAFT,
    DATASET_PROVINCE,
    DATASET_SUBSIDY,
    GROUP_BUDGET_FLAG,
    SUBSET_FLAG,
    Act2570DiscoveryError,
    Act2570SheetError,
    check_v2,
    classify_a3_dataset,
    detect_format_a_header,
    detect_format_b_header,
    discover_files,
    extract_act2570,
    extract_one_a3_file,
    find_title,
    map_format_a_header,
)
from tgbp_pipeline.util.hash import doc_id_for_path
from tgbp_pipeline.util.hash import source_id as compute_source_id

FORMAT_B_HEADER = (
    "min",
    "min_name",
    "agc",
    "agc_name",
    "group_budget",
    "plan_name",
    "output_name",
    "act_name",
    "objc",
    "objc_8_name",
    "cap_ncap",
    "item_name",
    "p_total_bud",
)

FORMAT_A_HEADER = (
    "กระทรวง",
    "หน่วยงาน",
    "แผนงาน",
    "รายการ (item_name)",
    "ประเภทรายจ่าย",
    "ประจำ/ลงทุน",
    "งบ (บาท)",
)


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


def _b_row(
    min_="02000",
    min_name="กระทรวงกลาโหม",
    agc="02005",
    agc_name="กองทัพเรือ",
    group_budget="งบประมาณรายจ่ายของหน่วยรับงบประมาณ",
    plan_name="แผนงานพื้นฐานด้านความมั่นคง",
    output_name="ผลผลิต A",
    act_name="กิจกรรม A",
    objc="งบลงทุน",
    objc_8_name="ค่าครุภัณฑ์ ที่ดิน และสิ่งก่อสร้าง",
    cap_ncap="รายจ่ายลงทุน",
    item_name="ก่อสร้างอาคาร ตำบลช้างเผือก อำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่",
    p_total_bud=1_500_000,
) -> tuple:
    return (
        min_,
        min_name,
        agc,
        agc_name,
        group_budget,
        plan_name,
        output_name,
        act_name,
        objc,
        objc_8_name,
        cap_ncap,
        item_name,
        p_total_bud,
    )


def _write_workbook(
    path: Path, sheet_name: str, rows: list[tuple], extra_sheets: dict | None = None
) -> None:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet_name
    for row in rows:
        ws.append(row)
    if extra_sheets:
        for name, sheet_rows in extra_sheets.items():
            ws2 = wb.create_sheet(name)
            for row in sheet_rows:
                ws2.append(row)
    wb.save(path)


def _write_draft(raw_dir: Path, rel_dir: str, rows: list[tuple]) -> Path:
    folder = raw_dir / rel_dir
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "ร่าง พ.ร.บ. งบ 2570 ฉบับเต็ม - Excel.xlsx"
    _write_workbook(
        path, "Data", [FORMAT_B_HEADER, *rows], extra_sheets={"Data Dict": [("LIST", "FIELD")]}
    )
    return path


def _write_format_b_a3(
    raw_dir: Path,
    rel_dir: str,
    filename: str,
    rows: list[tuple],
    header: tuple = FORMAT_B_HEADER,
    sheet_name: str = "Data",
) -> Path:
    folder = raw_dir / rel_dir
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / filename
    _write_workbook(path, sheet_name, [header, *rows])
    return path


def _write_format_a_a3(
    raw_dir: Path,
    rel_dir: str,
    filename: str,
    item_rows: list[tuple],
    n_blank: int,
    title_n: int,
    title_amount: int,
    total_amount: int,
) -> Path:
    folder = raw_dir / rel_dir
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / filename
    rows: list[tuple] = [
        ("รายการที่ระบุ ... ปีงบประมาณ 2570", None, None, None, None, None, None),
        (
            f"{title_n} รายการ  |  งบรวม {title_amount:,} บาท  |  ⚠ หมายเหตุทดสอบ",
            None,
            None,
            None,
            None,
            None,
            None,
        ),
        FORMAT_A_HEADER,
        *item_rows,
        *[(None,) * 7 for _ in range(n_blank)],
        ("รวมทั้งหมด", None, None, None, None, None, total_amount),
    ]
    _write_workbook(path, "รายการ (ไม่รวม อปท.)", rows)
    return path


# ---------------------------------------------------------------------------
# discover_files / classify_a3_dataset
# ---------------------------------------------------------------------------


def test_classify_a3_dataset() -> None:
    assert (
        classify_a3_dataset("ร่าง พ.ร.บ. งบ 2570 เฉพาะส่วนราชการที่มีรายการในเชียงใหม่ - Excel.xlsx")
        == DATASET_PROVINCE
    )
    assert (
        classify_a3_dataset("ร่าง พ.ร.บ. งบ 2570 เฉพาะเงินอุดหนุน อบจ. เชียงใหม่ - Excel.xlsx")
        == DATASET_SUBSIDY
    )
    assert classify_a3_dataset("ไฟล์ที่ไม่เข้าเกณฑ์ใด ๆ - Excel.xlsx") is None


def test_discover_files_raises_when_no_draft_file(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    with pytest.raises(Act2570DiscoveryError):
        discover_files(cfg)


def test_discover_files_dedupes_by_sha1_primary_is_alphabetically_first(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    row = _b_row()
    primary_path = _write_draft(cfg.raw_data_dir, "งบประมาณ สมุทรปราการ/1 - x", [row])
    # สำเนาไฟล์เดียวกันจริง (ไบต์เหมือนกัน 100% เหมือนกรณีจริง — ไม่ใช้ openpyxl สร้างใหม่เพราะ
    # metadata (created timestamp) จะทำให้ sha1 ต่างกันทั้งที่เนื้อหาตารางเหมือนกัน
    dup_folder = cfg.raw_data_dir / "งบประมาณ เชียงใหม่/1 - y"
    dup_folder.mkdir(parents=True)
    dup_path = dup_folder / "ร่าง พ.ร.บ. งบ 2570 ฉบับเต็ม - Excel.xlsx"
    shutil.copyfile(primary_path, dup_path)

    discovered = discover_files(cfg)
    assert discovered.draft_path == primary_path
    assert discovered.draft_duplicate_paths == [dup_path]


def test_discover_files_raises_when_draft_files_have_different_content(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    _write_draft(cfg.raw_data_dir, "งบประมาณ สมุทรปราการ/1 - x", [_b_row()])
    _write_draft(cfg.raw_data_dir, "งบประมาณ เชียงใหม่/1 - y", [_b_row(p_total_bud=999)])

    with pytest.raises(Act2570DiscoveryError):
        discover_files(cfg)


# ---------------------------------------------------------------------------
# extract_act2570: A2 draft
# ---------------------------------------------------------------------------


def test_extract_act2570_draft_basic_fields_and_group_budget_flag(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    row_central = _b_row(min_="02000", agc="02005", p_total_bud=1_500_000)
    row_local = _b_row(
        min_="75000",
        min_name="องค์กรปกครองส่วนท้องถิ่น",
        agc="7510A",  # อปท. — รหัสมีตัวอักษรปน (02 §A2)
        agc_name="เทศบาลตำบลทดสอบ",
        item_name="ค่าอุปกรณ์การเรียน",
        p_total_bud=5_800,
    )
    _write_draft(cfg.raw_data_dir, "งบประมาณ สมุทรปราการ/1 - x", [row_central, row_local])

    report = extract_act2570(cfg, cache_dir=tmp_path / "cache")

    assert report.draft.rows_written == 2
    assert report.draft.total_amount_thb == 1_505_800
    assert report.draft.duplicate_rel_paths == []

    records = pq.read_table(str(report.draft.cache_path)).to_pylist()
    central, local = records
    assert central["dataset"] == DATASET_DRAFT
    assert central["ministry_code"] == "02000"
    assert central["agency_code"] == "02005"
    assert central["gov_level"] == "central"
    assert central["local_gov_name"] is None
    assert central["is_capital"] is True
    assert central["strategy"] == "งบประมาณรายจ่ายของหน่วยรับงบประมาณ"
    assert GROUP_BUDGET_FLAG in central["quality_flags"]
    assert central["amount_thb"] == 1_500_000
    assert central["amount_unit_source"] == "thb"
    assert central["fiscal_year_be"] == 2570
    assert central["fiscal_year_ce"] == 2027

    assert local["agency_code"] == "7510A"
    assert local["gov_level"] == "local"
    assert local["local_gov_name"] == "เทศบาลตำบลทดสอบ"


def test_extract_act2570_draft_code_defensive_int_and_float(tmp_path: Path) -> None:
    """`min`/`agc` เป็น str ในไฟล์จริงเสมอ แต่ `_code_str` กัน int/float ไว้เชิงป้องกัน"""
    cfg = PipelineConfig.load(_write_config(tmp_path))
    row = _b_row(min_=2000, agc=2005)  # จงใจใส่เป็น int
    _write_draft(cfg.raw_data_dir, "งบประมาณ สมุทรปราการ/1 - x", [row])

    report = extract_act2570(cfg, cache_dir=tmp_path / "cache")
    record = pq.read_table(str(report.draft.cache_path)).to_pylist()[0]
    assert record["ministry_code"] == "02000"
    assert record["agency_code"] == "02005"


def test_extract_act2570_draft_empty_item_name_flag(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    row = _b_row(item_name=None)
    _write_draft(cfg.raw_data_dir, "งบประมาณ สมุทรปราการ/1 - x", [row])

    report = extract_act2570(cfg, cache_dir=tmp_path / "cache")
    record = pq.read_table(str(report.draft.cache_path)).to_pylist()[0]
    assert record["item_name_raw"] is None
    assert "empty_item_name" in record["quality_flags"]


def test_extract_act2570_draft_source_id_matches_hash_formula(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    path = _write_draft(
        cfg.raw_data_dir, "งบประมาณ สมุทรปราการ/1 - x", [_b_row(), _b_row(agc="02006")]
    )

    report = extract_act2570(cfg, cache_dir=tmp_path / "cache")
    records = pq.read_table(str(report.draft.cache_path)).to_pylist()
    rel_path = path.relative_to(cfg.raw_data_dir).as_posix()
    expected = [
        compute_source_id(DATASET_DRAFT, rel_path, "Data", 2),
        compute_source_id(DATASET_DRAFT, rel_path, "Data", 3),
    ]
    assert [r["source_id"] for r in records] == expected
    assert all(r["source_doc_id"] == doc_id_for_path(rel_path) for r in records)

    # รันซ้ำ ผลต้องเหมือนเดิม (คงที่ข้ามการรัน)
    report2 = extract_act2570(cfg, cache_dir=tmp_path / "cache2")
    records2 = pq.read_table(str(report2.draft.cache_path)).to_pylist()
    assert [r["source_id"] for r in records2] == expected


# ---------------------------------------------------------------------------
# format B header detection (objc_8 alias, extra columns)
# ---------------------------------------------------------------------------


def test_detect_format_b_header_accepts_objc_8_alias() -> None:
    header = (
        "min",
        "min_name",
        "agc",
        "agc_name",
        "group_budget",
        "plan_name",
        "output_name",
        "act_name",
        "objc",
        "objc_8",  # alias ของ objc_8_name (เชียงใหม่/4 จริง)
        "cap_ncap",
        "item_name",
        "p_total_bud",
        "จังหวัด",
        "อำเภอ",
        "ตำบล",
    )
    mapping = detect_format_b_header(header)
    assert mapping is not None
    assert mapping["objc_8_name"] == header.index("objc_8")
    assert mapping["จังหวัด"] == header.index("จังหวัด")


def test_detect_format_b_header_returns_none_for_format_a() -> None:
    assert detect_format_b_header(FORMAT_A_HEADER) is None


def test_extract_one_a3_file_format_b_objc8_and_jangwat_column(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    header = (*FORMAT_B_HEADER[:9], "objc_8", *FORMAT_B_HEADER[10:], "จังหวัด", "อำเภอ", "ตำบล")
    row = (
        "75000",
        "องค์กรปกครองส่วนท้องถิ่น",
        "75266",
        "เทศบาลนครเชียงใหม่",
        "งบประมาณรายจ่ายของหน่วยรับงบประมาณ",
        "แผนงาน A",
        "ผลผลิต A",
        "กิจกรรม A",
        "งบเงินอุดหนุน",
        "ค่าครุภัณฑ์ ที่ดิน และสิ่งก่อสร้าง",
        "รายจ่ายลงทุน",
        "รายการทดสอบ",
        1_000_000,
        "เชียงใหม่",
        "เมืองเชียงใหม่",
        None,
    )
    path = _write_format_b_a3(
        cfg.raw_data_dir,
        "งบประมาณ เชียงใหม่/4 - x",
        "ร่าง พ.ร.บ. งบ 2570 เฉพาะเงินอุดหนุนเทศบาลในเชียงใหม่ - Excel.xlsx",
        [row],
        header=header,
        sheet_name="เทศบาลในเชียงใหม่",
    )
    out_dir = cfg.assert_writable_path(tmp_path / "cache" / "act2570")
    out_dir.mkdir(parents=True)

    result = extract_one_a3_file(cfg, path, out_dir)
    assert result is not None
    assert result.dataset == DATASET_SUBSIDY
    assert result.format == "B"
    assert result.rows_written == 1

    record = pq.read_table(str(result.cache_path)).to_pylist()[0]
    assert record["expense_category"] == "ค่าครุภัณฑ์ ที่ดิน และสิ่งก่อสร้าง"
    assert record["province"] == "เชียงใหม่"
    assert SUBSET_FLAG in record["quality_flags"]
    assert GROUP_BUDGET_FLAG in record["quality_flags"]


def test_extract_one_a3_file_returns_none_for_unclassified_filename(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    path = _write_format_b_a3(
        cfg.raw_data_dir,
        "งบประมาณ เชียงใหม่/9 - x",
        "ร่าง พ.ร.บ. งบ 2570 ไฟล์แปลกใหม่ - Excel.xlsx",
        [_b_row()],
    )
    out_dir = cfg.assert_writable_path(tmp_path / "cache" / "act2570")
    out_dir.mkdir(parents=True)
    assert extract_one_a3_file(cfg, path, out_dir) is None


# ---------------------------------------------------------------------------
# format A: header/title detector + skip blank & total rows
# ---------------------------------------------------------------------------


def test_detect_format_a_header_and_map() -> None:
    rows = [
        ("หัวเรื่องทดสอบ", None, None, None, None, None, None),
        ("2 รายการ  |  งบรวม 100 บาท", None, None, None, None, None, None),
        FORMAT_A_HEADER,
        ("กระทรวงกลาโหม", "กองทัพบก", "แผนงาน A", "รายการ A", "ค่าครุภัณฑ์", "รายจ่ายลงทุน", 100),
    ]
    idx = detect_format_a_header(rows)
    assert idx == 2
    mapping = map_format_a_header(rows[idx])
    assert set(mapping) == {
        "ministry",
        "agency",
        "plan",
        "item_name_raw",
        "expense_category",
        "cap_ncap_raw",
        "amount_thb",
    }
    title = find_title(rows, idx)
    assert title == (2, 100)


def test_extract_one_a3_file_format_a_skips_blank_and_total_rows(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    item_rows = [
        (
            "กระทรวงกลาโหม",
            "กองทัพอากาศ",
            "แผนงานพื้นฐานด้านความมั่นคง",
            "สร้างอาคาร ตำบลช่างเคิ่ง อำเภอแม่แจ่ม จังหวัดเชียงใหม่",
            "ค่าครุภัณฑ์ ที่ดิน และสิ่งก่อสร้าง",
            "รายจ่ายลงทุน",
            41_698_700,
        ),
        (
            "กระทรวงการคลัง",
            "กรมธนารักษ์",
            "แผนงานยุทธศาสตร์สร้างรายได้จากการท่องเที่ยว",
            "ค่าบริหารจัดการศูนย์ประชุม จังหวัดเชียงใหม่",
            "ค่าตอบแทนใช้สอยและวัสดุ",
            "รายจ่ายประจำ",
            15_480_500,
        ),
    ]
    total = sum(r[-1] for r in item_rows)
    path = _write_format_a_a3(
        cfg.raw_data_dir,
        "งบประมาณ เชียงใหม่/1 - x",
        "ร่าง พ.ร.บ. งบ 2570 เฉพาะส่วนราชการที่มีรายการในเชียงใหม่ - Excel.xlsx",
        item_rows,
        n_blank=404,
        title_n=2,
        title_amount=total,
        total_amount=total,
    )
    out_dir = cfg.assert_writable_path(tmp_path / "cache" / "act2570")
    out_dir.mkdir(parents=True)

    result = extract_one_a3_file(cfg, path, out_dir)
    assert result is not None
    assert result.format == "A"
    assert result.dataset == DATASET_PROVINCE
    # 404 แถวว่าง + 1 แถว "รวมทั้งหมด" ต้องถูกข้ามทั้งคู่ (เซลล์ `รายการ` ว่างเหมือนกัน)
    assert result.rows_written == 2
    assert result.total_amount_thb == total
    assert result.title_n == 2
    assert result.title_amount_thb == total
    assert result.province == "เชียงใหม่"

    records = pq.read_table(str(result.cache_path)).to_pylist()
    assert all(SUBSET_FLAG in r["quality_flags"] for r in records)
    assert all(r["ministry_code"] is None for r in records)
    assert records[0]["gov_level"] == "central"
    assert records[1]["is_capital"] is False


def test_extract_one_a3_file_format_a_raises_when_header_missing(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    folder = cfg.raw_data_dir / "งบประมาณ เชียงใหม่/1 - x"
    folder.mkdir(parents=True)
    path = folder / "ร่าง พ.ร.บ. งบ 2570 เฉพาะส่วนราชการที่มีรายการในเชียงใหม่ - Excel.xlsx"
    # ไม่มี header คำว่า กระทรวง/หน่วยงาน เลย และไม่ตรง format B ด้วย
    _write_workbook(path, "แปลก", [("a", "b"), ("c", "d")])
    out_dir = cfg.assert_writable_path(tmp_path / "cache" / "act2570")
    out_dir.mkdir(parents=True)

    with pytest.raises(Act2570SheetError):
        extract_one_a3_file(cfg, path, out_dir)


# ---------------------------------------------------------------------------
# V2: format A exact, format B no_oracle + soft cross-check
# ---------------------------------------------------------------------------


def test_check_v2_format_a_pass_and_fail(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    _write_draft(cfg.raw_data_dir, "งบประมาณ สมุทรปราการ/1 - x", [_b_row()])
    item_rows = [
        (
            "กระทรวงกลาโหม",
            "กองทัพอากาศ",
            "แผนงาน A",
            "รายการ A จังหวัดเชียงใหม่",
            "ค่าครุภัณฑ์",
            "รายจ่ายลงทุน",
            100,
        ),
        (
            "กระทรวงการคลัง",
            "กรมธนารักษ์",
            "แผนงาน B",
            "รายการ B จังหวัดเชียงใหม่",
            "ค่าตอบแทน",
            "รายจ่ายประจำ",
            200,
        ),
    ]
    _write_format_a_a3(
        cfg.raw_data_dir,
        "งบประมาณ เชียงใหม่/1 - x",
        "ร่าง พ.ร.บ. งบ 2570 เฉพาะส่วนราชการที่มีรายการในเชียงใหม่ - Excel.xlsx",
        item_rows,
        n_blank=3,
        title_n=2,
        title_amount=300,
        total_amount=300,
    )
    cache_dir = tmp_path / "cache"
    extract_act2570(cfg, cache_dir=cache_dir)

    [v2] = check_v2(cache_dir / "act2570")
    assert v2.format == "A"
    assert v2.status == "ok"
    assert v2.passed is True
    assert v2.n_rows == 2
    assert v2.total_amount_thb == 300


def test_check_v2_format_a_fails_when_title_mismatches_computed(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    _write_draft(cfg.raw_data_dir, "งบประมาณ สมุทรปราการ/1 - x", [_b_row()])
    item_rows = [
        ("กระทรวงกลาโหม", "กองทัพอากาศ", "แผนงาน A", "รายการ A", "ค่าครุภัณฑ์", "รายจ่ายลงทุน", 100),
    ]
    # title อ้าง 5 รายการ/500 บาท แต่ข้อมูลจริงมีแค่ 1 รายการ/100 บาท — ต้อง fail
    _write_format_a_a3(
        cfg.raw_data_dir,
        "งบประมาณ เชียงใหม่/1 - x",
        "ร่าง พ.ร.บ. งบ 2570 เฉพาะส่วนราชการที่มีรายการในเชียงใหม่ - Excel.xlsx",
        item_rows,
        n_blank=1,
        title_n=5,
        title_amount=500,
        total_amount=100,
    )
    cache_dir = tmp_path / "cache"
    extract_act2570(cfg, cache_dir=cache_dir)

    [v2] = check_v2(cache_dir / "act2570")
    assert v2.status == "failed"
    assert v2.passed is False
    assert v2.notes


def test_check_v2_format_b_no_oracle_full_match(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    draft_row = _b_row(
        agc="75266",
        min_="75000",
        min_name="องค์กรปกครองส่วนท้องถิ่น",
        item_name="รายการทดสอบ",
        p_total_bud=100,
    )
    _write_draft(cfg.raw_data_dir, "งบประมาณ สมุทรปราการ/1 - x", [draft_row])
    # ไฟล์ subset เป็นสับเซตตรง ๆ ของแถวเดียวกันใน draft
    _write_format_b_a3(
        cfg.raw_data_dir,
        "งบประมาณ เชียงใหม่/2 - x",
        "ร่าง พ.ร.บ. งบ 2570 เฉพาะเงินอุดหนุน อบจ. เชียงใหม่ - Excel.xlsx",
        [draft_row],
    )
    cache_dir = tmp_path / "cache"
    extract_act2570(cfg, cache_dir=cache_dir)

    [v2] = check_v2(cache_dir / "act2570")
    assert v2.format == "B"
    assert v2.status == "no_oracle"
    assert v2.passed is True
    assert v2.match_pct_to_draft == 100.0
    assert v2.notes == []


def test_check_v2_format_b_whitespace_difference_still_matches_after_clean(tmp_path: Path) -> None:
    """ยืนยันปัญหาคุณภาพข้อมูลจริง (เชียงใหม่/4): item_name มี `\\n`/trailing space ต่างกันระหว่าง
    A2 กับไฟล์ subset แต่ต้อง match กัน 100% หลัง `clean()` (ไม่ใช่ raw string)
    """
    cfg = PipelineConfig.load(_write_config(tmp_path))
    draft_row = _b_row(
        agc="7526D",
        min_="75000",
        min_name="องค์กรปกครองส่วนท้องถิ่น",
        item_name="เครื่องแปลงขยะ \nขนาด 1,000 กิโลกรัม",
        p_total_bud=7_100_000,
    )
    subset_row = _b_row(
        agc="7526D",
        min_="75000",
        min_name="องค์กรปกครองส่วนท้องถิ่น",
        item_name="เครื่องแปลงขยะ ขนาด 1,000 กิโลกรัม",
        p_total_bud=7_100_000,
    )
    _write_draft(cfg.raw_data_dir, "งบประมาณ สมุทรปราการ/1 - x", [draft_row])
    _write_format_b_a3(
        cfg.raw_data_dir,
        "งบประมาณ เชียงใหม่/4 - x",
        "ร่าง พ.ร.บ. งบ 2570 เฉพาะเงินอุดหนุนเทศบาลในเชียงใหม่ - Excel.xlsx",
        [subset_row],
        sheet_name="เทศบาลในเชียงใหม่",
    )
    cache_dir = tmp_path / "cache"
    extract_act2570(cfg, cache_dir=cache_dir)

    [v2] = check_v2(cache_dir / "act2570")
    assert v2.match_pct_to_draft == 100.0
    assert v2.status == "no_oracle"
    assert v2.passed is True


def test_check_v2_format_b_reports_soft_note_when_row_missing_from_draft(tmp_path: Path) -> None:
    cfg = PipelineConfig.load(_write_config(tmp_path))
    _write_draft(
        cfg.raw_data_dir,
        "งบประมาณ สมุทรปราการ/1 - x",
        [_b_row(agc="75266", min_="75000", item_name="รายการ A", p_total_bud=100)],
    )
    # subset มีแถวที่ไม่มีใน draft เลย (agc/item_name/amount ไม่ตรงอะไรเลย)
    _write_format_b_a3(
        cfg.raw_data_dir,
        "งบประมาณ เชียงใหม่/2 - x",
        "ร่าง พ.ร.บ. งบ 2570 เฉพาะเงินอุดหนุน อบจ. เชียงใหม่ - Excel.xlsx",
        [_b_row(agc="75266", min_="75000", item_name="รายการที่ไม่มีใน A2 เลย", p_total_bud=999)],
    )
    cache_dir = tmp_path / "cache"
    extract_act2570(cfg, cache_dir=cache_dir)

    [v2] = check_v2(cache_dir / "act2570")
    assert v2.status == "no_oracle"
    assert v2.passed is True  # soft — ไม่ fail
    assert v2.match_pct_to_draft == 0.0
    assert v2.notes  # ต้องมี note เตือน
    assert v2.unmatched_examples


# ---------------------------------------------------------------------------
# rawdata: extract ไฟล์จริงทั้งหมด (A2 + A3 6 ไฟล์) แล้วตรวจสถิติที่ยืนยันแล้ว
# ---------------------------------------------------------------------------


@pytest.mark.rawdata
def test_rawdata_extract_act2570_matches_verified_stats(tmp_path: Path) -> None:
    real_cfg = PipelineConfig.load()
    if not (real_cfg.raw_data_dir / "งบประมาณ เชียงใหม่").is_dir():
        pytest.skip("ไม่มีโฟลเดอร์ข้อมูลดิบจริงบนเครื่องนี้")

    import dataclasses

    cfg = dataclasses.replace(real_cfg, cache_dir=tmp_path / "cache")
    report = extract_act2570(cfg, cache_dir=tmp_path / "cache")

    assert report.draft.rows_written == 96_470
    assert report.draft.total_amount_thb == 3_788_000_000_000
    assert len(report.draft.duplicate_rel_paths) == 1
    assert len(report.province_and_subsidy) == 6
    assert report.unclassified_rel_paths == []

    v2_results = check_v2(cfg.cache_dir / "act2570")
    assert len(v2_results) == 6
    by_format = {"A": 0, "B": 0}
    for v2 in v2_results:
        by_format[v2.format] += 1
        assert v2.passed is True
    assert by_format == {"A": 1, "B": 5}
