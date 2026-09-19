"""T-110a: `normalize/run.py` — 03-DATA-PIPELINE.md §5, §6 (V3 soft ADR-005)

ห้ามพึ่งไฟล์ raw จริง (fixture ทั้งหมดสร้างในเทสต์) และห้ามแตะ `pipeline/.cache` จริง — ทุกเทสต์ใช้
`tmp_path` เป็น cache_dir/raw_data_dir เสมอ
"""

from __future__ import annotations

from pathlib import Path

import openpyxl
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from tgbp_pipeline.config import PipelineConfig
from tgbp_pipeline.extract.act2570 import pyarrow_schema as act2570_schema
from tgbp_pipeline.extract.local_sheets import _pyarrow_schema as local_schema
from tgbp_pipeline.extract.pbo import pyarrow_schema as pbo_schema
from tgbp_pipeline.normalize.org_master import OrgMaster, OrgRecord
from tgbp_pipeline.normalize.run import (
    DATASET_LOCAL_ORDINANCE,
    GROUP_MISMATCH_FLAG,
    expand_local_gov_abbreviation,
    gov_level_for_ministry_code,
    normalize_dataset,
    normalize_file,
    normalize_table,
    parse_distinct_item_names,
)


def _cfg(tmp_path: Path) -> PipelineConfig:
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir(exist_ok=True)
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir(exist_ok=True)
    return PipelineConfig(
        config_path=tmp_path / "config.yaml",
        raw_data_dir=raw_dir,
        output_dir=tmp_path / "out",
        cache_dir=cache_dir,
        fixtures_dir=tmp_path / "fixtures",
    )


def _org_master() -> OrgMaster:
    ministries = [
        OrgRecord(code="10000", name="กระทรวงกลาโหม", level="ministry", ministry_code=None),
        OrgRecord(code="75000", name="องค์กรปกครองส่วนท้องถิ่น", level="ministry", ministry_code=None),
    ]
    agencies = [
        OrgRecord(code="10001", name="กรมทหารบก", level="agency", ministry_code="10000"),
        OrgRecord(code="75AAA", name="เทศบาลตำบลทดสอบ", level="agency", ministry_code="75000"),
    ]
    return OrgMaster(ministries=ministries, agencies=agencies)


_PBO_DEFAULT_ROW: dict = {
    "source_id": "s1",
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
    "item_name_raw": "เครื่องปรับอากาศ ขนาด 18000 บีทียู ตำบลช้างเผือก อำเภอเมืองเชียงใหม่",
    "amount_thb": 100_000,
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
    "disbursement_rate": None,
    "amount_unit_source": "million_thb",
    "source_path": "PBO/2566.xlsx",
    "source_sheet": "เบิกจ่ายภาพรวมทุกมิติ (7)",
    "source_row": 2,
    "source_doc_id": "d_0",
    "quality_flags": [],
}


def _pbo_row(**overrides) -> dict:
    return {**_PBO_DEFAULT_ROW, **overrides}


def _pbo_table(rows: list[dict]) -> pa.Table:
    return pa.Table.from_pylist(rows, schema=pbo_schema())


# ---------------------------------------------------------------------------
# parse_distinct_item_names — join กลับ distinct ถูกต้อง
# ---------------------------------------------------------------------------


def test_parse_distinct_item_names_serial_matches_item_parser() -> None:
    names = ["เครื่องปรับอากาศ จังหวัดเชียงใหม่", "รถบรรทุกน้ำ 1 คัน จังหวัดลำปาง"]
    result = parse_distinct_item_names(names, max_workers=1)
    assert set(result) == set(names)
    assert result[names[0]].province == "เชียงใหม่"
    assert result[names[1]].province == "ลำปาง"
    assert result[names[1]].item_qty == 1.0


