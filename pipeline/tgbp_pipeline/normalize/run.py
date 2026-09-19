"""T-110a: `tgbp normalize` — 03-DATA-PIPELINE.md §5 (item_parser/org_master/money), §6 (V3 soft
ADR-005) — normalize stage รวม extract-stage cache ของทุก dataset เข้ากับ `item_parser`/
`org_master` แล้วเขียน `.cache/normalized/{dataset}/*.parquet` ตาม
`normalize.schema.budget_line_pyarrow_schema()` (schema กลางเดียวกันทุก dataset — 03 §3.1)

## Field ที่เติม/แก้ต่อ dataset (03 §5)
- `item_name`/`item_key`/`item_qty`/`item_unit`/`spec_tokens`/`location_text`: จาก
  `item_parser.parse(item_name_raw)` — **parse เฉพาะ distinct `item_name_raw` ต่อไฟล์** (ทำทีละ
  ปี/ทีละไฟล์ — ประหยัด memory ตามที่สั่ง) แล้ว join กลับด้วย dict lookup
- `province`: เติมจาก `item_parser` **เฉพาะแถวที่ dataset ไม่ได้ให้มาแล้ว** (ไม่ทับของเดิม — เช่น
  `act_2570_province`/`local_subsidy_2570` ไฟล์เชียงใหม่/4 ที่มีคอลัมน์ `จังหวัด` จริงอยู่แล้ว หรือ
  `local_ordinance_2570`/`committee_table` ที่ได้ province จากโฟลเดอร์/หัวตาราง)
- `ministry_code`/`agency_code`: `OrgMaster.match()` — **ยกเว้น** `act_2570_draft`/
  `act_2570_province`/`local_subsidy_2570` ที่มี code จาก A2/A3 อยู่แล้ว (`DATASETS_WITH_ORG_CODES`)
  ไม่ match ซ้ำ; `local_ordinance_2570` (อปท.) ไม่มีคอลัมน์ ministry จึง match ด้วย
  `(กระทรวง="องค์กรปกครองส่วนท้องถิ่น", agency=local_gov_name)` แทน (ชื่อ เทศบาล/อบต. ถูกขึ้นทะเบียน
  เป็น "agency" ใต้ min=75000 ใน org_master อยู่แล้ว — คนละแนวคิดกับคอลัมน์ `agency`/`description`
  ของ local_sheets ที่เป็นชื่อกอง/ฝ่ายภายใน อปท. ไม่ใช่ชื่อ อปท. เอง) — match ไม่ได้ → flag
  `org_unmapped` (มาจาก `OrgMatch.flags` โดยตรง)
- `gov_level`/`fiscal_year_ce`: เติมเฉพาะตอนที่ extract stage เป็น `None` (PBO ไม่มี `gov_level`
  เลย — derive จาก `ministry_code` หลัง org match ด้วยกฎเดียวกับ `extract/act2570.py`)
- `unit_price_thb`: **ไม่ทับค่าที่ dataset ให้มาแล้ว** (เช่น อบจ. เชียงใหม่ มีคอลัมน์ "ราคา/หน่วย"
  จริงจากต้นทาง — ถือเป็นค่าจริงที่แม่นกว่าค่าคำนวณ) มิฉะนั้นคำนวณ `amount_thb / item_qty` เมื่อ
  `item_qty > 0` **และไม่มี** flag `qty_is_measure`/`qty_parsed_low_conf`/`corrupt_row` (รวม flag
  เดิมของแถว + flag ใหม่จาก item_parser) ปัดเป็น int
- `quality_flags`: รวม (union, deduplicate, คงลำดับ) ของ flag เดิม + flag จาก item_parser +
  flag จาก org match + `group_total_mismatch` (ADR-005, เฉพาะราชาเทวะ — ดูด้านล่าง)

## V3 soft (ADR-005) — `group_total_mismatch`
`local_ordinance_2570` ไฟล์ราชาเทวะ (มี flag `upstream_ocr`) เปิด sheet `summary_ocr_raw_data`
ของไฟล์ raw ต้นทางอีกครั้ง (read-only, ไม่ OCR ไม่แก้ข้อมูล — ใช้ฟังก์ชันเดิมจาก
`extract.local_sheets` ตาม N7) แล้วเทียบยอดต่อกลุ่ม `(plan, activity, budget_type)` — กลุ่มที่ไม่ตรง
(± tolerance เดียวกับ `check_v3_raja`) ทุกแถวในกลุ่มติด flag `group_total_mismatch`

## Performance (T-110a: PBO 2.9 ล้านแถว, item_parser เป็น regex หนัก)
`parse_distinct_item_names()` ใช้ `ProcessPoolExecutor` แบ่ง chunk เมื่อจำนวน distinct ชื่อ
มากพอจะคุ้ม (`_PARALLEL_MIN_DISTINCT`) — worker เป็น top-level function `_parse_chunk`
(picklable บน Windows spawn) แบ่ง chunk ขนาด `_CHUNK_SIZE`; ต่ำกว่า threshold รัน serial ตรง ๆ
เพราะ overhead spawn process มากกว่าประโยชน์ (เช่นไฟล์ act2570/local/committee ที่มีไม่กี่พันแถว)

Deterministic: เขียนแถวเรียงตาม `source_row` เดิม (ไม่ sort ใหม่ — ลำดับจาก extract stage เอง
เรียงตาม source_row อยู่แล้วทุก extractor) ไม่มี timestamp/สุ่มใด ๆ ในผลลัพธ์
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from pathlib import Path

import openpyxl
import pyarrow as pa
import pyarrow.parquet as pq

from tgbp_pipeline.config import PipelineConfig
from tgbp_pipeline.extract.local_sheets import check_v3_raja, extract_raja_summary_oracle
from tgbp_pipeline.normalize import item_parser
from tgbp_pipeline.normalize.item_parser import ParsedItem
from tgbp_pipeline.normalize.org_master import OrgMaster, OrgMatch, load_org_master_cache
from tgbp_pipeline.normalize.schema import budget_line_pyarrow_schema

DATASET_PBO = "pbo_disbursement"
DATASET_ACT_DRAFT = "act_2570_draft"
DATASET_ACT_PROVINCE = "act_2570_province"
DATASET_LOCAL_SUBSIDY = "local_subsidy_2570"
DATASET_LOCAL_ORDINANCE = "local_ordinance_2570"
DATASET_COMMITTEE = "committee_table"

# act2570 (A2/A3) มี ministry_code/agency_code จาก A2 Data Dict อยู่แล้ว (03 §5 ข้อ 3, T-110a
# instructions) — ไม่ต้อง org_master.match() ซ้ำ
DATASETS_WITH_ORG_CODES: frozenset[str] = frozenset(
    {DATASET_ACT_DRAFT, DATASET_ACT_PROVINCE, DATASET_LOCAL_SUBSIDY}
)

MIN_LOCAL_GOV = "75000"
MIN_STATE_ENTERPRISE = "50000"
LOCAL_GOV_MINISTRY_NAME = "องค์กรปกครองส่วนท้องถิ่น"

# `local_ordinance_2570.local_gov_name` มาจากชื่อไฟล์แบบย่อเสมอ (เช่น "อบจ. เชียงใหม่",
# "ทน. เชียงใหม่" — ดู `extract/local_sheets.py::derive_province_and_local_gov`) แต่ org_master
# เก็บชื่อเต็มจาก A2 (เช่น "องค์การบริหารส่วนจังหวัดเชียงใหม่") และ**ปิด fuzzy สำหรับชื่อ อปท.**
# (03 §5 ข้อ 3 — ชื่อสั้นคล้ายกันแต่คนละที่) → ถ้าไม่ขยายคำย่อก่อน จะ `org_unmapped` ทุกแถวเสมอ
# (ยืนยันจริง 19 ก.ย. 2569: รันจริงได้ org_unmapped=100% ก่อนแก้จุดนี้)
_LOCAL_GOV_ABBREV_EXPANSIONS: tuple[tuple[str, str], ...] = (
    ("อบจ.", "องค์การบริหารส่วนจังหวัด"),
    ("อบต.", "องค์การบริหารส่วนตำบล"),
    ("ทน.", "เทศบาลนคร"),
    ("ทม.", "เทศบาลเมือง"),
    ("ทต.", "เทศบาลตำบล"),
)


def expand_local_gov_abbreviation(name: str | None) -> str | None:
    """ขยายคำย่อชื่อ อปท. มาตรฐาน (อบจ./อบต./ทน./ทม./ทต.) เป็นชื่อเต็มก่อน match กับ org_master

    เป็นการขยายคำย่อทางการที่ไม่กำกวม (ไม่ใช่การเดา — ตรงข้าม N3) — คืนค่าเดิมถ้าไม่ขึ้นต้นด้วยคำย่อ
    ที่รู้จัก (เช่นชื่อเต็มอยู่แล้ว หรือเป็น `None`)
    """
    if not name:
        return name
    for abbrev, full in _LOCAL_GOV_ABBREV_EXPANSIONS:
        if name.startswith(abbrev):
            rest = name[len(abbrev) :].strip()
            return f"{full}{rest}" if rest else full
    return name


# flags ที่ห้ามคำนวณ unit_price_thb อัตโนมัติ (T-110a instructions)
UNIT_PRICE_DISALLOWED_FLAGS: frozenset[str] = frozenset(
    {"qty_is_measure", "qty_parsed_low_conf", "corrupt_row"}
)

# T-115 ข้อ 2 (po review): item_qty >= เกณฑ์นี้ ต้องมี "คำบอกจำนวนชัดเจน" ในชื่อรายการ
# (`item_parser.has_explicit_qty_marker`) มิฉะนั้นถือว่าความมั่นใจต่ำ (flag เดียวกับที่ item_parser
# ใช้อยู่แล้ว — `qty_parsed_low_conf` — เพื่อให้ UNIT_PRICE_DISALLOWED_FLAGS/publish.py/catalog ที่
# กรอง flag นี้อยู่แล้วครอบคลุมเคสนี้ไปด้วยโดยไม่ต้องแก้จุดอื่น)
HIGH_QTY_LOW_CONF_THRESHOLD = 20
HIGH_QTY_LOW_CONF_FLAG = "qty_parsed_low_conf"

RAJA_OCR_FLAG = "upstream_ocr"
GROUP_MISMATCH_FLAG = "group_total_mismatch"

NORMALIZED_CACHE_DIRNAME = "normalized"

# ต่ำกว่านี้ spawn process (~50-100ms/worker บน Windows) ไม่คุ้มเทียบเวลาที่ประหยัดได้จริง
_PARALLEL_MIN_DISTINCT = 4_000
_CHUNK_SIZE = 2_000


# ---------------------------------------------------------------------------
# item_parser: parse เฉพาะ distinct item_name_raw (ขนานเมื่อคุ้ม)
# ---------------------------------------------------------------------------


def _parse_chunk(names: list[str]) -> list[tuple[str, ParsedItem]]:
    """top-level function (picklable) — ใช้กับ `ProcessPoolExecutor` (Windows ต้อง spawn ได้)"""
    return [(n, item_parser.parse(n)) for n in names]


def parse_distinct_item_names(
    names: list[str], max_workers: int | None = None
) -> dict[str, ParsedItem]:
    """parse `item_name_raw` distinct ทั้งหมดในไฟล์เดียว — ขนานด้วย `ProcessPoolExecutor` เมื่อ
    จำนวน distinct >= `_PARALLEL_MIN_DISTINCT` มิฉะนั้นรัน serial (overhead spawn ไม่คุ้ม)
    """
    if not names:
        return {}
    if max_workers is None:
        max_workers = os.cpu_count() or 1
    if len(names) < _PARALLEL_MIN_DISTINCT or max_workers <= 1:
        return {n: item_parser.parse(n) for n in names}

    from concurrent.futures import ProcessPoolExecutor

    chunks = [names[i : i + _CHUNK_SIZE] for i in range(0, len(names), _CHUNK_SIZE)]
    result: dict[str, ParsedItem] = {}
    with ProcessPoolExecutor(max_workers=max_workers) as ex:
        for chunk_result in ex.map(_parse_chunk, chunks):
            for name, parsed in chunk_result:
                result[name] = parsed
    return result


# ---------------------------------------------------------------------------
# gov_level derivation (เหมือน extract/act2570.py::_gov_level_for_min แต่ใช้ public constants
# ไม่ import private function ข้ามโมดูล — 03 §5, N7)
# ---------------------------------------------------------------------------


def gov_level_for_ministry_code(code: str | None) -> str | None:
    if code == MIN_LOCAL_GOV:
        return "local"
    if code == MIN_STATE_ENTERPRISE:
        return "state_enterprise"
    if code is None:
        return None
    return "central"


# ---------------------------------------------------------------------------
# V3 soft (ADR-005) — group_total_mismatch เฉพาะราชาเทวะ (local_ordinance_2570, upstream_ocr)
# ---------------------------------------------------------------------------


def load_raja_summary_oracle(cfg: PipelineConfig, rel_path: str) -> dict[tuple, float] | None:
    """เปิดไฟล์ raw ต้นทาง (read-only) หา sheet `summary_*` แล้วคืน oracle dict ของ
    `extract_raja_summary_oracle` — คืน `None` ถ้าเปิด/หา sheet ไม่ได้ (ไม่ raise; ใช้ทั้งจาก
    normalize stage (`raja_group_mismatch_keys`) และ `validate.check_v3` — N7 ไม่สร้างซ้ำ)
    """
    raw_path = cfg.raw_data_dir / rel_path
    if not raw_path.is_file():
        return None
    try:
        wb = openpyxl.load_workbook(str(raw_path), read_only=True, data_only=True)
    except Exception:  # noqa: BLE001 — ไฟล์ raw เปิดไม่ได้ ไม่ทำให้ผู้เรียกทั้งก้อนล้ม
        return None
    try:
        summary_sheets = [s for s in wb.sheetnames if s.startswith("summary_")]
        if not summary_sheets:
            return None
        oracle = extract_raja_summary_oracle(wb[summary_sheets[0]])
    finally:
        wb.close()
    return oracle or None


def raja_group_mismatch_keys(
    cfg: PipelineConfig, rel_path: str, records_view: list[dict]
) -> set[tuple]:
    """คืนกลุ่ม `(plan, activity, budget_type)` ที่ยอดไม่ตรง oracle (ADR-005) — เซตว่างถ้าไม่มี
    oracle ให้เทียบ (ไม่ใช่ hard rule)
    """
    oracle = load_raja_summary_oracle(cfg, rel_path)
    if not oracle:
        return set()
    v3 = check_v3_raja(records_view, oracle)
    return {d.key for d in v3.diffs if d.oracle_baht is not None}


# ---------------------------------------------------------------------------
# core: normalize หนึ่ง pyarrow Table (หนึ่งไฟล์ extract-stage cache)
# ---------------------------------------------------------------------------


@dataclass
class NormalizeStats:
    n_rows: int = 0
    n_distinct_item_names: int = 0
    n_org_unmapped: int = 0
    n_group_mismatch_rows: int = 0
    n_qty_parsed: int = 0
    n_province_parsed: int = 0
    n_unit_price_computed: int = 0
    n_high_qty_low_conf: int = 0
    flag_counts: dict[str, int] = field(default_factory=dict)


_SCHEMA = budget_line_pyarrow_schema()
_SCHEMA_FIELD_NAMES: tuple[str, ...] = tuple(f.name for f in _SCHEMA)


def normalize_table(
    table: pa.Table,
    *,
    cfg: PipelineConfig,
    org_master: OrgMaster | None,
    max_workers: int | None = None,
) -> tuple[pa.Table, NormalizeStats]:
    """normalize หนึ่ง extract-stage `pa.Table` → `(normalized_table, stats)`

    `table` ต้องมีคอลัมน์ `dataset` (ค่าเดียวกันทั้งไฟล์ — จริงเสมอสำหรับ extractor ปัจจุบัน)
    """
    n = table.num_rows
    stats = NormalizeStats(n_rows=n)
    if n == 0:
        return pa.Table.from_pylist([], schema=_SCHEMA), stats

    columns = set(table.schema.names)

    def col(name: str) -> list:
        if name in columns:
            return table.column(name).to_pylist()
        return [None] * n

    dataset_list = col("dataset")
    dataset = dataset_list[0]

    item_name_raw_list = col("item_name_raw")
    distinct_names = sorted({v for v in item_name_raw_list if v})
    stats.n_distinct_item_names = len(distinct_names)
    parsed_map = parse_distinct_item_names(distinct_names, max_workers=max_workers)

    needs_org_match = dataset not in DATASETS_WITH_ORG_CODES
    org_matches: list[OrgMatch] | None = None
    if needs_org_match:
        if org_master is None:
            raise ValueError(f"dataset {dataset!r} ต้อง org_master แต่ไม่ได้ส่งเข้ามา (org_master=None)")
        if dataset == DATASET_LOCAL_ORDINANCE:
            ministry_inputs = [LOCAL_GOV_MINISTRY_NAME] * n
            agency_inputs = [expand_local_gov_abbreviation(n) for n in col("local_gov_name")]
        else:
            ministry_inputs = col("ministry")
            agency_inputs = col("agency")
        org_matches = [
            org_master.match(m, a) for m, a in zip(ministry_inputs, agency_inputs, strict=True)
        ]

    existing_ministry_code = col("ministry_code")
    existing_agency_code = col("agency_code")
    existing_gov_level = col("gov_level")
    existing_province = col("province")
    existing_fiscal_be = col("fiscal_year_be")
    existing_fiscal_ce = col("fiscal_year_ce")
    existing_unit_price = col("unit_price_thb")
    amount_thb_list = col("amount_thb")
    orig_flags_list = col("quality_flags")

    plan_list = col("plan")
    activity_list = col("activity")
    budget_type_list = col("budget_type")

    # V3 soft (ADR-005) — เฉพาะไฟล์ราชาเทวะ (local_ordinance_2570 + flag upstream_ocr)
    group_mismatch_keys: set[tuple] = set()
    if dataset == DATASET_LOCAL_ORDINANCE and any(
        RAJA_OCR_FLAG in (fl or []) for fl in orig_flags_list
    ):
        rel_path = col("source_path")[0]
        records_view = [
            {
                "plan": plan_list[i],
                "activity": activity_list[i],
                "budget_type": budget_type_list[i],
                "amount_thb": amount_thb_list[i],
                "quality_flags": orig_flags_list[i] or [],
            }
            for i in range(n)
        ]
        group_mismatch_keys = raja_group_mismatch_keys(cfg, rel_path, records_view)

    passthrough_names = (
        "source_id",
        "strategy",
        "budget_group",
        "output_project",
        "expense_category",
        "is_capital",
        "revised_thb",
        "po_thb",
        "disbursed_thb",
        "disbursed_incl_po_thb",
        "reserved_thb",
        "carryover_thb",
        "disbursement_rate",
        "description",
        "legal_reference",
        "source_path",
        "source_sheet",
        "source_row",
        "source_page",
        "source_doc_id",
    )
    passthrough = {name: col(name) for name in passthrough_names}
    ministry_text_list = col("ministry")
    agency_text_list = col("agency")
    local_gov_name_list = col("local_gov_name")

    flag_counts: dict[str, int] = {}

    def _tally(flags: list[str]) -> None:
        for f in flags:
            flag_counts[f] = flag_counts.get(f, 0) + 1

    records: list[dict] = []
    for i in range(n):
        item_name_raw = item_name_raw_list[i]
        parsed = parsed_map.get(item_name_raw) if item_name_raw else None

        if parsed is not None:
            item_name = parsed.item_name
            item_key = parsed.item_key
            item_qty = parsed.item_qty
            item_unit = parsed.item_unit
            spec_tokens = list(parsed.spec_tokens)
            location_text = parsed.location_text
            parsed_province = parsed.province
            parse_flags = list(parsed.quality_flags)
            if item_qty is not None:
                stats.n_qty_parsed += 1
            if parsed_province is not None:
                stats.n_province_parsed += 1
        else:
            item_name = item_name_raw
            item_key = None
            item_qty = None
            item_unit = None
            spec_tokens = []
            location_text = None
            parsed_province = None
            parse_flags = []

        province = existing_province[i]
        if province is None:
            province = parsed_province

        if org_matches is not None:
            om = org_matches[i]
            ministry_code = om.ministry_code
            agency_code = om.agency_code
            org_flags = list(om.flags)
            if agency_code is None:
                stats.n_org_unmapped += 1
        else:
            ministry_code = existing_ministry_code[i]
            agency_code = existing_agency_code[i]
            org_flags = []

        gov_level = existing_gov_level[i]
        if gov_level is None:
            gov_level = gov_level_for_ministry_code(ministry_code)

        fiscal_be = existing_fiscal_be[i]
        fiscal_ce = existing_fiscal_ce[i]
        if fiscal_ce is None and fiscal_be is not None:
            fiscal_ce = fiscal_be - 543

        orig_flags = orig_flags_list[i] or []
        amount_thb = amount_thb_list[i]
        unit_price_thb = existing_unit_price[i]
        extra_flags: list[str] = []
        if (
            unit_price_thb is None
            and item_qty is not None
            and item_qty > 0
            and amount_thb is not None
        ):
            disallow = UNIT_PRICE_DISALLOWED_FLAGS & (set(orig_flags) | set(parse_flags))
            # T-115 ข้อ 2 (po review): item_qty ≥ เกณฑ์ (20) ที่ item_name ไม่มี "คำบอกจำนวนชัดเจน"
            # ("จำนวน" หรือหน่วยนับติดกับเลขไม่มีช่องว่างคั่น เช่น "20เครื่อง") มีความเสี่ยงสูงว่าตัวเลข
            # เป็นส่วนหนึ่งของรหัส/สเปคที่ item_parser จับพลาด (เช่น "IPv61"/"...KVA54") ไม่ใช่จำนวนนับ
            # จริง — กันไว้ก่อนตาม N3 (ไม่เดา unit_price เมื่อความมั่นใจต่ำ) แทนที่จะคำนวณแล้วอาจผิดมหาศาล
            if (
                not disallow
                and item_qty >= HIGH_QTY_LOW_CONF_THRESHOLD
                and not item_parser.has_explicit_qty_marker(item_name or "")
            ):
                extra_flags.append(HIGH_QTY_LOW_CONF_FLAG)
                stats.n_high_qty_low_conf += 1
                disallow = {HIGH_QTY_LOW_CONF_FLAG}
            if not disallow:
                unit_price_thb = int(round(amount_thb / item_qty))
                stats.n_unit_price_computed += 1

        if dataset == DATASET_LOCAL_ORDINANCE:
            key = (plan_list[i], activity_list[i], budget_type_list[i])
            if key in group_mismatch_keys:
                extra_flags.append(GROUP_MISMATCH_FLAG)
                stats.n_group_mismatch_rows += 1

        final_flags = list(dict.fromkeys([*orig_flags, *parse_flags, *org_flags, *extra_flags]))
        _tally(final_flags)

        record = {
            "source_id": passthrough["source_id"][i],
            "dataset": dataset,
            "fiscal_year_be": fiscal_be,
            "fiscal_year_ce": fiscal_ce,
            "gov_level": gov_level,
            "ministry": ministry_text_list[i],
            "ministry_code": ministry_code,
            "agency": agency_text_list[i],
            "agency_code": agency_code,
            "province": province,
            "local_gov_name": local_gov_name_list[i],
            "strategy": passthrough["strategy"][i],
            "budget_group": passthrough["budget_group"][i],
            "plan": plan_list[i],
            "output_project": passthrough["output_project"][i],
            "activity": activity_list[i],
            "budget_type": budget_type_list[i],
            "expense_category": passthrough["expense_category"][i],
            "is_capital": passthrough["is_capital"][i],
            "item_name_raw": item_name_raw,
            "item_name": item_name,
            "item_key": item_key,
            "item_qty": item_qty,
            "item_unit": item_unit,
            "spec_tokens": spec_tokens,
            "location_text": location_text,
            "amount_thb": amount_thb,
            "unit_price_thb": unit_price_thb,
            "revised_thb": passthrough["revised_thb"][i],
            "po_thb": passthrough["po_thb"][i],
            "disbursed_thb": passthrough["disbursed_thb"][i],
            "disbursed_incl_po_thb": passthrough["disbursed_incl_po_thb"][i],
            "reserved_thb": passthrough["reserved_thb"][i],
            "carryover_thb": passthrough["carryover_thb"][i],
            "disbursement_rate": passthrough["disbursement_rate"][i],
            "description": passthrough["description"][i],
            "legal_reference": passthrough["legal_reference"][i],
            "source_path": passthrough["source_path"][i],
            "source_sheet": passthrough["source_sheet"][i],
            "source_row": passthrough["source_row"][i],
            "source_page": passthrough["source_page"][i],
            "source_doc_id": passthrough["source_doc_id"][i],
            "quality_flags": final_flags,
        }
        records.append(record)

    stats.flag_counts = flag_counts
    normalized = pa.Table.from_pylist(records, schema=_SCHEMA)
    return normalized, stats


# ---------------------------------------------------------------------------
# discovery ของ extract-stage cache ต่อ dataset key (คีย์เดียวกับ `tgbp extract --dataset`)
# ---------------------------------------------------------------------------


def discover_pbo_cache_files(cfg: PipelineConfig) -> list[Path]:
    pbo_dir = cfg.cache_dir / "pbo"
    if not pbo_dir.is_dir():
        return []
    return sorted(p for p in pbo_dir.glob("*.parquet") if not p.name.endswith(".partial.parquet"))


def discover_act2570_cache_files(cfg: PipelineConfig) -> list[Path]:
    d = cfg.cache_dir / "act2570"
    return sorted(d.glob("*.parquet")) if d.is_dir() else []


def discover_local_cache_files(cfg: PipelineConfig) -> list[Path]:
    d = cfg.cache_dir / "local"
    return sorted(d.glob("*.parquet")) if d.is_dir() else []


def discover_committee_cache_files(cfg: PipelineConfig) -> list[Path]:
    d = cfg.cache_dir / "committee"
    return sorted(d.glob("*.parquet")) if d.is_dir() else []


_DISCOVERERS: dict[str, object] = {
    "pbo": discover_pbo_cache_files,
    "act2570": discover_act2570_cache_files,
    "local": discover_local_cache_files,
    "committee": discover_committee_cache_files,
}

ALL_NORMALIZE_DATASETS: tuple[str, ...] = ("pbo", "act2570", "local", "committee")


# ---------------------------------------------------------------------------
# per-file orchestration + CLI entry point
# ---------------------------------------------------------------------------


@dataclass
class NormalizeFileResult:
    source_path: Path
    dataset: str
    out_path: Path
    stats: NormalizeStats
    elapsed_seconds: float
    cache_bytes: int


@dataclass
class NormalizeReport:
    results: list[NormalizeFileResult] = field(default_factory=list)

    @property
    def total_rows(self) -> int:
        return sum(r.stats.n_rows for r in self.results)


def _normalized_dir(cfg: PipelineConfig, dataset: str, cache_dir: Path | None) -> Path:
    base = cache_dir if cache_dir is not None else cfg.cache_dir / NORMALIZED_CACHE_DIRNAME
    return cfg.assert_writable_path(base / dataset)


def normalize_file(
    cfg: PipelineConfig,
    source_path: Path,
    *,
    org_master: OrgMaster | None,
    cache_dir: Path | None = None,
    max_workers: int | None = None,
) -> NormalizeFileResult:
    """normalize หนึ่งไฟล์ extract-stage cache → `.cache/normalized/{dataset}/{basename}.parquet`"""
    start = time.monotonic()
    table = pq.read_table(str(source_path))
    dataset = table.column("dataset")[0].as_py() if table.num_rows else source_path.stem

    normalized, stats = normalize_table(
        table, cfg=cfg, org_master=org_master, max_workers=max_workers
    )

    out_dir = _normalized_dir(cfg, dataset, cache_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / source_path.name
    pq.write_table(normalized, str(out_path), compression="zstd")

    return NormalizeFileResult(
        source_path=source_path,
        dataset=dataset,
        out_path=out_path,
        stats=stats,
        elapsed_seconds=time.monotonic() - start,
        cache_bytes=out_path.stat().st_size,
    )


def normalize_dataset(
    cfg: PipelineConfig,
    dataset_key: str,
    *,
    cache_dir: Path | None = None,
    max_workers: int | None = None,
) -> NormalizeReport:
    """normalize ทุกไฟล์ของ dataset key หนึ่งตัว (`pbo`/`act2570`/`local`/`committee`)"""
    if dataset_key not in _DISCOVERERS:
        raise ValueError(
            f"ไม่รู้จัก dataset key {dataset_key!r} (ต้องเป็นหนึ่งใน {ALL_NORMALIZE_DATASETS})"
        )

    files = _DISCOVERERS[dataset_key](cfg)
    org_master = None
    if dataset_key in ("pbo", "local", "committee"):
        org_master = load_org_master_cache(cfg)
        if org_master is None:
            raise FileNotFoundError(
                "ไม่พบ org_master cache — รัน `tgbp extract --dataset act2570` ก่อน (org_master "
                "สร้างจาก A2 Data Dict) หรือเรียก `build_org_master()` เอง"
            )

    results = [
        normalize_file(
            cfg, path, org_master=org_master, cache_dir=cache_dir, max_workers=max_workers
        )
        for path in files
    ]
    return NormalizeReport(results=results)


def normalize_all(
    cfg: PipelineConfig,
    *,
    datasets: list[str] | None = None,
    cache_dir: Path | None = None,
    max_workers: int | None = None,
) -> dict[str, NormalizeReport]:
    """normalize ทุก dataset (ค่าเริ่มต้น = `ALL_NORMALIZE_DATASETS`) — คืน `{dataset_key: report}`"""
    targets = datasets if datasets is not None else list(ALL_NORMALIZE_DATASETS)
    return {
        key: normalize_dataset(cfg, key, cache_dir=cache_dir, max_workers=max_workers)
        for key in targets
    }
