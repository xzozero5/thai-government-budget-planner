"""T-110b: `tgbp publish` — 03-DATA-PIPELINE.md §7 + คำสั่งของ main thread (19 ก.ย. 2569)

แปลง `.cache/normalized/{dataset}/*.parquet` (2,993,621 แถว) → `web/public/data/`:
`budget_lines/**` (parquet shard ตาม dataset), `catalog/{items.json.gz,orgs.json,facets.json,
trends/*.json.gz}`, `docs/{doc_id}.json.gz` (copy), `sources.json` (เติม extracted/n_chunks),
`econ/indicators.json`, `manifest.json`, `validation.json` + `validation_report.md`.

## สถาปัตยกรรม
ใช้ **DuckDB** (dependency มีอยู่แล้ว) อ่าน parquet ของ normalized cache ตรง ๆ ผ่าน `read_parquet`
glob แทนการโหลดทั้งก้อนเข้า pandas — คำนวณ `unit_price_outlier` (V8)/`lump_sum_category` แล้วเก็บเป็น
view `flagged_full` (ทุกคอลัมน์ รวม `item_name`/`location_text`/`fiscal_year_ce` — ใช้ทำ
catalog/trends) และ `flagged` (ตัด 3 คอลัมน์นั้นออก — ใช้เขียน budget_lines shards ตรง 03 §7)

`run_publish_pipeline()` เป็น engine กลางที่ `publish()` (ข้อมูลเต็ม → `cfg.output_dir`) และ
`sample()` (T-112, ข้อมูลย่อย deterministic → `cfg.fixtures_dir`) เรียกร่วมกัน (N7 ไม่สร้างซ้ำ)
โดย `sample()` ส่ง `source_sql` ที่ query เฉพาะ subset ของ normalized cache แทน glob เต็ม

## Catalog threshold (ปรับจากที่ระบุใน spec เดิม — วัดจริงแล้วรายงาน)
สเปคเดิม (main thread) ระบุ `n_lines>=3 OR ปรากฏ>=2ปี OR unit_price>=2 ค่า` แต่วัดจริงจาก
`.cache/normalized/` (19-20 ก.ย. 2569) ได้ 334,069 entries (เกินเป้า ≤150k ไปกว่า 2 เท่า) —
ตัวที่ผลักดันจำนวนคือเงื่อนไข "ปรากฏ >= 2 ปี" (310,486 รายการเข้าเกณฑ์นี้อย่างเดียว) ไม่ใช่ n_lines
ตามที่สเปคคาดไว้ ("ขยับ n_lines >= 4") จึงปรับเป็น **`n_lines>=3 OR ปรากฏ>=3ปี OR unit_price>=2 ค่า`**
แทน (สอดคล้องกับเกณฑ์ trends "≥3 ปี" ในตัว) ได้ 131,934 entries — ดูตัวเลขเปรียบเทียบ threshold อื่น
ในรายงานสรุปที่ main thread เก็บไว้ (`docs/STATUS.md` reference จาก data-engineer)
"""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import re
import shutil
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from tgbp_pipeline.config import PipelineConfig
from tgbp_pipeline.extract.local_sheets import slugify_ascii
from tgbp_pipeline.extract.pdf_text import PDF_REPORT_FILENAME
from tgbp_pipeline.inventory import scan_raw_dir, write_inventory_appendix
from tgbp_pipeline.normalize.org_master import export_catalog_orgs, load_org_master_cache
from tgbp_pipeline.normalize.schema import BUDGET_LINE_COLUMN_NAMES, SourceDoc
from tgbp_pipeline.validate import (
    build_validation_report,
    load_known_source_gaps,
    write_validation_report,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_FILE_BYTES = 24_000_000
TOTAL_OUTPUT_BYTES_LIMIT = 500_000_000
ROW_GROUP_SIZE = 65_536
ZSTD_LEVEL = 15

_SHARD_DROPPED_COLUMNS = frozenset({"item_name", "location_text", "fiscal_year_ce"})
_SHARD_COLUMN_ORDER: tuple[str, ...] = tuple(
    c for c in BUDGET_LINE_COLUMN_NAMES if c not in _SHARD_DROPPED_COLUMNS
)

_LUMP_SUM_LIKE = "%ราคาต่อหน่วยต่ำกว่า%"

# catalog inclusion threshold (ดู module docstring — วัดจริงกับ `.cache/normalized/` 19-20 ก.ย.
# 2569: (3,3,2) ได้ 131,934 entries/14.27 MB gz (เกินเป้า 8 MB), (5,3,2) ได้ 72,854 entries/7.43 MB
# gz — ผ่านทั้งสองเงื่อนไข จึงตั้งเป็นค่าเริ่มต้น; `build_catalog()` ยังขยับเพิ่มอัตโนมัติถ้าเกินจริง)
CATALOG_MIN_LINES = 5
CATALOG_MIN_YEARS = 3
CATALOG_MIN_UNIT_PRICE_DISTINCT = 2
CATALOG_MAX_ENTRIES_TARGET = 150_000
CATALOG_MAX_GZ_BYTES_TARGET = 8_000_000

TREND_MIN_YEARS = 3
TREND_MIN_UNIT_PRICE_PER_YEAR = 3
TREND_SHARD_HEX_LEN = 2

SUBSET_FLAG = "subset_of_act_2570_draft"
CORRUPT_ROW_FLAG = "corrupt_row"
UNIT_PRICE_OUTLIER_FLAG = "unit_price_outlier"
LUMP_SUM_CATEGORY_FLAG = "lump_sum_category"
QTY_LOW_CONF_FLAGS = ("qty_is_measure", "qty_parsed_low_conf")

# T-110c (main thread, 20 ก.ย. 2569): key แตกเพราะ whitespace ภาษาไทยต่างกัน (เช่น
# "เครื่องคอมพิวเตอร์โน้ตบุ๊กสำหรับงานประมวลผล" n=1,503 กับ "...โน้ตบุ๊ก สำหรับ..." n=1,299 คือ
# รายการเดียวกัน) — catalog/trends จึง aggregate ตาม `group_key` (item_key ตัด whitespace ทั้งหมด)
# แทน `item_key` ตรง ๆ **เฉพาะตอน publish** (ไม่แตะ item_key ใน budget_lines shards/normalize)
_WHITESPACE_ALL_RE = re.compile(r"\s+")
CATALOG_MAX_KEYS_PER_GROUP = 12


def compute_group_key(item_key: str | None) -> str | None:
    """`item_key` ตัด whitespace ทั้งหมดออก (ไม่ใช่แค่ collapse) — ใช้จับ variant ที่ต่างกันแค่
    การเว้นวรรค (`item_parser`/OCR ต้นทางบางทีเว้น "โน้ตบุ๊ก สำหรับ" บางทีติดกัน "โน้ตบุ๊กสำหรับ")

    **ต้องตรงกับนิยามฝั่ง SQL ทุกประการ** (`_GROUP_KEY_SQL_EXPR` — `regexp_replace(item_key,
    '\\s+', '', 'g')`) เพราะใช้จับคู่ shard_index (คำนวณฝั่ง Python จาก `ShardPart.item_keys`)
    เข้ากับผลอควรีของ DuckDB (คำนวณฝั่ง SQL จาก `flagged_full.group_key`)
    """
    if item_key is None:
        return None
    return _WHITESPACE_ALL_RE.sub("", item_key)


def _group_key_sql(col_ref: str = "item_key") -> str:
    """นิพจน์ SQL เดียวกับ `compute_group_key()` ข้างบน (DuckDB `\\s` ครอบคลุมชุดเดียวกับ Python
    `\\s` สำหรับข้อความไทย/ละติน/เลขที่พบจริงในข้อมูลนี้ — ยืนยันด้วยผลลัพธ์ตรงกันจริงใน tests)
    """
    return f"regexp_replace({col_ref}, '\\s+', '', 'g')"


DATASET_PBO = "pbo_disbursement"
DATASET_ACT_DRAFT = "act_2570_draft"
DATASET_ACT_PROVINCE = "act_2570_province"
DATASET_LOCAL_SUBSIDY = "local_subsidy_2570"
DATASET_LOCAL_ORDINANCE = "local_ordinance_2570"
DATASET_COMMITTEE = "committee_table"

_UNMAPPED = "_unmapped"
_UNKNOWN_PROVINCE_SLUG = "unknown-province"
_UNKNOWN_GOV_SLUG = "unknown-local-gov"


def _sql_lit(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _province_slug(province: str | None) -> str:
    return slugify_ascii(province) if province else _UNKNOWN_PROVINCE_SLUG


def _gov_slug(name: str | None) -> str:
    return slugify_ascii(name) if name else _UNKNOWN_GOV_SLUG


# ---------------------------------------------------------------------------
# DuckDB views: flagged_full (ทุกคอลัมน์ + flags) / flagged (ตัดคอลัมน์ตาม 03 §7)
# ---------------------------------------------------------------------------


def build_duckdb_views(con: duckdb.DuckDBPyConnection, source_sql: str) -> None:
    """สร้าง `normalized_raw` (view) + `flagged_full`/`flagged` (**TEMP TABLE**, materialize) จาก
    `source_sql`

    `source_sql` เป็น SELECT ที่คืนคอลัมน์ตรงกับ `budget_line_pyarrow_schema()` ทั้งหมด — ปกติคือ
    `SELECT * FROM read_parquet('.../*/*.parquet', union_by_name=True)` (ข้อมูลเต็ม, `publish()`)
    หรือ subquery ของ subset ที่ `sample()` กรองไว้แล้ว

    **สำคัญ (แก้บั๊กประสิทธิภาพจริง — วัดจาก `sample()`: 34 วินาทีสำหรับ 1,000 แถว)**:
    `flagged_full` **ต้อง materialize เป็น TABLE ไม่ใช่ VIEW** เพราะถูก query ซ้ำ ๆ หลายสิบครั้ง
    (ทุก shard group + ทุก catalog sub-aggregate + trends) — ถ้าเป็น view ที่อ้างอิง
    `read_parquet(...)` ผ่าน `normalized_raw` ทุกครั้งจะ scan ไฟล์ parquet ทั้งก้อนใหม่ (รวม
    PBO 2.9M แถวทั้งหมด) ซ้ำทุก query แม้จะกรองด้วย `WHERE dataset=...` ก็ตาม (window function
    `item_thresholds`/flags join กันไม่ให้ predicate pushdown ทะลุไปถึง `read_parquet` ได้เต็มที่)
    """
    con.execute(f"CREATE OR REPLACE VIEW normalized_raw AS {source_sql}")
    con.execute(
        """
        CREATE OR REPLACE TEMP TABLE item_thresholds AS
        SELECT item_key, quantile_cont(unit_price_thb, 0.995) * 10 AS threshold
        FROM normalized_raw
        WHERE item_key IS NOT NULL AND unit_price_thb IS NOT NULL AND unit_price_thb > 0
          AND NOT list_contains(quality_flags, 'corrupt_row')
        GROUP BY item_key
        """
    )
    full_cols_sql = ", ".join(f"b.{c}" for c in BUDGET_LINE_COLUMN_NAMES if c != "quality_flags")
    flags_sql = f"""
        list_concat(
            b.quality_flags,
            CASE WHEN b.unit_price_thb IS NOT NULL AND b.unit_price_thb > 0
                      AND t.threshold IS NOT NULL AND b.unit_price_thb > t.threshold
                 THEN ['{UNIT_PRICE_OUTLIER_FLAG}'] ELSE [] END,
            CASE WHEN b.item_name_raw IS NOT NULL AND b.item_name_raw LIKE '{_LUMP_SUM_LIKE}'
                 THEN ['lump_sum_category'] ELSE [] END
        )
    """
    con.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE flagged_full AS
        SELECT {full_cols_sql}, {flags_sql} AS quality_flags,
               {_group_key_sql("b.item_key")} AS group_key
        FROM normalized_raw b
        LEFT JOIN item_thresholds t USING (item_key)
        """
    )
    shard_cols_sql = ", ".join(_SHARD_COLUMN_ORDER)
    con.execute(
        f"CREATE OR REPLACE TEMP TABLE flagged AS SELECT {shard_cols_sql} FROM flagged_full"
    )


def default_source_sql(cfg: PipelineConfig) -> str:
    glob = (cfg.cache_dir / "normalized" / "*" / "*.parquet").as_posix()
    return f"SELECT * FROM read_parquet({_sql_lit(glob)}, union_by_name=True)"


# ---------------------------------------------------------------------------
# Shard writing
# ---------------------------------------------------------------------------


@dataclass
class ShardPart:
    path: Path
    rel_path: str
    bytes: int
    rows: int
    dataset: str
    fiscal_year_be: int | None
    ministry_code: str | None
    province: str | None
    item_keys: frozenset[str]


def _write_arrow_with_size_limit(
    table: pa.Table,
    dest_path: Path,
    *,
    out_root: Path,
    dataset: str,
    fiscal_year_be: int | None,
    ministry_code: str | None,
    province: str | None,
    max_bytes: int = MAX_FILE_BYTES,
) -> list[ShardPart]:
    n = table.num_rows
    if n == 0:
        return []
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    parts = 1
    while True:
        chunk = math.ceil(n / parts)
        candidates: list[tuple[Path, pa.Table]] = []
        for i in range(parts):
            start = i * chunk
            if start >= n:
                break
            sub = table.slice(start, min(chunk, n - start))
            path = (
                dest_path
                if parts == 1
                else dest_path.with_name(f"{dest_path.stem}_part{i + 1}{dest_path.suffix}")
            )
            candidates.append((path, sub))

        results: list[ShardPart] = []
        ok = True
        for path, sub in candidates:
            pq.write_table(
                sub,
                str(path),
                compression="zstd",
                compression_level=ZSTD_LEVEL,
                row_group_size=ROW_GROUP_SIZE,
                use_dictionary=True,
                write_statistics=True,
            )
            size = path.stat().st_size
            if size > max_bytes:
                ok = False
            item_keys = frozenset(
                v for v in pc.unique(sub.column("item_key")).to_pylist() if v is not None
            )
            results.append(
                ShardPart(
                    path=path,
                    rel_path=path.relative_to(out_root).as_posix(),
                    bytes=size,
                    rows=sub.num_rows,
                    dataset=dataset,
                    fiscal_year_be=fiscal_year_be,
                    ministry_code=ministry_code,
                    province=province,
                    item_keys=item_keys,
                )
            )
        if ok:
            return results
        for path, _sub in candidates:
            path.unlink(missing_ok=True)
        parts += 1
        if parts > max(n, 1):  # ป้องกัน infinite loop ในเคสผิดปกติสุดขั้ว (ไม่ควรเกิดจริง)
            return results


def _fetch_sorted(con: duckdb.DuckDBPyConnection, where_sql: str) -> pa.Table:
    """`ORDER BY agency, item_key, source_id` — **ต้องมี `source_id` เป็น tiebreaker สุดท้ายเสมอ**

    แก้บั๊ก non-determinism จริงที่พบ (รัน `publish()` 2 ครั้งติดกันบนข้อมูลเดียวกัน 19-20 ก.ย.
    2569): `ORDER BY agency, item_key` เฉย ๆ มีแถวผูกคู่ (agency, item_key) ซ้ำกันจำนวนมาก (บรรทัด
    รายการเดียวกันคนละสถานที่/ปีย่อย) — DuckDB ไม่การันตี stable sort ของแถวที่ผูกกันเมื่อรันแบบ
    parallel/multi-thread ลำดับแถวภายใน row group จึงต่างกันได้ทุกรอบรัน ทำให้ byte ของ parquet
    (สถิติ/dictionary encoding ขึ้นกับลำดับ) ต่างกัน แม้ข้อมูล (เป็นเซต) เหมือนกันทุกประการ —
    `source_id` unique เสมอ (V4) จึงเป็น tiebreaker ที่ทำให้ลำดับสมบูรณ์ (total order) แก้ปัญหาได้เด็ดขาด
    """
    return con.execute(
        f"SELECT * FROM flagged WHERE {where_sql} ORDER BY agency, item_key, source_id"
    ).to_arrow_table()


def write_pbo_shards(con: duckdb.DuckDBPyConnection, out_dir: Path) -> list[ShardPart]:
    rows = con.execute(
        "SELECT DISTINCT fiscal_year_be, ministry_code FROM flagged "
        f"WHERE dataset={_sql_lit(DATASET_PBO)}"
    ).fetchall()
    results: list[ShardPart] = []
    for year, mcode in rows:
        year_label = str(int(year)) if year is not None else "unknown-year"
        mcode_safe = mcode if mcode else _UNMAPPED
        where = f"dataset={_sql_lit(DATASET_PBO)} AND " + (
            f"fiscal_year_be={int(year)}" if year is not None else "fiscal_year_be IS NULL"
        )
        where += " AND " + (
            f"ministry_code={_sql_lit(mcode)}" if mcode else "ministry_code IS NULL"
        )
        dest = out_dir / "budget_lines" / "pbo" / year_label / f"{mcode_safe}.parquet"
        table = _fetch_sorted(con, where)
        results += _write_arrow_with_size_limit(
            table,
            dest,
            out_root=out_dir,
            dataset=DATASET_PBO,
            fiscal_year_be=int(year) if year is not None else None,
            ministry_code=mcode,
            province=None,
        )
    return results


def write_act2570_draft_shards(con: duckdb.DuckDBPyConnection, out_dir: Path) -> list[ShardPart]:
    rows = con.execute(
        f"SELECT DISTINCT ministry_code FROM flagged WHERE dataset={_sql_lit(DATASET_ACT_DRAFT)}"
    ).fetchall()
    results: list[ShardPart] = []
    for (mcode,) in rows:
        mcode_safe = mcode if mcode else _UNMAPPED
        where = f"dataset={_sql_lit(DATASET_ACT_DRAFT)} AND " + (
            f"ministry_code={_sql_lit(mcode)}" if mcode else "ministry_code IS NULL"
        )
        dest = out_dir / "budget_lines" / "act2570" / f"{mcode_safe}.parquet"
        table = _fetch_sorted(con, where)
        results += _write_arrow_with_size_limit(
            table,
            dest,
            out_root=out_dir,
            dataset=DATASET_ACT_DRAFT,
            fiscal_year_be=2570,
            ministry_code=mcode,
            province=None,
        )
    return results


def _write_province_shards(
    con: duckdb.DuckDBPyConnection, dataset: str, folder: str, out_dir: Path
) -> list[ShardPart]:
    rows = con.execute(
        f"SELECT DISTINCT province FROM flagged WHERE dataset={_sql_lit(dataset)}"
    ).fetchall()
    results: list[ShardPart] = []
    for (province,) in rows:
        slug = _province_slug(province)
        where = f"dataset={_sql_lit(dataset)} AND " + (
            f"province={_sql_lit(province)}" if province is not None else "province IS NULL"
        )
        dest = out_dir / "budget_lines" / folder / f"{slug}.parquet"
        table = _fetch_sorted(con, where)
        results += _write_arrow_with_size_limit(
            table,
            dest,
            out_root=out_dir,
            dataset=dataset,
            fiscal_year_be=2570,
            ministry_code=None,
            province=province,
        )
    return results


def write_act2570_province_shards(con: duckdb.DuckDBPyConnection, out_dir: Path) -> list[ShardPart]:
    return _write_province_shards(con, DATASET_ACT_PROVINCE, "act2570_province", out_dir)


def write_local_subsidy_shards(con: duckdb.DuckDBPyConnection, out_dir: Path) -> list[ShardPart]:
    return _write_province_shards(con, DATASET_LOCAL_SUBSIDY, "local_subsidy", out_dir)


def write_local_ordinance_shards(con: duckdb.DuckDBPyConnection, out_dir: Path) -> list[ShardPart]:
    rows = con.execute(
        "SELECT DISTINCT province, local_gov_name FROM flagged "
        f"WHERE dataset={_sql_lit(DATASET_LOCAL_ORDINANCE)}"
    ).fetchall()
    results: list[ShardPart] = []
    for province, gov_name in rows:
        province_slug = _province_slug(province)
        gov_slug = _gov_slug(gov_name)
        where = f"dataset={_sql_lit(DATASET_LOCAL_ORDINANCE)} AND " + (
            f"province={_sql_lit(province)}" if province is not None else "province IS NULL"
        )
        where += " AND " + (
            f"local_gov_name={_sql_lit(gov_name)}"
            if gov_name is not None
            else "local_gov_name IS NULL"
        )
        dest = out_dir / "budget_lines" / "local" / province_slug / f"{gov_slug}.parquet"
        table = _fetch_sorted(con, where)
        results += _write_arrow_with_size_limit(
            table,
            dest,
            out_root=out_dir,
            dataset=DATASET_LOCAL_ORDINANCE,
            fiscal_year_be=2570,
            ministry_code=None,
            province=province,
        )
    return results


def write_committee_shards(con: duckdb.DuckDBPyConnection, out_dir: Path) -> list[ShardPart]:
    rows = con.execute(
        f"SELECT DISTINCT source_doc_id FROM flagged WHERE dataset={_sql_lit(DATASET_COMMITTEE)}"
    ).fetchall()
    results: list[ShardPart] = []
    for (doc_id,) in rows:
        where = f"dataset={_sql_lit(DATASET_COMMITTEE)} AND source_doc_id={_sql_lit(doc_id)}"
        dest = out_dir / "budget_lines" / "committee" / f"{doc_id}.parquet"
        table = _fetch_sorted(con, where)
        results += _write_arrow_with_size_limit(
            table,
            dest,
            out_root=out_dir,
            dataset=DATASET_COMMITTEE,
            fiscal_year_be=None,
            ministry_code=None,
            province=None,
        )
    return results


def write_all_shards(con: duckdb.DuckDBPyConnection, out_dir: Path) -> list[ShardPart]:
    parts: list[ShardPart] = []
    parts += write_pbo_shards(con, out_dir)
    parts += write_act2570_draft_shards(con, out_dir)
    parts += write_act2570_province_shards(con, out_dir)
    parts += write_local_subsidy_shards(con, out_dir)
    parts += write_local_ordinance_shards(con, out_dir)
    parts += write_committee_shards(con, out_dir)
    return parts


# ---------------------------------------------------------------------------
# Catalog (`catalog/items.json.gz`)
# ---------------------------------------------------------------------------


@dataclass
class CatalogBuildResult:
    entries: list[dict]
    min_lines: int
    min_years: int
    min_unit_price_distinct: int
    # (n_lines, n_years, n_up, count, gz_bytes) ทุก threshold ที่ลอง — รายงานใน manifest.json
    thresholds_tried: list[tuple[int, int, int, int, int]]
    # {representative key (= entry["key"]): group_key} — ใช้ต่อโดย build_trends เท่านั้น
    # (ไม่เขียนลง catalog/items.json.gz — group_key เป็นรายละเอียดภายในของ publish stage)
    group_key_by_key: dict[str, str]


# แถวที่ไม่นับเป็น "รายการเทียบราคาได้" เลย (ตัดออกจาก n_lines/n_years/สถิติ/variant ทั้งหมด — ไม่ใช่
# แค่ไม่นับซ้ำแบบ subset_of_act_2570_draft): corrupt_row (เงินเป็น null/ผิดปกติ), lump_sum_category
# (เป็นหมวดรวม "ราคาต่อหน่วยต่ำกว่า X บาท" ไม่ใช่รายการเดี่ยว)
_CATALOG_BASE_EXCLUDE_SQL = (
    "NOT list_contains(quality_flags, 'subset_of_act_2570_draft')"
    " AND NOT list_contains(quality_flags, 'corrupt_row')"
    " AND NOT list_contains(quality_flags, 'lump_sum_category')"
)

_CATALOG_AGG_SQL_TEMPLATE = f"""
SELECT
    group_key,
    COUNT(*) AS n_lines,
    COUNT(DISTINCT fiscal_year_be) AS n_years,
    list_sort(list_distinct(list(fiscal_year_be))) AS years,
    COUNT(DISTINCT CASE WHEN unit_price_thb > 0
                          AND NOT list_contains(quality_flags,'unit_price_outlier')
                          AND NOT list_contains(quality_flags,'qty_is_measure')
                          AND NOT list_contains(quality_flags,'qty_parsed_low_conf')
                     THEN unit_price_thb END) AS n_unit_price_distinct
FROM flagged_full
WHERE group_key IS NOT NULL
  AND {_CATALOG_BASE_EXCLUDE_SQL}
GROUP BY group_key
"""


def _round_stat(v: float | None) -> int | None:
    return int(round(v)) if v is not None else None


def _build_catalog_entries(
    con: duckdb.DuckDBPyConnection,
    shard_index: dict[str, list[str]],
    n_lines: int,
    n_years: int,
    n_up: int,
) -> tuple[list[dict], dict[str, str]]:
    """สร้าง catalog entries เต็มสำหรับ threshold ตัวหนึ่ง — aggregate ตาม `group_key` (item_key
    ตัด whitespace ทั้งหมด, `compute_group_key`) เพื่อรวม variant ที่ต่างกันแค่การเว้นวรรค

    คืน `(entries, group_key_by_key)` — `group_key_by_key` map จาก representative key (= "key"
    ของแต่ละ entry) กลับไป group_key ให้ `build_trends` ใช้ต่อ (เรียกซ้ำได้จาก `build_catalog`
    ตอนขยับ threshold — แต่ละครั้งคือการ scan `flagged_full` ใหม่ทั้งหมด ~15-20 วินาทีบนข้อมูลเต็ม)
    """
    con.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE catalog_agg AS
        SELECT * FROM ({_CATALOG_AGG_SQL_TEMPLATE}) t
        WHERE n_lines >= {n_lines} OR n_years >= {n_years} OR n_unit_price_distinct >= {n_up}
        """
    )

    # variant ของ item_key จริงต่อ group_key (สำหรับเลือกตัวแทน "key" + สร้าง "keys" list)
    con.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE catalog_variants AS
        SELECT group_key, item_key, COUNT(*) AS n
        FROM flagged_full
        WHERE group_key IN (SELECT group_key FROM catalog_agg)
          AND {_CATALOG_BASE_EXCLUDE_SQL}
        GROUP BY group_key, item_key
        """
    )
    con.execute(
        """
        CREATE OR REPLACE TEMP TABLE catalog_keys AS
        WITH ranked AS (
            SELECT group_key, item_key, n,
                   row_number() OVER (PARTITION BY group_key ORDER BY n DESC, item_key ASC) AS rn
            FROM catalog_variants
        )
        SELECT group_key, list(item_key ORDER BY rn) AS all_keys, COUNT(*) AS n_variants
        FROM ranked GROUP BY group_key
        """
    )

    con.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE catalog_unit_price AS
        SELECT group_key,
            MIN(unit_price_thb) AS up_min,
            quantile_cont(unit_price_thb, 0.25) AS up_p25,
            median(unit_price_thb) AS up_median,
            quantile_cont(unit_price_thb, 0.75) AS up_p75,
            MAX(unit_price_thb) AS up_max,
            COUNT(*) AS up_n
        FROM flagged_full
        WHERE group_key IN (SELECT group_key FROM catalog_agg)
          AND unit_price_thb > 0
          AND NOT list_contains(quality_flags,'unit_price_outlier')
          AND NOT list_contains(quality_flags,'qty_is_measure')
          AND NOT list_contains(quality_flags,'qty_parsed_low_conf')
          AND {_CATALOG_BASE_EXCLUDE_SQL}
        GROUP BY group_key
        """
    )
    con.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE catalog_amount AS
        SELECT group_key,
            MIN(amount_thb) AS amt_min,
            quantile_cont(amount_thb, 0.25) AS amt_p25,
            median(amount_thb) AS amt_median,
            quantile_cont(amount_thb, 0.75) AS amt_p75,
            MAX(amount_thb) AS amt_max,
            COUNT(*) AS amt_n
        FROM flagged_full
        WHERE group_key IN (SELECT group_key FROM catalog_agg)
          AND amount_thb > 0
          AND NOT list_contains(quality_flags,'unit_price_outlier')
          AND {_CATALOG_BASE_EXCLUDE_SQL}
        GROUP BY group_key
        """
    )
    con.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE catalog_display_name AS
        WITH name_counts AS (
            SELECT group_key, item_name, COUNT(*) AS n
            FROM flagged_full
            WHERE group_key IN (SELECT group_key FROM catalog_agg) AND item_name IS NOT NULL
              AND {_CATALOG_BASE_EXCLUDE_SQL}
            GROUP BY group_key, item_name
        ), ranked AS (
            SELECT group_key, item_name,
                   row_number() OVER (PARTITION BY group_key ORDER BY n DESC, item_name ASC) AS rn
            FROM name_counts
        )
        SELECT group_key, item_name AS display_name FROM ranked WHERE rn = 1
        """
    )
    con.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE catalog_top_agencies AS
        WITH agency_counts AS (
            SELECT group_key, agency, COUNT(*) AS n
            FROM flagged_full
            WHERE group_key IN (SELECT group_key FROM catalog_agg) AND agency IS NOT NULL
              AND {_CATALOG_BASE_EXCLUDE_SQL}
            GROUP BY group_key, agency
        ), ranked AS (
            SELECT group_key, agency,
                   row_number() OVER (PARTITION BY group_key ORDER BY n DESC, agency ASC) AS rn
            FROM agency_counts
        )
        SELECT group_key, list(agency ORDER BY rn) AS top_agencies
        FROM ranked WHERE rn <= 3 GROUP BY group_key
        """
    )
    con.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE catalog_sample_sources AS
        WITH ranked AS (
            SELECT group_key, source_id,
                   row_number() OVER (
                       PARTITION BY group_key ORDER BY COALESCE(amount_thb, 0) DESC, source_id ASC
                   ) AS rn
            FROM flagged_full
            WHERE group_key IN (SELECT group_key FROM catalog_agg)
              AND {_CATALOG_BASE_EXCLUDE_SQL}
        )
        SELECT group_key, list(source_id ORDER BY rn) AS sample_source_ids
        FROM ranked WHERE rn <= 3 GROUP BY group_key
        """
    )

    joined = con.execute(
        """
        SELECT a.group_key, k.all_keys, k.n_variants, d.display_name, a.n_lines, a.years,
               up.up_min, up.up_p25, up.up_median, up.up_p75, up.up_max, up.up_n,
               amt.amt_min, amt.amt_p25, amt.amt_median, amt.amt_p75, amt.amt_max, amt.amt_n,
               ta.top_agencies, ss.sample_source_ids
        FROM catalog_agg a
        LEFT JOIN catalog_keys k USING (group_key)
        LEFT JOIN catalog_display_name d USING (group_key)
        LEFT JOIN catalog_unit_price up USING (group_key)
        LEFT JOIN catalog_amount amt USING (group_key)
        LEFT JOIN catalog_top_agencies ta USING (group_key)
        LEFT JOIN catalog_sample_sources ss USING (group_key)
        """
    ).fetchall()

    entries: list[dict] = []
    group_key_by_key: dict[str, str] = {}
    for row in joined:
        (
            group_key,
            all_keys,
            n_variants,
            display_name,
            n_lines_v,
            years,
            up_min,
            up_p25,
            up_median,
            up_p75,
            up_max,
            up_n,
            amt_min,
            amt_p25,
            amt_median,
            amt_p75,
            amt_max,
            amt_n,
            top_agencies,
            sample_source_ids,
        ) = row
        all_keys = all_keys or []
        # all_keys เรียง (n DESC, item_key ASC) แล้วจาก SQL — ตัวแรกคือ representative
        # (variant ที่มีจำนวนแถวมากสุด, เสมอกันเรียงตัวอักษร — deterministic)
        representative = all_keys[0]
        entry: dict = {
            "key": representative,
            "name": display_name,
            "n_lines": n_lines_v,
            "years": [int(y) for y in (years or [])],
            "top_agencies": (top_agencies or [])[:3],
            "sample_source_ids": (sample_source_ids or [])[:3],
            # ห้าม cap รายการ shard: ถ้าตัด browser จะ query ได้ไม่ครบ n_lines และ
            # sample_source_ids อาจชี้ไปนอก shard ที่ระบุ (main thread พบ 194 entries ตอน cap=60)
            # path ซ้ำ ๆ บีบอัดดีมาก ต้นทุนขนาดต่ำ
            "shards": sorted(shard_index.get(group_key, [])),
        }
        if n_variants and n_variants > 1:
            entry["keys"] = all_keys[:CATALOG_MAX_KEYS_PER_GROUP]
            if len(all_keys) > CATALOG_MAX_KEYS_PER_GROUP:
                entry["keys_truncated"] = True
        if up_n:
            entry["unit_price"] = {
                "min": _round_stat(up_min),
                "p25": _round_stat(up_p25),
                "median": _round_stat(up_median),
                "p75": _round_stat(up_p75),
                "max": _round_stat(up_max),
                "n": up_n,
            }
        if amt_n:
            entry["amount"] = {
                "min": _round_stat(amt_min),
                "p25": _round_stat(amt_p25),
                "median": _round_stat(amt_median),
                "p75": _round_stat(amt_p75),
                "max": _round_stat(amt_max),
                "n": amt_n,
            }
        entries.append(entry)
        group_key_by_key[representative] = group_key

    entries.sort(key=lambda e: e["key"])
    return entries, group_key_by_key


