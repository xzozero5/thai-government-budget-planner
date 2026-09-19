"""T-109: PDF ที่มี text layer → `DocChunk` (03-DATA-PIPELINE.md §3.3, §4.5)

Scope (ตัดสินใจแล้วโดย main thread 19 ก.ย. 2569 — ดู `docs/02-DATA-INVENTORY.md` §B):
- เป้าหมาย = PDF ที่ `sources.json` บอกว่า `has_text_layer == true` และ `bytes <= 100 MB`,
  ข้ามไฟล์ที่เป็น duplicate รอง (ใช้ตัวหลักตามฟิลด์ `duplicates` — 03 §4.2/inventory.py)
- **ไม่พยายาม map เป็น `committee_table`** แม้ตารางจะมีคอลัมน์ตัวเลข (ต่างจาก 03 §4.5 ที่เขียนไว้
  ก่อนสำรวจไฟล์จริง) — ตารางบางไฟล์ (เช่น OPEN SSO ผลเบิกจ่าย, ราคากลาง) label-row/value-row
  เหลื่อมกันหรือคำว่า "ราคากลาง" มีสองความหมายในไฟล์เดียว จึง map แบบเดายอด/หน่วยไม่ได้ (N3)
  → ปล่อยเป็น `DocChunk` + `tables` ดิบเสมอ ไม่เขียน `budget_lines`
- ใช้ `DocChunk`/`Atom`/`chunk_atoms`/`write_doc_chunks_gz` จาก `extract.office_text` เดียวกัน
  ทั้งหมด (N7 ห้ามสร้าง chunker/gzip writer ซ้ำ) — ที่นี่มีแค่ตรรกะเฉพาะ PDF (pdfplumber, PUA
  mapping, garbled detection, resume/timeout/report)

คุณภาพข้อความไทย (03 §5 ข้อ 1 + ข้อกำหนดงานนี้):
1. PDF เก่าที่ทำด้วยฟอนต์ UPC (DilleniaUPC/AngsanaNew ฯลฯ) มักฝัง ToUnicode CMap ที่ชี้ไป Private
   Use Area U+F700-U+F71A แทนสระ/วรรณยุกต์มาตรฐาน (ตำแหน่ง glyph ที่ขยับตามชนิดพยัญชนะ) — เรา
   map กลับเป็นอักษรไทยมาตรฐานด้วย **การแทนที่ระดับ string** หลัง `pdfplumber` extract แล้ว
   (ไม่แก้ไฟล์ PDF ต้นทาง ไม่ใช้ pikepdf — ไม่มีใน deps) อ้างอิงตาราง NECTEC/Microsoft WTT 2.0
   จาก `pipeline/.cache/_ref_fix_thai_pdf.py` (ไฟล์อ้างอิงชั่วคราว ไม่ใช่โค้ด production)
   ข้อจำกัดที่รู้: การแก้นี้แก้แค่ "ตัวอักษรผิด" ไม่แก้ "ลำดับ" — ฟอนต์เดิมยังใช้ zero-width glyph
   นำหน้าเพื่อเลื่อนตำแหน่งวาด สระ/วรรณยุกต์บางตัวจึงอาจสกัดออกมาก่อน/หลังพยัญชนะที่ควรอยู่ด้วย
   (เช่น `ิ` หลุดไปอยู่ก่อนพยัญชนะ) — **ไม่พยายามเดาลำดับที่ถูกต้อง** (N3/N4) รายงานเป็น data
   quality issue แทน
2. `garbled_ratio` ต่อไฟล์ = สัดส่วนอักขระที่ไม่ใช่ไทย/ละติน/ตัวเลข/วรรคตอน/whitespace (หรือเป็น
   U+FFFD) เทียบอักขระทั้งหมดที่ extract ได้ (หลัง PUA-map, ก่อน `thai_text.clean`) — เกิน 0.30
   → status `text_layer_garbled` และ**ไม่เขียน** `.json.gz` เลย (ทิ้ง chunk ที่สร้างไว้ในหน่วยความจำ)
"""

from __future__ import annotations

