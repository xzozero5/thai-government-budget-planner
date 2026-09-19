"""T-106: `extract/act2570.py` — ร่าง พ.ร.บ. งบประมาณ 2570 ฉบับเต็ม (A2) + subset จังหวัด (A3)
(03-DATA-PIPELINE.md §4.2, §6 V2; 02-DATA-INVENTORY.md §A2/§A3)

ยืนยันจากไฟล์จริงทั้งหมด (19 ก.ย. 2569, เปิดด้วย openpyxl read_only) — ตรวจซ้ำข้อค้นพบของ agent
ก่อนหน้าที่ยังไม่ได้ตรวจ ผล:

**A2** (`ร่าง พ.ร.บ. งบ 2570 ฉบับเต็ม - Excel.xlsx`, 6,894,740 bytes, sha1 `113188b4...`):
- ยืนยันตรง 02 §A2: sheet `Data` **96,470 แถว**, คอลัมน์ `min, min_name, agc, agc_name,
  group_budget, plan_name, output_name, act_name, objc, objc_8_name, cap_ncap, item_name,
  p_total_bud`; รวม `p_total_bud` = 3,788,000,000,000 บาท (~3.79 ล้านล้านบาท — สมเหตุสมผลกับ
  งบประเทศปี 2570); 33 กระทรวง distinct; `agc` 49,869/96,470 แถว (51.7%) มีตัวอักษรปน (กลุ่ม
  อปท. `min=75000` = 55,843 แถว)
- **แก้ข้อค้นพบเดิม**: `min`/`agc` เป็น **string ล้วน (5 ตัวอักษร) ทุกแถวอยู่แล้ว** ในไฟล์จริง
  (สแกนครบ 96,470 แถวด้วย `type()` เจอ `str` เท่านั้น) — ไม่มีแถวไหนเป็น `int` ในไฟล์ปัจจุบัน
  แต่ `_code_str()` ยังกัน int/float ไว้เชิงป้องกัน (เผื่อไฟล์อัปเดตในอนาคต)
- ไฟล์ซ้ำ (sha1 เดียวกัน) อยู่ที่ `งบประมาณ เชียงใหม่/1 - .../ร่าง พ.ร.บ. งบ 2570 ฉบับเต็ม -
  Excel.xlsx` — ยืนยันตัวหลัก = สำเนาใต้ `งบประมาณ สมุทรปราการ/` จริง (เรียง codepoint:
  `ส` (U+0E2A) < `เ` (U+0E40)) ตรงกับที่ `web/public/data/sources.json` บันทึกไว้แล้ว (`duplicates`
  อยู่บน entry ของสมุทรปราการ) — โมดูลนี้ **ไม่พึ่ง sources.json** (คนละ stage) แต่ dedupe เองด้วย
  sha1 ตรง ๆ (03 §4.2) ได้ผลตรงกัน

**A3** (6 ไฟล์ "เฉพาะ..." — ยืนยันครบทั้ง 6 ไฟล์ ตรงกับที่ agent ก่อนหน้าสำรวจไว้ทุกไฟล์):
- **format A มีไฟล์เดียวจริง**: `งบประมาณ เชียงใหม่/1 - .../ร่าง พ.ร.บ. งบ 2570 เฉพาะส่วนราชการ
  ที่มีรายการในเชียงใหม่ - Excel.xlsx` sheet `รายการ (ไม่รวม อปท.)` — 983 แถวทางกายภาพ: แถว 1
  = หัวเรื่อง, แถว 2 = `"575 รายการ  |  งบรวม 9,043,395,000 บาท  |  ⚠ กรุณาตรวจสอบและตัดรายการ
  ที่ไม่เกี่ยวข้องออก (ตัด อ.ศรีเชียงใหม่ ออกแล้ว)"`, แถว 3 = header
  `กระทรวง|หน่วยงาน|แผนงาน|รายการ (item_name)|ประเภทรายจ่าย|ประจำ/ลงทุน|งบ (บาท)`,
  แถว 4-983 = 980 แถว data-area = **575 รายการจริง + 404 แถวว่างล้วน + 1 แถว "รวมทั้งหมด"
  (แถว Excel 579, คอลัมน์ `กระทรวง`="รวมทั้งหมด", คอลัมน์ `รายการ`=ว่าง, คอลัมน์ `งบ (บาท)`=
  9,043,395,000)** — ยืนยันตัวเลขตรงกับ agent ก่อนหน้าทุกประการ (405 = 404 ว่าง + 1 รวม)
  → **ข้ามแถวที่เซลล์ `รายการ` ว่าง** (ครอบคลุมทั้งแถวว่างและแถว "รวมทั้งหมด" ในทีเดียว เพราะ
  แถว "รวมทั้งหมด" มีเซลล์ `รายการ` ว่างเหมือนกัน)
- **format B อีก 5 ไฟล์** (สมุทรปราการ/1, สมุทรปราการ/2, เชียงใหม่/2, เชียงใหม่/3, เชียงใหม่/4)
  sheet `Data` (เชียงใหม่/4 ชื่อ sheet = `เทศบาลในเชียงใหม่`) header แบบ field code เดียวกับ A2
  ทุกตัว **ไม่มี title/แถวสรุป** → V2 = `no_oracle` (soft) ไม่ใช่ fail; เชียงใหม่/4 ใช้ `objc_8`
  (ไม่ใช่ `objc_8_name` — แต่ `Data Dict` ของไฟล์นี้ก็เขียนว่า field #10 ชื่อ `objc_8` เหมือนกัน
  ทั้งที่ description ยังเป็น "ชื่อหมวดรายจ่ายหลัก" คือเก็บ**ชื่อ**หมวดเหมือนไฟล์อื่น แค่ตั้งชื่อ
  คอลัมน์ต่างกัน — ถือเป็น alias เดียวกับ `objc_8_name`) และมีคอลัมน์เสริม `จังหวัด/อำเภอ/ตำบล`
  ต่อท้าย (ใช้ `จังหวัด` เติม/ยืนยัน `province` รายแถวแทนการเดาจากโฟลเดอร์อย่างเดียว)
- **จำแนก dataset จากชื่อไฟล์**: มีคำว่า `ส่วนราชการ` → `act_2570_province` (สมุทรปราการ/1,
  เชียงใหม่/1), มีคำว่า `เงินอุดหนุน` → `local_subsidy_2570` (สมุทรปราการ/2, เชียงใหม่/2/3/4)
- **A3 เป็น subset ของ A2 จริง 100%** เมื่อ match ด้วย key `(agc, clean(item_name), amount)`
  (format B, ยกเว้นเชียงใหม่/4 ที่ต้องทำความสะอาด whitespace ก่อน — ดูหัวข้อคุณภาพข้อมูลด้านล่าง)
  และ key `(clean(item_name), amount)` (format A ไม่มี `agc`): ทุกไฟล์ match กลับ A2 ได้ **100%**
  ยกเว้นเชียงใหม่/4 ที่ match ตรง ๆ (raw) ได้แค่ 2,667/2,679 = 99.6% แต่ **100%** หลัง `clean()`
  ทั้งสองฝั่ง (ดูด้านล่าง)

**ส่วนต่างสมุทรปราการ (แก้ปริศนาที่ agent ก่อนหน้าค้างไว้)**: filter A2 ด้วย substring
`"สมุทรปราการ"` ใน `item_name` ได้ 157 แถว/6,080,160,600 บาท เทียบไฟล์ `เฉพาะส่วนราชการ...
สมุทรปราการ` (format B) 155 แถว/6,075,051,600 บาท — **ต่าง 2 แถวพอดี**: เป็นรายการของ
`เทศบาลตำบลบางบ่อ` (agc `756BD`, รถบรรทุกน้ำ 2,573,000 บาท) และ `เทศบาลตำบลบางพลี` (agc
`756BP`, รถบรรทุกขยะ 2,536,000 บาท) ซึ่งเป็น **อปท. (min=75000)** ที่บังเอิญพิมพ์ชื่อจังหวัด
"สมุทรปราการ" อยู่ใน `item_name` ด้วย — ไฟล์ "เฉพาะส่วนราชการ" (ไม่รวม อปท.) จึงตัดออกถูกต้องแล้ว
ไม่ใช่ข้อมูลขาดหาย เป็น false-positive ของการกรองด้วย substring เพียงอย่างเดียว (ยืนยัน:
2,573,000 + 2,536,000 = 5,109,000 = 6,080,160,600 − 6,075,051,600 พอดี)

**ปัญหาคุณภาพข้อมูลจริงที่พบ (เชียงใหม่/4)**: `item_name` ใน A2 บางรายการมี whitespace ต่างจาก
ไฟล์ subset แม้เป็นรายการเดียวกัน (agc/amount ตรงกัน) — ตัวอย่างจริง: A2 เก็บ
`'เครื่องแปลงขยะเศษอาหารและเศษวัชพืชโดยใช้จุลินทรีย์ \nขนาด 1,000 กิโลกรัม ตำบลหนองหอย...'`
(มี `\n` แทรกกลาง) ส่วนไฟล์ `เฉพาะเงินอุดหนุนเทศบาลในเชียงใหม่` เก็บบรรทัดเดียว
`'เครื่องแปลงขยะเศษอาหารและเศษวัชพืชโดยใช้จุลินทรีย์ ขนาด 1,000 กิโลกรัม ตำบลหนองหอย...'`
(agc `7526D`); อีกตัวอย่าง A2 มี trailing space `'ค่าอุปกรณ์การเรียน '` ไฟล์ subset ไม่มี (agc
`7529Y`/`7588P`) — ทำให้ raw exact-match ได้แค่ 99.6% (12/2,679 แถว) แต่ตรงกัน **100%** เมื่อ
`normalize.thai_text.clean()` ยุบ whitespace ก่อนเทียบทั้งสองฝั่ง → `check_v2()` ใช้ `clean()`
เสมอตอนสร้าง key เปรียบเทียบ (ไม่ใช่ raw string) ด้วยเหตุนี้

ฟิลด์ที่ `normalize.schema.BudgetLine` **ไม่มี field รองรับตรง ๆ**:
- `group_budget` (A2 Data Dict: "กลุ่มงบประมาณ" — 7 ค่า distinct เช่น
  `งบประมาณรายจ่ายของหน่วยรับงบประมาณ`/`งบประมาณรายจ่ายบูรณาการ`/`งบประมาณรายจ่ายงบกลาง` ฯลฯ)
  ไม่มีฟิลด์ตรงใน schema → เก็บไว้ใน `strategy` แทน (concept ใกล้เคียงที่สุดที่มีอยู่: "ยุทธศาสตร์/
  กลุ่มการจัดสรรงบระดับบนสุด") ทุกแถว format-B (A2 + A3 format B) ติด flag
  `group_budget_as_strategy` ให้ main thread ตัดสินใจว่าจะเพิ่ม field แยกจริงหรือไม่ — format A
  ไม่มีข้อมูลนี้เลย (`strategy=None`)
- `cap_ncap`/`ประจำ/ลงทุน` แปลงเป็น `is_capital: bool|None` ตาม schema แต่ยังเก็บสตริงดิบไว้ใน
  คอลัมน์ extra `cap_ncap_raw` ของ cache parquet (แบบเดียวกับ `capital_type_raw` ใน `extract/pbo.py`)
  เผื่อค่าที่ map ไม่ได้ (ไม่ใช่ "รายจ่ายลงทุน"/"รายจ่ายประจำ" เป๊ะ ๆ)
- `จังหวัด/อำเภอ/ตำบล` ในเชียงใหม่/4: ใช้แค่ `จังหวัด` เติม `province` ต่อแถว (แม่นกว่าเดาจาก
  โฟลเดอร์อย่างเดียว) ส่วน `อำเภอ`/`ตำบล` **ยังไม่เก็บ** (เป็นหน้าที่ `item_parser`/normalize
  stage ตาม 03 §5 ข้อ 2 ไม่ใช่ extract stage) — รายงานไว้ให้ T-102 (item_parser) รู้ว่ามีคอลัมน์
  นี้ให้ใช้ตรง ๆ ได้เลยสำหรับไฟล์นี้โดยไม่ต้อง regex จาก item_name

A3 ทุกแถวติด flag `subset_of_act_2570_draft` (ตามที่สั่ง) เพื่อกัน catalog stage นับซ้ำกับ
`act_2570_draft`
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import openpyxl
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from tgbp_pipeline.config import PipelineConfig
from tgbp_pipeline.extract.local_sheets import slugify_ascii
from tgbp_pipeline.normalize import money
from tgbp_pipeline.normalize.thai_geo import canonical_province
from tgbp_pipeline.normalize.thai_text import clean, nfc_only
from tgbp_pipeline.util.hash import doc_id_for_path, sha1_file
from tgbp_pipeline.util.hash import source_id as compute_source_id

DATASET_DRAFT = "act_2570_draft"
DATASET_PROVINCE = "act_2570_province"
DATASET_SUBSIDY = "local_subsidy_2570"

FISCAL_YEAR_BE = 2570
FISCAL_YEAR_CE = FISCAL_YEAR_BE - 543
AMOUNT_UNIT_SOURCE = "thb"

MIN_LOCAL_GOV = "75000"
MIN_STATE_ENTERPRISE = "50000"

GROUP_BUDGET_FLAG = "group_budget_as_strategy"
SUBSET_FLAG = "subset_of_act_2570_draft"

ORACLE_FILENAME = "oracle.json"
CACHE_SUBDIR = "act2570"

# ---------------------------------------------------------------------------
# discovery + dedupe (03 §4.2)
# ---------------------------------------------------------------------------

_FILE_GLOB = "ร่าง พ.ร.บ. งบ 2570 *.xlsx"
_DRAFT_MARKER = "ฉบับเต็ม"
_PROVINCE_MARKER = "ส่วนราชการ"
_SUBSIDY_MARKER = "เงินอุดหนุน"


class Act2570DiscoveryError(ValueError):
    """หาไฟล์ A2/A3 ตามที่คาดไม่เจอ หรือเจอ 'ฉบับเต็ม' ที่เนื้อหาไม่เหมือนกัน (ต้องตรวจใหม่)"""


@dataclass
class DiscoveredFiles:
    draft_path: Path
    draft_duplicate_paths: list[Path]
    a3_paths: list[Path]


def discover_files(cfg: PipelineConfig) -> DiscoveredFiles:
    """หาไฟล์ A2 (dedupe ด้วย sha1 → ตัวหลัก = เรียงตัวอักษรของ rel_path ก่อน) + ไฟล์ A3 ทั้งหมด"""
    candidates = sorted(cfg.raw_data_dir.rglob(_FILE_GLOB))
    drafts = [p for p in candidates if _DRAFT_MARKER in p.name]
    a3_paths = [p for p in candidates if _DRAFT_MARKER not in p.name]

    if not drafts:
        raise Act2570DiscoveryError(
            f"ไม่พบไฟล์ '{_DRAFT_MARKER}' ใต้ {cfg.raw_data_dir} (glob: {_FILE_GLOB!r})"
        )

    def rel(p: Path) -> str:
        return p.relative_to(cfg.raw_data_dir).as_posix()

    groups: dict[str, list[Path]] = defaultdict(list)
    for p in drafts:
        groups[sha1_file(str(p))].append(p)

    if len(groups) > 1:
        detail = {h: [rel(p) for p in ps] for h, ps in groups.items()}
        raise Act2570DiscoveryError(
            f"พบไฟล์ '{_DRAFT_MARKER}' ที่เนื้อหาไม่เหมือนกัน {len(groups)} กลุ่ม (คาด 1 กลุ่ม "
            f"เนื้อหาเดียวกันทั้งหมดตาม 02 §A2) — ต้องตรวจสอบใหม่: {detail}"
        )

    [group] = groups.values()
    group_sorted = sorted(group, key=rel)
    draft_path, *duplicate_paths = group_sorted

    return DiscoveredFiles(
        draft_path=draft_path,
        draft_duplicate_paths=duplicate_paths,
        a3_paths=sorted(a3_paths, key=rel),
    )


def classify_a3_dataset(filename: str) -> str | None:
    """`act_2570_province` (มีคำ `ส่วนราชการ`) หรือ `local_subsidy_2570` (มีคำ `เงินอุดหนุน`)

    คืน `None` ถ้าไม่เข้าเกณฑ์ทั้งคู่ (ไฟล์ A3 ใหม่ที่ตั้งชื่อไม่ตรง pattern — รายงาน ไม่ raise)
    """
    if _PROVINCE_MARKER in filename:
        return DATASET_PROVINCE
    if _SUBSIDY_MARKER in filename:
        return DATASET_SUBSIDY
    return None


_PROVINCE_FOLDER_RE = re.compile(r"^งบประมาณ\s+(.+)$")


def _province_from_rel_path(rel_path: str) -> str | None:
    """`province` จากโฟลเดอร์บนสุด `งบประมาณ <จังหวัด>/...` (03 §4.3 pattern เดียวกับ A4)"""
    top = rel_path.split("/")[0] if rel_path else ""
    m = _PROVINCE_FOLDER_RE.match(clean(top))
    if not m:
        return None
    return canonical_province(clean(m.group(1)))


# ---------------------------------------------------------------------------
# helpers ทั่วไป (เทียบ pbo.py — เขียนแยกเพราะรูปแบบ input ต่างกัน)
# ---------------------------------------------------------------------------


def _code_str(value: object) -> str | None:
    """`min`/`agc` เป็น string 5 ตัวอักษรอยู่แล้วในไฟล์จริงที่ตรวจ (19 ก.ย. 2569) — ฟังก์ชันนี้
    กัน int/float ไว้เชิงป้องกันเผื่อไฟล์ในอนาคตเปลี่ยน (`agc` ของ อปท. มีตัวอักษรปนได้ เช่น
    `7510A` จึงห้าม `int()` ตรง ๆ)
    """
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value).zfill(5)
    if isinstance(value, float):
        return str(int(value)).zfill(5)
    return str(value).strip() or None


def _text_or_none(value: object) -> str | None:
    if value is None:
        return None
    text = clean(str(value))
    return text or None


def _item_name_raw(value: object) -> str | None:
    """`item_name_raw` — NFC เท่านั้น (ห้าม transliterate/แก้ของต้นฉบับ ตาม CLAUDE.md §7)"""
    if value is None:
        return None
    text = nfc_only(str(value))
    return text if text.strip() else None


def _gov_level_for_min(min_code: str | None) -> str | None:
    if min_code == MIN_LOCAL_GOV:
        return "local"
    if min_code == MIN_STATE_ENTERPRISE:
        return "state_enterprise"
    if min_code is None:
        return None
    return "central"


_CAP_MAP: dict[str, bool] = {
    "รายจ่ายลงทุน": True,
    "รายจ่ายประจำ": False,
}


def _get(row: tuple, mapping: dict[str, int], field_name: str) -> object:
    idx = mapping.get(field_name)
    if idx is None or idx >= len(row):
        return None
    return row[idx]


# ---------------------------------------------------------------------------
# format B (A2 + 5/6 ไฟล์ A3) — header เป็น field code ตรงกับ A2 Data Dict
# ---------------------------------------------------------------------------

# `objc_8` (เชียงใหม่/4) เป็น alias ของ `objc_8_name` (ไฟล์อื่น) — ทั้งคู่เก็บ**ชื่อ**หมวดรายจ่าย
# หลักเหมือนกัน (ดู module docstring)
_FIELD_ALIASES: dict[str, str] = {"objc_8": "objc_8_name"}

_FORMAT_B_REQUIRED_FIELDS: frozenset[str] = frozenset(
    {"min", "min_name", "agc", "agc_name", "item_name", "p_total_bud"}
)


def detect_format_b_header(row: tuple | None) -> dict[str, int] | None:
    """map header row 1 แบบ A2 (`min, min_name, agc, ...`) → `{field: col_idx}`

    คืน `None` ถ้าไม่ตรง (ให้ผู้เรียกลอง format A ต่อ)
    """
    if row is None:
        return None
    mapping: dict[str, int] = {}
    for col_idx, cell in enumerate(row):
        if not isinstance(cell, str):
            continue
        key = cell.strip()
        key = _FIELD_ALIASES.get(key, key)
        if key and key not in mapping:
            mapping[key] = col_idx
    if _FORMAT_B_REQUIRED_FIELDS <= mapping.keys():
        return mapping
    return None


def _build_field_code_record(
    row: tuple,
    mapping: dict[str, int],
    *,
    rel_path: str,
    sheet_name: str,
    excel_row: int,
    source_doc_id: str,
    dataset: str,
    folder_province: str | None,
    extra_quality_flags: tuple[str, ...],
) -> dict:
    flags: list[str] = list(extra_quality_flags)

    min_code = _code_str(_get(row, mapping, "min"))
    agc_code = _code_str(_get(row, mapping, "agc"))
    gov_level = _gov_level_for_min(min_code)
    ministry = _text_or_none(_get(row, mapping, "min_name"))
    agency = _text_or_none(_get(row, mapping, "agc_name"))
    local_gov_name = agency if gov_level == "local" else None

    province = folder_province
    if "จังหวัด" in mapping:
        raw_province = _get(row, mapping, "จังหวัด")
        if raw_province:
            canon = canonical_province(clean(str(raw_province)))
            if canon:
                province = canon

    cap_raw = _text_or_none(_get(row, mapping, "cap_ncap"))
    is_capital = _CAP_MAP.get(cap_raw) if cap_raw else None

    item_name_raw = _item_name_raw(_get(row, mapping, "item_name"))
    if item_name_raw is None:
        flags.append("empty_item_name")

    amount_thb = money.parse_baht(_get(row, mapping, "p_total_bud"))

    return {
        "source_id": compute_source_id(dataset, rel_path, sheet_name, excel_row),
        "dataset": dataset,
        "fiscal_year_be": FISCAL_YEAR_BE,
        "fiscal_year_ce": FISCAL_YEAR_CE,
        "gov_level": gov_level,
        "ministry": ministry,
        "ministry_code": min_code,
        "agency": agency,
        "agency_code": agc_code,
        "province": province,
        "local_gov_name": local_gov_name,
        "strategy": _text_or_none(_get(row, mapping, "group_budget")),
        "plan": _text_or_none(_get(row, mapping, "plan_name")),
        "output_project": _text_or_none(_get(row, mapping, "output_name")),
        "activity": _text_or_none(_get(row, mapping, "act_name")),
        "budget_type": _text_or_none(_get(row, mapping, "objc")),
        "expense_category": _text_or_none(_get(row, mapping, "objc_8_name")),
        "is_capital": is_capital,
        "cap_ncap_raw": cap_raw,
        "item_name_raw": item_name_raw,
        "amount_thb": amount_thb,
        "amount_unit_source": AMOUNT_UNIT_SOURCE,
        "source_path": rel_path,
        "source_sheet": sheet_name,
        "source_row": excel_row,
        "source_doc_id": source_doc_id,
        "quality_flags": flags,
    }


# ---------------------------------------------------------------------------
# format A (1 ไฟล์: เชียงใหม่ "เฉพาะส่วนราชการ...") — header ทั่วไปตาม 03 §4.2
# ---------------------------------------------------------------------------

_FORMAT_A_HEADER_SEARCH_ROWS = 6
_FORMAT_A_MIN_NON_EMPTY_CELLS = 5
_FORMAT_A_HEADER_KEYWORDS = ("กระทรวง", "หน่วยงาน")

# เรียงจากเฉพาะเจาะจง → ทั่วไป กันคำที่กว้างกว่าจับคอลัมน์ผิดก่อน (เช่น "งบ" ต้องเช็คหลัง
# "ประเภทรายจ่าย"/"ลงทุน" เพราะไม่ปรากฏในคอลัมน์อื่น)
_FORMAT_A_FIELD_KEYWORDS: tuple[tuple[str, str], ...] = (
    ("บาท", "amount_thb"),
    ("ประจำ/ลงทุน", "cap_ncap_raw"),
    ("ประเภทรายจ่าย", "expense_category"),
    ("รายการ", "item_name_raw"),
    ("แผนงาน", "plan"),
    ("หน่วยงาน", "agency"),
    ("กระทรวง", "ministry"),
)

_FORMAT_A_CORE_FIELDS: frozenset[str] = frozenset(
    {"ministry", "agency", "plan", "item_name_raw", "amount_thb"}
)

# "N รายการ  |  งบรวม X บาท  |  ..." — เว้นวรรครอบ `|` ไม่คงที่ (พบ 2 ช่องว่างจริงในไฟล์)
_TITLE_RE = re.compile(r"([\d,]+)\s*รายการ.*?งบรวม\s*([\d,]+)\s*บาท")


def detect_format_a_header(rows: list[tuple]) -> int | None:
    """หาแถวแรกที่มี ≥ 5 เซลล์ไม่ว่างและมีคำว่า `กระทรวง`/`หน่วยงาน` (03 §4.2)"""
    for idx, row in enumerate(rows[:_FORMAT_A_HEADER_SEARCH_ROWS]):
        if row is None:
            continue
        texts = [clean(str(c)) for c in row if isinstance(c, str) and clean(str(c)).strip()]
        if len(texts) < _FORMAT_A_MIN_NON_EMPTY_CELLS:
            continue
        if any(kw in t for t in texts for kw in _FORMAT_A_HEADER_KEYWORDS):
            return idx
    return None


def map_format_a_header(row: tuple) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for col_idx, cell in enumerate(row):
        if not isinstance(cell, str):
            continue
        text = clean(cell)
        for keyword, field_name in _FORMAT_A_FIELD_KEYWORDS:
            if keyword in text and field_name not in mapping:
                mapping[field_name] = col_idx
                break
    return mapping


def find_title(
    rows: list[tuple], header_row_idx: int, max_lookback: int = 4
) -> tuple[int, int] | None:
    """หาแถว title ("N รายการ | งบรวม X บาท") ในช่วงก่อนหน้า header (ปกติคือแถวติดกัน)"""
    for idx in range(max(0, header_row_idx - max_lookback), header_row_idx):
        row = rows[idx]
        if row is None:
            continue
        for cell in row:
            if not isinstance(cell, str):
                continue
            m = _TITLE_RE.search(clean(cell))
            if m:
                n = int(m.group(1).replace(",", ""))
                amount = int(m.group(2).replace(",", ""))
                return n, amount
    return None


def _build_format_a_record(
    row: tuple,
    mapping: dict[str, int],
    *,
    rel_path: str,
    sheet_name: str,
    excel_row: int,
    source_doc_id: str,
    dataset: str,
    folder_province: str | None,
) -> dict:
    item_name_raw = _item_name_raw(_get(row, mapping, "item_name_raw"))
    cap_raw = _text_or_none(_get(row, mapping, "cap_ncap_raw"))
    is_capital = _CAP_MAP.get(cap_raw) if cap_raw else None
    amount_thb = money.parse_baht(_get(row, mapping, "amount_thb"))

    return {
        "source_id": compute_source_id(dataset, rel_path, sheet_name, excel_row),
        "dataset": dataset,
        "fiscal_year_be": FISCAL_YEAR_BE,
        "fiscal_year_ce": FISCAL_YEAR_CE,
        # format A = "รายการ (ไม่รวม อปท.)" → ส่วนราชการล้วน (ไม่มีรหัสกระทรวง/กรมให้ตรวจ min)
        "gov_level": "central",
        "ministry": _text_or_none(_get(row, mapping, "ministry")),
        "ministry_code": None,
        "agency": _text_or_none(_get(row, mapping, "agency")),
        "agency_code": None,
        "province": folder_province,
        "local_gov_name": None,
        "strategy": None,
        "plan": _text_or_none(_get(row, mapping, "plan")),
        "output_project": None,
        "activity": None,
        "budget_type": None,
        "expense_category": _text_or_none(_get(row, mapping, "expense_category")),
        "is_capital": is_capital,
        "cap_ncap_raw": cap_raw,
        "item_name_raw": item_name_raw,
        "amount_thb": amount_thb,
        "amount_unit_source": AMOUNT_UNIT_SOURCE,
        "source_path": rel_path,
        "source_sheet": sheet_name,
        "source_row": excel_row,
        "source_doc_id": source_doc_id,
        "quality_flags": [SUBSET_FLAG],
    }


def _is_blank_item_cell(value: object) -> bool:
    return value is None or (isinstance(value, str) and clean(value).strip() == "")


# ---------------------------------------------------------------------------
# pyarrow schema + parquet io
# ---------------------------------------------------------------------------


def pyarrow_schema() -> pa.Schema:
    return pa.schema(
        [
            pa.field("source_id", pa.string()),
            pa.field("dataset", pa.string()),
            pa.field("fiscal_year_be", pa.int32()),
            pa.field("fiscal_year_ce", pa.int32()),
            pa.field("gov_level", pa.string()),
            pa.field("ministry", pa.string()),
            pa.field("ministry_code", pa.string()),
            pa.field("agency", pa.string()),
            pa.field("agency_code", pa.string()),
            pa.field("province", pa.string()),
            pa.field("local_gov_name", pa.string()),
            pa.field("strategy", pa.string()),
            pa.field("plan", pa.string()),
            pa.field("output_project", pa.string()),
            pa.field("activity", pa.string()),
            pa.field("budget_type", pa.string()),
            pa.field("expense_category", pa.string()),
            pa.field("is_capital", pa.bool_()),
            pa.field("cap_ncap_raw", pa.string()),
            pa.field("item_name_raw", pa.string()),
            pa.field("amount_thb", pa.int64()),
            pa.field("amount_unit_source", pa.string()),
            pa.field("source_path", pa.string()),
            pa.field("source_sheet", pa.string()),
            pa.field("source_row", pa.int32()),
            pa.field("source_doc_id", pa.string()),
            pa.field("quality_flags", pa.list_(pa.string())),
        ]
    )


def _write_parquet(records: list[dict], cache_path: Path) -> int:
    table = pa.Table.from_pylist(records, schema=pyarrow_schema())
    pq.write_table(table, str(cache_path), compression="zstd")
    return cache_path.stat().st_size


def _act2570_dir(cfg: PipelineConfig, cache_dir: Path | None) -> Path:
    base = cache_dir if cache_dir is not None else cfg.cache_dir
    return cfg.assert_writable_path(base / CACHE_SUBDIR)


# ---------------------------------------------------------------------------
# per-file extraction
# ---------------------------------------------------------------------------

_IGNORED_SHEET_NAMES: frozenset[str] = frozenset({"Data Dict", "Pivot"})


class Act2570SheetError(ValueError):
    """เปิดไฟล์ได้แต่หา sheet/header ที่คาดไม่เจอ — ต้องตรวจไฟล์ใหม่ (ไม่ silent-skip)"""


def _pick_a3_sheet(sheet_names: list[str], path: Path) -> str:
    if "Data" in sheet_names:
        return "Data"
    candidates = [s for s in sheet_names if s not in _IGNORED_SHEET_NAMES]
    if len(candidates) == 1:
        return candidates[0]
    raise Act2570SheetError(
        f"เลือก sheet ข้อมูลหลักของ A3 ไม่ได้ใน {path} (ไม่มี sheet ชื่อ 'Data' และเหลือ "
        f"candidate {len(candidates)} ตัวหลังตัด {sorted(_IGNORED_SHEET_NAMES)}): {sheet_names}"
    )


@dataclass
class DraftResult:
    file_path: Path
    rel_path: str
    source_doc_id: str
    sheet_name: str
    duplicate_rel_paths: list[str]
    rows_written: int
    total_amount_thb: int
    flag_counts: Counter
    cache_path: Path
    cache_bytes: int


def extract_draft(cfg: PipelineConfig, discovered: DiscoveredFiles, out_dir: Path) -> DraftResult:
    """A2: sheet `Data` ตรง ๆ (03 §4.2) → `.cache/act2570/act_2570_draft.parquet`"""
    path = discovered.draft_path
    rel_path = path.relative_to(cfg.raw_data_dir).as_posix()
    source_doc_id = doc_id_for_path(rel_path)

    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    try:
        if "Data" not in wb.sheetnames:
            raise Act2570SheetError(f"ไม่พบ sheet 'Data' ใน {path}: {wb.sheetnames}")
        sheet_name = "Data"
        ws = wb[sheet_name]
        rows_iter = ws.iter_rows(values_only=True)
        header = next(rows_iter)
        mapping = detect_format_b_header(header)
        if mapping is None:
            raise Act2570SheetError(
                f"header ของ sheet 'Data' ใน {path} ไม่ตรงกับ field code ของ A2 ที่คาด: {header}"
            )

        records: list[dict] = []
        flag_counts: Counter = Counter()
        excel_row = 1
        for row in rows_iter:
            excel_row += 1
            record = _build_field_code_record(
                row,
                mapping,
                rel_path=rel_path,
                sheet_name=sheet_name,
                excel_row=excel_row,
                source_doc_id=source_doc_id,
                dataset=DATASET_DRAFT,
                folder_province=None,
                extra_quality_flags=(GROUP_BUDGET_FLAG,),
            )
            records.append(record)
            flag_counts.update(record["quality_flags"])
    finally:
        wb.close()

    cache_path = cfg.assert_writable_path(out_dir / f"{DATASET_DRAFT}.parquet")
    cache_bytes = _write_parquet(records, cache_path)

    return DraftResult(
        file_path=path,
        rel_path=rel_path,
        source_doc_id=source_doc_id,
        sheet_name=sheet_name,
        duplicate_rel_paths=[
            p.relative_to(cfg.raw_data_dir).as_posix() for p in discovered.draft_duplicate_paths
        ],
        rows_written=len(records),
        total_amount_thb=sum(r["amount_thb"] or 0 for r in records),
        flag_counts=flag_counts,
        cache_path=cache_path,
        cache_bytes=cache_bytes,
    )


@dataclass
class A3FileResult:
    file_path: Path
    rel_path: str
    source_doc_id: str
    dataset: str
    format: str  # "A" | "B"
    province: str | None
    rows_written: int
    total_amount_thb: int
    title_n: int | None
    title_amount_thb: int | None
    flag_counts: Counter
    cache_path: Path
    cache_bytes: int


def extract_one_a3_file(cfg: PipelineConfig, path: Path, out_dir: Path) -> A3FileResult | None:
    """extract ไฟล์ A3 หนึ่งไฟล์ — คืน `None` ถ้าชื่อไฟล์จำแนก dataset ไม่ได้ (รายงาน ไม่ raise)"""
    dataset = classify_a3_dataset(path.name)
    if dataset is None:
        return None

    rel_path = path.relative_to(cfg.raw_data_dir).as_posix()
    source_doc_id = doc_id_for_path(rel_path)
    folder_province = _province_from_rel_path(rel_path)

    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    try:
        sheet_name = _pick_a3_sheet(wb.sheetnames, path)
        ws = wb[sheet_name]
        rows_iter = ws.iter_rows(values_only=True)
        first_row = next(rows_iter)
        mapping_b = detect_format_b_header(first_row)

        records: list[dict] = []
        flag_counts: Counter = Counter()
        title_n: int | None = None
        title_amount_thb: int | None = None

        if mapping_b is not None:
            fmt = "B"
            excel_row = 1
            for row in rows_iter:
                excel_row += 1
                record = _build_field_code_record(
                    row,
                    mapping_b,
                    rel_path=rel_path,
                    sheet_name=sheet_name,
                    excel_row=excel_row,
                    source_doc_id=source_doc_id,
                    dataset=dataset,
                    folder_province=folder_province,
                    extra_quality_flags=(GROUP_BUDGET_FLAG, SUBSET_FLAG),
                )
                records.append(record)
                flag_counts.update(record["quality_flags"])
        else:
            fmt = "A"
            all_rows = [first_row, *list(rows_iter)]
            header_idx = detect_format_a_header(all_rows)
            if header_idx is None:
                raise Act2570SheetError(
                    f"หา header format A ไม่เจอใน {path} (ต้องมี >= "
                    f"{_FORMAT_A_MIN_NON_EMPTY_CELLS} เซลล์ไม่ว่างและมีคำว่า "
                    f"{_FORMAT_A_HEADER_KEYWORDS}) — แถวแรก ๆ: "
                    f"{all_rows[:_FORMAT_A_HEADER_SEARCH_ROWS]}"
                )
            col_mapping = map_format_a_header(all_rows[header_idx])
            missing = _FORMAT_A_CORE_FIELDS - col_mapping.keys()
            if missing:
                raise Act2570SheetError(
                    f"map header format A ไม่ครบ (ขาด {sorted(missing)}) ใน {path}: "
                    f"{all_rows[header_idx]}"
                )
            title = find_title(all_rows, header_idx)
            if title is not None:
                title_n, title_amount_thb = title

            for excel_row, row in enumerate(all_rows[header_idx + 1 :], start=header_idx + 2):
                item_cell = _get(row, col_mapping, "item_name_raw")
                if _is_blank_item_cell(item_cell):
                    # ครอบคลุมทั้งแถวว่างล้วนและแถว "รวมทั้งหมด" (เซลล์ `รายการ` ว่างทั้งคู่)
                    continue
                record = _build_format_a_record(
                    row,
                    col_mapping,
                    rel_path=rel_path,
                    sheet_name=sheet_name,
                    excel_row=excel_row,
                    source_doc_id=source_doc_id,
                    dataset=dataset,
                    folder_province=folder_province,
                )
                records.append(record)
                flag_counts.update(record["quality_flags"])
    finally:
        wb.close()

    total_amount_thb = sum(r["amount_thb"] or 0 for r in records)
    slug = slugify_ascii(Path(rel_path).stem)
    cache_path = cfg.assert_writable_path(out_dir / f"{dataset}__{slug}.parquet")
    cache_bytes = _write_parquet(records, cache_path)

    return A3FileResult(
        file_path=path,
        rel_path=rel_path,
        source_doc_id=source_doc_id,
        dataset=dataset,
        format=fmt,
        province=folder_province,
        rows_written=len(records),
        total_amount_thb=total_amount_thb,
        title_n=title_n,
        title_amount_thb=title_amount_thb,
        flag_counts=flag_counts,
        cache_path=cache_path,
        cache_bytes=cache_bytes,
    )


# ---------------------------------------------------------------------------
# orchestration
# ---------------------------------------------------------------------------


@dataclass
class ExtractReport:
    draft: DraftResult
    province_and_subsidy: list[A3FileResult]
    duplicate_skipped_rel_paths: list[str]
    unclassified_rel_paths: list[str]
    oracle_path: Path


def _write_oracle(cfg: PipelineConfig, out_dir: Path, report: ExtractReport) -> Path:
    data = {
        "draft": {
            "rel_path": report.draft.rel_path,
            "cache_path": report.draft.cache_path.name,
            "duplicate_rel_paths": report.draft.duplicate_rel_paths,
            "n_rows": report.draft.rows_written,
            "total_amount_thb": report.draft.total_amount_thb,
        },
        "province_and_subsidy": [
            {
                "rel_path": r.rel_path,
                "dataset": r.dataset,
                "format": r.format,
                "province": r.province,
                "cache_path": r.cache_path.name,
                "n_rows": r.rows_written,
                "total_amount_thb": r.total_amount_thb,
                "title_n": r.title_n,
                "title_amount_thb": r.title_amount_thb,
            }
            for r in report.province_and_subsidy
        ],
    }
    path = cfg.assert_writable_path(out_dir / ORACLE_FILENAME)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
        newline="\n",
    )
    return path


def extract_act2570(cfg: PipelineConfig, *, cache_dir: Path | None = None) -> ExtractReport:
    """extract A2 (ตัวหลักหลัง dedupe) + A3 ทั้งหมด → `.cache/act2570/*.parquet` + `oracle.json`

    `cache_dir` override ได้ (สำหรับ test — ต้องไม่แตะ `pipeline/.cache` จริง)
    """
    out_dir = _act2570_dir(cfg, cache_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    discovered = discover_files(cfg)
    draft_result = extract_draft(cfg, discovered, out_dir)

    a3_results: list[A3FileResult] = []
    unclassified: list[str] = []
    for path in discovered.a3_paths:
        result = extract_one_a3_file(cfg, path, out_dir)
        if result is None:
            unclassified.append(path.relative_to(cfg.raw_data_dir).as_posix())
            continue
        a3_results.append(result)

    report = ExtractReport(
        draft=draft_result,
        province_and_subsidy=a3_results,
        duplicate_skipped_rel_paths=draft_result.duplicate_rel_paths,
        unclassified_rel_paths=unclassified,
        oracle_path=out_dir / ORACLE_FILENAME,
    )
    oracle_path = _write_oracle(cfg, out_dir, report)
    report.oracle_path = oracle_path
    return report


# ---------------------------------------------------------------------------
# V2 (03 §6): format A ต้อง exact (N + ยอดบาท); format B → no_oracle + soft cross-check กับ A2
# ---------------------------------------------------------------------------


@dataclass
class V2Result:
    rel_path: str
    dataset: str
    format: str  # "A" | "B"
    status: str  # "ok" | "failed" | "no_oracle"
    passed: bool
    n_rows: int
    total_amount_thb: int
    title_n: int | None = None
    title_amount_thb: int | None = None
    match_pct_to_draft: float | None = None
    unmatched_examples: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


_SOFT_MATCH_THRESHOLD_PCT = 99.0


def _clean_or_none(value: object) -> str | None:
    if value is None:
        return None
    return clean(str(value))


def check_v2(cache_dir: Path) -> list[V2Result]:
    """V2: อ่าน `oracle.json` ใน `cache_dir` แล้วตรวจแต่ละไฟล์ A3

    format A: hard — จำนวนแถว = title_n และผลรวม = title_amount_thb เป๊ะ
    format B: ไม่มี title → status `no_oracle` (`passed=True` เสมอ, ไม่ใช่ hard fail ตาม 03 §6)
    พร้อม soft cross-check ว่า match กลับไปหา `act_2570_draft` ได้กี่ % (key เทียบหลัง `clean()`
    ทั้งสองฝั่ง กัน whitespace/`\\n` ต่างกันของ item_name แบบที่พบจริงใน เชียงใหม่/4)
    """
    oracle = json.loads((cache_dir / ORACLE_FILENAME).read_text(encoding="utf-8"))
    draft_entry = oracle["draft"]
    draft_table = pq.read_table(
        str(cache_dir / draft_entry["cache_path"]),
        columns=["agency_code", "item_name_raw", "amount_thb"],
    )
    draft_agc = draft_table.column("agency_code").to_pylist()
    draft_item = [_clean_or_none(v) for v in draft_table.column("item_name_raw").to_pylist()]
    draft_amt = draft_table.column("amount_thb").to_pylist()

    keys_with_agc: set[tuple] = set(zip(draft_agc, draft_item, draft_amt, strict=True))
    keys_item_amount: set[tuple] = set(zip(draft_item, draft_amt, strict=True))

    results: list[V2Result] = []
    for entry in oracle["province_and_subsidy"]:
        table = pq.read_table(
            str(cache_dir / entry["cache_path"]),
            columns=["agency_code", "item_name_raw", "amount_thb"],
        )
        n_rows = table.num_rows
        total_amount_thb = int(pc.sum(table.column("amount_thb")).as_py() or 0)

        fmt = entry["format"]
        agcs = table.column("agency_code").to_pylist()
        items = [_clean_or_none(v) for v in table.column("item_name_raw").to_pylist()]
        amts = table.column("amount_thb").to_pylist()

        matched = 0
        unmatched_examples: list[dict] = []
        for agc, item, amt in zip(agcs, items, amts, strict=True):
            key = (agc, item, amt) if fmt == "B" else (item, amt)
            found = key in keys_with_agc if fmt == "B" else key in keys_item_amount
            if found:
                matched += 1
            elif len(unmatched_examples) < 5:
                unmatched_examples.append(
                    {"agency_code": agc, "item_name": item, "amount_thb": amt}
                )
        match_pct = (matched / n_rows * 100) if n_rows else 100.0

        notes: list[str] = []
        if fmt == "A":
            title_n = entry["title_n"]
            title_amount_thb = entry["title_amount_thb"]
            passed = n_rows == title_n and total_amount_thb == title_amount_thb
            status = "ok" if passed else "failed"
            if not passed:
                notes.append(
                    f"format A oracle mismatch: n_rows={n_rows} (title={title_n}), "
                    f"total_amount_thb={total_amount_thb} (title={title_amount_thb})"
                )
        else:
            title_n = entry.get("title_n")
            title_amount_thb = entry.get("title_amount_thb")
            status = "no_oracle"
            passed = True
            if match_pct < _SOFT_MATCH_THRESHOLD_PCT:
                notes.append(
                    f"soft cross-check กับ act_2570_draft ต่ำกว่า {_SOFT_MATCH_THRESHOLD_PCT}%: "
                    f"{match_pct:.2f}% ({matched}/{n_rows})"
                )

        results.append(
            V2Result(
                rel_path=entry["rel_path"],
                dataset=entry["dataset"],
                format=fmt,
                status=status,
                passed=passed,
                n_rows=n_rows,
                total_amount_thb=total_amount_thb,
                title_n=title_n,
                title_amount_thb=title_amount_thb,
                match_pct_to_draft=match_pct,
                unmatched_examples=unmatched_examples,
                notes=notes,
            )
        )
    return results