def _gzip_size(payload: object) -> int:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    return len(gzip.compress(data, compresslevel=9))


def build_catalog(
    con: duckdb.DuckDBPyConnection,
    shard_index: dict[str, list[str]],
    *,
    min_lines: int = CATALOG_MIN_LINES,
    min_years: int = CATALOG_MIN_YEARS,
    min_unit_price_distinct: int = CATALOG_MIN_UNIT_PRICE_DISTINCT,
    max_entries: int = CATALOG_MAX_ENTRIES_TARGET,
    max_gz_bytes: int = CATALOG_MAX_GZ_BYTES_TARGET,
) -> CatalogBuildResult:
    """สร้าง catalog entries — ขยับ threshold อัตโนมัติถ้าจำนวนเกิน `max_entries` **หรือ** ขนาด
    gzip เกิน `max_gz_bytes` — รายงานทุกจุดที่ลองไว้ใน `thresholds_tried` (ไปที่ manifest.json ต่อ)

    T-110c (main thread, 20 ก.ย. 2569): เปลี่ยนจาก aggregate ตาม `item_key` ตรง ๆ เป็น aggregate
    ตาม `group_key` (ตัด whitespace) — รวม variant ที่ item_parser/OCR ต้นทางเว้นวรรคไม่เหมือนกัน
    (เช่น "เครื่องคอมพิวเตอร์โน้ตบุ๊กสำหรับงานประมวลผล" กับ "...โน้ตบุ๊ก สำหรับ...") เข้าเป็น entry
    เดียว — จำนวน entry ที่ได้จึงน้อยกว่าตอน aggregate ตาม item_key ตรง ๆ (วัดจริงแล้วรายงานในคอมเมนต์
    `docs/STATUS.md`/รายงานงานนี้ ไม่ hardcode ตัวเลขไว้ในโค้ดเพราะเปลี่ยนตามข้อมูลจริง)
    """
    thresholds_tried: list[tuple[int, int, int, int, int]] = []
    n_lines, n_years, n_up = min_lines, min_years, min_unit_price_distinct
    entries: list[dict] = []
    group_key_by_key: dict[str, str] = {}
    for _attempt in range(10):
        entries, group_key_by_key = _build_catalog_entries(con, shard_index, n_lines, n_years, n_up)
        gz_bytes = _gzip_size(entries)
        thresholds_tried.append((n_lines, n_years, n_up, len(entries), gz_bytes))
        if len(entries) <= max_entries and gz_bytes <= max_gz_bytes:
            break
        n_lines += 1
        n_years += 1
        if n_lines > 100:  # safety valve — ไม่ควรถึงจุดนี้จริงตามข้อมูลที่วัดแล้ว
            break

    return CatalogBuildResult(
        entries=entries,
        min_lines=n_lines,
        min_years=n_years,
        min_unit_price_distinct=n_up,
        thresholds_tried=thresholds_tried,
        group_key_by_key=group_key_by_key,
    )