import json
import re
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from tgbp_pipeline.config import PipelineConfig
from tgbp_pipeline.extract.office_text import (
    DOCS_CACHE_DIRNAME,
    Atom,
    DocChunk,
    chunk_atoms,
    write_doc_chunks_gz,
)
from tgbp_pipeline.normalize.schema import SourceDoc
from tgbp_pipeline.normalize.thai_text import clean

MAX_PDF_BYTES = 100 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 600.0
GARBLED_RATIO_THRESHOLD = 0.30

PDF_INDEX_FILENAME = "_pdf_index.json"
PDF_REPORT_FILENAME = "_pdf_report.json"

# NECTEC/Microsoft WTT 2.0 PUA → Thai Unicode มาตรฐาน — ตำแหน่ง glyph ที่ขยับ (ซ้าย/ล่าง/ล่างซ้าย)
# ตามชนิดพยัญชนะ (ascending/strict-descender/removable-descender) ไม่ใช่ offset ธรรมดา
# อ้างอิง: pipeline/.cache/_ref_fix_thai_pdf.py (NECTEC/Microsoft WTT 2.0; ยืนยันครบ 27 codepoint
# U+F700-U+F71A แล้ว 19 ก.ย. 2569) — แก้แค่ "ตัวอักษร" ไม่แก้ "ลำดับ" (ดู module docstring)
PUA_TO_THAI: dict[int, int] = {
    0xF700: 0x0E10,  # ฐ THO THAN (ไม่มีหางล่าง ใช้เมื่อมีสระบน)
    0xF70F: 0x0E0D,  # ญ YO YING (ไม่มีหางล่าง ใช้เมื่อมีสระบน)
    0xF701: 0x0E34,  # ิ  SARA I เลื่อนซ้าย
    0xF702: 0x0E35,  # ี  SARA II เลื่อนซ้าย
    0xF703: 0x0E36,  # ึ  SARA UE เลื่อนซ้าย
    0xF704: 0x0E37,  # ื  SARA UEE เลื่อนซ้าย
    0xF710: 0x0E31,  # ั  MAI HAN AKAT เลื่อนซ้าย
    0xF711: 0x0E4D,  # ํ  NIKHAHIT เลื่อนซ้าย
    0xF712: 0x0E47,  # ็  MAITAIKHU เลื่อนซ้าย
    0xF705: 0x0E48,  # ่  MAI EK เลื่อนล่างซ้าย
    0xF706: 0x0E49,  # ้  MAI THO เลื่อนล่างซ้าย
    0xF707: 0x0E4A,  # ๊  MAI TRI เลื่อนล่างซ้าย
    0xF708: 0x0E4B,  # ๋  MAI CHATTAWA เลื่อนล่างซ้าย
    0xF709: 0x0E4C,  # ์  THANTHAKHAT เลื่อนล่างซ้าย
    0xF70A: 0x0E48,  # ่  MAI EK เลื่อนล่าง
    0xF70B: 0x0E49,  # ้  MAI THO เลื่อนล่าง
    0xF70C: 0x0E4A,  # ๊  MAI TRI เลื่อนล่าง
    0xF70D: 0x0E4B,  # ๋  MAI CHATTAWA เลื่อนล่าง
    0xF70E: 0x0E4C,  # ์  THANTHAKHAT เลื่อนล่าง
    0xF713: 0x0E48,  # ่  MAI EK เลื่อนซ้าย
    0xF714: 0x0E49,  # ้  MAI THO เลื่อนซ้าย
    0xF715: 0x0E4A,  # ๊  MAI TRI เลื่อนซ้าย
    0xF716: 0x0E4B,  # ๋  MAI CHATTAWA เลื่อนซ้าย
    0xF717: 0x0E4C,  # ์  THANTHAKHAT เลื่อนซ้าย
    0xF718: 0x0E38,  # ุ  SARA U เลื่อนล่าง (พยัญชนะหางลึก ฎ ฏ)
    0xF719: 0x0E39,  # ู  SARA UU เลื่อนล่าง
    0xF71A: 0x0E3A,  # ฺ  PHINTHU เลื่อนล่าง
}

_PUA_TRANSLATE_TABLE = str.maketrans({cp: chr(target) for cp, target in PUA_TO_THAI.items()})