def test_normalize_table_join_back_distinct_gives_same_parse_to_repeated_names(
    tmp_path: Path,
) -> None:
    """สองแถวมี `item_name_raw` เดียวกัน (คนละหน่วยงาน) — ต้อง parse ครั้งเดียวแต่ผลตรงกันทั้งคู่"""
    same_name = "เครื่องปรับอากาศ ขนาด 18000 บีทียู จังหวัดเชียงใหม่"
    rows = [
        _pbo_row(source_id="s1", item_name_raw=same_name, source_row=2),
        _pbo_row(
            source_id="s2",
            item_name_raw=same_name,
            ministry="กระทรวงกลาโหม",
            agency="กรมทหารบก",
            source_row=3,
        ),
    ]
    table = _pbo_table(rows)
    cfg = _cfg(tmp_path)  # ไม่ถูกใช้จริง (pbo ไม่มี upstream_ocr, ไม่ต้องเปิดไฟล์ raw)
    normalized, stats = normalize_table(table, cfg=cfg, org_master=_org_master(), max_workers=1)

    assert stats.n_distinct_item_names == 1
    records = normalized.to_pylist()
    assert records[0]["item_key"] == records[1]["item_key"]
    assert records[0]["province"] == "เชียงใหม่"
    assert records[1]["province"] == "เชียงใหม่"
    assert "18000 บีทียู" in records[0]["spec_tokens"]
    # ลำดับต้องคงเดิมตาม source_row (deterministic)
    assert [r["source_id"] for r in records] == ["s1", "s2"]


# ---------------------------------------------------------------------------
# unit_price_thb — เงื่อนไข flag
# ---------------------------------------------------------------------------


def test_unit_price_computed_when_qty_positive_and_no_disallowed_flags(tmp_path: Path) -> None:
    row = _pbo_row(item_name_raw="เครื่องพิมพ์ จำนวน 4 เครื่อง", amount_thb=40_000)
    table = _pbo_table([row])
    cfg = _cfg(tmp_path)
    normalized, stats = normalize_table(table, cfg=cfg, org_master=_org_master(), max_workers=1)
    record = normalized.to_pylist()[0]
    assert record["item_qty"] == 4.0
    assert record["unit_price_thb"] == 10_000
    assert stats.n_unit_price_computed == 1


def test_unit_price_not_computed_when_corrupt_row_flag_present(tmp_path: Path) -> None:
    row = _pbo_row(
        item_name_raw="เครื่องพิมพ์ จำนวน 4 เครื่อง",
        amount_thb=40_000,
        quality_flags=["corrupt_row"],
    )
    table = _pbo_table([row])
    cfg = _cfg(tmp_path)
    normalized, _ = normalize_table(table, cfg=cfg, org_master=_org_master(), max_workers=1)
    record = normalized.to_pylist()[0]
    assert record["unit_price_thb"] is None


def test_unit_price_not_computed_when_qty_is_measure_flag_from_parser(tmp_path: Path) -> None:
    # "พื้นที่ 100 ตารางเมตร" → ตัวเลข+หน่วยมิติหลัง marker ปริมาณงาน → qty_is_measure (item_parser)
    row = _pbo_row(item_name_raw="ปรับปรุงถนน พื้นที่ 100 ตารางเมตร", amount_thb=500_000)
    table = _pbo_table([row])
    cfg = _cfg(tmp_path)
    normalized, _ = normalize_table(table, cfg=cfg, org_master=_org_master(), max_workers=1)
    record = normalized.to_pylist()[0]
    assert "qty_is_measure" in record["quality_flags"]
    assert record["unit_price_thb"] is None


def test_unit_price_not_computed_when_high_qty_without_explicit_marker(tmp_path: Path) -> None:
    """T-115 ข้อ 2: item_qty >= 20 แต่ item_name ไม่มี "จำนวน"/หน่วยนับติดเลข → low_conf ไม่คำนวณ

    เคสจริง (ก่อนแก้ item_parser ข้อ 1): "IPv6" ติดกับเลขจำนวนจริงกลายเป็น "IPv61" — ตัวอย่างนี้ใช้
    เคสสังเคราะห์ที่ item_qty มาจาก generic qty match ปกติ (>= 20, ไม่มี "จำนวน", ไม่มีหน่วยนับติดเลข)
    เพื่อแยกทดสอบเงื่อนไข sanity นี้ต่างหากจากบั๊ก item_parser ข้อ 1 โดยตรง
    """
    row = _pbo_row(item_name_raw="เครื่องพิมพ์ 25 เครื่อง", amount_thb=500_000)
    table = _pbo_table([row])
    cfg = _cfg(tmp_path)
    normalized, stats = normalize_table(table, cfg=cfg, org_master=_org_master(), max_workers=1)
    record = normalized.to_pylist()[0]
    assert record["item_qty"] == 25.0
    assert record["unit_price_thb"] is None
    assert "qty_parsed_low_conf" in record["quality_flags"]
    assert stats.n_high_qty_low_conf == 1
    assert stats.n_unit_price_computed == 0


