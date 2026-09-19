"""T-101: เดินโฟลเดอร์ raw data ทั้งหมด → `sources.json` (03-DATA-PIPELINE.md §3.2)

ขั้นตอนหลัก (`scan_raw_dir`):
1. เดิน `raw_data_dir` ทั้งหมด (`os.walk`, ทุกไฟล์ รวม `.DS_Store` ถ้ามี)
2. คำนวณ `doc_id` (hash ของ path), `sha1` (hash ของเนื้อไฟล์ stream), `kind` (นามสกุล/magic bytes)
3. parse metadata จากชื่อโฟลเดอร์/ไฟล์ (collection, meeting_no, meeting_date, topic,
   agency_guess, province, level/gov_level, fiscal_years, title_guess) — 02 §C
4. PDF: นับหน้า + ตรวจ text layer 3 หน้าแรกด้วย pypdf (fallback pdfplumber) — ไม่ OCR (N4)
5. หา sha1 ซ้ำ → ทำเครื่องหมาย `duplicates` บนตัวหลัก (ตัวแรกตามลำดับตัวอักษรของ rel_path)

`rel_path` เก็บตามจริงเสมอ (ห้าม transliterate/แก้ U+200B) — normalize เป็นแค่สำเนาชั่วคราว
ตอน parse metadata เท่านั้น (`_normalize_for_parse`)
"""

from __future__ import annotations

import json
import re
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from tgbp_pipeline.config import PipelineConfig
from tgbp_pipeline.normalize.schema import Collection, GovLevel, Kind, SourceDoc
from tgbp_pipeline.normalize.thai_text import clean as clean_thai
from tgbp_pipeline.util.hash import doc_id_for_path, sha1_file

PDF_PROBE_PAGES = 3
PDF_HAS_TEXT_LAYER_CHARS_PER_PAGE = 200
PDF_PROBE_TIMEOUT_SECONDS = 60
PDF_LOW_CONFIDENCE_CHARS_PER_PAGE = 50  # ต่ำกว่านี้ลอง fallback pdfplumber ด้วย

CACHE_FILENAME = "inventory_probe.json"

_KNOWN_EXTENSIONS: dict[str, Kind] = {
    ".pdf": "pdf",
    ".xlsx": "xlsx",
    ".xls": "xls",
    ".docx": "docx",
    ".pptx": "pptx",
    ".jpg": "jpg",
    ".jpeg": "jpg",
}

# ชื่อโฟลเดอร์ราก → collection (03 §3.2); ตรวจแล้วว่า raw root มีแค่ 5 โฟลเดอร์นี้ (02 บรรทัด 4)
_ROOT_FOLDER_TO_COLLECTION: dict[str, Collection] = {
    "PBO": "pbo",
    "OPEN SSO": "open_sso",
    "กมธ.ติดตามงบ": "committee",
}
_PROVINCE_ROOT_PREFIX = "งบประมาณ"

_THAI_MONTHS: dict[str, int] = {
    "มกราคม": 1,
    "มค": 1,
    "กุมภาพันธ์": 2,
    "กพ": 2,
    "มีนาคม": 3,
    "มีค": 3,
    "เมษายน": 4,
    "เมย": 4,
    "พฤษภาคม": 5,
    "พค": 5,
    "มิถุนายน": 6,
    "มิย": 6,
    "กรกฎาคม": 7,
    "กค": 7,
    "สิงหาคม": 8,
    "สค": 8,
    "กันยายน": 9,
    "กย": 9,
    "ตุลาคม": 10,
    "ตค": 10,
    "พฤศจิกายน": 11,
    "พย": 11,
    "ธันวาคม": 12,
    "ธค": 12,
}

_MEETING_FOLDER_RE = re.compile(r"ครั้งที่\s*(\d+)\s*\(\s*([^)]*)\s*\)")
_MEETING_DATE_INNER_RE = re.compile(r"(\d{1,2})\s*([^\d]+?)\s*(\d{4})\s*$")
_PROVINCE_LEVEL_FOLDER_RE = re.compile(r"^(\d+)\s*-\s*(.+)$")