# อักขระที่ "ไม่นับว่าเพี้ยน": ไทย (รวมเลขไทย/บาทไทย), ASCII พิมพ์ได้ (ละติน/เลข/วรรคตอน/space),
# และ whitespace อื่น ๆ (\t \n \r) — อะไรนอกชุดนี้ (รวม U+FFFD replacement char) ถือว่าเพี้ยน
_ALLOWED_CHAR_RE = re.compile(r"[฀-๿ -~\s]")


def map_thai_pua(text: str) -> str:
    """แทนที่ Thai PUA U+F700-U+F71A ด้วยอักษรไทยมาตรฐานตาม `PUA_TO_THAI`"""
    return text.translate(_PUA_TRANSLATE_TABLE)


def _classify_chars(text: str) -> tuple[int, int]:
    """คืน (จำนวนอักขระทั้งหมด, จำนวนอักขระที่อยู่นอกชุดไทย/ละติน/เลข/วรรคตอน/whitespace)"""
    total = len(text)
    bad = sum(1 for ch in text if _ALLOWED_CHAR_RE.match(ch) is None)
    return total, bad


def _clean_lines_preserving_breaks(text: str) -> list[str]:
    """`thai_text.clean` ทีละบรรทัด — เก็บการขึ้นบรรทัดไว้ (clean() เดี่ยว ๆ จะยุบ \\n เป็นช่องว่าง)

    บรรทัดที่กลายเป็นค่าว่างหลัง clean (ช่องว่างล้วน) ถูกตัดทิ้ง แถวตารางไม่ผ่านฟังก์ชันนี้
    (จัดการแยกใน `_page_table_atoms` เพื่อคง cell แยกไว้)
    """
    lines: list[str] = []
    for raw_line in text.splitlines():
        cleaned = clean(raw_line)
        if cleaned:
            lines.append(cleaned)
    return lines


def _page_table_atoms(tables: list[list[list[str | None]]]) -> list[Atom]:
    atoms: list[Atom] = []
    for table in tables:
        table_key = object()
        for row in table:
            cells = [clean(cell) if cell else "" for cell in row]
            if not any(cells):
                continue
            atoms.append(Atom(line="\t".join(cells), table_row=cells, table_key=table_key))
    return atoms


def _release_page(page: Any) -> None:
    """ปล่อย memory cache ของหน้า pdfplumber ก่อนไปหน้าถัดไป (03 งานนี้ข้อ 1)"""
    flush = getattr(page, "flush_cache", None)
    if callable(flush):
        try:
            flush()
        except Exception:  # noqa: BLE001 — flush ล้มเหลวไม่ควรทำให้ทั้งไฟล์พัง
            pass
    close = getattr(page, "close", None)
    if callable(close):
        try:
            close()
        except Exception:  # noqa: BLE001
            pass


@dataclass
class PdfExtractResult:
    """หนึ่งแถวใน `_pdf_report.json` — main thread ใช้ตอน T-110 อัปเดต `sources.json`"""

    doc_id: str
    rel_path: str
    pages: int | None
    pages_with_text: int
    pages_without_text: int
    chunks: int
    tables: int
    chars: int
    garbled_ratio: float
    seconds: float
    status: str
    out_bytes: int
    error: str | None = None


@dataclass
class ExtractReport:
    results: list[PdfExtractResult] = field(default_factory=list)