def test_unit_price_computed_when_high_qty_with_jamnuan_marker(tmp_path: Path) -> None:
    """item_qty >= 20 แต่มีคำว่า "จำนวน" ชัดเจน → ยังคำนวณ unit_price ตามปกติ"""
    row = _pbo_row(item_name_raw="ปากกา จำนวน 500 ชุด", amount_thb=25_000)
    table = _pbo_table([row])
    cfg = _cfg(tmp_path)
    normalized, stats = normalize_table(table, cfg=cfg, org_master=_org_master(), max_workers=1)
    record = normalized.to_pylist()[0]
    assert record["item_qty"] == 500.0
    assert record["unit_price_thb"] == 50
    assert "qty_parsed_low_conf" not in (record["quality_flags"] or [])
    assert stats.n_high_qty_low_conf == 0
    assert stats.n_unit_price_computed == 1


def test_unit_price_computed_when_high_qty_below_threshold_unaffected(tmp_path: Path) -> None:
    """item_qty < 20 ไม่ถูกกระทบโดย sanity check ใหม่เลย (ไม่มี "จำนวน"/หน่วยติดเลข)"""
    row = _pbo_row(item_name_raw="เครื่องพิมพ์ 4 เครื่อง", amount_thb=40_000)
    table = _pbo_table([row])
    cfg = _cfg(tmp_path)
    normalized, stats = normalize_table(table, cfg=cfg, org_master=_org_master(), max_workers=1)
    record = normalized.to_pylist()[0]
    assert record["unit_price_thb"] == 10_000
    assert stats.n_high_qty_low_conf == 0


def test_unit_price_existing_value_not_overwritten(tmp_path: Path) -> None:
    """อบจ. เชียงใหม่ (local) มี unit_price_thb จริงจากคอลัมน์ "ราคา/หน่วย" — ห้ามคำนวณทับ"""
    row = {
        "source_id": "s1",
        "dataset": "local_ordinance_2570",
        "fiscal_year_be": 2570,
        "fiscal_year_ce": 2027,
        "gov_level": "local",
        "province": "เชียงใหม่",
        "local_gov_name": "องค์การบริหารส่วนจังหวัดเชียงใหม่",
        "plan": "แผนงาน A",
        "output_project": None,
        "activity": None,
        "budget_type": None,
        "expense_category": None,
        "item_name_raw": "เครื่องคอมพิวเตอร์",
        "item_qty": 2.0,
        "unit_price_thb": 25_000,  # ราคาจริงจากต้นทาง ต่างจาก amount/qty = 30,000/2=15,000
        "amount_thb": 30_000,
        "agency": "กองคลัง",
        "description": None,
        "legal_reference": None,
        "amount_unit_source": "thb",
        "source_path": "งบประมาณ เชียงใหม่/2 - x/ร่างข้อบัญญัติงบ 2570 อบจ. เชียงใหม่ - Sheets.xlsx",
        "source_sheet": "Data",
        "source_row": 2,
        "source_page": None,
        "source_doc_id": "d_0",
        "quality_flags": [],
    }
    table = pa.Table.from_pylist([row], schema=local_schema())
    cfg = _cfg(tmp_path)
    normalized, _ = normalize_table(table, cfg=cfg, org_master=_org_master(), max_workers=1)
    record = normalized.to_pylist()[0]
    assert record["unit_price_thb"] == 25_000


# ---------------------------------------------------------------------------
# province ไม่ถูกทับ
# ---------------------------------------------------------------------------