# ปีงบประมาณ 4 หลักแบบ พ.ศ. (ขอบเขตกว้างพอดักช่วง 2550-2599 กัน false positive จากเลขอื่น)
_FISCAL_YEAR_4_DIGIT_RE = re.compile(r"25\d{2}")
_FISCAL_YEAR_RANGE_RE = re.compile(r"(25\d{2})\s*[-–]\s*(25\d{2})")
# ปีงบประมาณ 2 หลักที่ชัดเจนจาก keyword นำหน้า เช่น "งบ 70", "ของบฯ 70", "ปี 69", "พ.ศ. 70"
_FISCAL_YEAR_2_DIGIT_RE = re.compile(
    r"(?:ปีงบประมาณ|ปีงบ|ของบประมาณ|ของบฯ|ของบ|งบประมาณ|งบฯ|งบ|พ\.ศ\.?|ปี)[\s.:]{0,4}(\d{2})(?!\d)"
)
_FISCAL_YEAR_MIN_BE = 2540
_FISCAL_YEAR_MAX_BE = 2600
_FISCAL_YEAR_2_DIGIT_MIN = 40
_FISCAL_YEAR_2_DIGIT_MAX = 79


@dataclass
class InventoryStats:
    total_files: int = 0
    by_kind: dict[str, int] = field(default_factory=dict)
    by_collection: dict[str, int] = field(default_factory=dict)
    by_has_text_layer: dict[str, int] = field(default_factory=dict)
    duplicate_groups: int = 0
    duplicate_files: int = 0
    pdf_probe_failures: list[str] = field(default_factory=list)
    pdf_probe_timeouts: list[str] = field(default_factory=list)
    elapsed_seconds: float = 0.0


def _normalize_for_parse(text: str) -> str:
    """สำเนา normalize (NFC + ลบ U+200B/U+FEFF + เลขไทย→อารบิก) สำหรับ regex เท่านั้น

    ห้ามใช้ผลลัพธ์นี้เป็น `rel_path`/`title_guess` ที่เก็บถาวร — ใช้ `clean_thai` ตรง ๆ
    ปลอดภัยเพราะ metadata (`meeting_no`, `topic`, ...) เป็นค่าที่ derive ไว้ให้ AI/UI อ่านง่าย
    ไม่ใช่ path อ้างอิงกลับไฟล์จริง
    """
    return clean_thai(text)


def _thai_month_to_int(text: str) -> int | None:
    key = text.strip().replace(".", "").replace(" ", "")
    return _THAI_MONTHS.get(key)


def _parse_meeting_folder(normalized_folder_name: str) -> tuple[int | None, str | None]:
    """คืน (meeting_no, meeting_date ISO พ.ศ.) จากชื่อโฟลเดอร์ `ครั้งที่ N (D MMM YYYY)`"""
    match = _MEETING_FOLDER_RE.search(normalized_folder_name)
    if not match:
        return None, None
    meeting_no = int(match.group(1))
    inner = match.group(2)
    date_match = _MEETING_DATE_INNER_RE.search(inner)
    if not date_match:
        return meeting_no, None
    day_str, month_str, year_str = date_match.groups()
    month = _thai_month_to_int(month_str)
    if month is None:
        return meeting_no, None
    try:
        day = int(day_str)
        year_be = int(year_str)
    except ValueError:
        return meeting_no, None
    return meeting_no, f"{year_be:04d}-{month:02d}-{day:02d}"


def _extract_fiscal_years(normalized_text: str) -> list[int]:
    years: set[int] = set()

    for start_str, end_str in _FISCAL_YEAR_RANGE_RE.findall(normalized_text):
        start, end = int(start_str), int(end_str)
        if start <= end and (end - start) <= 30:
            for y in range(start, end + 1):
                if _FISCAL_YEAR_MIN_BE <= y <= _FISCAL_YEAR_MAX_BE:
                    years.add(y)

    for match in _FISCAL_YEAR_4_DIGIT_RE.finditer(normalized_text):
        y = int(match.group(0))
        if _FISCAL_YEAR_MIN_BE <= y <= _FISCAL_YEAR_MAX_BE:
            years.add(y)

    for match in _FISCAL_YEAR_2_DIGIT_RE.finditer(normalized_text):
        n = int(match.group(1))
        if _FISCAL_YEAR_2_DIGIT_MIN <= n <= _FISCAL_YEAR_2_DIGIT_MAX:
            years.add(2500 + n)

    return sorted(years)