def _process_one_pdf(
    raw_data_dir: Path,
    rel_path: str,
    doc_id: str,
    docs_cache_dir: Path,
    timeout_seconds: float,
) -> PdfExtractResult:
    """ประมวลผลไฟล์ PDF เดียว → เขียน `.json.gz` (ถ้าไม่เพี้ยน) + คืนแถวรายงาน

    top-level function (picklable) เพื่อให้เรียกผ่าน `ProcessPoolExecutor` ได้บน Windows
    """
    start = time.monotonic()
    abs_path = raw_data_dir / rel_path
    out_path = docs_cache_dir / f"{doc_id}.json.gz"

    try:
        import pdfplumber

        with pdfplumber.open(str(abs_path)) as pdf:
            n_pages = len(pdf.pages)
            pages_with_text = 0
            pages_without_text = 0
            total_chars = 0
            bad_chars = 0
            tables_count = 0
            doc_chunks: list[DocChunk] = []
            timed_out = False

            for page_no, page in enumerate(pdf.pages, start=1):
                if time.monotonic() - start > timeout_seconds:
                    timed_out = True
                    break

                try:
                    raw_text = page.extract_text()
                except Exception:  # noqa: BLE001 — หน้าเสียเฉพาะจุด ไม่ทำให้ทั้งไฟล์ fail
                    raw_text = None

                if not raw_text or not raw_text.strip():
                    pages_without_text += 1
                    _release_page(page)
                    continue

                pages_with_text += 1
                mapped = map_thai_pua(raw_text)
                page_total, page_bad = _classify_chars(mapped)
                total_chars += page_total
                bad_chars += page_bad

                atoms: list[Atom] = [
                    Atom(line=line) for line in _clean_lines_preserving_breaks(mapped)
                ]

                try:
                    page_tables = page.extract_tables()
                except Exception:  # noqa: BLE001 — table detection ล้มเหลวเฉพาะหน้า ไม่ fail ทั้งไฟล์
                    page_tables = []
                if page_tables:
                    tables_count += len(page_tables)
                    atoms.extend(_page_table_atoms(page_tables))

                if atoms:
                    for chunk_no, (chunk_text, chunk_tables) in enumerate(chunk_atoms(atoms)):
                        doc_chunks.append(
                            {
                                "doc_id": doc_id,
                                "page": page_no,
                                "chunk_no": chunk_no,
                                "text": chunk_text,
                                "tables": chunk_tables,
                            }
                        )

                _release_page(page)

        garbled_ratio = (bad_chars / total_chars) if total_chars else 0.0

        if garbled_ratio > GARBLED_RATIO_THRESHOLD:
            status = "text_layer_garbled"
            out_bytes = 0
        elif timed_out:
            status = "partial_timeout"
            write_doc_chunks_gz(out_path, doc_chunks)
            out_bytes = out_path.stat().st_size
        else:
            status = "ok"
            write_doc_chunks_gz(out_path, doc_chunks)
            out_bytes = out_path.stat().st_size

        return PdfExtractResult(
            doc_id=doc_id,
            rel_path=rel_path,
            pages=n_pages,
            pages_with_text=pages_with_text,
            pages_without_text=pages_without_text,
            chunks=len(doc_chunks) if status != "text_layer_garbled" else 0,
            tables=tables_count,
            chars=total_chars,
            garbled_ratio=round(garbled_ratio, 6),
            seconds=round(time.monotonic() - start, 3),
            status=status,
            out_bytes=out_bytes,
        )
    except Exception as exc:  # noqa: BLE001 — ไฟล์เสีย/เข้ารหัส/รูปแบบแปลกมีหลายชนิด exception
        return PdfExtractResult(
            doc_id=doc_id,
            rel_path=rel_path,
            pages=None,
            pages_with_text=0,
            pages_without_text=0,
            chunks=0,
            tables=0,
            chars=0,
            garbled_ratio=0.0,
            seconds=round(time.monotonic() - start, 3),
            status="failed",
            out_bytes=0,
            error=str(exc)[:500],
        )


def _load_source_docs(cfg: PipelineConfig) -> list[SourceDoc]:
    sources_path = cfg.output_dir / "sources.json"
    if not sources_path.is_file():
        raise FileNotFoundError(f"ไม่พบ {sources_path} — รัน `tgbp inventory` ก่อน extract pdf")
    raw = json.loads(sources_path.read_text(encoding="utf-8"))
    return [SourceDoc.model_validate(item) for item in raw]


def select_pdf_targets(
    docs: list[SourceDoc], only_doc_ids: set[str] | None = None
) -> list[SourceDoc]:
    """PDF เป้าหมาย: `has_text_layer==True`, `bytes<=100MB`, ไม่ใช่ duplicate รอง (03 §4.2/T-109)"""
    secondary_duplicates: set[str] = set()
    for doc in docs:
        if doc.duplicates:
            secondary_duplicates.update(doc.duplicates)

    targets = [
        doc
        for doc in docs
        if doc.kind == "pdf"
        and doc.has_text_layer is True
        and doc.bytes <= MAX_PDF_BYTES
        and doc.rel_path not in secondary_duplicates
    ]
    if only_doc_ids is not None:
        targets = [doc for doc in targets if doc.doc_id in only_doc_ids]
    targets.sort(key=lambda d: d.rel_path)
    return targets