def write_json_gz(path: Path, payload: object) -> None:
    """เขียน json.gz แบบ deterministic (mtime=0) — เหมือน `write_doc_chunks_gz` (N7 pattern เดียวกัน)"""
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(payload, ensure_ascii=False, sort_keys=False).encode("utf-8")
    with open(path, "wb") as raw:
        with gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as gz:
            gz.write(data)


# ---------------------------------------------------------------------------
# Trends (`catalog/trends/{hh}.json.gz`)
# ---------------------------------------------------------------------------


def build_trends(
    con: duckdb.DuckDBPyConnection, group_key_by_key: dict[str, str]
) -> dict[str, dict]:
    """คืน `{group_key: {"key": representative, "basis": "...", "series":[...]}}`

    T-110c: aggregate ตาม `group_key` (รวม whitespace variant — ดู `compute_group_key`) แทน
    `item_key` ตรง ๆ — `group_key_by_key` คือ `{representative_key: group_key}` จาก
    `CatalogBuildResult.group_key_by_key` (representative = ตัวแทนเดียวกับ catalog entry "key")

    เฉพาะ group_key ที่ series สุดท้าย (หลังเลือก basis เดียว) มี >= `TREND_MIN_YEARS` ปี — basis
    เดียวทั้ง series เสมอ (ห้ามปน unit_price_per_line/amount_per_line ในไฟล์เดียว — เลือก basis ที่
    ครอบคลุมปีมากสุด แล้วทิ้งปีที่ไม่มีข้อมูลของ basis นั้น)
    """
    if not group_key_by_key:
        return {}
    key_by_group = {g: k for k, g in group_key_by_key.items()}
    group_keys = list(key_by_group)
    keys_list = ", ".join(_sql_lit(k) for k in group_keys)
    rows = con.execute(
        f"""
        WITH up AS (
            SELECT group_key, fiscal_year_be AS year_be, unit_price_thb
            FROM flagged_full
            WHERE group_key IN ({keys_list}) AND fiscal_year_be IS NOT NULL
              AND unit_price_thb > 0
              AND {_CATALOG_BASE_EXCLUDE_SQL}
              AND NOT list_contains(quality_flags,'unit_price_outlier')
              AND NOT list_contains(quality_flags,'qty_is_measure')
              AND NOT list_contains(quality_flags,'qty_parsed_low_conf')
        ), up_stats AS (
            SELECT group_key, year_be, COUNT(*) AS n,
                   median(unit_price_thb) AS median_v,
                   quantile_cont(unit_price_thb, 0.25) AS p25,
                   quantile_cont(unit_price_thb, 0.75) AS p75
            FROM up GROUP BY group_key, year_be
        ), amt AS (
            SELECT group_key, fiscal_year_be AS year_be, amount_thb
            FROM flagged_full
            WHERE group_key IN ({keys_list}) AND fiscal_year_be IS NOT NULL
              AND amount_thb > 0
              AND {_CATALOG_BASE_EXCLUDE_SQL}
              AND NOT list_contains(quality_flags,'unit_price_outlier')
        ), amt_stats AS (
            SELECT group_key, year_be, COUNT(*) AS n, median(amount_thb) AS median_v
            FROM amt GROUP BY group_key, year_be
        )
        SELECT COALESCE(u.group_key, a.group_key) AS group_key,
               COALESCE(u.year_be, a.year_be) AS year_be,
               u.n AS up_n, u.median_v AS up_median, u.p25 AS up_p25, u.p75 AS up_p75,
               a.n AS amt_n, a.median_v AS amt_median
        FROM up_stats u
        FULL OUTER JOIN amt_stats a USING (group_key, year_be)
        ORDER BY group_key, year_be
        """
    ).fetchall()

    by_key: dict[str, list[tuple]] = defaultdict(list)
    for r in rows:
        by_key[r[0]].append(r)

    trends: dict[str, dict] = {}
    for group_key, year_rows in by_key.items():
        up_years = [
            r for r in year_rows if r[2] is not None and r[2] >= TREND_MIN_UNIT_PRICE_PER_YEAR
        ]
        amt_years = [r for r in year_rows if r[6] is not None and r[6] >= 1]
        if len(up_years) >= len(amt_years):
            basis = "unit_price_per_line"
            chosen = up_years
        else:
            basis = "amount_per_line"
            chosen = amt_years
        if len(chosen) < TREND_MIN_YEARS:
            continue

        series = []
        for r in chosen:
            _group_key, year_be, up_n, up_median, up_p25, up_p75, amt_n, amt_median = r
            if basis == "unit_price_per_line":
                point = {
                    "year_be": int(year_be),
                    "n": up_n,
                    "median_unit_price_thb": _round_stat(up_median),
                    "p25": _round_stat(up_p25),
                    "p75": _round_stat(up_p75),
                }
            else:
                point = {
                    "year_be": int(year_be),
                    "n": amt_n,
                    "median_amount_thb": _round_stat(amt_median),
                }
            if int(year_be) == 2562:
                point["note"] = "source_incomplete"
            series.append(point)
        trends[group_key] = {"key": key_by_group[group_key], "basis": basis, "series": series}
    return trends