def test_province_not_overwritten_when_dataset_already_has_it(tmp_path: Path) -> None:
    """act2570 (เชียงใหม่/4) มี province จากคอลัมน์ `จังหวัด` จริง — item_parser ต้องไม่ทับ แม้ใน
    item_name จะพบชื่อจังหวัดอื่น
    """
    row = {
        "source_id": "s1",
        "dataset": "local_subsidy_2570",
        "fiscal_year_be": 2570,
        "fiscal_year_ce": 2027,
        "gov_level": "local",
        "ministry": "องค์กรปกครองส่วนท้องถิ่น",
        "ministry_code": "75000",
        "agency": "เทศบาลนครเชียงใหม่",
        "agency_code": "75266",
        "province": "เชียงใหม่",  # จากคอลัมน์ จังหวัด จริง — ต้องไม่ถูกทับ
        "local_gov_name": "เทศบาลนครเชียงใหม่",
        "strategy": None,
        "budget_group": "งบประมาณรายจ่ายของหน่วยรับงบประมาณ",
        "plan": "แผนงาน A",
        "output_project": None,
        "activity": None,
        "budget_type": None,
        "expense_category": None,
        "is_capital": True,
        "cap_ncap_raw": "รายจ่ายลงทุน",
        "item_name_raw": "ก่อสร้างถนน ตำบลบางบ่อ จังหวัดสมุทรปราการ",
        "amount_thb": 1_000_000,
        "amount_unit_source": "thb",
        "source_path": "x.xlsx",
        "source_sheet": "Data",
        "source_row": 2,
        "source_doc_id": "d_0",
        "quality_flags": [],
    }
    table = pa.Table.from_pylist([row], schema=act2570_schema())
    cfg = _cfg(tmp_path)
    normalized, _ = normalize_table(table, cfg=cfg, org_master=None, max_workers=1)
    record = normalized.to_pylist()[0]
    assert record["province"] == "เชียงใหม่"  # ไม่ถูกทับเป็น "สมุทรปราการ" จาก item_name


# ---------------------------------------------------------------------------
# org code คงเดิมสำหรับ act2570 (ไม่ match ซ้ำ)
# ---------------------------------------------------------------------------


def test_act2570_dataset_skips_org_match_keeps_existing_codes(tmp_path: Path) -> None:
    row = {
        "source_id": "s1",
        "dataset": "act_2570_draft",
        "fiscal_year_be": 2570,
        "fiscal_year_ce": 2027,
        "gov_level": "central",
        "ministry": "กระทรวงกลาโหม",
        "ministry_code": "02000",
        "agency": "กองทัพเรือ",
        "agency_code": "02005",
        "province": None,
        "local_gov_name": None,
        "strategy": None,
        "budget_group": "งบประมาณรายจ่ายของหน่วยรับงบประมาณ",
        "plan": "แผนงาน A",
        "output_project": None,
        "activity": None,
        "budget_type": None,
        "expense_category": None,
        "is_capital": True,
        "cap_ncap_raw": "รายจ่ายลงทุน",
        "item_name_raw": "ก่อสร้างอาคาร",
        "amount_thb": 1_500_000,
        "amount_unit_source": "thb",
        "source_path": "x.xlsx",
        "source_sheet": "Data",
        "source_row": 2,
        "source_doc_id": "d_0",
        "quality_flags": [],
    }
    table = pa.Table.from_pylist([row], schema=act2570_schema())
    cfg = _cfg(tmp_path)
    # org_master=None จงใจ — ถ้าโค้ดพยายาม match จริงจะ raise ทันที (พิสูจน์ว่า "ไม่ match ซ้ำ")
    normalized, stats = normalize_table(table, cfg=cfg, org_master=None, max_workers=1)
    record = normalized.to_pylist()[0]
    assert record["ministry_code"] == "02000"
    assert record["agency_code"] == "02005"
    assert stats.n_org_unmapped == 0
    assert "org_unmapped" not in record["quality_flags"]