def _fiscal_year_search_text(rel_parts: list[str], collection: Collection) -> str:
    """ข้อความที่ใช้หา `fiscal_years` — ตัดปีในวงเล็บของโฟลเดอร์ประชุม กมธ. ออกก่อนเสมอ

    `กมธ.ติดตามงบ/ครั้งที่ N (วัน เดือน ปี)/...` — ปีในวงเล็บคือ **วันที่ประชุม**
    (เก็บใน `meeting_date` แล้ว) ไม่ใช่ปีงบประมาณของเอกสาร ห้ามเดาว่าเป็นปีเดียวกัน (N3)
    ถ้าไฟล์/โฟลเดอร์อื่นในเส้นทางเดียวกันระบุปีงบชัดเจน (เช่นในชื่อไฟล์) ยังคงจับได้ตามปกติ
    """
    if collection == "committee" and len(rel_parts) >= 2:
        # rel_parts[0] = "กมธ.ติดตามงบ", rel_parts[1] = โฟลเดอร์ "ครั้งที่ N (...)" ที่ต้องตัดทิ้ง
        parts = [rel_parts[0], *rel_parts[2:]]
    else:
        parts = rel_parts
    return "/".join(parts)


def _detect_magic_kind(path: Path) -> Kind:
    """ไฟล์ไม่มีนามสกุล (หรือนามสกุลแปลก) → ตรวจ magic bytes: `%PDF`→pdf, `PK`→zip-office"""
    try:
        with open(path, "rb") as f:
            head = f.read(8)
    except OSError:
        return "other"

    if head.startswith(b"%PDF"):
        return "pdf"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if head.startswith(b"PK\x03\x04") or head.startswith(b"PK\x05\x06"):
        return _sniff_zip_office_kind(path)
    return "other"


def _sniff_zip_office_kind(path: Path) -> Kind:
    """PK header เพิ่มเติม: ลองดูว่าเป็น OOXML ชนิดไหนจากชื่อไฟล์ภายใน zip"""
    try:
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
    except (zipfile.BadZipFile, OSError):
        return "zip-office"

    if any(n.startswith("xl/") for n in names):
        return "xlsx"
    if any(n.startswith("word/") for n in names):
        return "docx"
    if any(n.startswith("ppt/") for n in names):
        return "pptx"
    return "zip-office"


def _detect_kind(path: Path) -> Kind:
    ext = path.suffix.lower()
    known = _KNOWN_EXTENSIONS.get(ext)
    if known is not None:
        return known
    return _detect_magic_kind(path)


@dataclass
class _FolderMetadata:
    collection: Collection
    meeting_no: int | None = None
    meeting_date: str | None = None
    topic: str | None = None
    agency_guess: str | None = None
    province: str | None = None
    gov_level: GovLevel | None = None
    level: str | None = None


def _derive_gov_level_from_description(description: str) -> GovLevel | None:
    if "ฟังก์ชัน" in description:
        return "central"
    if any(kw in description for kw in ("อบจ", "เทศบาล", "อบต", "อปท", "ทน", "ทม")):
        return "local"
    return None


def _parse_committee_metadata(parts: list[str]) -> _FolderMetadata:
    """`กมธ.ติดตามงบ/ครั้งที่ N (วัน เดือน ปี)/<เรื่อง>/<หน่วยงาน>/ไฟล์` (02 §C)"""
    meta = _FolderMetadata(collection="committee")
    if not parts:
        return meta
    meeting_no, meeting_date = _parse_meeting_folder(_normalize_for_parse(parts[0]))
    meta.meeting_no = meeting_no
    meta.meeting_date = meeting_date

    subfolders = parts[1:]  # ทุกโฟลเดอร์ระหว่าง meeting folder กับไฟล์ (ไม่รวมชื่อไฟล์)
    if len(subfolders) >= 1:
        meta.topic = clean_thai(subfolders[0])
    if len(subfolders) >= 2:
        meta.agency_guess = clean_thai(subfolders[-1])
    return meta