def write_trend_shards(out_dir: Path, trends: dict[str, dict]) -> dict[str, str]:
    """เขียน `catalog/trends/{hh}.json.gz` (hh = 2 ตัวแรกของ sha1(group_key)) — `trends` keyed ด้วย
    `group_key` (จาก `build_trends`) แต่ไฟล์ที่เขียนจริง**คืน dict keyed ด้วย representative key**
    (`payload["key"]` — ตัวแทนเดียวกับ `catalog` entry "key") เพื่อให้ browser lookup ตรง ๆ ด้วย
    `catalogEntry.key` ได้เลยโดยไม่ต้องรู้จัก `group_key`

    คืน `{representative_key: hh}` ให้ `run_publish_pipeline` เติม `entry["trend"]`
    """
    buckets: dict[str, dict[str, dict]] = defaultdict(dict)
    key_to_hh: dict[str, str] = {}
    for group_key, payload in trends.items():
        hh = hashlib.sha1(group_key.encode("utf-8")).hexdigest()[:TREND_SHARD_HEX_LEN]
        representative = payload["key"]
        buckets[hh][representative] = payload
        key_to_hh[representative] = hh
    trends_dir = out_dir / "catalog" / "trends"
    for hh, payload in buckets.items():
        write_json_gz(trends_dir / f"{hh}.json.gz", payload)
    return key_to_hh