def test_pbo_dataset_requires_org_match_flags_org_unmapped_when_no_match(tmp_path: Path) -> None:
    row = _pbo_row(ministry="กระทรวงที่ไม่มีใน master", agency="กรมที่ไม่รู้จัก")
    table = _pbo_table([row])
    cfg = _cfg(tmp_path)
    normalized, stats = normalize_table(table, cfg=cfg, org_master=_org_master(), max_workers=1)
    record = normalized.to_pylist()[0]
    assert record["ministry_code"] is None
    assert record["agency_code"] is None
    assert "org_unmapped" in record["quality_flags"]
    assert stats.n_org_unmapped == 1


def test_pbo_dataset_missing_org_master_raises(tmp_path: Path) -> None:
    table = _pbo_table([_pbo_row()])
    cfg = _cfg(tmp_path)
    with pytest.raises(ValueError, match="org_master"):
        normalize_table(table, cfg=cfg, org_master=None, max_workers=1)


def test_gov_level_derived_from_matched_ministry_code(tmp_path: Path) -> None:
    row = _pbo_row(ministry="องค์กรปกครองส่วนท้องถิ่น", agency="เทศบาลตำบลทดสอบ")
    table = _pbo_table([row])
    cfg = _cfg(tmp_path)
    normalized, _ = normalize_table(table, cfg=cfg, org_master=_org_master(), max_workers=1)
    record = normalized.to_pylist()[0]
    assert record["agency_code"] == "75AAA"
    assert record["gov_level"] == "local"
    assert gov_level_for_ministry_code("75000") == "local"
    assert gov_level_for_ministry_code("50000") == "state_enterprise"
    assert gov_level_for_ministry_code("10000") == "central"
    assert gov_level_for_ministry_code(None) is None


# ---------------------------------------------------------------------------
# expand_local_gov_abbreviation — local_ordinance_2570 ใช้ชื่อย่อจากไฟล์ (อบจ./ทน./ฯลฯ) แต่
# org_master เก็บชื่อเต็มและปิด fuzzy สำหรับ อปท. (03 §5 ข้อ 3) — ต้องขยายก่อน match เสมอ
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("อบจ. เชียงใหม่", "องค์การบริหารส่วนจังหวัดเชียงใหม่"),
        ("อบต. ราชาเทวะ", "องค์การบริหารส่วนตำบลราชาเทวะ"),
        ("ทน. เชียงใหม่", "เทศบาลนครเชียงใหม่"),
        ("ทม. แม่ฮ่องสอน", "เทศบาลเมืองแม่ฮ่องสอน"),
        ("ทต. บางบ่อ", "เทศบาลตำบลบางบ่อ"),
        ("องค์การบริหารส่วนจังหวัดเชียงใหม่", "องค์การบริหารส่วนจังหวัดเชียงใหม่"),  # ชื่อเต็มอยู่แล้ว
        (None, None),
    ],
)
def test_expand_local_gov_abbreviation(raw: str | None, expected: str | None) -> None:
    assert expand_local_gov_abbreviation(raw) == expected


def test_local_ordinance_org_match_uses_expanded_name(tmp_path: Path) -> None:
    """ยืนยันบั๊กจริงที่พบ 19 ก.ย. 2569: `local_gov_name` แบบย่อ ("อบจ. เชียงใหม่") ต้อง match
    org_master ได้หลังขยายคำย่อ (ก่อนแก้: org_unmapped=100% ของทุกแถว local_ordinance_2570)
    """
    ministries = [
        OrgRecord(code="75000", name="องค์กรปกครองส่วนท้องถิ่น", level="ministry", ministry_code=None)
    ]
    agencies = [
        OrgRecord(
            code="75266",
            name="องค์การบริหารส่วนจังหวัดเชียงใหม่",
            level="agency",
            ministry_code="75000",
        )
    ]
    org_master = OrgMaster(ministries=ministries, agencies=agencies)

    row = {
        "source_id": "s1",
        "dataset": DATASET_LOCAL_ORDINANCE,
        "fiscal_year_be": 2570,
        "fiscal_year_ce": 2027,
        "gov_level": "local",
        "province": "เชียงใหม่",
        "local_gov_name": "อบจ. เชียงใหม่",
        "plan": "แผนงาน A",
        "output_project": None,
        "activity": None,
        "budget_type": None,
        "expense_category": None,
        "item_name_raw": "เครื่องคอมพิวเตอร์",
        "item_qty": None,
        "unit_price_thb": None,
        "amount_thb": 30_000,
        "agency": "กองคลัง",
        "description": None,
        "legal_reference": None,
        "amount_unit_source": "thb",
        "source_path": "x.xlsx",
        "source_sheet": "Data",
        "source_row": 2,
        "source_page": None,
        "source_doc_id": "d_0",
        "quality_flags": [],
    }
    table = pa.Table.from_pylist([row], schema=local_schema())
    cfg = _cfg(tmp_path)

    normalized, stats = normalize_table(table, cfg=cfg, org_master=org_master, max_workers=1)
    record = normalized.to_pylist()[0]

    assert record["agency_code"] == "75266"
    assert record["ministry_code"] == "75000"
    assert stats.n_org_unmapped == 0
    assert "org_unmapped" not in record["quality_flags"]