def _parse_province_metadata(parts: list[str], root_folder: str) -> _FolderMetadata:
    """`งบประมาณ <จังหวัด>/<ลำดับ> - <ระดับ>/ไฟล์` (02 §C)"""
    province = clean_thai(root_folder[len(_PROVINCE_ROOT_PREFIX) :].strip())
    meta = _FolderMetadata(collection="province_budget", province=province or None)
    if not parts:
        return meta
    match = _PROVINCE_LEVEL_FOLDER_RE.match(_normalize_for_parse(parts[0]))
    if match:
        description = clean_thai(match.group(2))
        meta.level = description
        meta.gov_level = _derive_gov_level_from_description(description)
    return meta


def _parse_folder_metadata(rel_parts: list[str]) -> _FolderMetadata:
    """`rel_parts` = ทุก path segment ของ rel_path (รวมชื่อไฟล์ตัวสุดท้าย)"""
    root_folder = rel_parts[0]
    middle_parts = rel_parts[1:-1]  # ตัด root folder และชื่อไฟล์ออก

    if root_folder in _ROOT_FOLDER_TO_COLLECTION:
        collection = _ROOT_FOLDER_TO_COLLECTION[root_folder]
        if collection == "committee":
            return _parse_committee_metadata(middle_parts)
        if collection == "open_sso":
            return _FolderMetadata(collection="open_sso", agency_guess="สำนักงานประกันสังคม")
        return _FolderMetadata(collection="pbo")

    if root_folder.startswith(_PROVINCE_ROOT_PREFIX):
        return _parse_province_metadata(middle_parts, root_folder)

    # ไม่ตรง 4 collection ที่รู้จัก (ไม่ควรเกิดกับ raw data ที่ตรวจแล้ว 19 ก.ย. 2569 มีแค่ 5 โฟลเดอร์ราก)
    return _FolderMetadata(collection="committee")


def _title_guess(filename: str) -> str:
    stem = Path(filename).stem
    return clean_thai(stem)


@dataclass
class _PdfProbeResult:
    pages: int | None
    has_text_layer: bool | None
    extracted: bool
    note: str | None


def _count_non_whitespace(text: str | None) -> int:
    if not text:
        return 0
    return len(re.sub(r"\s+", "", text))


def _pypdf_probe(path: Path) -> tuple[int | None, int, int]:
    """คืน (pages, chars ที่นับได้จาก N หน้าแรก, จำนวนหน้าที่อ่านข้อความได้จริง)"""
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    reader = PdfReader(str(path), strict=False)
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception as exc:  # noqa: BLE001 — pypdf raise หลายชนิดขึ้นกับ backend
            raise PdfReadError(f"encrypted: {exc}") from exc

    pages = len(reader.pages)
    n_probe = min(PDF_PROBE_PAGES, pages)
    chars = 0
    for i in range(n_probe):
        text = reader.pages[i].extract_text()
        chars += _count_non_whitespace(text)
    return pages, chars, n_probe


def _pdfplumber_probe(path: Path) -> tuple[int | None, int, int]:
    import pdfplumber

    with pdfplumber.open(str(path)) as pdf:
        pages = len(pdf.pages)
        n_probe = min(PDF_PROBE_PAGES, pages)
        chars = 0
        for i in range(n_probe):
            text = pdf.pages[i].extract_text()
            chars += _count_non_whitespace(text)
    return pages, chars, n_probe


def _probe_pdf_inner(path: Path) -> _PdfProbeResult:
    try:
        pages, chars, n_probe = _pypdf_probe(path)
    except Exception as exc:  # noqa: BLE001 — PDF เสีย/เข้ารหัสมีหลายชนิด exception
        # fallback ไป pdfplumber ก่อนยอมแพ้ (บาง PDF pypdf เปิดไม่ได้แต่ pdfplumber เปิดได้)
        try:
            pages, chars, n_probe = _pdfplumber_probe(path)
        except Exception as exc2:  # noqa: BLE001
            note = f"PDF เปิดไม่ได้ (เสีย/เข้ารหัส): {exc} / {exc2}"
            return _PdfProbeResult(
                pages=None, has_text_layer=None, extracted=False, note=note[:300]
            )
    else:
        if n_probe > 0 and (chars / n_probe) < PDF_LOW_CONFIDENCE_CHARS_PER_PAGE:
            # ข้อความน้อยผิดปกติ (อาจว่าง/เพี้ยน) → ลอง pdfplumber เทียบ แล้วใช้ค่าที่ดีกว่า
            try:
                pages_pl, chars_pl, n_probe_pl = _pdfplumber_probe(path)
                if n_probe_pl > 0 and chars_pl > chars:
                    chars, n_probe = chars_pl, n_probe_pl
            except Exception:  # noqa: BLE001 — fallback ที่ล้มเหลวไม่เป็นไร ใช้ผล pypdf เดิม
                pass

    if n_probe == 0:
        return _PdfProbeResult(
            pages=pages, has_text_layer=None, extracted=False, note="ไม่มีหน้าให้ตรวจ (0 หน้า)"
        )

    chars_per_page = chars / n_probe
    has_text_layer = chars_per_page >= PDF_HAS_TEXT_LAYER_CHARS_PER_PAGE
    if has_text_layer:
        return _PdfProbeResult(pages=pages, has_text_layer=True, extracted=True, note=None)
    return _PdfProbeResult(
        pages=pages, has_text_layer=False, extracted=False, note="OCR out of scope"
    )