# ---------------------------------------------------------------------------
# Facets + orgs
# ---------------------------------------------------------------------------


def build_facets(con: duckdb.DuckDBPyConnection, cfg: PipelineConfig) -> dict:
    def _distinct_counts(col: str) -> list[dict]:
        rows = con.execute(
            f"SELECT {col}, COUNT(*) FROM flagged_full WHERE {col} IS NOT NULL "
            f"GROUP BY {col} ORDER BY {col}"
        ).fetchall()
        return [{"value": v, "count": c} for v, c in rows]

    facets = {
        "ministries": _distinct_counts("ministry_code"),
        "fiscal_years": _distinct_counts("fiscal_year_be"),
        "budget_types": _distinct_counts("budget_type"),
        "provinces": _distinct_counts("province"),
        "datasets": _distinct_counts("dataset"),
    }

    gaps = load_known_source_gaps()
    coverage_notes: list[dict] = []
    pbo_gaps = gaps.get(DATASET_PBO) or {}
    for year, entry in pbo_gaps.items():
        coverage_notes.append(
            {
                "dataset": DATASET_PBO,
                "fiscal_year_be": int(year),
                "status": "source_incomplete",
                "coverage_pct": entry.get("coverage_pct"),
                "missing_ministries": entry.get("missing_ministries", []),
                "partial_ministries": entry.get("partial_ministries", []),
                "note": str(entry.get("note", "")).strip(),
                "decision_ref": "ADR-004",
            }
        )
    # 2567: ไม่มี oracle เลย (soft, ADR ไม่มีเลขเฉพาะ — อ้าง 03 §6 V1(d))
    coverage_notes.append(
        {
            "dataset": DATASET_PBO,
            "fiscal_year_be": 2567,
            "status": "no_oracle",
            "note": "ไม่มี Grand Total/Sheet1 ให้ตรวจยอดในไฟล์ต้นทาง — ตรวจแค่จำนวนแถว (soft)",
            "decision_ref": "03-DATA-PIPELINE.md §6 V1(d)",
        }
    )
    coverage_notes.append(
        {
            "dataset": DATASET_LOCAL_ORDINANCE,
            "fiscal_year_be": 2570,
            "status": "upstream_ocr_group_mismatch",
            "note": (
                "อบต. ราชาเทวะ: ตัวเลขระดับแถวถอดจาก OCR ของต้นทาง (ไม่ใช่เรา OCR) — 10/38 กลุ่ม "
                "(plan, activity, budget_type) ยอดไม่ตรง summary ที่พิมพ์ในเอกสาร (flag "
                "group_total_mismatch) ยอดรวมทั้งไฟล์ต่างกัน 0.21% เท่านั้น"
            ),
            "decision_ref": "ADR-005",
        }
    )
    facets["coverage_notes"] = coverage_notes
    return facets


def build_orgs(cfg: PipelineConfig) -> list[dict]:
    org_master = load_org_master_cache(cfg)
    if org_master is None:
        return []
    return export_catalog_orgs(org_master)


# ---------------------------------------------------------------------------
# docs/*.json.gz copy + sources.json enrichment
# ---------------------------------------------------------------------------


@dataclass
class DocsCopyResult:
    n_copied: int
    n_bytes: int
    rel_paths: list[str]


def copy_doc_chunks(
    cfg: PipelineConfig, out_dir: Path, *, max_docs: int | None = None
) -> DocsCopyResult:
    """copy `docs/{doc_id}.json.gz` byte-identical จาก `.cache/docs/`

    `max_docs` (ใช้โดย `sample()` เท่านั้น — T-112): จำกัดจำนวนไฟล์ที่ copy โดยเลือกไฟล์**เล็กสุดก่อน**
    (เรียงตามขนาดแล้วชื่อ, deterministic) เพื่อคุมขนาด fixtures รวม
    """
    src_dir = cfg.cache_dir / "docs"
    dest_dir = out_dir / "docs"
    dest_dir.mkdir(parents=True, exist_ok=True)
    rel_paths: list[str] = []
    total_bytes = 0
    if src_dir.is_dir():
        candidates = sorted(src_dir.glob("*.json.gz"))
        if max_docs is not None:
            candidates = sorted(candidates, key=lambda p: (p.stat().st_size, p.name))[:max_docs]
        for src in sorted(candidates):
            dest = dest_dir / src.name
            shutil.copyfile(src, dest)
            rel_paths.append(f"docs/{src.name}")
            total_bytes += dest.stat().st_size
    return DocsCopyResult(n_copied=len(rel_paths), n_bytes=total_bytes, rel_paths=rel_paths)


def _load_pdf_report(cfg: PipelineConfig) -> dict[str, dict]:
    path = cfg.cache_dir / "docs" / PDF_REPORT_FILENAME
    if not path.is_file():
        return {}
    rows = json.loads(path.read_text(encoding="utf-8"))
    return {r["doc_id"]: r for r in rows}


def update_sources_with_extraction(
    cfg: PipelineConfig, docs: list[SourceDoc], con: duckdb.DuckDBPyConnection
) -> list[SourceDoc]:
    """เติม `extracted`/`text_chunks_file`/`n_chunks` ให้ `SourceDoc` แต่ละตัว (T-110b)

    - PDF: จาก `_pdf_report.json` (status ok/partial_timeout → extracted=True)
    - office/committee (มี `.cache/docs/{doc_id}.json.gz` แต่ไม่ใช่ PDF): นับจากไฟล์ gz ตรง ๆ
    - ไฟล์ที่ doc_id ปรากฏใน `source_doc_id` ของ budget_lines (มีข้อมูลโครงสร้างจริง): extracted=True
      ด้วย (ไม่มี text_chunks_file เพราะไม่ใช่ DocChunk)
    """
    from tgbp_pipeline.extract.office_text import read_doc_chunks_gz

    pdf_report = _load_pdf_report(cfg)
    docs_cache_dir = cfg.cache_dir / "docs"
    mapped_doc_ids = {
        r[0] for r in con.execute("SELECT DISTINCT source_doc_id FROM flagged_full").fetchall()
    }

    updated: list[SourceDoc] = []
    for doc in docs:
        data = doc.model_dump()
        gz_path = docs_cache_dir / f"{doc.doc_id}.json.gz"

        if doc.kind == "pdf" and doc.doc_id in pdf_report:
            r = pdf_report[doc.doc_id]
            if r["status"] in ("ok", "partial_timeout") and gz_path.is_file():
                data["extracted"] = True
                data["text_chunks_file"] = f"docs/{doc.doc_id}.json.gz"
                data["n_chunks"] = r.get("chunks")
            elif r["status"] == "text_layer_garbled":
                data["extracted"] = False
                data["note"] = "text_layer_garbled: ข้อความสกัดได้เพี้ยนเกินเกณฑ์ (>30%) — ไม่เขียน DocChunk"
            elif r["status"] == "failed":
                data["extracted"] = False
                data["note"] = f"pdf extract failed: {r.get('error')}"
        elif gz_path.is_file():
            try:
                n_chunks = len(read_doc_chunks_gz(gz_path))
            except Exception:  # noqa: BLE001 — ไฟล์ gz เสียไม่ควรทำให้ทั้ง publish ล้ม
                n_chunks = None
            data["extracted"] = True
            data["text_chunks_file"] = f"docs/{doc.doc_id}.json.gz"
            data["n_chunks"] = n_chunks

        if not data["extracted"] and doc.doc_id in mapped_doc_ids:
            data["extracted"] = True  # ข้อมูลถูกดึงเป็น budget_lines โครงสร้างแล้ว (ไม่มี DocChunk)

        updated.append(SourceDoc.model_validate(data))
    return updated