# ---------------------------------------------------------------------------
# V3 soft (ADR-005) — flag `group_total_mismatch`
# ---------------------------------------------------------------------------


def _raja_local_row(**overrides) -> dict:
    base = {
        "source_id": "s1",
        "dataset": DATASET_LOCAL_ORDINANCE,
        "fiscal_year_be": 2570,
        "fiscal_year_ce": 2027,
        "gov_level": "local",
        "province": "สมุทรปราการ",
        "local_gov_name": "องค์การบริหารส่วนตำบลราชาเทวะ",
        "plan": "แผนงานงบกลาง",
        "output_project": None,
        "activity": "งานบริหารทั่วไป",
        "budget_type": "งบบุคลากร",
        "expense_category": None,
        "item_name_raw": "เงินเดือน",
        "item_qty": None,
        "unit_price_thb": None,
        "amount_thb": 500_000,
        "agency": None,
        "description": None,
        "legal_reference": None,
        "amount_unit_source": "thb",
        "source_path": "งบประมาณ สมุทรปราการ/3 - x/ร่างข้อบัญญัติงบ 2570 อบต. ราชาเทวะ - Sheets.xlsx",
        "source_sheet": "แผนงานงบกลาง",
        "source_row": 2,
        "source_page": None,
        "source_doc_id": "d_0",
        "quality_flags": ["upstream_ocr"],
    }
    return {**base, **overrides}


def _write_raja_raw_file(cfg: PipelineConfig, rel_path: str) -> None:
    """เขียนไฟล์ raw จำลอง (เฉพาะ sheet `summary_ocr_raw_data` — เพียงพอสำหรับ
    `extract_raja_summary_oracle`) ไว้ใต้ `cfg.raw_data_dir` ตาม `rel_path`
    """
    path = cfg.raw_data_dir / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "summary_ocr_raw_data"
    ws.append(("page", "plan", "work", "budget_group", "total_amount"))
    # กลุ่มนี้ oracle = 1,000,000 แต่แถวจริงรวมแค่ 500,000 → ต้อง mismatch
    ws.append((1, "แผนงานงบกลาง", "งานบริหารทั่วไป", "งบบุคลากร", 1_000_000))
    # กลุ่มนี้ oracle ตรงกับแถวจริงพอดี (300,000) → ไม่ควรติด flag
    ws.append((2, "แผนงานการศึกษา", "งานการศึกษา", "งบดำเนินงาน", 300_000))
    wb.save(path)


def test_v3_group_total_mismatch_flags_only_mismatched_group(tmp_path: Path) -> None:
    cfg = _cfg(tmp_path)
    rel_path = "งบประมาณ สมุทรปราการ/3 - x/ร่างข้อบัญญัติงบ 2570 อบต. ราชาเทวะ - Sheets.xlsx"
    _write_raja_raw_file(cfg, rel_path)

    mismatched_row = _raja_local_row(source_id="s1", source_row=2, source_path=rel_path)
    matched_row = _raja_local_row(
        source_id="s2",
        source_row=3,
        source_path=rel_path,
        plan="แผนงานการศึกษา",
        activity="งานการศึกษา",
        budget_type="งบดำเนินงาน",
        amount_thb=300_000,
    )
    table = pa.Table.from_pylist([mismatched_row, matched_row], schema=local_schema())

    normalized, stats = normalize_table(table, cfg=cfg, org_master=_org_master(), max_workers=1)
    records = normalized.to_pylist()

    assert GROUP_MISMATCH_FLAG in records[0]["quality_flags"]
    assert GROUP_MISMATCH_FLAG not in records[1]["quality_flags"]
    assert stats.n_group_mismatch_rows == 1


