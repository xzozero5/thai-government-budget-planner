"""T-107: `extract/local_sheets.py` — ข้อบัญญัติ/เทศบัญญัติ อปท. ปี 2570 ที่ถอดเป็นตารางแล้ว
(Sheets.xlsx) — 03-DATA-PIPELINE.md §4.3, 02-DATA-INVENTORY.md §A4

`dataset = "local_ordinance_2570"`, `gov_level = "local"`, `fiscal_year_be = 2570` คงที่ทั้ง
dataset; หน่วยเงินในไฟล์เป็น**บาทอยู่แล้ว** (ไม่ใช่ล้านบาทแบบ PBO) → `amount_unit_source = "thb"`
(คอลัมน์นี้อยู่นอก `normalize.schema.BudgetLine` เหมือนที่ `extract/pbo.py` ทำ — cache parquet
ของ extract stage เป็น superset ของ schema เสมอ ยังไม่ผ่าน pydantic validation ที่ extract stage)

ไฟล์ที่พบจริงใต้ raw root (ยืนยัน 19 ก.ย. 2569, เปิดด้วย openpyxl read_only) — ค้นหาด้วย
`discover_local_files()` (filename ขึ้นต้น "ร่างข้อบัญญัติ"/"ร่างเทศบัญญัติ" และลงท้าย
" - Sheets.xlsx"/" - Excel.xlsx" กัน false-positive กับไฟล์ A3 "ร่าง พ.ร.บ. ... - Excel.xlsx"):

1. `งบประมาณ สมุทรปราการ/3 - งบ อบต. ราชาเทวะ/ร่างข้อบัญญัติงบ 2570 อบต. ราชาเทวะ - Sheets.xlsx`
   — 11 sheet ต่อแผนงาน (header ตรง `RAJA_HEADER` ทุก sheet, รวม 345 แถวข้อมูล) +
   `ocr_raw_data` (concat ของทั้งหมด, ไม่ใช้), `pivot_ocr_raw_data` (ตรวจยอดกับ PDF ต้นฉบับ,
   ไม่ใช้), `summary_ocr_raw_data` (`page,plan,work,budget_group,total_amount` — ใช้เป็น oracle
   ของ `check_v3_raja`) ตรงตาม 02 §A4 ทุกประการ — เดต้ามาจาก **OCR ของต้นทางเอง** (ไม่ใช่เรา
   OCR — ไม่ละเมิด N4) → ทุกแถวติด flag `upstream_ocr`
   - **ยืนยันตัวอย่าง outlier จริง**: sheet `แผนงานงบกลาง` แถว Excel 2 — item
     "เงินสมทบกองทุนประกันสังคม" `amount=2` (บาท) ทั้งที่ควรเป็นหลักหมื่น/แสน → เข้าเกณฑ์
     `< 100 บาท` พอดี → flag `amount_outlier`
2. `งบประมาณ เชียงใหม่/2 - งบ อบจ. เชียงใหม่/ร่างข้อบัญญัติงบ 2570 อบจ. เชียงใหม่ - Sheets.xlsx`
   sheet `Data` (sheet เดียวในไฟล์, 1,027 แถว, คอลัมน์ตรง 02 §A4: `REF_DOC_Page, Divison,
   Budgetary_Plan, Budgetary_USER, Budgetary_TYPE, Budgetary_TYPE2, Pre Project, Project ,
   number, amount, Division, FCY` + คอลัมน์ว่าง 22 คอลัมน์ท้ายตาราง)
   - **ยืนยันแล้ว (แก้ไข 02 §A4)**: มีคอลัมน์ `Divison` (typo) **และ** `Division` (สะกดถูก) พร้อม
     กันในไฟล์เดียว — `Divison` เป็น `None` ทั้ง 1,045 แถว, `Division` มีค่าจริง 1,020/1,045
     แถว (97.6%) → mapper ใช้ `Division` เป็นหลัก, fallback ไป `Divison` เฉพาะถ้า `Division`
     ว่าง (ไม่มีเคสจริงในไฟล์นี้ที่ `Divison` ไม่ว่างแต่ `Division` ว่าง)
   - **ยืนยันแล้ว (`FCY` ไม่ใช่ปีงบ — ต่างจากที่ชื่อคอลัมน์สื่อ)**: สแกนทุกแถวพบว่า `FCY` เก็บ
     "จำนวน (หน่วย)" ล้วน ๆ ไม่ใช่ปีงบ (ตัวอย่างค่าจริง: `'รถ 9 คัน'`,
     `'เพื่อจ่ายเป็นเงินเพิ่มสำหรับตำแหน่งที่มีเหตุพิเศษ...'`) → เป็นข้อความอธิบาย/หมายเหตุ →
     map เข้า `description` แทนการตรวจปีงบ (fiscal_year_be คงที่ 2570 ทั้ง dataset อยู่แล้ว)
3. Generic column mapper (fuzzy, rapidfuzz `WRatio` + `_CANONICAL_SYNONYMS`) — ใช้กับทุก sheet
   ที่เหลือ (ไม่ใช่ sheet ของ (1)/(2) ข้างบน) รวม:
   - `งบประมาณ สมุทรปราการ/2 - งบ อบจ. สมุทรปราการ/ร่างข้อบัญญัติงบ 2570 อบจ. สมุทรปราการ -
     Sheets.xlsx` — **ยืนยันแล้ว โครงสร้างต่างจาก อบจ. เชียงใหม่โดยสิ้นเชิง** (02 §A4 เดิมเดา
     "คาดเหมือน อบจ. ชม." — ผิด, แก้เป็นด้านล่าง): 4 sheet — `ภาพรวม` (พาย/สรุปตามปี ไม่มีคอลัมน์
     item → skip), `โครงการรวม งบ 70` (**575 แถวไม่ว่างจริง (นับซ้ำ 19 ก.ย. 2569) — 574 แถวถูก
     extract จริง** เพราะ 1 แถว [plan=`แผนงบกลาง`, budget_group=`งบกลาง`, expense_category=
     `รายจ่ายตามข้อผูกพัน`] มีคอลัมน์ `โครงการ` ว่างเปล่า (ไม่มีชื่อรายการให้ใช้เป็น item_name) จึง
     ถูกข้ามตามกติกาทั่วไป — เลข "577" ที่เคยมีอยู่ก่อนหน้าไม่ตรงกับไฟล์จริง แก้เป็นตัวเลขที่นับจาก
     ไฟล์จริงแล้ว; header อยู่แถว Excel 3, คอลัมน์ `โครงการ,
     แผนงาน , กลุ่มงาน, ประเภทงบประมาณ, ประเภทงบประมาณ (ย่อย), หน่วยรับงบประมาณ, ราคา/หน่วย,
     จำนวน (หน่วย), จำนวน (งวด), ยอดสุทธิ, ร้อยละ, แผนพัฒนาท้องถิ่น (2566-2570)` — **ปีงบ 2570
     ตัวจริง** → extract), `โครงการรวม งบ 69` (539 แถว, คอลัมน์เกือบเหมือนกันแต่เป็นงบปี **2569**),
     `แผนพัฒฯ ปี 69` (94 แถว, เป็นแผนพัฒนาท้องถิ่นปี 2569) — 2 sheet หลัง**ข้ามเสมอ** (ชื่อ sheet
     มีเลขปี "69" ไม่ตรง 2570 — ตรวจด้วย `_sheet_targets_fiscal_year_2570()`, ไม่ใช่ปีงบ 2570 ของ
     dataset นี้) แม้ column จะ map ได้ครบก็ตาม
   - `งบประมาณ เชียงใหม่/3 - งบเทศบาลนครเชียงใหม่/ร่างเทศบัญญัติงบ 2570 ทน. เชียงใหม่ -
     Excel.xlsx` — 3 sheet: `ชีต1` (700 แถว, คอลัมน์ `REF_PDF_Page, REF_DOC_Page, Divison,
     Budgetary_Plan, Budgetary_USER, Budgetary_TYPE, Budgetary_TYPE2, Pre Project, Project ,
     number, amount, FCY` — **ยืนยันตรงกับหมายเหตุใน sheet `_หมายเหตุ` ของไฟล์เอง**: "บรรจุเฉพาะ
     รายการที่ตั้งงบไว้ในปี 2570 ... จำนวน 700 รายการ"; column ชุดนี้เหมือน (2) เกือบทุกตัวจึงถูก
     generic mapper จับได้ครบผ่าน synonym dict เดียวกัน โดยไม่ต้องเขียน mapper เฉพาะไฟล์ตามที่
     spec สั่ง — `number`/`REF_PDF_Page` เป็น `None` ทั้งไฟล์ (ไม่มีข้อมูลจริง), `FCY` ก็ไม่ใช่ปีงบ
     เช่นกัน — มีค่าจริงแค่ 17/700 แถว เป็นชื่อชุมชน เช่น `'ชุมชนชัยมงคลบ้านเมิ่ง'`), `_ตรวจกระทบยอด`
     (34 แถว, เป็นตาราง self-check ของต้นทางเอง เทียบยอดชีต1 กับ "รวม" ในเอกสาร PDF — **ไม่มี
     คอลัมน์ item** → skip เพราะไม่เข้าเกณฑ์ ≥ 3 ฟิลด์หลัก), `_หมายเหตุ` (23 แถว ข้อความอธิบายล้วน
     → skip เช่นกัน)
   - ไฟล์/sheet อปท. อื่นที่อาจเพิ่มมาทีหลังภายใต้โฟลเดอร์ `งบประมาณ */` ที่ตรง filename pattern
     ข้างบน จะถูกลองด้วย generic mapper อัตโนมัติ (ไม่ต้องแก้โค้ดถ้าคอลัมน์คล้ายที่เจอแล้ว)

ฟิลด์ที่ `normalize.schema.BudgetLine` **ไม่มี field รองรับ** (ต้องรายงาน ไม่แก้ schema เอง):
- `source_pdf_doc_id` — PDF ต้นฉบับที่จับคู่ได้ (ตาม naming `<title> - PDF*.pdf` ในโฟลเดอร์
  เดียวกับ Sheets/Excel .xlsx) เก็บไว้ที่ `.cache/local/pdf_pairs.json` แทน (คีย์ = source_doc_id
  ของไฟล์ .xlsx) ตามที่ข้อ 3 ของ T-107 กำหนด — **ไม่**เขียนลงคอลัมน์ `description` เพราะจะปนกับ
  เนื้อหาจริงของ `description` (raja มี `description` ที่เป็น citation text สำคัญอยู่แล้ว)

Slug ของชื่อไฟล์ (`{province}__{local_gov_slug}.parquet`) เป็น ascii เสมอ (N7/03 §7) แต่ไม่มี
transliteration library ในสารบบ dependency (`pythainlp` เป็น optional ที่ไม่ได้ติดตั้งจริงใน
`pyproject.toml`) — ใช้ตารางแปลงอักษรไทย→ละตินแบบคร่าว ๆ (ไม่ใช่ RTGS ทางการ เพราะไม่ต้องอ่าน
ออกเสียงถูก แค่ต้องเป็น ascii, deterministic, ไม่ชนกัน) ต่อท้ายด้วย hash 6 ตัวอักษรของชื่อเต็ม
เพื่อกันชนกันเวลาแปลงแล้วสั้นไป — ชื่อไทยจริงยังอยู่ในคอลัมน์ `local_gov_name`/`province` เสมอ
(ห้าม transliterate ข้อมูล ตาม CLAUDE.md §7)

ไม่มี `check_v3` ใน `validate.py` (ยังไม่ถูกสร้างในรอบนี้ และ task นี้ห้ามแตะ `validate.py`) —
โมดูลนี้จึงมี `check_v3_raja()`/`V3Result` ของตัวเองไว้ก่อน (หน้าตา/field คล้าย `V1Result` ใน
`validate.py` โดยเจตนา) ให้ main thread ย้ายไป `validate.py` ทีหลังได้ถ้าต้องการรวมเข้า
`tgbp validate`

**แก้ 19 ก.ย. 2569 (รอบตรวจซ้ำ T-107 — โค้ดเดิมยังไม่เคยรันจริง)** พบบั๊กจริง 3 จุดจากการรัน
`extract_local_sheets()` กับไฟล์จริงทั้ง 4 ไฟล์ + เทียบผล V3:
1. `flag_amount_outliers` เดิมมี z-score ต่อกลุ่ม `expense_category` เพิ่มจากที่ยืนยันไว้ (03 §4.3
   สั่งแค่ threshold `< 100 บาท`) — พิสูจน์แล้วว่า**ผิด**: raja sheet ส่วนใหญ่ (เช่น
   `แผนงานงบกลาง`) มี `expense_category`/`sub_category` เป็น `None` ทั้งชีต ทำให้รายการที่ไม่
   เกี่ยวข้องกันถูกจัดกลุ่มสถิติเดียวกัน แล้ว z-score แฟล็กยอดที่ถูกต้องจริงเป็น outlier (ยืนยันจริง:
   `เบี้ยยังขีพผู้สูงอายุ` 48,000,000 บาท ถูกแฟล็กผิด) จนถูกตัดออกจาก `check_v3_raja` ทำให้ V3 fail
   หนักกว่าความเป็นจริงมาก (diff หลักสิบล้านบาทในบางกลุ่ม) — ตัด z-score ออก เหลือเฉพาะ absolute
   threshold ที่มีตัวอย่างจริงยืนยัน
2. `_map_header_row` เดิม tie-break ด้วยลำดับคอลัมน์ในชีตเมื่อสองคอลัมน์ได้คะแนนเท่ากันสำหรับ field
   เดียวกัน — พิสูจน์แล้วว่า**ผิด**สำหรับ `ทน. เชียงใหม่` sheet `ชีต1` ที่มีทั้ง `REF_PDF_Page`
   (ว่างทั้งไฟล์) และ `REF_DOC_Page` (มีค่าจริง รูปแบบ `"N/M"` เช่น `"2/88"`) แข่งกันเป็น
   `source_page` ทั้งคู่คะแนนเท่ากัน (WRatio=100) แล้วเลือกคอลัมน์แรก (`REF_PDF_Page`, ว่าง) ทำให้
   `source_page` เป็น `None` ทั้ง 700 แถว (สูญเสีย citation เลขหน้า) — แก้ให้ tie-break ด้วยลำดับ
   synonym ใน `_CANONICAL_SYNONYMS` แทน (`ref_doc_page` มาก่อน `ref_pdf_page` ในทูเพิลอยู่แล้ว)
3. ไม่มีโค้ดรองรับรูปแบบ `"N/M"` (หน้า/จำนวนหน้ารวม) ของ `REF_DOC_Page` แม้ tie-break ข้อ 2 จะแก้แล้ว
   ก็ตาม (`int("2/88")` raise ValueError → เดิมกลืนเป็น `None` เงียบ ๆ) — เพิ่ม `_page_or_none()`
   แยกเลขหน้าหน้า `/` ออกมา
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import openpyxl
import pyarrow as pa
import pyarrow.parquet as pq
from rapidfuzz import fuzz

from tgbp_pipeline.config import PipelineConfig
from tgbp_pipeline.normalize import money
from tgbp_pipeline.normalize.thai_geo import canonical_province
from tgbp_pipeline.normalize.thai_text import clean, nfc_only
from tgbp_pipeline.util.hash import doc_id_for_path
from tgbp_pipeline.util.hash import source_id as compute_source_id

DATASET = "local_ordinance_2570"
GOV_LEVEL = "local"
FISCAL_YEAR_BE = 2570
FISCAL_YEAR_CE = FISCAL_YEAR_BE - 543
AMOUNT_UNIT_SOURCE = "thb"

# ---------------------------------------------------------------------------
# discovery — filename pattern ยืนยันจริง 19 ก.ย. 2569: มีแค่ 4 ไฟล์ที่ตรง (02 §A4)
# ("ร่าง พ.ร.บ. ... - Excel.xlsx" เป็น A3/act2570_province — ไม่ใช่ของ T-107 จึงกัน prefix)
# ---------------------------------------------------------------------------

_LOCAL_FILE_PREFIXES: tuple[str, ...] = ("ร่างข้อบัญญัติ", "ร่างเทศบัญญัติ")
_LOCAL_FILE_SUFFIXES: tuple[str, ...] = (" - Sheets.xlsx", " - Excel.xlsx")


def discover_local_files(cfg: PipelineConfig) -> list[Path]:
    """หาไฟล์ Sheets/Excel ของข้อบัญญัติ/เทศบัญญัติ อปท. ใต้ `raw_data_dir` ทั้งหมด (เรียงตาม path)"""
    found: list[Path] = []
    for path in cfg.raw_data_dir.rglob("*.xlsx"):
        name = path.name
        if name.startswith(_LOCAL_FILE_PREFIXES) and name.endswith(_LOCAL_FILE_SUFFIXES):
            found.append(path)
    return sorted(found)


# ---------------------------------------------------------------------------
# province / local_gov_name จากชื่อไฟล์/โฟลเดอร์ (03 §4.3)
# ---------------------------------------------------------------------------

_PROVINCE_FOLDER_RE = re.compile(r"^งบประมาณ\s+(.+)$")
_TITLE_SUFFIX_RE = re.compile(r"\s*-\s*(Sheets|Excel)\s*$", re.IGNORECASE)
_TITLE_PREFIX_RE = re.compile(r"^ร่าง(ข้อบัญญัติ|เทศบัญญัติ)งบ\s*2570\s*")


def derive_province_and_local_gov(rel_path: str) -> tuple[str | None, str | None]:
    """`province` จากโฟลเดอร์บนสุด `งบประมาณ <จังหวัด>/...`, `local_gov_name` จากชื่อไฟล์"""
    parts = rel_path.split("/")
    province: str | None = None
    if parts:
        m = _PROVINCE_FOLDER_RE.match(clean(parts[0]))
        if m:
            province = canonical_province(clean(m.group(1)))

    filename_stem = Path(parts[-1]).stem if parts else ""
    title = _TITLE_SUFFIX_RE.sub("", clean(filename_stem)).strip()
    local_gov_name = _TITLE_PREFIX_RE.sub("", title).strip()
    return province, (local_gov_name or None)


def _pdf_title_stem(rel_path: str) -> str:
    """ชื่อ (ไม่รวม suffix ` - Sheets`/` - Excel`) ใช้ค้นหา PDF คู่กัน (` - PDF*.pdf`)"""
    filename_stem = Path(rel_path).name
    filename_stem = Path(filename_stem).stem
    return _TITLE_SUFFIX_RE.sub("", clean(filename_stem)).strip()


def find_paired_pdfs(xlsx_path: Path, cfg: PipelineConfig) -> list[Path]:
    """หา PDF ต้นฉบับที่ชื่อขึ้นต้นเหมือนกัน (`<title> - PDF*.pdf`) ในโฟลเดอร์เดียวกัน"""
    rel_path = xlsx_path.relative_to(cfg.raw_data_dir).as_posix()
    title = _pdf_title_stem(rel_path)
    if not title:
        return []
    pattern = f"{title} - PDF*.pdf"
    return sorted(xlsx_path.parent.glob(pattern))


# ---------------------------------------------------------------------------
# ascii slug (03 §7 — ชื่อไฟล์ ascii-safe, ชื่อไทยจริงเก็บในคอลัมน์)
# ---------------------------------------------------------------------------

_THAI_TO_ASCII: dict[str, str] = {
    "ก": "k",
    "ข": "kh",
    "ฃ": "kh",
    "ค": "kh",
    "ฅ": "kh",
    "ฆ": "kh",
    "ง": "ng",
    "จ": "ch",
    "ฉ": "ch",
    "ช": "ch",
    "ซ": "s",
    "ฌ": "ch",
    "ญ": "y",
    "ฎ": "d",
    "ฏ": "t",
    "ฐ": "th",
    "ฑ": "th",
    "ฒ": "th",
    "ณ": "n",
    "ด": "d",
    "ต": "t",
    "ถ": "th",
    "ท": "th",
    "ธ": "th",
    "น": "n",
    "บ": "b",
    "ป": "p",
    "ผ": "ph",
    "ฝ": "f",
    "พ": "ph",
    "ฟ": "f",
    "ภ": "ph",
    "ม": "m",
    "ย": "y",
    "ร": "r",
    "ฤ": "rue",
    "ล": "l",
    "ฦ": "lue",
    "ว": "w",
    "ศ": "s",
    "ษ": "s",
    "ส": "s",
    "ห": "h",
    "ฬ": "l",
    "อ": "o",
    "ฮ": "h",
    "ะ": "a",
    "ั": "a",
    "า": "a",
    "ำ": "am",
    "ิ": "i",
    "ี": "i",
    "ึ": "ue",
    "ื": "ue",
    "ุ": "u",
    "ู": "u",
    "เ": "e",
    "แ": "ae",
    "โ": "o",
    "ใ": "ai",
    "ไ": "ai",
    "ๅ": "",
    "็": "",
    "่": "",
    "้": "",
    "๊": "",
    "๋": "",
    "์": "",
    "ๆ": "",
    "ฯ": "",
}

_SLUG_INVALID_RE = re.compile(r"[^a-z0-9]+")


def slugify_ascii(text: str) -> str:
    """แปลงข้อความไทย/อื่น ๆ → slug ascii deterministic (ไม่ใช่ RTGS ทางการ — ดู module docstring)"""
    cleaned = clean(text)
    transliterated = "".join(_THAI_TO_ASCII.get(ch, ch) for ch in cleaned)
    ascii_only = transliterated.encode("ascii", errors="ignore").decode("ascii").lower()
    slug = _SLUG_INVALID_RE.sub("-", ascii_only).strip("-")
    digest = hashlib.sha1(cleaned.encode("utf-8")).hexdigest()[:6]
    return f"{slug}-{digest}" if slug else digest


# ---------------------------------------------------------------------------
# generic fuzzy column mapper (03 §4.3 "ไฟล์อื่นใน A4")
# ---------------------------------------------------------------------------

_CANONICAL_SYNONYMS: dict[str, tuple[str, ...]] = {
    "source_page": ("ref_doc_page", "ref_pdf_page", "page", "เลขหน้า"),
    "plan": ("แผนงาน", "budgetary_plan", "plan"),
    "activity": ("งาน", "กลุ่มงาน", "budgetary_user", "activity", "work"),
    "budget_type": ("ประเภทงบประมาณ", "budgetary_type", "budget_type", "งบรายจ่าย"),
    "expense_category": (
        "ประเภทงบประมาณ (ย่อย)",
        "budgetary_type2",
        "expense_category",
        "sub_category",
        "หมวดรายจ่าย",
    ),
    "output_project": ("pre project", "output_project", "ผลผลิต/โครงการ"),
    "item_name_raw": ("โครงการ", "รายการ", "ชื่อโครงการ", "ชื่อรายการ", "project", "item"),
    "item_qty": ("จำนวน (หน่วย)", "number", "item_qty", "qty"),
    "unit_price_thb": ("ราคา/หน่วย", "unit_price", "ราคาต่อหน่วย"),
    "amount_thb": ("ยอดสุทธิ", "amount", "จำนวนเงิน", "total_amount"),
    "agency": (
        "หน่วยรับงบประมาณ",
        "division",
        "divison",
        "department",
        "หน่วยงาน",
    ),
    "legal_reference": (
        "แผนพัฒนาท้องถิ่น (2566-2570)",
        "แผนพัฒนาท้องถิ่น",
        "ระเบียบ",
        "legal_reference",
    ),
    "description": ("fcy", "รายละเอียด", "description", "คำชี้แจง"),
}

_CORE_FIELDS: tuple[str, ...] = ("item_name_raw", "amount_thb", "plan")
_FUZZY_THRESHOLD = 88.0
_HEADER_SEARCH_ROWS = 12
_MIN_HEADER_TEXT_CELLS = 2


def _map_header_row(row: tuple) -> dict[str, int]:
    """map เซลล์ header หนึ่งแถว → `{canonical_field: col_idx}` แบบ greedy (คะแนนสูงสุดก่อน)

    เมื่อสองคอลัมน์ผูกคะแนนกันสำหรับ field เดียวกัน (พบจริงใน `ทน. เชียงใหม่` sheet `ชีต1`:
    `REF_PDF_Page` กับ `REF_DOC_Page` แมตช์ `source_page` ได้คะแนนเท่ากันทั้งคู่ แต่ `REF_PDF_Page`
    ว่างทั้งไฟล์ ส่วน `REF_DOC_Page` มีค่าจริง) ต้อง tie-break ด้วย**ลำดับ synonym** ใน
    `_CANONICAL_SYNONYMS` (ตัวที่เขียนไว้ก่อนในทูเพิลถือว่า "ตรง"/สำคัญกว่า — `ref_doc_page` มาก่อน
    `ref_pdf_page` โดยตั้งใจ) ไม่ใช่แค่ลำดับคอลัมน์ในชีต
    """
    candidates: list[tuple[float, int, int, str]] = []
    for col_idx, cell in enumerate(row):
        if not isinstance(cell, str):
            continue
        text = clean(cell).strip().lower()
        if not text:
            continue
        for field_name, synonyms in _CANONICAL_SYNONYMS.items():
            scored = [(fuzz.WRatio(text, syn.lower()), rank) for rank, syn in enumerate(synonyms)]
            best_score, best_rank = max(scored, key=lambda t: (t[0], -t[1]))
            if best_score >= _FUZZY_THRESHOLD:
                candidates.append((best_score, best_rank, col_idx, field_name))
    # เรียง: คะแนนมากก่อน → synonym rank น้อยก่อน (synonym ที่เขียนไว้ก่อน = สำคัญกว่า) →
    # col_idx น้อยก่อน (เสถียร/deterministic เมื่อยังเสมอกันหมด)
    candidates.sort(key=lambda t: (-t[0], t[1], t[2]))
    mapping: dict[str, int] = {}
    used_cols: set[int] = set()
    used_fields: set[str] = set()
    for _score, _rank, col_idx, field_name in candidates:
        if col_idx in used_cols or field_name in used_fields:
            continue
        mapping[field_name] = col_idx
        used_cols.add(col_idx)
        used_fields.add(field_name)
    return mapping


@dataclass
class HeaderDetectResult:
    header_row_idx: int  # 0-based index ใน list ของแถวที่สแกน
    mapping: dict[str, int]


def detect_generic_header(rows: list[tuple]) -> HeaderDetectResult | None:
    """สแกน `rows[:_HEADER_SEARCH_ROWS]` หาแถว header ที่ map ได้ครบ 3 ฟิลด์หลัก (item/amount/plan)

    คืน `None` ถ้าไม่พบ (สั่ง skip sheet ทั้ง sheet ตาม 03 §4.3)
    """
    for idx, row in enumerate(rows[:_HEADER_SEARCH_ROWS]):
        if row is None:
            continue
        n_text_cells = sum(1 for cell in row if isinstance(cell, str) and clean(cell).strip())
        if n_text_cells < _MIN_HEADER_TEXT_CELLS:
            continue
        mapping = _map_header_row(row)
        if all(f in mapping for f in _CORE_FIELDS):
            return HeaderDetectResult(header_row_idx=idx, mapping=mapping)
    return None


_SHEET_YEAR_TOKEN_RE = re.compile(r"(?:งบ|ปี)\s*(\d{2,4})")


def sheet_targets_fiscal_year_2570(sheet_name: str) -> bool:
    """`False` ถ้าชื่อ sheet มี token ปีงบที่ชัดเจนว่าไม่ใช่ 2570 (เช่น `โครงการรวม งบ 69`)

    ไม่มี token ปีเลย → ถือว่าเข้าเกณฑ์ (default ของ dataset นี้คือ 2570 อยู่แล้ว)
    """
    for raw in _SHEET_YEAR_TOKEN_RE.findall(clean(sheet_name)):
        year = int(raw)
        if year in (70, 2570):
            continue
        return False
    return True


# ---------------------------------------------------------------------------
# amount outlier flag (03 §4.3 ราชาเทวะ — ใช้กับทุกไฟล์เพื่อความสม่ำเสมอของ QC)
# ---------------------------------------------------------------------------

AMOUNT_OUTLIER_ABS_BAHT_THRESHOLD = 100


def flag_amount_outliers(records: list[dict]) -> None:
    """เติม flag `amount_outlier` ใน `record["quality_flags"]` ตรงตำแหน่ง — แก้ list in-place

    กฎ: `amount_thb < 100` บาท (ยืนยันจากตัวอย่างจริงเดียวใน 02 §A4: ราชาเทวะ sheet
    `แผนงานงบกลาง` "เงินสมทบกองทุนประกันสังคม" amount=2) ไม่แก้ค่า `amount_thb` เอง

    **แก้ 19 ก.ย. 2569 (รอบตรวจซ้ำ)**: โค้ดเดิมมี z-score ต่อกลุ่ม `expense_category` เพิ่มเข้ามา
    ด้วย แต่ raja plan sheet ส่วนใหญ่มี `expense_category`/`sub_category` เป็น `None` ทั้งชีต
    (เช่น `แผนงานงบกลาง`) ทำให้รายการที่ไม่เกี่ยวข้องกันเลย (เงินสมทบประกันสังคมหลักหมื่น ปนกับ
    เบี้ยยังชีพผู้สูงอายุหลักสิบล้าน) ถูกจัดกลุ่มสถิติเดียวกัน แล้ว z-score เกิน threshold จนแฟล็ก
    ยอดที่ถูกต้องจริง (พิสูจน์แล้ว: `เบี้ยยังขีพผู้สูงอายุ` 48,000,000 บาท ถูกแฟล็กผิดเป็น
    `amount_outlier` และถูกตัดออกจาก `check_v3_raja` จนทำให้ V3 fail ทั้งที่ข้อมูลถูก) — ตัด
    z-score ออก เหลือเฉพาะเกณฑ์ absolute threshold ที่มีตัวอย่างจริงยืนยันเท่านั้น
    """
    for rec in records:
        amount = rec.get("amount_thb")
        if amount is not None and amount < AMOUNT_OUTLIER_ABS_BAHT_THRESHOLD:
            flags = rec["quality_flags"]
            if "amount_outlier" not in flags:
                flags.append("amount_outlier")


# ---------------------------------------------------------------------------
# common helpers
# ---------------------------------------------------------------------------


def _clean_or_none(value: object) -> str | None:
    if value is None:
        return None
    text = clean(str(value))
    return text or None


def _nfc_or_none(value: object) -> str | None:
    if value is None:
        return None
    text = nfc_only(str(value))
    return text or None


def _float_or_none(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = clean(str(value)).strip().replace(",", "")
    if not text or text == "-":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _int_or_none(value: object) -> int | None:
    f = _float_or_none(value)
    return int(round(f)) if f is not None else None


_PAGE_FRACTION_RE = re.compile(r"^\s*(\d+)\s*/\s*\d+\s*$")


def _page_or_none(value: object) -> int | None:
    """`source_page` — รองรับเลขหน้าธรรมดา **และ** รูปแบบ `"N/M"` (หน้า/จำนวนหน้ารวม) ที่พบจริง
    ใน `ทน. เชียงใหม่` sheet `ชีต1` คอลัมน์ `REF_DOC_Page` (เช่น `"2/88"` → หน้า 2)
    """
    if isinstance(value, str):
        m = _PAGE_FRACTION_RE.match(value)
        if m:
            return int(m.group(1))
    return _int_or_none(value)


def _row_is_blank(row: tuple) -> bool:
    return row is None or all(v is None for v in row)


def _base_record(
    *,
    rel_path: str,
    sheet_name: str,
    excel_row: int,
    source_doc_id: str,
    province: str | None,
    local_gov_name: str | None,
) -> dict:
    return {
        "source_id": compute_source_id(DATASET, rel_path, sheet_name, excel_row),
        "dataset": DATASET,
        "fiscal_year_be": FISCAL_YEAR_BE,
        "fiscal_year_ce": FISCAL_YEAR_CE,
        "gov_level": GOV_LEVEL,
        "province": province,
        "local_gov_name": local_gov_name,
        "plan": None,
        "output_project": None,
        "activity": None,
        "budget_type": None,
        "expense_category": None,
        "item_name_raw": None,
        "item_qty": None,
        "unit_price_thb": None,
        "amount_thb": None,
        "agency": None,
        "description": None,
        "legal_reference": None,
        "amount_unit_source": AMOUNT_UNIT_SOURCE,
        "source_path": rel_path,
        "source_sheet": sheet_name,
        "source_row": excel_row,
        "source_page": None,
        "source_doc_id": source_doc_id,
        "quality_flags": [],
    }


# ---------------------------------------------------------------------------
# ราชาเทวะ — mapper เฉพาะ (03 §4.3, 02 §A4)
# ---------------------------------------------------------------------------

RAJA_HEADER: tuple[str, ...] = (
    "page",
    "plan",
    "work",
    "budget_group",
    "expense_category",
    "sub_category",
    "item",
    "amount",
    "department",
    "description",
    "legal_reference",
)
RAJA_EXCLUDE_EXACT = frozenset({"ocr_raw_data"})
RAJA_EXCLUDE_PREFIXES: tuple[str, ...] = ("pivot_", "summary_")
RAJA_ONLY_FLAG = "upstream_ocr"


def _is_raja_style_workbook(sheet_names: list[str]) -> bool:
    return "ocr_raw_data" in sheet_names or any(s.startswith("summary_") for s in sheet_names)


def extract_raja_plan_sheet(
    ws,
    sheet_name: str,
    rel_path: str,
    source_doc_id: str,
    province: str | None,
    local_gov_name: str | None,
) -> tuple[list[dict], str | None]:
    """คืน `(records, skip_reason)` — `skip_reason` ไม่ใช่ `None` ถ้า header ไม่ตรง"""
    rows_iter = ws.iter_rows(values_only=True)
    try:
        header = next(rows_iter)
    except StopIteration:
        return [], "sheet ว่าง (ไม่มี header)"

    if tuple(header[: len(RAJA_HEADER)]) != RAJA_HEADER:
        return [], f"header ไม่ตรง RAJA_HEADER: {header!r}"

    records: list[dict] = []
    excel_row = 1
    for row in rows_iter:
        excel_row += 1
        if _row_is_blank(row):
            continue
        item_name_raw = _nfc_or_none(row[6])
        if item_name_raw is None:
            continue

        record = _base_record(
            rel_path=rel_path,
            sheet_name=sheet_name,
            excel_row=excel_row,
            source_doc_id=source_doc_id,
            province=province,
            local_gov_name=local_gov_name,
        )
        expense_category = _clean_or_none(row[4])
        sub_category = _clean_or_none(row[5])
        if expense_category and sub_category:
            expense_category = f"{expense_category} / {sub_category}"
        elif sub_category:
            expense_category = sub_category

        record.update(
            {
                "source_page": _page_or_none(row[0]),
                "plan": _clean_or_none(row[1]),
                "activity": _clean_or_none(row[2]),
                "budget_type": _clean_or_none(row[3]),
                "expense_category": expense_category,
                "item_name_raw": item_name_raw,
                "amount_thb": money.parse_baht(row[7]),
                "agency": _clean_or_none(row[8]),
                "description": _clean_or_none(row[9]),
                "legal_reference": _clean_or_none(row[10]),
                "quality_flags": [RAJA_ONLY_FLAG],
            }
        )
        records.append(record)
    return records, None


def extract_raja_summary_oracle(ws) -> dict[tuple[str | None, str | None, str | None], float]:
    """`summary_ocr_raw_data` → `{(plan, work, budget_group): total_amount}` (บาท, sum ถ้าซ้ำ)"""
    rows_iter = ws.iter_rows(values_only=True)
    header = next(rows_iter, None)
    if header is None:
        return {}
    oracle: dict[tuple[str | None, str | None, str | None], float] = defaultdict(float)
    for row in rows_iter:
        if _row_is_blank(row) or len(row) < 5:
            continue
        key = (_clean_or_none(row[1]), _clean_or_none(row[2]), _clean_or_none(row[3]))
        if key == (None, None, None):
            continue
        value = _float_or_none(row[4])
        if value is not None:
            oracle[key] += value
    return dict(oracle)


@dataclass
class V3GroupDiff:
    key: tuple[str | None, str | None, str | None]
    computed_baht: int
    oracle_baht: float | None
    diff: float | None


@dataclass
class V3Result:
    passed: bool
    n_groups_checked: int
    n_outlier_rows_excluded: int
    diffs: list[V3GroupDiff] = field(default_factory=list)


def check_v3_raja(records: list[dict], oracle: dict[tuple, float]) -> V3Result:
    """V3 (03 §6): ผลรวมต่อ (plan, work=activity, budget_group=budget_type) = `summary_ocr_raw_data`

    ยกเว้นแถวที่ติด flag `amount_outlier` (รายงานจำนวนที่ยกเว้นไว้ ไม่รวมในผลรวม)
    """
    sums: dict[tuple, int] = defaultdict(int)
    n_excluded = 0
    for rec in records:
        if "amount_outlier" in rec["quality_flags"]:
            n_excluded += 1
            continue
        key = (rec["plan"], rec["activity"], rec["budget_type"])
        sums[key] += rec["amount_thb"] or 0

    all_keys = set(sums) | set(oracle)
    diffs: list[V3GroupDiff] = []
    passed = True
    for key in sorted(all_keys, key=lambda k: tuple(x or "" for x in k)):
        computed = sums.get(key, 0)
        oracle_val = oracle.get(key)
        diff = None if oracle_val is None else computed - oracle_val
        tolerance = max(1.0, 0.0001 * abs(oracle_val)) if oracle_val is not None else None
        group_ok = oracle_val is not None and diff is not None and abs(diff) <= tolerance
        if not group_ok:
            passed = False
            diffs.append(
                V3GroupDiff(key=key, computed_baht=computed, oracle_baht=oracle_val, diff=diff)
            )

    return V3Result(
        passed=passed,
        n_groups_checked=len(all_keys),
        n_outlier_rows_excluded=n_excluded,
        diffs=diffs,
    )


# ---------------------------------------------------------------------------
# อบจ. เชียงใหม่ sheet "Data" — mapper เฉพาะ (03 §4.3, 02 §A4)
# ---------------------------------------------------------------------------

_CNX_PCAO_REQUIRED_HEADERS = frozenset({"Budgetary_Plan", "Budgetary_TYPE", "amount"})


def _is_cnx_pcao_data_sheet(sheet_name: str, header: tuple) -> bool:
    if sheet_name != "Data":
        return False
    header_texts = {str(h).strip() for h in header if isinstance(h, str)}
    return _CNX_PCAO_REQUIRED_HEADERS.issubset(header_texts)


def extract_cnx_pcao_data_sheet(
    ws,
    sheet_name: str,
    rel_path: str,
    source_doc_id: str,
    province: str | None,
    local_gov_name: str | None,
) -> list[dict]:
    """`REF_DOC_Page,Divison,Budgetary_Plan,Budgetary_USER,Budgetary_TYPE,Budgetary_TYPE2,
    Pre Project,Project ,number,amount,Division,FCY` (02 §A4) — `Divison` เป็น typo ว่างเสมอใน
    ไฟล์จริง, ใช้ `Division` เป็นหลัก; `FCY` ยืนยันแล้วว่า**ไม่ใช่ปีงบ** (เป็นข้อความอธิบาย) →
    map เข้า `description`
    """
    rows_iter = ws.iter_rows(values_only=True)
    header = next(rows_iter)
    idx = {str(h).strip(): i for i, h in enumerate(header) if isinstance(h, str) and h.strip()}

    def cell(row: tuple, name: str) -> object:
        i = idx.get(name)
        return row[i] if i is not None and i < len(row) else None

    records: list[dict] = []
    excel_row = 1
    for row in rows_iter:
        excel_row += 1
        if _row_is_blank(row):
            continue
        item_name_raw = _nfc_or_none(cell(row, "Project "))
        if item_name_raw is None:
            item_name_raw = _nfc_or_none(cell(row, "Project"))
        if item_name_raw is None:
            continue

        agency = _clean_or_none(cell(row, "Division"))
        agency_flags: list[str] = []
        if agency is None:
            divison_fallback = _clean_or_none(cell(row, "Divison"))
            if divison_fallback is not None:
                agency = divison_fallback
                agency_flags.append("agency_from_divison_typo_column")

        record = _base_record(
            rel_path=rel_path,
            sheet_name=sheet_name,
            excel_row=excel_row,
            source_doc_id=source_doc_id,
            province=province,
            local_gov_name=local_gov_name,
        )
        record.update(
            {
                "source_page": _page_or_none(cell(row, "REF_DOC_Page")),
                "plan": _clean_or_none(cell(row, "Budgetary_Plan")),
                "activity": _clean_or_none(cell(row, "Budgetary_USER")),
                "budget_type": _clean_or_none(cell(row, "Budgetary_TYPE")),
                "expense_category": _clean_or_none(cell(row, "Budgetary_TYPE2")),
                "output_project": _clean_or_none(cell(row, "Pre Project")),
                "item_name_raw": item_name_raw,
                "item_qty": _float_or_none(cell(row, "number")),
                "amount_thb": money.parse_baht(cell(row, "amount")),
                "agency": agency,
                "description": _clean_or_none(cell(row, "FCY")),
                "quality_flags": agency_flags,
            }
        )
        records.append(record)
    return records


# ---------------------------------------------------------------------------
# generic mapper — extraction จาก mapping ที่ detect ได้
# ---------------------------------------------------------------------------


def extract_generic_sheet(
    ws,
    sheet_name: str,
    rel_path: str,
    source_doc_id: str,
    province: str | None,
    local_gov_name: str | None,
    header: HeaderDetectResult,
) -> list[dict]:
    rows_iter = ws.iter_rows(values_only=True)
    for _ in range(header.header_row_idx + 1):
        next(rows_iter)

    mapping = header.mapping

    def cell(row: tuple, field_name: str) -> object:
        i = mapping.get(field_name)
        return row[i] if i is not None and i < len(row) else None

    records: list[dict] = []
    excel_row = header.header_row_idx + 1
    for row in rows_iter:
        excel_row += 1
        if _row_is_blank(row):
            continue
        item_name_raw = _nfc_or_none(cell(row, "item_name_raw"))
        if item_name_raw is None:
            continue
        amount_thb = money.parse_baht(cell(row, "amount_thb"))

        record = _base_record(
            rel_path=rel_path,
            sheet_name=sheet_name,
            excel_row=excel_row,
            source_doc_id=source_doc_id,
            province=province,
            local_gov_name=local_gov_name,
        )
        record.update(
            {
                "source_page": _page_or_none(cell(row, "source_page")),
                "plan": _clean_or_none(cell(row, "plan")),
                "activity": _clean_or_none(cell(row, "activity")),
                "budget_type": _clean_or_none(cell(row, "budget_type")),
                "expense_category": _clean_or_none(cell(row, "expense_category")),
                "output_project": _clean_or_none(cell(row, "output_project")),
                "item_name_raw": item_name_raw,
                "item_qty": _float_or_none(cell(row, "item_qty")),
                "unit_price_thb": money.parse_baht(cell(row, "unit_price_thb")),
                "amount_thb": amount_thb,
                "agency": _clean_or_none(cell(row, "agency")),
                "description": _clean_or_none(cell(row, "description")),
                "legal_reference": _clean_or_none(cell(row, "legal_reference")),
                "quality_flags": ["generic_mapper"],
            }
        )
        records.append(record)
    return records


# ---------------------------------------------------------------------------
# per-file orchestration
# ---------------------------------------------------------------------------


@dataclass
class SheetSkip:
    sheet_name: str
    reason: str


@dataclass
class LocalFileResult:
    file_path: Path
    rel_path: str
    source_doc_id: str
    province: str | None
    local_gov_name: str | None
    sheets_used: list[str]
    sheets_skipped: list[SheetSkip]
    rows_written: int
    total_amount_thb: int
    flag_counts: Counter
    cache_path: Path
    cache_bytes: int
    v3: V3Result | None
    paired_pdf_doc_ids: list[str]


@dataclass
class ExtractReport:
    results: list[LocalFileResult]
    pdf_pairs_path: Path | None
    total_files: int
    total_rows: int


def _pyarrow_schema() -> pa.Schema:
    return pa.schema(
        [
            pa.field("source_id", pa.string()),
            pa.field("dataset", pa.string()),
            pa.field("fiscal_year_be", pa.int32()),
            pa.field("fiscal_year_ce", pa.int32()),
            pa.field("gov_level", pa.string()),
            pa.field("province", pa.string()),
            pa.field("local_gov_name", pa.string()),
            pa.field("plan", pa.string()),
            pa.field("output_project", pa.string()),
            pa.field("activity", pa.string()),
            pa.field("budget_type", pa.string()),
            pa.field("expense_category", pa.string()),
            pa.field("item_name_raw", pa.string()),
            pa.field("item_qty", pa.float64()),
            pa.field("unit_price_thb", pa.int64()),
            pa.field("amount_thb", pa.int64()),
            pa.field("agency", pa.string()),
            pa.field("description", pa.string()),
            pa.field("legal_reference", pa.string()),
            pa.field("amount_unit_source", pa.string()),
            pa.field("source_path", pa.string()),
            pa.field("source_sheet", pa.string()),
            pa.field("source_row", pa.int32()),
            pa.field("source_page", pa.int32()),
            pa.field("source_doc_id", pa.string()),
            pa.field("quality_flags", pa.list_(pa.string())),
        ]
    )


def _write_parquet(records: list[dict], cache_path: Path) -> int:
    table = pa.Table.from_pylist(records, schema=_pyarrow_schema())
    pq.write_table(table, str(cache_path), compression="zstd")
    return cache_path.stat().st_size


def _local_dir(cfg: PipelineConfig, cache_dir: Path | None) -> Path:
    base = cache_dir if cache_dir is not None else cfg.cache_dir
    return cfg.assert_writable_path(base / "local")


def _write_pdf_pairs(cfg: PipelineConfig, local_dir: Path, pairs: dict[str, dict]) -> Path:
    path = cfg.assert_writable_path(local_dir / "pdf_pairs.json")
    path.write_text(
        json.dumps(pairs, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
        newline="\n",
    )
    return path


def extract_one_file(
    cfg: PipelineConfig,
    file_path: Path,
    local_dir: Path,
) -> LocalFileResult:
    rel_path = file_path.relative_to(cfg.raw_data_dir).as_posix()
    source_doc_id = doc_id_for_path(rel_path)
    province, local_gov_name = derive_province_and_local_gov(rel_path)

    wb = openpyxl.load_workbook(str(file_path), read_only=True, data_only=True)
    try:
        sheet_names = wb.sheetnames
        is_raja = _is_raja_style_workbook(sheet_names)

        all_records: list[dict] = []
        sheets_used: list[str] = []
        sheets_skipped: list[SheetSkip] = []
        raja_summary_oracle: dict | None = None

        for sheet_name in sheet_names:
            ws = wb[sheet_name]

            if is_raja:
                if sheet_name in RAJA_EXCLUDE_EXACT:
                    sheets_skipped.append(SheetSkip(sheet_name, "raja: ไม่ใช้ (ocr_raw_data ดิบรวม)"))
                    continue
                if sheet_name.startswith(RAJA_EXCLUDE_PREFIXES):
                    if sheet_name.startswith("summary_"):
                        raja_summary_oracle = extract_raja_summary_oracle(ws)
                        sheets_skipped.append(
                            SheetSkip(sheet_name, "raja: ใช้เป็น oracle (ไม่ใช่แถวข้อมูล)")
                        )
                    else:
                        sheets_skipped.append(
                            SheetSkip(sheet_name, "raja: pivot ตรวจสอบของต้นทาง ไม่ใช่ข้อมูล")
                        )
                    continue
                records, skip_reason = extract_raja_plan_sheet(
                    ws, sheet_name, rel_path, source_doc_id, province, local_gov_name
                )
                if skip_reason is not None:
                    sheets_skipped.append(SheetSkip(sheet_name, skip_reason))
                    continue
                flag_amount_outliers(records)
                all_records.extend(records)
                sheets_used.append(sheet_name)
                continue

            # ไม่ใช่ไฟล์สไตล์ราชาเทวะ — ตรวจ CNX PCAO "Data" sheet ก่อน แล้วค่อย generic
            header_row = next(ws.iter_rows(values_only=True), None)
            if header_row is not None and _is_cnx_pcao_data_sheet(sheet_name, header_row):
                records = extract_cnx_pcao_data_sheet(
                    ws, sheet_name, rel_path, source_doc_id, province, local_gov_name
                )
                flag_amount_outliers(records)
                all_records.extend(records)
                sheets_used.append(sheet_name)
                continue

            if not sheet_targets_fiscal_year_2570(sheet_name):
                sheets_skipped.append(
                    SheetSkip(sheet_name, "generic: ชื่อ sheet ระบุปีงบอื่น (ไม่ใช่ 2570)")
                )
                continue

            rows = list(ws.iter_rows(values_only=True, max_row=_HEADER_SEARCH_ROWS))
            header_detect = detect_generic_header(rows)
            if header_detect is None:
                sheets_skipped.append(
                    SheetSkip(sheet_name, "generic: map ไม่ได้ >= 3 ฟิลด์หลัก (item/amount/plan)")
                )
                continue

            records = extract_generic_sheet(
                ws, sheet_name, rel_path, source_doc_id, province, local_gov_name, header_detect
            )
            flag_amount_outliers(records)
            all_records.extend(records)
            sheets_used.append(sheet_name)
    finally:
        wb.close()

    v3: V3Result | None = None
    if is_raja and raja_summary_oracle is not None:
        v3 = check_v3_raja(all_records, raja_summary_oracle)

    flag_counts: Counter = Counter()
    for rec in all_records:
        flag_counts.update(rec["quality_flags"])

    province_slug = slugify_ascii(province) if province else "unknown-province"
    gov_slug = slugify_ascii(local_gov_name) if local_gov_name else slugify_ascii(rel_path)
    cache_path = local_dir / f"{province_slug}__{gov_slug}.parquet"
    cache_bytes = _write_parquet(all_records, cache_path)

    paired_pdfs = find_paired_pdfs(file_path, cfg)
    paired_pdf_doc_ids = [
        doc_id_for_path(p.relative_to(cfg.raw_data_dir).as_posix()) for p in paired_pdfs
    ]

    return LocalFileResult(
        file_path=file_path,
        rel_path=rel_path,
        source_doc_id=source_doc_id,
        province=province,
        local_gov_name=local_gov_name,
        sheets_used=sheets_used,
        sheets_skipped=sheets_skipped,
        rows_written=len(all_records),
        total_amount_thb=sum(r["amount_thb"] or 0 for r in all_records),
        flag_counts=flag_counts,
        cache_path=cache_path,
        cache_bytes=cache_bytes,
        v3=v3,
        paired_pdf_doc_ids=paired_pdf_doc_ids,
    )


def extract_local_sheets(
    cfg: PipelineConfig,
    *,
    cache_dir: Path | None = None,
    files: list[Path] | None = None,
) -> ExtractReport:
    """extract ไฟล์ A4 ทั้งหมด (`files=None` → `discover_local_files(cfg)`) → `.cache/local/*.parquet`

    `cache_dir` override ได้ (สำหรับ test — ต้องไม่แตะ `pipeline/.cache` จริง)
    """
    target_files = files if files is not None else discover_local_files(cfg)
    local_dir = _local_dir(cfg, cache_dir)
    local_dir.mkdir(parents=True, exist_ok=True)

    results: list[LocalFileResult] = []
    pdf_pairs: dict[str, dict] = {}
    for file_path in target_files:
        result = extract_one_file(cfg, file_path, local_dir)
        results.append(result)
        if result.paired_pdf_doc_ids:
            paired_pdfs = find_paired_pdfs(file_path, cfg)
            pdf_pairs[result.source_doc_id] = {
                "xlsx_rel_path": result.rel_path,
                "pdf_doc_ids": result.paired_pdf_doc_ids,
                "pdf_rel_paths": [p.relative_to(cfg.raw_data_dir).as_posix() for p in paired_pdfs],
            }

    pdf_pairs_path: Path | None = None
    if pdf_pairs:
        pdf_pairs_path = _write_pdf_pairs(cfg, local_dir, pdf_pairs)

    return ExtractReport(
        results=results,
        pdf_pairs_path=pdf_pairs_path,
        total_files=len(results),
        total_rows=sum(r.rows_written for r in results),
    )