def write_sources_json(out_dir: Path, docs: list[SourceDoc]) -> Path:
    out_path = out_dir / "sources.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = [d.model_dump(mode="json") for d in docs]
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False),
        encoding="utf-8",
        newline="\n",
    )
    return out_path


# ---------------------------------------------------------------------------
# econ/indicators.json
# ---------------------------------------------------------------------------

ECON_SOURCE_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "econ" / "indicators.source.json"
)

# label_th ต่อ indicator (T-110b — กำหนดในโค้ดตามที่ main thread สั่ง; ยังไม่ verified)
ECON_LABEL_TH: dict[str, str] = {
    "cmi_asphalt_petroleum": "ดัชนีราคาวัสดุก่อสร้าง หมวดยางมะตอย/ปิโตรเลียม (ไม่มีข้อมูลแยกจาก สนค.)",
    "cmi_cement": "ดัชนีราคาวัสดุก่อสร้าง หมวดซีเมนต์",
    "cmi_concrete": "ดัชนีราคาวัสดุก่อสร้าง หมวดผลิตภัณฑ์คอนกรีต",
    "cmi_electrical": "ดัชนีราคาวัสดุก่อสร้าง หมวดอุปกรณ์ไฟฟ้า (ไม่มีข้อมูลแยกจาก สนค.)",
    "cmi_electrical_plumbing": "ดัชนีราคาวัสดุก่อสร้าง หมวดอุปกรณ์ไฟฟ้าและประปา",
    "cmi_other": "ดัชนีราคาวัสดุก่อสร้าง หมวดวัสดุก่อสร้างอื่น ๆ",
    "cmi_paint": "ดัชนีราคาวัสดุก่อสร้าง หมวดวัสดุฉาบผิว",
    "cmi_plumbing": "ดัชนีราคาวัสดุก่อสร้าง หมวดอุปกรณ์ประปา (ไม่มีข้อมูลแยกจาก สนค.)",
    "cmi_sanitary": "ดัชนีราคาวัสดุก่อสร้าง หมวดสุขภัณฑ์",
    "cmi_steel": "ดัชนีราคาวัสดุก่อสร้าง หมวดเหล็กและผลิตภัณฑ์เหล็ก",
    "cmi_tiles": "ดัชนีราคาวัสดุก่อสร้าง หมวดกระเบื้อง",
    "cmi_wood": "ดัชนีราคาวัสดุก่อสร้าง หมวดไม้และผลิตภัณฑ์ไม้",
    "construction_material_index": "ดัชนีราคาวัสดุก่อสร้าง (รวมทุกหมวด)",
    "cpi_headline_index": "ดัชนีราคาผู้บริโภคทั่วไป (CPI)",
    "diesel_avg_thb_per_l": "ราคาน้ำมันดีเซลเฉลี่ยรายปี",
    "gasoline95_avg_thb_per_l": "ราคาน้ำมันเบนซิน 95 เฉลี่ยรายปี",
    "gdp_growth_pct": "อัตราการเติบโตทางเศรษฐกิจ (GDP)",
    "government_budget_total_mthb": "งบประมาณรายจ่ายรวมของรัฐบาล",
    "inflation_pct": "อัตราเงินเฟ้อทั่วไป",
    "min_wage_avg_thb": "ค่าแรงขั้นต่ำเฉลี่ยทั้งประเทศ",
    "min_wage_bangkok_thb": "ค่าแรงขั้นต่ำกรุงเทพมหานคร",
    "usd_thb_avg": "อัตราแลกเปลี่ยนเฉลี่ย บาทต่อดอลลาร์สหรัฐ",
}

ECON_MIN_POINTS_FOR_SERIES = 3


def build_econ_indicators(source_path: Path | None = None) -> dict:
    """`econ/indicators.json` — `{schema_version, records, series}` (03 §3.5, T-110b)

    `series` เฉพาะ indicator ที่มีค่า (`value is not None`) >= 3 ปี **และ unit เดียวกันทั้งชุด**
    (ถ้า unit ต่างกันในปีเดียวกัน/indicator เดียวกัน → ห้ามรวมเป็น series เดียว: เลือก unit ที่มี
    จำนวนจุดมากสุด ทิ้งจุดที่ unit ต่างไป — ข้อมูลจริงที่ตรวจ 19-20 ก.ย. 2569 ทุก indicator มี unit
    เดียวตลอดอยู่แล้ว จึงไม่มีจุดถูกทิ้งจริงในรอบนี้ แต่ตรรกะนี้ยังใช้ป้องกันไว้)
    """
    src = source_path if source_path is not None else ECON_SOURCE_PATH
    raw = json.loads(src.read_text(encoding="utf-8"))
    records = raw["records"]

    by_indicator: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        by_indicator[r["indicator"]].append(r)

    series: list[dict] = []
    for indicator, recs in sorted(by_indicator.items()):
        valid = [r for r in recs if r.get("value") is not None]
        if len(valid) < ECON_MIN_POINTS_FOR_SERIES:
            continue
        unit_counts: dict[str, int] = defaultdict(int)
        for r in valid:
            unit_counts[r["unit"]] += 1
        best_unit = max(unit_counts.items(), key=lambda kv: (kv[1], kv[0]))[0]
        same_unit = [r for r in valid if r["unit"] == best_unit]
        if len(same_unit) < ECON_MIN_POINTS_FOR_SERIES:
            continue
        same_unit.sort(key=lambda r: r["year_be"])
        first = same_unit[0]
        series.append(
            {
                "indicator": indicator,
                "label_th": ECON_LABEL_TH.get(indicator, indicator),
                "unit": best_unit,
                "points": [{"year_be": r["year_be"], "value": r["value"]} for r in same_unit],
                "source_name": first.get("source_name"),
                "source_url": first.get("source_url"),
                "verified": False,
            }
        )

    return {"schema_version": raw.get("schema_version", 1), "records": records, "series": series}


# ---------------------------------------------------------------------------
# cleanup: ล้าง output เก่าที่ไม่อยู่ใน manifest ใหม่ (N6 ผ่าน assert_writable_path)
# ---------------------------------------------------------------------------


def clean_stale_output(cfg: PipelineConfig, out_dir: Path, keep_rel_paths: set[str]) -> list[str]:
    out_dir = cfg.assert_writable_path(out_dir)
    removed: list[str] = []
    if not out_dir.is_dir():
        return removed
    for path in sorted(out_dir.rglob("*")):
        if path.is_dir():
            continue
        if path.name == ".gitkeep":
            continue
        rel = path.relative_to(out_dir).as_posix()
        if rel not in keep_rel_paths:
            path.unlink()
            removed.append(rel)
    # ลบโฟลเดอร์ว่างที่เหลือ (จากล่างขึ้นบน)
    for d in sorted((p for p in out_dir.rglob("*") if p.is_dir()), key=lambda p: -len(p.parts)):
        try:
            d.rmdir()
        except OSError:
            pass
    return removed


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


@dataclass
class ManifestFileEntry:
    path: str
    bytes: int
    sha256: str
    rows: int | None = None
    dataset: str | None = None
    fiscal_year_be: int | None = None
    ministry_code: str | None = None
    province: str | None = None


def build_manifest(
    out_dir: Path,
    file_entries: list[ManifestFileEntry],
    *,
    totals: dict,
    catalog_scope: str,
    coverage_notes: list[dict],
    built_at: str | None = None,
) -> dict:
    files_sorted = sorted(file_entries, key=lambda e: e.path)
    # data_version: hash ของรายการไฟล์ (path+sha256+rows) — ไม่ขึ้นกับ built_at (deterministic)
    version_payload = json.dumps(
        [
            {"path": e.path, "sha256": e.sha256, "bytes": e.bytes, "rows": e.rows}
            for e in files_sorted
        ],
        ensure_ascii=False,
        sort_keys=True,
    )
    data_version = hashlib.sha256(version_payload.encode("utf-8")).hexdigest()

    return {
        "schema_version": 1,
        "data_version": data_version,
        "built_at": built_at or datetime.now(UTC).isoformat(),
        "totals": totals,
        "files": [
            {
                "path": e.path,
                "bytes": e.bytes,
                "sha256": e.sha256,
                "rows": e.rows,
                "dataset": e.dataset,
                "fiscal_year_be": e.fiscal_year_be,
                "ministry_code": e.ministry_code,
                "province": e.province,
            }
            for e in files_sorted
        ],
        "catalog_scope": catalog_scope,
        "coverage_notes": coverage_notes,
    }