def test_v3_skipped_when_raw_file_missing_does_not_raise(tmp_path: Path) -> None:
    """ไฟล์ raw หายไป (เช่นเทสต์ไม่ได้เขียนไว้) — ต้องไม่ raise แค่ไม่ติด flag"""
    cfg = _cfg(tmp_path)
    row = _raja_local_row(source_path="ไม่มีไฟล์นี้จริง.xlsx")
    table = pa.Table.from_pylist([row], schema=local_schema())
    normalized, stats = normalize_table(table, cfg=cfg, org_master=_org_master(), max_workers=1)
    assert GROUP_MISMATCH_FLAG not in normalized.to_pylist()[0]["quality_flags"]
    assert stats.n_group_mismatch_rows == 0


# ---------------------------------------------------------------------------
# normalize_file / normalize_dataset — เขียน parquet จริง (tmp_path เท่านั้น)
# ---------------------------------------------------------------------------


def test_normalize_file_writes_parquet_under_normalized_dir(tmp_path: Path) -> None:
    cfg = _cfg(tmp_path)
    pbo_dir = cfg.cache_dir / "pbo"
    pbo_dir.mkdir(parents=True)
    source_path = pbo_dir / "2566.parquet"
    pq.write_table(_pbo_table([_pbo_row()]), str(source_path))

    result = normalize_file(cfg, source_path, org_master=_org_master(), max_workers=1)

    assert result.out_path == cfg.cache_dir / "normalized" / "pbo_disbursement" / "2566.parquet"
    assert result.out_path.is_file()
    assert result.stats.n_rows == 1
    table = pq.read_table(str(result.out_path))
    assert table.num_rows == 1


def test_normalize_dataset_pbo_processes_all_year_files_and_skips_partial(tmp_path: Path) -> None:
    cfg = _cfg(tmp_path)
    pbo_dir = cfg.cache_dir / "pbo"
    pbo_dir.mkdir(parents=True)
    pq.write_table(_pbo_table([_pbo_row(source_id="a")]), str(pbo_dir / "2566.parquet"))
    pq.write_table(_pbo_table([_pbo_row(source_id="b")]), str(pbo_dir / "2567.parquet"))
    # ไฟล์ partial ต้องถูกข้าม (ไม่ใช่ผลรันเต็ม)
    pq.write_table(_pbo_table([_pbo_row(source_id="c")]), str(pbo_dir / "2568.partial.parquet"))
    org_master_path = cfg.cache_dir / "org_master.json"
    org_master_path.write_text(
        '{"ministries": [], "agencies": []}', encoding="utf-8"
    )  # org_master ว่างพอสำหรับเทสต์นี้ (ไม่สนใจผล match)

    report = normalize_dataset(cfg, "pbo", max_workers=1)

    assert len(report.results) == 2
    assert report.total_rows == 2
    out_files = sorted(
        p.name for p in (cfg.cache_dir / "normalized" / "pbo_disbursement").glob("*")
    )
    assert out_files == ["2566.parquet", "2567.parquet"]


def test_normalize_dataset_missing_org_master_cache_raises_clear_error(tmp_path: Path) -> None:
    cfg = _cfg(tmp_path)
    pbo_dir = cfg.cache_dir / "pbo"
    pbo_dir.mkdir(parents=True)
    pq.write_table(_pbo_table([_pbo_row()]), str(pbo_dir / "2566.parquet"))

    with pytest.raises(FileNotFoundError, match="org_master"):
        normalize_dataset(cfg, "pbo", max_workers=1)