_PDF_PROBE_EXECUTOR = ThreadPoolExecutor(max_workers=1)


def _probe_pdf(path: Path) -> _PdfProbeResult:
    """ตรวจ text layer พร้อม timeout ต่อไฟล์ (ไฟล์ใหญ่/เสียบางไฟล์อาจค้าง)"""
    future = _PDF_PROBE_EXECUTOR.submit(_probe_pdf_inner, path)
    try:
        return future.result(timeout=PDF_PROBE_TIMEOUT_SECONDS)
    except FutureTimeoutError:
        return _PdfProbeResult(
            pages=None,
            has_text_layer=None,
            extracted=False,
            note=f"ข้าม: probe เกิน {PDF_PROBE_TIMEOUT_SECONDS} วินาที (ไฟล์ใหญ่/ซับซ้อน)",
        )


class _ProbeCache:
    """cache ผล probe PDF คีย์ด้วย (rel_path, bytes, mtime_ns) กันรันซ้ำช้า"""

    def __init__(self, cache_path: Path) -> None:
        self.cache_path = cache_path
        self._data: dict[str, dict[str, Any]] = {}
        self._dirty = False
        if cache_path.is_file():
            try:
                self._data = json.loads(cache_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                self._data = {}

    @staticmethod
    def _key(rel_path_posix: str, size_bytes: int, mtime_ns: int) -> str:
        return f"{rel_path_posix}|{size_bytes}|{mtime_ns}"

    def get(self, rel_path_posix: str, size_bytes: int, mtime_ns: int) -> dict[str, Any] | None:
        return self._data.get(self._key(rel_path_posix, size_bytes, mtime_ns))

    def put(
        self, rel_path_posix: str, size_bytes: int, mtime_ns: int, value: dict[str, Any]
    ) -> None:
        self._data[self._key(rel_path_posix, size_bytes, mtime_ns)] = value
        self._dirty = True

    def save(self) -> None:
        if not self._dirty:
            return
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(
            json.dumps(self._data, ensure_ascii=False, indent=None), encoding="utf-8"
        )
        self._dirty = False


def _probe_pdf_cached(path: Path, rel_path_posix: str, cache: _ProbeCache) -> _PdfProbeResult:
    stat = path.stat()
    cached = cache.get(rel_path_posix, stat.st_size, stat.st_mtime_ns)
    if cached is not None:
        return _PdfProbeResult(
            pages=cached.get("pages"),
            has_text_layer=cached.get("has_text_layer"),
            extracted=cached.get("extracted", False),
            note=cached.get("note"),
        )
    result = _probe_pdf(path)
    cache.put(
        rel_path_posix,
        stat.st_size,
        stat.st_mtime_ns,
        {
            "pages": result.pages,
            "has_text_layer": result.has_text_layer,
            "extracted": result.extracted,
            "note": result.note,
        },
    )
    return result


def _iter_raw_files(raw_data_dir: Path) -> list[Path]:
    files: list[Path] = []
    for dirpath, _dirnames, filenames in _walk(raw_data_dir):
        for name in filenames:
            files.append(Path(dirpath) / name)
    return files


def _walk(raw_data_dir: Path):
    import os

    yield from os.walk(raw_data_dir)


def build_source_doc(
    raw_data_dir: Path,
    abs_path: Path,
    cache: _ProbeCache,
    probe_pdf: bool,
) -> SourceDoc:
    # `rel_path` เก็บเป็น posix (`/`) เสมอไม่ว่ารันบน OS ไหน (03 §3.2) — ตัวอักษร/U+200B
    # ในแต่ละ path segment ยังคงตามจริงทุกตัว มีแค่ตัวคั่นโฟลเดอร์ที่ normalize
    rel_path = abs_path.relative_to(raw_data_dir).as_posix()
    rel_parts = rel_path.split("/")

    kind = _detect_kind(abs_path)
    size_bytes = abs_path.stat().st_size
    sha1 = sha1_file(str(abs_path))
    # doc_id_for_path normalize posix+NFC ภายในอยู่แล้ว — ค่าเดิมกับตอนที่ยังส่ง backslash เข้ามา
    # จึง**ไม่เปลี่ยน** (แค่ฟิลด์ rel_path ที่เก็บใน SourceDoc ที่เปลี่ยนจาก backslash เป็น posix)
    doc_id = doc_id_for_path(rel_path)

    folder_meta = _parse_folder_metadata(rel_parts)
    fiscal_year_text = _fiscal_year_search_text(rel_parts, folder_meta.collection)
    fiscal_years = _extract_fiscal_years(_normalize_for_parse(fiscal_year_text))

    pages: int | None = None
    has_text_layer: bool | None = None
    extracted = False
    note: str | None = None

    if kind == "pdf":
        if probe_pdf:
            result = _probe_pdf_cached(abs_path, rel_path, cache)
            pages, has_text_layer, extracted, note = (
                result.pages,
                result.has_text_layer,
                result.extracted,
                result.note,
            )
        else:
            note = "pdf probe skipped (--no-pdf-probe)"

    return SourceDoc(
        doc_id=doc_id,
        rel_path=rel_path,
        kind=kind,
        bytes=size_bytes,
        sha1=sha1,
        pages=pages,
        has_text_layer=has_text_layer,
        extracted=extracted,
        title_guess=_title_guess(abs_path.name),
        collection=folder_meta.collection,
        meeting_no=folder_meta.meeting_no,
        meeting_date=folder_meta.meeting_date,
        topic=folder_meta.topic,
        agency_guess=folder_meta.agency_guess,
        province=folder_meta.province,
        gov_level=folder_meta.gov_level,
        level=folder_meta.level,
        fiscal_years=fiscal_years,
        text_chunks_file=None,
        note=note,
        duplicates=None,
    )


def _apply_duplicates(docs: list[SourceDoc]) -> None:
    """หา sha1 ซ้ำ → ใส่ `duplicates` บนตัวหลัก (ตัวแรกตามลำดับตัวอักษรของ rel_path)"""
    by_sha1: dict[str, list[SourceDoc]] = {}
    for doc in docs:
        by_sha1.setdefault(doc.sha1, []).append(doc)

    for group in by_sha1.values():
        if len(group) < 2:
            continue
        group.sort(key=lambda d: d.rel_path)
        primary, *others = group
        primary.duplicates = [d.rel_path for d in others]


def scan_raw_dir(
    cfg: PipelineConfig,
    limit: int | None = None,
    probe_pdf: bool = True,
) -> tuple[list[SourceDoc], InventoryStats]:
    start = time.monotonic()
    raw_data_dir = cfg.raw_data_dir
    all_files = sorted(
        _iter_raw_files(raw_data_dir), key=lambda p: p.relative_to(raw_data_dir).as_posix()
    )
    if limit is not None:
        all_files = all_files[:limit]

    cache_path = cfg.cache_dir / CACHE_FILENAME
    cache = _ProbeCache(cache_path)

    docs: list[SourceDoc] = []
    stats = InventoryStats()

    for abs_path in all_files:
        doc = build_source_doc(raw_data_dir, abs_path, cache, probe_pdf)
        docs.append(doc)

        if doc.kind == "pdf" and probe_pdf:
            if doc.note is not None and "probe เกิน" in doc.note:
                stats.pdf_probe_timeouts.append(doc.rel_path)
            elif doc.has_text_layer is None:
                stats.pdf_probe_failures.append(doc.rel_path)

    cache.save()

    _apply_duplicates(docs)
    docs.sort(key=lambda d: d.rel_path)

    stats.total_files = len(docs)
    for doc in docs:
        stats.by_kind[doc.kind] = stats.by_kind.get(doc.kind, 0) + 1
        stats.by_collection[doc.collection] = stats.by_collection.get(doc.collection, 0) + 1
        if doc.kind == "pdf":
            # by_has_text_layer มีความหมายเฉพาะ PDF — kind อื่นมี has_text_layer=None
            # เป็นค่า default เสมอ (ไม่เกี่ยวกับ probe) นับรวมด้วยจะทำให้ตัวเลข null พองผิดจริง
            key = "null" if doc.has_text_layer is None else str(doc.has_text_layer).lower()
            stats.by_has_text_layer[key] = stats.by_has_text_layer.get(key, 0) + 1
        if doc.duplicates:
            stats.duplicate_groups += 1
            stats.duplicate_files += len(doc.duplicates)

    stats.elapsed_seconds = time.monotonic() - start
    return docs, stats


def write_sources_json(cfg: PipelineConfig, docs: list[SourceDoc]) -> Path:
    out_path = cfg.assert_writable_path(cfg.output_dir / "sources.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = [doc.model_dump(mode="json") for doc in docs]
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False),
        encoding="utf-8",
        newline="\n",
    )
    return out_path