CATALOG_SCOPE_NOTE = (
    "catalog/items.json.gz แต่ละ entry คือกลุ่ม item_key ที่เหมือนกันหลังตัด whitespace ทั้งหมด "
    "(group_key — รวม variant ที่ item_parser/OCR ต้นทางเว้นวรรคต่างกัน เช่น 'X สำหรับY' กับ "
    "'XสำหรับY'); 'key' = variant ที่มีจำนวนแถวมากสุด (ตัวแทน, deterministic — เสมอกันเรียงตัวอักษร), "
    "'keys' = variant ทั้งหมดของกลุ่ม (มีเฉพาะเมื่อ > 1 variant, cap 12 ตัว + 'keys_truncated:true' "
    "ถ้าเกิน) — query budget_lines shard ด้วย `item_key IN (keys ถ้ามี มิฉะนั้นใช้ key)`; ครอบคลุม"
    "เฉพาะกลุ่มที่ (n_lines >= เกณฑ์) หรือ (ปรากฏ >= เกณฑ์ปี) หรือ (มี unit_price ที่ต่างกัน >= 2 ค่า) "
    "ไม่รวมแถว corrupt_row/lump_sum_category/subset_of_act_2570_draft — ดู manifest "
    "'catalog_threshold' รายการหางยาว (long-tail) ที่ไม่เข้า catalog ยังค้นได้ด้วย SQL ตรงบน "
    "budget_lines shards ผ่าน DuckDB-WASM"
)


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


@dataclass
class PublishResult:
    out_dir: Path
    shard_parts: list[ShardPart]
    catalog: CatalogBuildResult
    n_trend_items: int
    docs: DocsCopyResult
    manifest: dict
    manifest_path: Path
    validation_passed: bool
    total_bytes: int
    elapsed_by_stage: dict[str, float]


def run_publish_pipeline(
    cfg: PipelineConfig,
    *,
    source_sql: str,
    out_dir: Path,
    total_bytes_limit: int = TOTAL_OUTPUT_BYTES_LIMIT,
    built_at: str | None = None,
    max_docs: int | None = None,
    run_validation: bool = True,
) -> PublishResult:
    elapsed: dict[str, float] = {}
    t_start = time.monotonic()

    out_dir = cfg.assert_writable_path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect()
    t0 = time.monotonic()
    build_duckdb_views(con, source_sql)
    elapsed["duckdb_views"] = time.monotonic() - t0

    t0 = time.monotonic()
    shard_parts = write_all_shards(con, out_dir)
    elapsed["budget_lines"] = time.monotonic() - t0

    # shard_index คีย์ด้วย group_key (T-110c) — ไม่แตะ item_key จริงในไฟล์ shard เอง แค่รวม index
    # ฝั่ง publish เพื่อให้ catalog entry ที่รวม whitespace variant แล้วหา shard ได้ครบทุก variant
    shard_index: dict[str, set[str]] = defaultdict(set)
    for part in shard_parts:
        for key in part.item_keys:
            group_key = compute_group_key(key)
            if group_key is not None:
                shard_index[group_key].add(part.rel_path)

    t0 = time.monotonic()
    catalog_result = build_catalog(con, shard_index)
    catalog_path = out_dir / "catalog" / "items.json.gz"
    write_json_gz(catalog_path, catalog_result.entries)
    elapsed["catalog"] = time.monotonic() - t0

    t0 = time.monotonic()
    # กรองเฉพาะ entry ที่มี >= TREND_MIN_YEARS ปีก่อนส่งเข้า build_trends (ประหยัด — ไม่ query
    # flagged_full ซ้ำสำหรับ group_key ที่รู้อยู่แล้วว่าไม่ถึงเกณฑ์)
    trend_group_key_by_key = {
        e["key"]: catalog_result.group_key_by_key[e["key"]]
        for e in catalog_result.entries
        if e["years"] and len(e["years"]) >= TREND_MIN_YEARS
    }
    trends = build_trends(con, trend_group_key_by_key)
    key_to_hh = write_trend_shards(out_dir, trends)
    for entry in catalog_result.entries:
        hh = key_to_hh.get(entry["key"])
        if hh is not None:
            entry["trend"] = hh
    # เขียนซ้ำ items.json.gz หลังเติม `trend` field (เขียนครั้งแรกไว้เผื่อ build_trends ล้มเหลว
    # แต่ในทางปฏิบัติ deterministic เสมอ — เขียนรอบสุดท้ายนี้คือไฟล์จริงที่ publish)
    write_json_gz(catalog_path, catalog_result.entries)
    elapsed["trends"] = time.monotonic() - t0

    t0 = time.monotonic()
    facets = build_facets(con, cfg)
    facets_path = out_dir / "catalog" / "facets.json"
    facets_path.parent.mkdir(parents=True, exist_ok=True)
    facets_path.write_text(
        json.dumps(facets, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
        newline="\n",
    )
    orgs = build_orgs(cfg)
    if max_docs is not None:
        # sample() (T-112): จำกัด orgs.json เฉพาะ ministry_code/agency_code ที่ปรากฏจริงใน subset
        # (org master เต็มมี ~3,322 รายการ ~650 KB — เกินงบ fixtures 1.5 MB ไปเกินครึ่งลำพังไฟล์เดียว)
        used_codes = {
            v
            for row in con.execute(
                "SELECT DISTINCT ministry_code FROM flagged_full "
                "UNION SELECT DISTINCT agency_code FROM flagged_full"
            ).fetchall()
            for v in row
            if v is not None
        }
        orgs = [o for o in orgs if o["code"] in used_codes]
    orgs_path = out_dir / "catalog" / "orgs.json"
    orgs_path.write_text(
        json.dumps(orgs, ensure_ascii=False, indent=2, sort_keys=False),
        encoding="utf-8",
        newline="\n",
    )
    elapsed["facets_orgs"] = time.monotonic() - t0

    t0 = time.monotonic()
    docs_result = copy_doc_chunks(cfg, out_dir, max_docs=max_docs)
    raw_docs, _stats = scan_raw_dir(cfg)
    enriched_docs = update_sources_with_extraction(cfg, raw_docs, con)
    if max_docs is not None:
        # sample(): sources.json เก็บเฉพาะไฟล์ที่ตัวเองอ้างถึงจริง (มี text_chunks_file ที่ copy
        # มาแล้ว หรือ doc_id ปรากฏใน source_doc_id ของแถวที่ sample มา) — full sources.json (262
        # ไฟล์, ~330 KB) เกินงบ fixtures ไปมากถ้าเก็บทั้งหมดโดยไม่มีประโยชน์ต่อ dev/test
        kept_doc_ids = {Path(p).stem.removesuffix(".json") for p in docs_result.rel_paths}
        mapped_doc_ids = {
            r[0] for r in con.execute("SELECT DISTINCT source_doc_id FROM flagged_full").fetchall()
        }
        relevant = kept_doc_ids | mapped_doc_ids
        enriched_docs = [d for d in enriched_docs if d.doc_id in relevant]
        for d in enriched_docs:
            if d.text_chunks_file is not None and d.doc_id not in kept_doc_ids:
                d.text_chunks_file = None
    sources_path = write_sources_json(out_dir, enriched_docs)
    if max_docs is None:
        write_inventory_appendix(cfg, enriched_docs, _stats)
    elapsed["docs_sources"] = time.monotonic() - t0

    t0 = time.monotonic()
    econ = build_econ_indicators()
    econ_path = out_dir / "econ" / "indicators.json"
    econ_path.parent.mkdir(parents=True, exist_ok=True)
    econ_path.write_text(
        json.dumps(econ, ensure_ascii=False, indent=2, sort_keys=False),
        encoding="utf-8",
        newline="\n",
    )
    elapsed["econ"] = time.monotonic() - t0

    con.close()

    # --- manifest (validation.json/validation_report.md ไม่รวมใน data_version — เขียนทีหลัง) ---
    file_entries: list[ManifestFileEntry] = []
    for part in shard_parts:
        file_entries.append(
            ManifestFileEntry(
                path=part.rel_path,
                bytes=part.bytes,
                sha256=_sha256_file(part.path),
                rows=part.rows,
                dataset=part.dataset,
                fiscal_year_be=part.fiscal_year_be,
                ministry_code=part.ministry_code,
                province=part.province,
            )
        )
    for extra_path in [catalog_path, facets_path, orgs_path, sources_path, econ_path]:
        file_entries.append(
            ManifestFileEntry(
                path=extra_path.relative_to(out_dir).as_posix(),
                bytes=extra_path.stat().st_size,
                sha256=_sha256_file(extra_path),
            )
        )
    for hh_path in sorted((out_dir / "catalog" / "trends").glob("*.json.gz")):
        file_entries.append(
            ManifestFileEntry(
                path=hh_path.relative_to(out_dir).as_posix(),
                bytes=hh_path.stat().st_size,
                sha256=_sha256_file(hh_path),
            )
        )
    for doc_rel in docs_result.rel_paths:
        p = out_dir / doc_rel
        file_entries.append(
            ManifestFileEntry(path=doc_rel, bytes=p.stat().st_size, sha256=_sha256_file(p))
        )

    totals: dict = {"files": len(file_entries), "bytes": sum(e.bytes for e in file_entries)}
    rows_by_dataset: dict[str, int] = defaultdict(int)
    for part in shard_parts:
        rows_by_dataset[part.dataset] += part.rows
    totals["rows_by_dataset"] = dict(rows_by_dataset)

    coverage_notes = facets["coverage_notes"]

    manifest = build_manifest(
        out_dir,
        file_entries,
        totals=totals,
        catalog_scope=CATALOG_SCOPE_NOTE,
        coverage_notes=coverage_notes,
        built_at=built_at,
    )
    manifest["catalog_threshold"] = {
        "min_lines": catalog_result.min_lines,
        "min_years": catalog_result.min_years,
        "min_unit_price_distinct": catalog_result.min_unit_price_distinct,
        "n_entries": len(catalog_result.entries),
        "thresholds_tried": [
            {"n_lines": a, "n_years": b, "n_unit_price_distinct": c, "count": d, "gz_bytes": e}
            for a, b, c, d, e in catalog_result.thresholds_tried
        ],
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=False),
        encoding="utf-8",
        newline="\n",
    )

    # --- cleanup ไฟล์เก่าที่ไม่อยู่ใน manifest (+ manifest.json เอง) ---
    keep = {e["path"] for e in manifest["files"]} | {"manifest.json"}
    clean_stale_output(cfg, out_dir, keep)

    total_bytes = sum(f.stat().st_size for f in out_dir.rglob("*") if f.is_file())

    # --- validation (V1-V10 รวม V6 หลัง publish จริงแล้ว) ---
    # `sample()` (T-112) ข้ามการรัน V1-V10 เต็ม (V1/V2/V3 อ่าน `.cache/{pbo,act2570}` เต็มเสมอ
    # ไม่เกี่ยวกับ subset ที่ sample เขียน — รันซ้ำจะเสียเวลาโดยไม่ได้ตรวจอะไรเพิ่มเกี่ยวกับ fixtures)
    # แต่ยัง**ต้อง**ตรวจ V6 (ไฟล์ < 24 MB) + ขนาดรวมกับไฟล์ที่เพิ่งเขียนจริงเสมอ
    t0 = time.monotonic()
    published_files = [f for f in out_dir.rglob("*") if f.is_file() and f.name != "manifest.json"]
    if run_validation:
        report = build_validation_report(
            cfg,
            published_files=published_files,
            total_output_bytes=total_bytes,
            total_output_bytes_limit=total_bytes_limit,
            sources_json_path=sources_path,
        )
        write_validation_report(cfg, report, out_dir=out_dir)
        validation_passed = report.passed
    else:
        from tgbp_pipeline.validate import check_v6

        v6 = check_v6(published_files)
        validation_passed = v6.passed and total_bytes <= total_bytes_limit
        summary = {
            "generated_at": datetime.now(UTC).isoformat(),
            "mode": "sample (V1-V10 เต็มข้าม — ดู publish.py::run_publish_pipeline)",
            "v6": {"passed": v6.passed, "n_files": v6.n_files, "oversized": v6.oversized},
            "total_output_bytes": total_bytes,
            "total_output_bytes_limit": total_bytes_limit,
            "passed": validation_passed,
        }
        (out_dir / "validation.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n"
        )
        (out_dir / "validation_report.md").write_text(
            f"# TGBP sample validation\n\nสถานะ: {'PASS' if validation_passed else 'FAIL'}\n\n"
            f"V6 (ไฟล์ < 24 MB): {'PASS' if v6.passed else 'FAIL'} ({v6.n_files} ไฟล์)\n\n"
            f"รวมขนาด: {total_bytes:,} bytes (เพดาน {total_bytes_limit:,})\n",
            encoding="utf-8",
            newline="\n",
        )
    elapsed["validate"] = time.monotonic() - t0

    elapsed["total"] = time.monotonic() - t_start

    return PublishResult(
        out_dir=out_dir,
        shard_parts=shard_parts,
        catalog=catalog_result,
        n_trend_items=len(trends),
        docs=docs_result,
        manifest=manifest,
        manifest_path=manifest_path,
        validation_passed=validation_passed,
        total_bytes=total_bytes,
        elapsed_by_stage=elapsed,
    )