def _read_json_if_exists(path: Path) -> Any:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
    )


def extract_pdf_text(
    cfg: PipelineConfig,
    *,
    cache_dir: Path | None = None,
    only_doc_ids: set[str] | None = None,
    max_workers: int = 4,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> ExtractReport:
    """extract PDF ที่มี text layer ทั้งหมด → `.cache/docs/{doc_id}.json.gz` (03 §4.5)

    resume: ข้ามไฟล์ที่ `doc_id` อยู่ใน `_pdf_index.json` ด้วย sha1 เดิม (ดึงจาก `sources.json`
    ไม่ต้อง hash ไฟล์ใหญ่ซ้ำ) — คืนแถวรายงานเดิมจาก `_pdf_report.json` แทนการประมวลผลใหม่
    """
    docs_cache_dir = cache_dir if cache_dir is not None else cfg.cache_dir / DOCS_CACHE_DIRNAME
    docs_cache_dir = cfg.assert_writable_path(docs_cache_dir)
    docs_cache_dir.mkdir(parents=True, exist_ok=True)

    source_docs = _load_source_docs(cfg)
    targets = select_pdf_targets(source_docs, only_doc_ids=only_doc_ids)

    index_path = docs_cache_dir / PDF_INDEX_FILENAME
    report_path = docs_cache_dir / PDF_REPORT_FILENAME

    index: dict[str, dict[str, str]] = _read_json_if_exists(index_path) or {}
    prev_report_rows: list[dict[str, Any]] = _read_json_if_exists(report_path) or []
    prev_by_doc_id = {row["doc_id"]: row for row in prev_report_rows}

    to_process: list[SourceDoc] = []
    results: list[PdfExtractResult] = []

    for doc in targets:
        prior = index.get(doc.doc_id)
        if prior is not None and prior.get("sha1") == doc.sha1 and doc.doc_id in prev_by_doc_id:
            results.append(PdfExtractResult(**prev_by_doc_id[doc.doc_id]))
            continue
        to_process.append(doc)

    if max_workers <= 1:
        for doc in to_process:
            row = _process_one_pdf(
                cfg.raw_data_dir, doc.rel_path, doc.doc_id, docs_cache_dir, timeout_seconds
            )
            results.append(row)
            index[doc.doc_id] = {"sha1": doc.sha1, "status": row.status}
    else:
        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            future_to_doc = {
                executor.submit(
                    _process_one_pdf,
                    cfg.raw_data_dir,
                    doc.rel_path,
                    doc.doc_id,
                    docs_cache_dir,
                    timeout_seconds,
                ): doc
                for doc in to_process
            }
            for future in as_completed(future_to_doc):
                doc = future_to_doc[future]
                try:
                    row = future.result()
                except Exception as exc:  # noqa: BLE001 — worker process ล้มไม่ควรล้มทั้ง batch
                    row = PdfExtractResult(
                        doc_id=doc.doc_id,
                        rel_path=doc.rel_path,
                        pages=None,
                        pages_with_text=0,
                        pages_without_text=0,
                        chunks=0,
                        tables=0,
                        chars=0,
                        garbled_ratio=0.0,
                        seconds=0.0,
                        status="failed",
                        out_bytes=0,
                        error=str(exc)[:500],
                    )
                results.append(row)
                index[doc.doc_id] = {"sha1": doc.sha1, "status": row.status}

    results.sort(key=lambda r: r.rel_path)

    _write_json(index_path, index)
    _write_json(report_path, [asdict(r) for r in results])

    return ExtractReport(results=results)


def _main() -> None:  # pragma: no cover — invoked manually / รันจริงทั้ง batch
    from tgbp_pipeline.config import load_config

    cfg = load_config()
    report = extract_pdf_text(cfg, max_workers=4)
    by_status: dict[str, int] = {}
    for row in report.results:
        by_status[row.status] = by_status.get(row.status, 0) + 1
    print(f"ประมวลผล {len(report.results)} ไฟล์: {by_status}")


if __name__ == "__main__":  # pragma: no cover
    _main()