def write_inventory_appendix(
    cfg: PipelineConfig, docs: list[SourceDoc], stats: InventoryStats
) -> Path:
    """เขียนภาคผนวกสรุปอัตโนมัติ (ห้ามแก้ `docs/02-DATA-INVENTORY.md` ตรง ๆ — N7/ขอบเขต T-101)"""
    project_root = cfg.config_path.parent.parent
    out_path = project_root / "docs" / "02-DATA-INVENTORY.appendix.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    lines: list[str] = []
    lines.append("# 02 — Appendix (สร้างอัตโนมัติโดย `tgbp inventory`)")
    lines.append("")
    lines.append(f"เวลาที่ใช้สแกน: {stats.elapsed_seconds:.1f} วินาที · ไฟล์ทั้งหมด: {stats.total_files}")
    lines.append("")
    lines.append("## นับตาม kind")
    lines.append("")
    lines.append("| kind | จำนวน |")
    lines.append("|---|---|")
    for kind, n in sorted(stats.by_kind.items()):
        lines.append(f"| {kind} | {n} |")
    lines.append("")
    lines.append("## นับตาม collection")
    lines.append("")
    lines.append("| collection | จำนวน |")
    lines.append("|---|---|")
    for collection, n in sorted(stats.by_collection.items()):
        lines.append(f"| {collection} | {n} |")
    lines.append("")
    lines.append("## PDF — has_text_layer")
    lines.append("")
    lines.append("| ค่า | จำนวน |")
    lines.append("|---|---|")
    for key, n in sorted(stats.by_has_text_layer.items()):
        lines.append(f"| {key} | {n} |")
    lines.append("")
    lines.append(
        f"## ไฟล์ซ้ำ (sha1 ซ้ำ) — {stats.duplicate_groups} กลุ่ม, {stats.duplicate_files} ไฟล์ซ้ำ"
    )
    lines.append("")
    for doc in docs:
        if doc.duplicates:
            lines.append(f"- `{doc.rel_path}` (ตัวหลัก) ซ้ำกับ:")
            for dup in doc.duplicates:
                lines.append(f"  - `{dup}`")
    lines.append("")
    lines.append(f"## probe ไม่สำเร็จ ({len(stats.pdf_probe_failures)} ไฟล์)")
    lines.append("")
    for rel_path in stats.pdf_probe_failures:
        lines.append(f"- `{rel_path}`")
    lines.append("")
    lines.append(f"## probe timeout ({len(stats.pdf_probe_timeouts)} ไฟล์)")
    lines.append("")
    for rel_path in stats.pdf_probe_timeouts:
        lines.append(f"- `{rel_path}`")
    lines.append("")
    lines.append("## PDF ที่มี text layer")
    lines.append("")
    lines.append("| rel_path | pages |")
    lines.append("|---|---|")
    for doc in docs:
        if doc.kind == "pdf" and doc.has_text_layer:
            lines.append(f"| `{doc.rel_path}` | {doc.pages} |")
    lines.append("")

    out_path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    return out_path