def publish(cfg: PipelineConfig) -> PublishResult:
    """`tgbp publish` — ข้อมูลเต็ม → `cfg.output_dir` (`web/public/data/`)"""
    return run_publish_pipeline(cfg, source_sql=default_source_sql(cfg), out_dir=cfg.output_dir)


# ---------------------------------------------------------------------------
# T-112: `tgbp sample` — stratified subset deterministic → `cfg.fixtures_dir`
#
# ใช้ `run_publish_pipeline()` เดียวกับ `publish()` (N7) แต่ป้อน `source_sql` ที่ query เฉพาะ
# subset เล็ก ๆ ของ `.cache/normalized/` แทน glob เต็ม — เพราะ engine เดียวกันจึงรับประกันเองว่า
# catalog/trends/facets/orgs ที่ได้ "สอดคล้องกับแถวใน sample จริง" (sample_source_ids/shards ทุกตัว
# resolve ได้ใน fixtures เสมอ ไม่ต้องเขียน logic ยืนยันแยกต่างหาก)
# ---------------------------------------------------------------------------

# ปีที่เลือกตายตัว (deterministic) — 2566-2568 มี oracle ปกติทั้งคู่ (ไม่ใช่ 2562/2567 ที่มีสถานะพิเศษ
# — sample ควรเป็นตัวแทนเคสปกติเป็นหลัก) ครอบคลุม >= 3 ปีต่อเนื่องพอให้ trends มีข้อมูลทดสอบได้
SAMPLE_PBO_YEARS: tuple[int, ...] = (2566, 2567, 2568)
SAMPLE_N_MINISTRIES = 3
SAMPLE_ROW_SHARE: dict[str, float] = {
    "pbo": 0.45,
    "act2570_draft": 0.20,
    "act2570_province": 0.05,
    "local_subsidy": 0.05,
    "local_ordinance": 0.15,
    "committee": 0.10,
}


def _top_values(
    con: duckdb.DuckDBPyConnection, glob: str, group_col: str, n: int, *, where: str = "TRUE"
) -> list:
    rows = con.execute(
        f"""
        SELECT {group_col}, COUNT(*) AS n
        FROM read_parquet({_sql_lit(glob)}, union_by_name=True)
        WHERE {group_col} IS NOT NULL AND {where}
        GROUP BY {group_col}
        ORDER BY n DESC, {group_col} ASC
        LIMIT {n}
        """
    ).fetchall()
    return [r[0] for r in rows]


def build_sample_source_sql(cfg: PipelineConfig, con: duckdb.DuckDBPyConnection, rows: int) -> str:
    """SQL (UNION ALL ของ subset แต่ละ dataset) สำหรับป้อน `build_duckdb_views` ใน `sample()`

    Deterministic เสมอ (ไม่มีการสุ่มจริง — "seed คงที่" หมายถึง deterministic selection): เลือก
    ministry_code/province/local_gov_name/doc_id ที่มีแถวมากสุด (`ORDER BY n DESC, key ASC`) แล้ว
    จำกัดจำนวนแถวต่อกลุ่ม **แทนที่จะ `LIMIT` แบบเรียง `source_id` เฉย ๆ** — เพราะ `source_id` เป็น
    hash (กระจายสุ่ม) ทำให้ `LIMIT` ธรรมดากระจายไปโดนแทบทุก ministry_code/province/doc_id ที่มีจริง
    (พบจริง: act2570/local/committee เดิมได้ shard 30+ ไฟล์เล็ก ๆ แทนที่จะเป็นไม่กี่ไฟล์ — ทำให้
    ขนาดรวม fixtures เกิน 1.5 MB จาก parquet footer/schema overhead ต่อไฟล์ ไม่ใช่จากข้อมูลจริง)
    """
    root = (cfg.cache_dir / "normalized").as_posix()

    def cap(share_key: str) -> int:
        return max(1, int(rows * SAMPLE_ROW_SHARE[share_key]))

    pbo_glob = f"{root}/pbo_disbursement/*.parquet"
    years_sql = ", ".join(str(y) for y in SAMPLE_PBO_YEARS)
    ministries = _top_values(
        con,
        pbo_glob,
        "ministry_code",
        SAMPLE_N_MINISTRIES,
        where=f"fiscal_year_be IN ({years_sql})",
    )
    mcode_sql = ", ".join(_sql_lit(m) for m in ministries) if ministries else "NULL"
    per_group_limit = max(1, cap("pbo") // max(len(SAMPLE_PBO_YEARS) * max(len(ministries), 1), 1))

    parts: list[str] = []
    if ministries:
        parts.append(
            f"""
            SELECT * EXCLUDE (rn) FROM (
                SELECT *, row_number() OVER (
                    PARTITION BY fiscal_year_be, ministry_code ORDER BY source_id
                ) AS rn
                FROM read_parquet({_sql_lit(pbo_glob)}, union_by_name=True)
                WHERE fiscal_year_be IN ({years_sql}) AND ministry_code IN ({mcode_sql})
            ) WHERE rn <= {per_group_limit}
            """
        )

        act_draft_glob = f"{root}/act_2570_draft/*.parquet"
        parts.append(
            f"""
            SELECT * EXCLUDE (rn) FROM (
                SELECT *, row_number() OVER (PARTITION BY ministry_code ORDER BY source_id) AS rn
                FROM read_parquet({_sql_lit(act_draft_glob)}, union_by_name=True)
                WHERE ministry_code IN ({mcode_sql})
            ) WHERE rn <= {max(1, cap("act2570_draft") // len(ministries))}
            """
        )

    def one_group(glob_suffix: str, group_col: str, limit_key: str) -> str | None:
        glob = f"{root}/{glob_suffix}"
        values = _top_values(con, glob, group_col, 1)
        if not values:
            return None
        return (
            f"SELECT * FROM read_parquet({_sql_lit(glob)}, union_by_name=True) "
            f"WHERE {group_col}={_sql_lit(values[0])} ORDER BY source_id LIMIT {cap(limit_key)}"
        )

    for glob_suffix, group_col, limit_key in (
        ("act_2570_province/*.parquet", "province", "act2570_province"),
        ("local_subsidy_2570/*.parquet", "province", "local_subsidy"),
        ("local_ordinance_2570/*.parquet", "local_gov_name", "local_ordinance"),
        ("committee_table/*.parquet", "source_doc_id", "committee"),
    ):
        sql = one_group(glob_suffix, group_col, limit_key)
        if sql is not None:
            parts.append(sql)

    return " UNION ALL BY NAME ".join(f"({p})" for p in parts)


SAMPLE_MAX_TOTAL_BYTES = 1_500_000
SAMPLE_MAX_DOCS = 3


def sample(cfg: PipelineConfig, rows: int = 1000) -> PublishResult:
    """`tgbp sample --rows N` (T-112) — โครงเดียวกับ production แต่เล็ก → `cfg.fixtures_dir`"""
    con = duckdb.connect()
    try:
        source_sql = build_sample_source_sql(cfg, con, rows)
    finally:
        con.close()

    return run_publish_pipeline(
        cfg,
        source_sql=source_sql,
        out_dir=cfg.fixtures_dir,
        total_bytes_limit=SAMPLE_MAX_TOTAL_BYTES,
        max_docs=SAMPLE_MAX_DOCS,
        run_validation=False,
        built_at="1970-01-01T00:00:00+00:00",
    )
