"""T-110b/T-112: `tgbp_pipeline.publish` — 03-DATA-PIPELINE.md §7 + คำสั่ง main thread (19 ก.ย. 2569)

ทุกเทสต์เขียนลง `tmp_path` เท่านั้น — ห้ามแตะ `pipeline/.cache`/`web/public/data`/
`web/tests/fixtures` จริง (CLAUDE.md N8) สร้าง normalized-cache fixture (parquet) เองทั้งหมด
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
import yaml

from tgbp_pipeline import publish as pub
from tgbp_pipeline.config import PipelineConfig
from tgbp_pipeline.normalize.schema import budget_line_pyarrow_schema
from tgbp_pipeline.util.hash import doc_id_for_path
from tgbp_pipeline.validate import check_v6

_SCHEMA = budget_line_pyarrow_schema()
_SCHEMA_NAMES = tuple(f.name for f in _SCHEMA)

_DEFAULT_ROW: dict = {name: None for name in _SCHEMA_NAMES}
_DEFAULT_ROW.update(
    {
        "dataset": "pbo_disbursement",
        "fiscal_year_be": 2567,
        "fiscal_year_ce": 2024,
        "gov_level": "central",
        "ministry": "กระทรวงทดสอบ",
        "ministry_code": "10000",
        "agency": "กรมทดสอบ",
        "agency_code": "10001",
        "item_name_raw": "รายการทดสอบ",
        "item_name": "รายการทดสอบ",
        "item_key": "รายการทดสอบ",
        "amount_thb": 1000,
        "source_path": "PBO/2567.xlsx",
        "source_sheet": "เบิกจ่ายภาพรวมทุกมิติ (7)",
        "source_row": 2,
        "spec_tokens": [],
        "quality_flags": [],
    }
)


def row(**overrides) -> dict:
    r = dict(_DEFAULT_ROW)
    r.update(overrides)
    if "source_id" not in overrides:
        # source_id ต้อง unique ต่อแถว (V4) — สร้างจาก path/sheet/row เหมือนของจริง
        r["source_id"] = f"{r['dataset']}|{r['source_path']}|{r['source_sheet']}|{r['source_row']}"
    if "source_doc_id" not in overrides:
        # source_doc_id คำนวณจาก source_path เสมอ (เหมือนของจริง — `doc_id_for_path`) เพื่อให้
        # `_build_rich_fixture` เขียนไฟล์ raw จำลองที่ path เดียวกันแล้ว `scan_raw_dir` เจอ doc_id
        # ตรงกันจริง (V5: source_doc_id ⊆ sources.json)
        r["source_doc_id"] = doc_id_for_path(r["source_path"])
    return r


def write_normalized(cache_dir: Path, dataset: str, filename: str, rows: list[dict]) -> Path:
    out_dir = cache_dir / "normalized" / dataset
    out_dir.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pylist(rows, schema=_SCHEMA)
    path = out_dir / filename
    pq.write_table(table, str(path))
    return path


def make_cfg(tmp_path: Path) -> PipelineConfig:
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
    return PipelineConfig.load(config_path)


# ---------------------------------------------------------------------------
# shard split เมื่อเกิน limit
# ---------------------------------------------------------------------------


def test_write_arrow_with_size_limit_splits_into_parts(tmp_path: Path) -> None:
    import os

    table = pa.table(
        {
            "agency": ["a"] * 100,
            "item_key": [f"k{i}" for i in range(100)],
            # random hex (บีบอัดไม่ได้) — บังคับให้ไฟล์ใหญ่พอจะเกิน limit เล็ก ๆ จริง ๆ (ข้อความซ้ำ
            # แบบ "x"*N ถูก zstd level 15 บีบจนเหลือไฟล์เดียวเสมอ ไม่ทดสอบ split จริง)
            "big_text": [os.urandom(3000).hex() for _ in range(100)],
        }
    )
    dest = tmp_path / "out" / "shard.parquet"
    parts = pub._write_arrow_with_size_limit(
        table,
        dest,
        out_root=tmp_path / "out",
        dataset="pbo_disbursement",
        fiscal_year_be=2567,
        ministry_code="10000",
        province=None,
        max_bytes=20_000,
    )
    assert len(parts) >= 2
    assert all(p.bytes <= 20_000 for p in parts)
    assert sum(p.rows for p in parts) == 100
    names = sorted(p.path.name for p in parts)
    assert names[0].endswith("_part1.parquet")
    # ไม่มีไฟล์ "shard.parquet" เดี่ยว ๆ หลงเหลือจาก attempt แรกที่ล้มเหลว
    assert not (tmp_path / "out" / "shard.parquet").is_file()


def test_write_arrow_with_size_limit_single_file_when_under_limit(tmp_path: Path) -> None:
    table = pa.table({"agency": ["a"], "item_key": ["k"]})
    dest = tmp_path / "out" / "shard.parquet"
    parts = pub._write_arrow_with_size_limit(
        table,
        dest,
        out_root=tmp_path / "out",
        dataset="pbo_disbursement",
        fiscal_year_be=2567,
        ministry_code="10000",
        province=None,
    )
    assert len(parts) == 1
    assert parts[0].path == dest
    assert parts[0].rel_path == "shard.parquet"


# ---------------------------------------------------------------------------
# คอลัมน์ที่ตัด/คงใน budget_lines shard (03 §7 + คำสั่ง main thread)
# ---------------------------------------------------------------------------


def test_shard_column_order_drops_item_name_location_fiscal_year_ce() -> None:
    assert "item_name" not in pub._SHARD_COLUMN_ORDER
    assert "location_text" not in pub._SHARD_COLUMN_ORDER
    assert "fiscal_year_ce" not in pub._SHARD_COLUMN_ORDER
    # ยังคงคอลัมน์คงที่ต่อไฟล์ (dictionary/RLE ทำให้แทบไม่กินที่)
    for kept in ("dataset", "source_path", "source_sheet", "source_doc_id", "fiscal_year_be"):
        assert kept in pub._SHARD_COLUMN_ORDER
    assert "item_name_raw" in pub._SHARD_COLUMN_ORDER
    assert "item_key" in pub._SHARD_COLUMN_ORDER


# ---------------------------------------------------------------------------
# run_publish_pipeline แบบเต็ม — fixture ครอบทุก dataset
# ---------------------------------------------------------------------------


def _build_rich_fixture(cfg: PipelineConfig) -> None:
    """สร้าง normalized cache ครอบคลุมทุก dataset + เคสที่เทสต์ต้องใช้:
    - item_key "ครุภัณฑ์คงทน" ปรากฏ 3 ปี (2565-2567) หลายแถว → เข้า catalog, มี unit_price >= 3
      ค่าต่อปี (basis unit_price_per_line) ครบ >= 3 ปี → มี trend
    - item_key "ก่อสร้างถนน" ปรากฏปีเดียว unit_price น้อย (< 3 ค่า/ปี) แต่ปรากฏ 3 ปี amount เท่านั้น
      → trend basis amount_per_line
    - item_key เดียวกับข้างบนมีแถว dataset=act_2570_province ติด flag subset_of_act_2570_draft
      จำนวนมาก (ทดสอบว่าไม่ถูกนับซ้ำใน n_lines/สถิติ)
    - แถว amount_thb ติดลบ/ศูนย์ → ไม่นับในสถิติ amount
    - แถว unit_price ผิดปกติสูงมาก (outlier) → ติด flag unit_price_outlier ตอน publish (V8)
    - item_name มีคำ "ราคาต่อหน่วยต่ำกว่า" → ติด flag lump_sum_category
    - แถวปี 2562 ของ item_key ที่มี unit_price → trend point มี note source_incomplete
    """
    rows_pbo: list[dict] = []
    # ครุภัณฑ์คงทน: 3 ปี x 4 แถว/ปี, unit_price 100,200,300,400 (คูณ 1000 ต่อปีให้ปีต่างกันชัด)
    for yi, year in enumerate((2565, 2566, 2567)):
        for i in range(4):
            unit_price = (i + 1) * 1000 * (yi + 1)
            rows_pbo.append(
                row(
                    fiscal_year_be=year,
                    fiscal_year_ce=year - 543,
                    item_name_raw="ครุภัณฑ์คงทน",
                    item_name="ครุภัณฑ์คงทน",
                    item_key="ครุภัณฑ์คงทน",
                    item_qty=1.0,
                    amount_thb=unit_price,
                    unit_price_thb=unit_price,
                    agency=f"กรม{i}",
                    source_path=f"PBO/{year}.xlsx",
                    source_row=100 + i,
                )
            )
    # 2562: 1 แถว unit_price (เพื่อทดสอบ note source_incomplete ถ้าปีนี้ติด series — ใช้ item_key
    # เดียวกันแต่ปีเพิ่ม เพื่อให้ >= 3 ปี unit_price อยู่แล้ว 2562 เป็นปีเสริม)
    rows_pbo.append(
        row(
            fiscal_year_be=2562,
            fiscal_year_ce=2019,
            item_name_raw="ครุภัณฑ์คงทน",
            item_name="ครุภัณฑ์คงทน",
            item_key="ครุภัณฑ์คงทน",
            item_qty=1.0,
            amount_thb=5000,
            unit_price_thb=5000,
            agency="กรม0",
            source_path="PBO/2562.xlsx",
            source_row=500,
        )
    )
    for i in range(3):
        rows_pbo.append(
            row(
                fiscal_year_be=2562,
                fiscal_year_ce=2019,
                item_name_raw="ครุภัณฑ์คงทน",
                item_name="ครุภัณฑ์คงทน",
                item_key="ครุภัณฑ์คงทน",
                item_qty=1.0,
                amount_thb=5000 + i,
                unit_price_thb=5000 + i,
                agency=f"กรม{i}",
                source_path="PBO/2562.xlsx",
                source_row=501 + i,
            )
        )

    # ก่อสร้างถนน: ปรากฏ 3 ปี, unit_price มีแค่ 1 ค่า/ปี (ไม่ถึง 3 → ต้องใช้ basis amount)
    for year in (2565, 2566, 2567):
        rows_pbo.append(
            row(
                fiscal_year_be=year,
                fiscal_year_ce=year - 543,
                item_name_raw="ก่อสร้างถนนคอนกรีต",
                item_name="ก่อสร้างถนนคอนกรีต",
                item_key="ก่อสร้างถนนคอนกรีต",
                amount_thb=2_000_000 + year,
                agency="กรมทาง",
                source_path=f"PBO/{year}.xlsx",
                source_row=900 + year,
            )
        )

    # amount_thb <= 0 → ไม่นับในสถิติ amount ของ item_key นี้
    rows_pbo.append(
        row(
            fiscal_year_be=2567,
            item_name_raw="ก่อสร้างถนนคอนกรีต",
            item_name="ก่อสร้างถนนคอนกรีต",
            item_key="ก่อสร้างถนนคอนกรีต",
            amount_thb=0,
            agency="กรมทาง",
            source_path="PBO/2567.xlsx",
            source_row=999,
        )
    )

    # unit_price outlier: item_key "ปั๊มน้ำ" ปกติราคาหลักพัน แต่มีแถวหนึ่งราคาผิดปกติสูงมาก
    # (ต้องมีแถวปกติเยอะพอ — p99.5 ของกลุ่มที่มีน้อยแถวจะถูก outlier เองดันสูงจนไม่ถูกแฟล็ก เหมือน
    # `validate.check_v8` จริง: threshold คำนวณจากกลุ่ม unit_price ทั้งหมดของ item_key รวม outlier)
    for i in range(200):
        rows_pbo.append(
            row(
                fiscal_year_be=2567,
                item_name_raw="ปั๊มน้ำ",
                item_name="ปั๊มน้ำ",
                item_key="ปั๊มน้ำ",
                item_qty=1.0,
                amount_thb=1000 + i,
                unit_price_thb=1000 + i,
                agency="กรมชล",
                source_path="PBO/2567.xlsx",
                source_row=1100 + i,
            )
        )
    rows_pbo.append(
        row(
            fiscal_year_be=2567,
            item_name_raw="ปั๊มน้ำ",
            item_name="ปั๊มน้ำ",
            item_key="ปั๊มน้ำ",
            item_qty=1.0,
            amount_thb=999_000_000,
            unit_price_thb=999_000_000,
            agency="กรมชล",
            source_path="PBO/2567.xlsx",
            source_row=1400,
        )
    )

    # lump_sum_category: item_name มีวลี "ราคาต่อหน่วยต่ำกว่า"
    rows_pbo.append(
        row(
            fiscal_year_be=2567,
            item_name_raw="ครุภัณฑ์สำนักงานที่มีราคาต่อหน่วยต่ำกว่า 1 ล้านบาท",
            item_name="ครุภัณฑ์สำนักงานที่มีราคาต่อหน่วยต่ำกว่า 1 ล้านบาท",
            item_key="ครุภัณฑ์สำนักงานที่มีราคาต่อหน่วยต่ำกว่า 1 ล้านบาท",
            amount_thb=50_000,
            agency="กรมทดสอบ",
            source_path="PBO/2567.xlsx",
            source_row=1300,
        )
    )

    # T-110c (main thread, 20 ก.ย. 2569): whitespace variant ของ item_key เดียวกัน — ต้องรวมเป็น
    # catalog entry เดียวผ่าน group_key (ตัด whitespace ทั้งหมด) "เครื่องพิมพ์เลเซอร์ ขาวดำ" (มีวรรค,
    # 2 แถว 2 ปี) กับ "เครื่องพิมพ์เลเซอร์ขาวดำ" (ไม่มีวรรค, 1 แถว 1 ปี) → group_key เดียวกัน,
    # ตัวแทน (n มากสุด) = "เครื่องพิมพ์เลเซอร์ ขาวดำ" (2 > 1), ปีรวม = 3 ปี (เข้าเกณฑ์ n_years>=3)
    for year, price in ((2565, 5000), (2566, 5100)):
        rows_pbo.append(
            row(
                fiscal_year_be=year,
                fiscal_year_ce=year - 543,
                item_name_raw="เครื่องพิมพ์เลเซอร์ ขาวดำ",
                item_name="เครื่องพิมพ์เลเซอร์ ขาวดำ",
                item_key="เครื่องพิมพ์เลเซอร์ ขาวดำ",
                item_qty=1.0,
                amount_thb=price,
                unit_price_thb=price,
                agency="กรมพัสดุ",
                source_path=f"PBO/{year}.xlsx",
                source_row=1500 + year,
            )
        )
    rows_pbo.append(
        row(
            fiscal_year_be=2567,
            item_name_raw="เครื่องพิมพ์เลเซอร์ขาวดำ",
            item_name="เครื่องพิมพ์เลเซอร์ขาวดำ",
            item_key="เครื่องพิมพ์เลเซอร์ขาวดำ",
            item_qty=1.0,
            amount_thb=5200,
            unit_price_thb=5200,
            agency="กรมพัสดุ",
            source_path="PBO/2567.xlsx",
            source_row=1600,
        )
    )

    write_normalized(cfg.cache_dir, "pbo_disbursement", "pbo.parquet", rows_pbo)

    # act_2570_province: 3 แถว subset_of_act_2570_draft ของ item_key "ก่อสร้างถนนคอนกรีต" — ไม่ควร
    # ถูกนับซ้ำเข้า n_lines/สถิติ (ถ้านับซ้ำ n_lines ของ item นี้จะทะลุ threshold ผิดที่)
    rows_province = [
        row(
            dataset="act_2570_province",
            fiscal_year_be=2570,
            fiscal_year_ce=2027,
            item_name_raw="ก่อสร้างถนนคอนกรีต",
            item_name="ก่อสร้างถนนคอนกรีต",
            item_key="ก่อสร้างถนนคอนกรีต",
            amount_thb=3_000_000,
            agency="กรมทาง",
            province="เชียงใหม่",
            source_path="งบประมาณ เชียงใหม่/act_province.xlsx",
            source_row=10 + i,
            quality_flags=["subset_of_act_2570_draft"],
        )
        for i in range(3)
    ]
    write_normalized(
        cfg.cache_dir, "act_2570_province", "act_2570_province__cnx.parquet", rows_province
    )

    rows_draft = [
        row(
            dataset="act_2570_draft",
            fiscal_year_be=2570,
            fiscal_year_ce=2027,
            item_name_raw="รายการร่าง พรบ",
            item_name="รายการร่าง พรบ",
            item_key="รายการร่าง พรบ",
            amount_thb=7_000_000,
            agency="กรมทดสอบ",
            source_path="ร่าง พ.ร.บ. งบ 2570 ฉบับเต็ม - Excel.xlsx",
            source_row=5,
        )
    ]
    write_normalized(cfg.cache_dir, "act_2570_draft", "act_2570_draft.parquet", rows_draft)

    rows_subsidy = [
        row(
            dataset="local_subsidy_2570",
            fiscal_year_be=2570,
            fiscal_year_ce=2027,
            item_name_raw="เงินอุดหนุนทดสอบ",
            item_name="เงินอุดหนุนทดสอบ",
            item_key="เงินอุดหนุนทดสอบ",
            amount_thb=500_000,
            agency="เทศบาลทดสอบ",
            province="เชียงใหม่",
            source_path="งบประมาณ เชียงใหม่/subsidy.xlsx",
            source_row=1,
            quality_flags=["subset_of_act_2570_draft"],
        )
    ]
    write_normalized(
        cfg.cache_dir, "local_subsidy_2570", "local_subsidy_2570__cnx.parquet", rows_subsidy
    )

    rows_local = [
        row(
            dataset="local_ordinance_2570",
            fiscal_year_be=2570,
            fiscal_year_ce=2027,
            gov_level="local",
            ministry=None,
            ministry_code=None,
            agency=None,
            agency_code=None,
            local_gov_name="องค์การบริหารส่วนตำบลราชาเทวะ",
            province="สมุทรปราการ",
            plan="แผนงานทดสอบ",
            item_name_raw="โครงการทดสอบท้องถิ่น",
            item_name="โครงการทดสอบท้องถิ่น",
            item_key="โครงการทดสอบท้องถิ่น",
            amount_thb=200_000,
            source_path=(
                "งบประมาณ สมุทรปราการ/3 - งบ อบต. ราชาเทวะ/"
                "ร่างข้อบัญญัติงบ 2570 อบต. ราชาเทวะ - Sheets.xlsx"
            ),
            source_row=1,
            quality_flags=["upstream_ocr", "org_unmapped"],
        )
    ]
    write_normalized(
        cfg.cache_dir, "local_ordinance_2570", "smuthrprakar__obt-rachaethwa.parquet", rows_local
    )

    rows_committee = [
        row(
            dataset="committee_table",
            fiscal_year_be=2568,
            fiscal_year_ce=2025,
            gov_level="central",
            ministry="กระทรวงทดสอบ",
            ministry_code=None,
            agency="กรมทดสอบ กมธ.",
            agency_code=None,
            item_name_raw="โครงการ กมธ. ทดสอบ",
            item_name="โครงการ กมธ. ทดสอบ",
            item_key="โครงการ กมธ ทดสอบ",
            amount_thb=1_000_000,
            source_path="กมธ.ติดตามงบ/ครั้งที่ 1 (1 มค 2569)/หัวข้อ/ไฟล์.xlsx",
            source_row=1,
            quality_flags=["org_unmapped"],
        )
    ]
    committee_doc_id = rows_committee[0]["source_doc_id"]
    write_normalized(
        cfg.cache_dir, "committee_table", f"{committee_doc_id}.parquet", rows_committee
    )

    # V5 (source_doc_id ⊆ sources.json): เขียนไฟล์ raw จำลอง (เนื้อหาไม่ต้องถูกต้องจริง — inventory
    # แค่ต้องหาไฟล์เจอที่ path เดียวกับ `source_path` ของทุกแถวข้างบน เพื่อให้ `doc_id_for_path`
    # ที่คำนวณจาก path เดียวกันตรงกับ `source_doc_id` ที่ผูกไว้ใน `row()` แล้ว)
    all_rows = rows_pbo + rows_province + rows_draft + rows_subsidy + rows_local + rows_committee
    seen_paths: set[str] = set()
    for r in all_rows:
        source_path = r["source_path"]
        if source_path in seen_paths:
            continue
        seen_paths.add(source_path)
        raw_path = cfg.raw_data_dir / source_path
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        raw_path.write_bytes(b"fixture placeholder")


def _run_full_pipeline(tmp_path: Path, out_subdir: str = "out") -> tuple[PipelineConfig, object]:
    cfg = make_cfg(tmp_path)
    _build_rich_fixture(cfg)
    out_dir = tmp_path / out_subdir
    result = pub.run_publish_pipeline(cfg, source_sql=pub.default_source_sql(cfg), out_dir=out_dir)
    return cfg, result


@pytest.fixture()
def published(tmp_path: Path):
    return _run_full_pipeline(tmp_path)


def test_publish_pipeline_writes_manifest_and_passes(published) -> None:
    cfg, result = published
    assert result.manifest_path.is_file()
    assert result.validation_passed is True
    assert result.manifest["sample"] is False


def test_catalog_excludes_subset_rows_from_n_lines(published) -> None:
    _cfg, result = published
    by_key = {e["key"]: e for e in result.catalog.entries}
    entry = by_key.get("ก่อสร้างถนนคอนกรีต")
    assert entry is not None
    # 4 แถวจริงใน pbo (2565,2566,2567,2567 amount=0) — ไม่รวม 3 แถว subset_of_act_2570_draft
    assert entry["n_lines"] == 4


def test_catalog_amount_stats_exclude_non_positive(published) -> None:
    _cfg, result = published
    by_key = {e["key"]: e for e in result.catalog.entries}
    entry = by_key["ก่อสร้างถนนคอนกรีต"]
    # แถว amount_thb=0 ต้องไม่นับใน amount stats (n=3 ไม่ใช่ 4)
    assert entry["amount"]["n"] == 3


# ---------------------------------------------------------------------------
# T-110c (main thread, 20 ก.ย. 2569): group_key รวม whitespace variant
# ---------------------------------------------------------------------------


def test_compute_group_key_strips_all_whitespace() -> None:
    assert pub.compute_group_key("เครื่องคอมพิวเตอร์โน้ตบุ๊ก สำหรับงานประมวลผล") == (
        pub.compute_group_key("เครื่องคอมพิวเตอร์โน้ตบุ๊กสำหรับงานประมวลผล")
    )
    assert pub.compute_group_key("a  b\tc\nd") == "abcd"
    assert pub.compute_group_key(None) is None
    assert pub.compute_group_key("") == ""


def test_catalog_merges_whitespace_variants_into_one_entry(published) -> None:
    """ "เครื่องพิมพ์เลเซอร์ ขาวดำ" (2 แถว, 2 ปี) + "เครื่องพิมพ์เลเซอร์ขาวดำ" (1 แถว, 1 ปี) ต้องรวม
    เป็น entry เดียว: n_lines=3, years=3 ปี, ตัวแทน (key) = variant ที่มีแถวมากสุด, keys มีทั้งคู่
    """
    _cfg, result = published
    variant_a = "เครื่องพิมพ์เลเซอร์ ขาวดำ"  # 2 แถว — ตัวแทนต้องเป็นตัวนี้
    variant_b = "เครื่องพิมพ์เลเซอร์ขาวดำ"  # 1 แถว
    by_key = {e["key"]: e for e in result.catalog.entries}
    assert variant_b not in by_key  # variant ที่ไม่ใช่ตัวแทนต้องไม่โผล่เป็น key แยก
    entry = by_key.get(variant_a)
    assert entry is not None, f"entries จริง: {sorted(by_key)}"
    assert entry["n_lines"] == 3
    assert sorted(entry["years"]) == [2565, 2566, 2567]
    assert entry["keys"] == [variant_a, variant_b]
    assert "keys_truncated" not in entry
    assert entry["unit_price"]["n"] == 3
    assert entry["amount"]["n"] == 3
    # shards ต้องครอบคลุมทั้งสองปีที่ variant_b (2567) อยู่ด้วย ไม่ใช่แค่ของ variant_a
    assert any("2567" in s for s in entry["shards"])
    assert any("2565" in s or "2566" in s for s in entry["shards"])


def test_catalog_single_variant_entry_has_no_keys_field(published) -> None:
    """item_key ที่ไม่มี whitespace variant (variant เดียว) ต้องไม่มี field "keys" (ประหยัดขนาด)"""
    _cfg, result = published
    by_key = {e["key"]: e for e in result.catalog.entries}
    entry = by_key["ครุภัณฑ์คงทน"]
    assert "keys" not in entry
    assert "keys_truncated" not in entry


def test_trends_use_group_key_for_merged_variants(published) -> None:
    """เครื่องพิมพ์เลเซอร์: unit_price มีแค่ 1 ค่า/ปี (< TREND_MIN_UNIT_PRICE_PER_YEAR=3) ทุกปี →
    basis ต้องเป็น amount_per_line และ series ต้องรวมข้อมูลจากทั้งสอง variant (3 ปี ไม่ใช่ 2 ปี)
    """
    _cfg, result = published
    variant_a = "เครื่องพิมพ์เลเซอร์ ขาวดำ"
    by_key = {e["key"]: e for e in result.catalog.entries}
    entry = by_key[variant_a]
    assert "trend" in entry
    hh = entry["trend"]
    trends_payload = json.loads(
        gzip.decompress((result.out_dir / "catalog" / "trends" / f"{hh}.json.gz").read_bytes())
    )
    series = trends_payload[variant_a]
    assert series["key"] == variant_a
    assert series["basis"] == "amount_per_line"
    assert sorted(p["year_be"] for p in series["series"]) == [2565, 2566, 2567]
    assert all("median_unit_price_thb" not in p for p in series["series"])


def test_unit_price_outlier_flag_written_to_shard(tmp_path: Path) -> None:
    cfg = make_cfg(tmp_path)
    _build_rich_fixture(cfg)
    out_dir = tmp_path / "out"
    pub.run_publish_pipeline(cfg, source_sql=pub.default_source_sql(cfg), out_dir=out_dir)

    con = duckdb.connect()
    shard_glob = (out_dir / "budget_lines" / "pbo" / "2567" / "*.parquet").as_posix()
    flags = con.execute(
        f"SELECT quality_flags FROM read_parquet('{shard_glob}', union_by_name=True) "
        "WHERE item_key='ปั๊มน้ำ' AND amount_thb=999000000"
    ).fetchone()
    assert flags is not None
    assert "unit_price_outlier" in flags[0]

    lump_flags = con.execute(
        f"SELECT quality_flags FROM read_parquet('{shard_glob}', union_by_name=True) "
        "WHERE item_key LIKE '%ราคาต่อหน่วยต่ำกว่า%'"
    ).fetchone()
    assert lump_flags is not None
    assert "lump_sum_category" in lump_flags[0]


def test_trends_basis_not_mixed_within_series(published) -> None:
    cfg, result = published
    out_dir = result.out_dir
    by_key = {e["key"]: e for e in result.catalog.entries}

    # "ครุภัณฑ์คงทน": unit_price >= 3 ค่า/ปี ทุกปี (2562,2565,2566,2567) → basis unit_price_per_line
    entry_a = by_key["ครุภัณฑ์คงทน"]
    assert "trend" in entry_a
    hh = entry_a["trend"]
    trends_payload = json.loads(
        gzip.decompress((out_dir / "catalog" / "trends" / f"{hh}.json.gz").read_bytes())
    )
    series_a = trends_payload["ครุภัณฑ์คงทน"]
    assert series_a["basis"] == "unit_price_per_line"
    assert all("median_unit_price_thb" in p for p in series_a["series"])
    assert all("median_amount_thb" not in p for p in series_a["series"])
    # ปี 2562 ต้องมี note source_incomplete
    point_2562 = next(p for p in series_a["series"] if p["year_be"] == 2562)
    assert point_2562["note"] == "source_incomplete"

    # "ก่อสร้างถนนคอนกรีต": unit_price ไม่ถึง 3 ค่า/ปี → ต้องใช้ basis amount_per_line ล้วน
    entry_b = by_key["ก่อสร้างถนนคอนกรีต"]
    assert "trend" in entry_b
    hh_b = entry_b["trend"]
    trends_payload_b = json.loads(
        gzip.decompress((out_dir / "catalog" / "trends" / f"{hh_b}.json.gz").read_bytes())
    )
    series_b = trends_payload_b["ก่อสร้างถนนคอนกรีต"]
    assert series_b["basis"] == "amount_per_line"
    assert all("median_amount_thb" in p for p in series_b["series"])
    assert all("median_unit_price_thb" not in p for p in series_b["series"])


def test_catalog_and_trends_sample_source_ids_resolve(published) -> None:
    """`sample_source_ids`/`shards`/`keys` ทุกตัวต้อง resolve ได้จริงในไฟล์ที่เขียน (ข้อ 8/9 + T-110c)"""
    _cfg, result = published
    out_dir = result.out_dir
    con = duckdb.connect()
    for entry in result.catalog.entries:
        for shard_rel in entry["shards"]:
            shard_path = out_dir / shard_rel
            assert shard_path.is_file(), f"shard {shard_rel} ของ {entry['key']} ไม่มีไฟล์จริง"
        for sid in entry["sample_source_ids"]:
            found = False
            for shard_rel in entry["shards"]:
                n = con.execute(
                    f"SELECT COUNT(*) FROM read_parquet('{(out_dir / shard_rel).as_posix()}') "
                    f"WHERE source_id={pub._sql_lit(sid)}"
                ).fetchone()[0]
                if n > 0:
                    found = True
                    break
            assert found, f"sample_source_id {sid} ของ {entry['key']} resolve ไม่ได้"
        # T-110c: ทุก variant ใน "keys" ต้องหาแถวเจอจริงใน shards ของ entry เดียวกัน (browser query
        # ด้วย `item_key IN (keys)`) — ไม่ใช่แค่ตัวแทน "key"
        for variant_key in entry.get("keys", [entry["key"]]):
            found = False
            for shard_rel in entry["shards"]:
                n = con.execute(
                    f"SELECT COUNT(*) FROM read_parquet('{(out_dir / shard_rel).as_posix()}') "
                    f"WHERE item_key={pub._sql_lit(variant_key)}"
                ).fetchone()[0]
                if n > 0:
                    found = True
                    break
            assert found, f"variant key {variant_key!r} ของ entry {entry['key']!r} resolve ไม่ได้"


def _load_catalog_v2(out_dir: Path) -> dict:
    return json.loads(gzip.decompress((out_dir / "catalog" / "items.json.gz").read_bytes()))


def test_catalog_file_on_disk_is_schema_v2_with_shard_index(published) -> None:
    """T-114 ข้อ 6: `catalog/items.json.gz` บนดิสก์ต้องเป็น schema_version 2 — `shard_paths`
    เรียงตัวอักษร ไม่ซ้ำ, `items[].shards` เป็น int ชี้เข้า `shard_paths` (ไม่ใช่ path เต็ม)"""
    _cfg, result = published
    payload = _load_catalog_v2(result.out_dir)
    assert payload["schema_version"] == 2
    shard_paths = payload["shard_paths"]
    assert shard_paths == sorted(shard_paths)
    assert len(shard_paths) == len(set(shard_paths))

    by_key = {e["key"]: e for e in result.catalog.entries}
    assert len(payload["items"]) == len(result.catalog.entries)
    for item in payload["items"]:
        assert all(isinstance(i, int) for i in item["shards"])
        resolved_paths = [shard_paths[i] for i in item["shards"]]
        # ต้องตรงกับ path เต็มที่ `result.catalog.entries` (in-memory, ก่อนแปลงเป็น index) ระบุไว้
        expected = by_key[item["key"]]["shards"]
        assert resolved_paths == expected


def test_sample_source_ids_resolve_within_shard_index_on_disk(published) -> None:
    """T-114 ข้อ 9 (กัน regression บั๊ก cap 60): ทุก `sample_source_ids` ต้องอยู่ในแถวของ shard ที่
    entry ชี้ — ตรวจจากไฟล์ **v2 บนดิสก์จริง** (resolve index → shard_paths → parquet) ไม่ใช่แค่
    โครงสร้างใน memory"""
    _cfg, result = published
    out_dir = result.out_dir
    payload = _load_catalog_v2(out_dir)
    shard_paths = payload["shard_paths"]
    con = duckdb.connect()
    checked = 0
    for item in payload["items"]:
        resolved_shards = [shard_paths[i] for i in item["shards"]]
        for sid in item["sample_source_ids"]:
            checked += 1
            found = any(
                con.execute(
                    f"SELECT COUNT(*) FROM read_parquet('{(out_dir / rel).as_posix()}') "
                    f"WHERE source_id={pub._sql_lit(sid)}"
                ).fetchone()[0]
                > 0
                for rel in resolved_shards
            )
            msg = f"sample_source_id {sid} ของ item {item['key']!r} resolve ไม่ได้ (v2 on-disk)"
            assert found, msg
    assert checked > 0


def test_low_specificity_flag_on_short_key_entry(tmp_path: Path) -> None:
    """T-114 ข้อ 7: key สั้น (ตัดช่องว่างแล้ว <= 12 ตัวอักษร) ต้องติด `low_specificity: true`"""
    cfg = make_cfg(tmp_path)
    rows = [
        row(
            source_id=f"short{i}",
            item_name_raw="ฝาย",
            item_name="ฝาย",
            item_key="ฝาย",
            fiscal_year_be=y,
            fiscal_year_ce=y - 543,
            amount_thb=100_000 * (i + 1),
            source_row=i + 1,
        )
        for i, y in enumerate([2565, 2566, 2567])
    ]
    write_normalized(cfg.cache_dir, "pbo_disbursement", "short.parquet", rows)
    result = pub.run_publish_pipeline(
        cfg, source_sql=pub.default_source_sql(cfg), out_dir=tmp_path / "out"
    )
    by_key = {e["key"]: e for e in result.catalog.entries}
    assert by_key["ฝาย"]["low_specificity"] is True
    assert result.manifest["catalog_threshold"]["n_low_specificity"] >= 1


def test_low_specificity_flag_on_wide_amount_spread_entry(tmp_path: Path) -> None:
    """T-114 ข้อ 7: amount.p75/p25 >= 8 (คนละสเกลกันมาก) ต้องติด `low_specificity: true` แม้ key ยาว"""
    cfg = make_cfg(tmp_path)
    long_key = "ก่อสร้างฝายชลประทานทดสอบขนาดใหญ่มาก"
    assert len(long_key) > 12
    amounts = [100_000, 100_000, 100_000, 100_000_000, 100_000_000]
    rows = [
        row(
            source_id=f"wide{i}",
            item_name_raw=long_key,
            item_name=long_key,
            item_key=long_key,
            fiscal_year_be=2566,
            fiscal_year_ce=2023,
            amount_thb=amt,
            source_row=i + 1,
        )
        for i, amt in enumerate(amounts)
    ]
    write_normalized(cfg.cache_dir, "pbo_disbursement", "wide.parquet", rows)
    result = pub.run_publish_pipeline(
        cfg, source_sql=pub.default_source_sql(cfg), out_dir=tmp_path / "out"
    )
    by_key = {e["key"]: e for e in result.catalog.entries}
    assert by_key[long_key].get("low_specificity") is True


def test_low_specificity_absent_when_neither_condition_holds(tmp_path: Path) -> None:
    cfg = make_cfg(tmp_path)
    long_key = "เครื่องปรับอากาศแบบแยกส่วนขนาดใหญ่มาก"
    assert len(long_key) > 12
    rows = [
        row(
            source_id=f"normal{i}",
            item_name_raw=long_key,
            item_name=long_key,
            item_key=long_key,
            fiscal_year_be=2566,
            fiscal_year_ce=2023,
            amount_thb=100_000 + i * 1_000,
            source_row=i + 1,
        )
        for i in range(5)
    ]
    write_normalized(cfg.cache_dir, "pbo_disbursement", "normal.parquet", rows)
    result = pub.run_publish_pipeline(
        cfg, source_sql=pub.default_source_sql(cfg), out_dir=tmp_path / "out"
    )
    by_key = {e["key"]: e for e in result.catalog.entries}
    assert "low_specificity" not in by_key[long_key]


def test_facets_has_coverage_notes_for_2562_2567_and_adr005(published) -> None:
    _cfg, result = published
    facets = json.loads((result.out_dir / "catalog" / "facets.json").read_text(encoding="utf-8"))
    notes = facets["coverage_notes"]
    refs = {n["decision_ref"] for n in notes}
    assert "ADR-004" in refs
    assert "ADR-005" in refs
    years_2567 = [
        n for n in notes if n.get("fiscal_year_be") == 2567 and n["status"] == "no_oracle"
    ]
    assert years_2567


def test_facets_and_manifest_have_org_unmapped_coverage_notes_for_committee_and_local(
    published,
) -> None:
    """T-114 ข้อ 5: committee_table/local_ordinance_2570 ต้องมี coverage_note สถานะ org_unmapped
    พร้อม % จริง (ทั้งใน facets.json และ manifest.coverage_notes — ค่าเดียวกัน)"""
    _cfg, result = published
    facets = json.loads((result.out_dir / "catalog" / "facets.json").read_text(encoding="utf-8"))
    for source in (facets["coverage_notes"], result.manifest["coverage_notes"]):
        by_dataset = {n["dataset"]: n for n in source if n.get("status") == "org_unmapped"}
        assert by_dataset["committee_table"]["pct_unmapped"] == pytest.approx(100.0)
        assert by_dataset["committee_table"]["n_rows"] == 1
        assert by_dataset["local_ordinance_2570"]["pct_unmapped"] == pytest.approx(100.0)
        assert "ministry_code" in by_dataset["committee_table"]["note"]


def test_manifest_sha256_matches_files_and_deterministic(tmp_path: Path) -> None:
    cfg = make_cfg(tmp_path)
    _build_rich_fixture(cfg)

    out1 = tmp_path / "out1"
    out2 = tmp_path / "out2"
    r1 = pub.run_publish_pipeline(
        cfg, source_sql=pub.default_source_sql(cfg), out_dir=out1, built_at="2020-01-01T00:00:00Z"
    )
    r2 = pub.run_publish_pipeline(
        cfg, source_sql=pub.default_source_sql(cfg), out_dir=out2, built_at="2099-12-31T00:00:00Z"
    )

    assert r1.manifest["data_version"] == r2.manifest["data_version"]
    assert r1.manifest["built_at"] != r2.manifest["built_at"]

    for entry in r1.manifest["files"]:
        path = out1 / entry["path"]
        assert path.is_file()
        assert path.stat().st_size == entry["bytes"]
        assert pub._sha256_file(path) == entry["sha256"]


def test_clean_stale_output_removes_unlisted_files_but_keeps_gitkeep(tmp_path: Path) -> None:
    cfg = make_cfg(tmp_path)
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    (out_dir / ".gitkeep").write_text("", encoding="utf-8")
    stale = out_dir / "budget_lines" / "pbo" / "2560" / "old.parquet"
    stale.parent.mkdir(parents=True)
    stale.write_text("stale", encoding="utf-8")
    keep_file = out_dir / "manifest.json"
    keep_file.write_text("{}", encoding="utf-8")

    removed = pub.clean_stale_output(cfg, out_dir, keep_rel_paths={"manifest.json"})

    assert "budget_lines/pbo/2560/old.parquet" in removed
    assert not stale.is_file()
    assert (out_dir / ".gitkeep").is_file()
    assert keep_file.is_file()
    # โฟลเดอร์ว่างที่เหลือถูกลบไปด้วย
    assert not (out_dir / "budget_lines").is_dir()


def test_sources_json_enrichment_extracted_and_n_chunks(tmp_path: Path) -> None:
    cfg = make_cfg(tmp_path)
    _build_rich_fixture(cfg)

    # จำลอง raw file + doc chunk cache ของไฟล์ office 1 ไฟล์ (โฟลเดอร์ประชุมเดียวกับ committee
    # fixture ที่ _build_rich_fixture สร้างไว้แล้ว — exist_ok=True กันชนกัน)
    (cfg.raw_data_dir / "กมธ.ติดตามงบ" / "ครั้งที่ 1 (1 มค 2569)" / "หัวข้อ").mkdir(
        parents=True, exist_ok=True
    )
    office_path = cfg.raw_data_dir / "กมธ.ติดตามงบ" / "ครั้งที่ 1 (1 มค 2569)" / "หัวข้อ" / "doc.docx"
    office_path.write_bytes(b"PK\x03\x04fake")  # เนื้อหาไม่ต้องเป็น docx จริง — แค่ให้ inventory scan เจอ

    from tgbp_pipeline.util.hash import doc_id_for_path

    rel_path = office_path.relative_to(cfg.raw_data_dir).as_posix()
    doc_id = doc_id_for_path(rel_path)
    docs_cache = cfg.cache_dir / "docs"
    docs_cache.mkdir(parents=True, exist_ok=True)
    from tgbp_pipeline.extract.office_text import write_doc_chunks_gz

    write_doc_chunks_gz(
        docs_cache / f"{doc_id}.json.gz",
        [{"doc_id": doc_id, "page": None, "chunk_no": 0, "text": "สวัสดี", "tables": []}],
    )

    out_dir = tmp_path / "out"
    pub.run_publish_pipeline(cfg, source_sql=pub.default_source_sql(cfg), out_dir=out_dir)

    sources = json.loads((out_dir / "sources.json").read_text(encoding="utf-8"))
    by_id = {d["doc_id"]: d for d in sources}
    assert doc_id in by_id
    assert by_id[doc_id]["extracted"] is True
    assert by_id[doc_id]["text_chunks_file"] == f"docs/{doc_id}.json.gz"
    assert by_id[doc_id]["n_chunks"] == 1
    assert (out_dir / "docs" / f"{doc_id}.json.gz").is_file()


def test_v6_check_flags_oversized_file(tmp_path: Path) -> None:
    big = tmp_path / "big.parquet"
    big.write_bytes(b"0" * 100)
    small = tmp_path / "small.parquet"
    small.write_bytes(b"0" * 10)
    result = check_v6([big, small], max_bytes=50)
    assert result.passed is False
    assert result.n_files == 2
    assert result.oversized == [{"path": str(big), "bytes": 100}]


# ---------------------------------------------------------------------------
# econ/indicators.json
# ---------------------------------------------------------------------------


def _write_econ_source(path: Path, records: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"schema_version": 1, "records": records}, ensure_ascii=False), encoding="utf-8"
    )


def test_econ_series_excludes_indicators_with_fewer_than_3_points(tmp_path: Path) -> None:
    src = tmp_path / "econ.source.json"
    _write_econ_source(
        src,
        [
            {
                "indicator": "only_two",
                "year_be": 2565,
                "value": 1.0,
                "unit": "u",
                "source_name": "s",
                "source_url": "",
            },
            {
                "indicator": "only_two",
                "year_be": 2566,
                "value": 2.0,
                "unit": "u",
                "source_name": "s",
                "source_url": "",
            },
            {
                "indicator": "only_two",
                "year_be": 2567,
                "value": None,
                "unit": "u",
                "source_name": "s",
                "source_url": "",
            },
        ],
    )
    result = pub.build_econ_indicators(src)
    assert result["series"] == []
    assert len(result["records"]) == 3


def test_econ_series_does_not_mix_units_within_indicator(tmp_path: Path) -> None:
    src = tmp_path / "econ.source.json"
    _write_econ_source(
        src,
        [
            {
                "indicator": "mixed",
                "year_be": y,
                "value": 1.0,
                "unit": "u1",
                "source_name": "s",
                "source_url": "",
            }
            for y in (2565, 2566, 2567)
        ]
        + [
            {
                "indicator": "mixed",
                "year_be": y,
                "value": 1.0,
                "unit": "u2",
                "source_name": "s",
                "source_url": "",
            }
            for y in (2568, 2569)
        ],
    )
    result = pub.build_econ_indicators(src)
    assert len(result["series"]) == 1
    series = result["series"][0]
    assert series["unit"] == "u1"  # unit ที่มีจุดมากกว่า (3 > 2) ชนะ
    assert len(series["points"]) == 3
    assert all(p["year_be"] in (2565, 2566, 2567) for p in series["points"])


def test_econ_series_included_when_enough_points(tmp_path: Path) -> None:
    src = tmp_path / "econ.source.json"
    _write_econ_source(
        src,
        [
            {
                "indicator": "ok",
                "year_be": y,
                "value": float(y),
                "unit": "u",
                "source_name": "s",
                "source_url": "http://x",
            }
            for y in (2565, 2566, 2567)
        ],
    )
    result = pub.build_econ_indicators(src)
    assert len(result["series"]) == 1
    assert result["series"][0]["indicator"] == "ok"
    assert result["series"][0]["verified"] is False
    assert result["series"][0]["label_th"]  # ไม่ว่าง


# ---------------------------------------------------------------------------
# T-112: sample() — end-to-end กับ fixture เล็ก
# ---------------------------------------------------------------------------


def test_sample_runs_end_to_end_and_resolves(tmp_path: Path) -> None:
    cfg = make_cfg(tmp_path)
    _build_rich_fixture(cfg)

    result = pub.sample(cfg, rows=200)

    assert result.manifest_path.is_file()
    assert result.out_dir == cfg.fixtures_dir
    con = duckdb.connect()
    for entry in result.catalog.entries:
        for shard_rel in entry["shards"]:
            assert (cfg.fixtures_dir / shard_rel).is_file()
        for sid in entry["sample_source_ids"]:
            found = any(
                con.execute(
                    f"SELECT COUNT(*) FROM read_parquet('{(cfg.fixtures_dir / s).as_posix()}') "
                    f"WHERE source_id={pub._sql_lit(sid)}"
                ).fetchone()[0]
                > 0
                for s in entry["shards"]
            )
            assert found
        for variant_key in entry.get("keys", [entry["key"]]):
            found = any(
                con.execute(
                    f"SELECT COUNT(*) FROM read_parquet('{(cfg.fixtures_dir / s).as_posix()}') "
                    f"WHERE item_key={pub._sql_lit(variant_key)}"
                ).fetchone()[0]
                > 0
                for s in entry["shards"]
            )
            assert found


def test_sample_manifest_has_sample_flag_and_catalog_v2(tmp_path: Path) -> None:
    """T-114 ข้อ 8: manifest ของ `tgbp sample` ต้องมี `"sample": true` และ catalog เป็นรูป v2
    เดียวกับ publish() เต็ม — ทุก index/`keys`/`sample_source_ids` resolve ได้"""
    cfg = make_cfg(tmp_path)
    _build_rich_fixture(cfg)

    result = pub.sample(cfg, rows=200)

    assert result.manifest["sample"] is True
    payload = _load_catalog_v2(cfg.fixtures_dir)
    assert payload["schema_version"] == 2
    shard_paths = payload["shard_paths"]
    assert shard_paths == sorted(shard_paths)

    con = duckdb.connect()
    for item in payload["items"]:
        resolved = [shard_paths[i] for i in item["shards"]]
        for rel in resolved:
            assert (cfg.fixtures_dir / rel).is_file()
        for sid in item["sample_source_ids"]:
            found = any(
                con.execute(
                    f"SELECT COUNT(*) FROM read_parquet('{(cfg.fixtures_dir / rel).as_posix()}') "
                    f"WHERE source_id={pub._sql_lit(sid)}"
                ).fetchone()[0]
                > 0
                for rel in resolved
            )
            msg = f"sample_source_id {sid} ของ item {item['key']!r} resolve ไม่ได้ (sample v2)"
            assert found, msg
        for variant_key in item.get("keys", [item["key"]]):
            found = any(
                con.execute(
                    f"SELECT COUNT(*) FROM read_parquet('{(cfg.fixtures_dir / rel).as_posix()}') "
                    f"WHERE item_key={pub._sql_lit(variant_key)}"
                ).fetchone()[0]
                > 0
                for rel in resolved
            )
            assert found, f"variant key {variant_key!r} ของ item {item['key']!r} resolve ไม่ได้"


def test_stale_trend_shard_is_not_listed_and_gets_cleaned(tmp_path: Path) -> None:
    """ไฟล์ trend ค้างจากรอบก่อนต้องไม่เข้า manifest และต้องถูกล้าง (regression: fixtures ของ sample)"""
    import inspect

    from tgbp_pipeline import publish as publish_mod

    source = inspect.getsource(publish_mod.run_publish_pipeline)
    assert (
        'glob("*.json.gz")' not in source.split("written_trend_shards")[0].split("file_entries")[-1]
    )
    assert "written_trend_shards" in source
