"""T-108: `extract/office_text.py` — docx/pptx → `DocChunk` (03 §3.3, §4.5)

ห้ามพึ่งไฟล์ raw จริง (สร้าง fixture docx/pptx เล็ก ๆ ในเทสต์เอง, เขียน output ลง `tmp_path`
เท่านั้น ห้ามแตะ `pipeline/.cache` จริง) ยกเว้นเทสต์ที่ mark `@pytest.mark.rawdata`

หมายเหตุ: `DocChunk`/`Atom`/`chunk_atoms`/`write_doc_chunks_gz` เป็น API สาธารณะที่
`extract/committee_xlsx.py` (T-108) และ `extract/pdf_text.py` (T-109) import ใช้ร่วมกัน —
ห้ามเปลี่ยน signature ในไฟล์นี้
"""

from __future__ import annotations

import gzip
import hashlib
from pathlib import Path

import docx
import pytest
from pptx import Presentation
from pptx.util import Inches

from tgbp_pipeline.config import PipelineConfig
from tgbp_pipeline.extract.office_text import (
    Atom,
    chunk_atoms,
    discover_office_files,
    extract_docx_file,
    extract_office_file,
    extract_office_text,
    extract_pptx_file,
    read_doc_chunks_gz,
    write_doc_chunks_gz,
)

# ---------------------------------------------------------------------------
# chunk_atoms
# ---------------------------------------------------------------------------


def test_chunk_atoms_groups_short_lines_into_one_chunk() -> None:
    atoms = [Atom(line="บรรทัดที่ 1"), Atom(line="บรรทัดที่ 2"), Atom(line="บรรทัดที่ 3")]
    chunks = chunk_atoms(atoms, limit=1200)
    assert len(chunks) == 1
    text, tables = chunks[0]
    assert text == "บรรทัดที่ 1\nบรรทัดที่ 2\nบรรทัดที่ 3"
    assert tables == []


def test_chunk_atoms_never_splits_a_single_atom_even_if_over_limit() -> None:
    long_line = "ก" * 50
    atoms = [Atom(line="สั้น"), Atom(line=long_line)]
    chunks = chunk_atoms(atoms, limit=10)
    # atom แรกเกิน limit ไปแล้วตอน flush ก่อน atom ยาว — ทั้งคู่ไม่ถูกตัดกลาง
    joined = "".join(text for text, _ in chunks)
    assert "สั้น" in joined
    assert long_line in joined
    for text, _tables in chunks:
        # แต่ละ atom ต้องอยู่ครบใน chunk เดียว ไม่ถูกตัดครึ่ง
        assert "สั้น" == text or long_line in text


def test_chunk_atoms_splits_into_new_chunk_when_limit_exceeded() -> None:
    atoms = [Atom(line="a" * 700), Atom(line="b" * 700)]
    chunks = chunk_atoms(atoms, limit=1200)
    assert len(chunks) == 2
    assert chunks[0][0] == "a" * 700
    assert chunks[1][0] == "b" * 700


def test_chunk_atoms_groups_table_rows_of_same_table_into_one_table() -> None:
    key = object()
    atoms = [
        Atom(line="หัวตาราง", table_row=["รายการ", "จำนวนเงิน"], table_key=key),
        Atom(line="แถว 1", table_row=["ค่าใช้จ่าย A", "1000"], table_key=key),
        Atom(line="แถว 2", table_row=["ค่าใช้จ่าย B", "2000"], table_key=key),
    ]
    chunks = chunk_atoms(atoms, limit=1200)
    assert len(chunks) == 1
    _text, tables = chunks[0]
    assert len(tables) == 1
    assert tables[0]["rows"] == [
        ["รายการ", "จำนวนเงิน"],
        ["ค่าใช้จ่าย A", "1000"],
        ["ค่าใช้จ่าย B", "2000"],
    ]


def test_chunk_atoms_new_table_key_starts_new_table_dict() -> None:
    key_a, key_b = object(), object()
    atoms = [
        Atom(line="A1", table_row=["A1"], table_key=key_a),
        Atom(line="B1", table_row=["B1"], table_key=key_b),
    ]
    chunks = chunk_atoms(atoms, limit=1200)
    assert len(chunks) == 1
    _text, tables = chunks[0]
    assert len(tables) == 2
    assert tables[0]["rows"] == [["A1"]]
    assert tables[1]["rows"] == [["B1"]]


def test_chunk_atoms_empty_input_returns_empty_list() -> None:
    assert chunk_atoms([]) == []


# ---------------------------------------------------------------------------
# write_doc_chunks_gz / read_doc_chunks_gz — deterministic gzip (mtime=0)
# ---------------------------------------------------------------------------


def test_write_doc_chunks_gz_roundtrip(tmp_path: Path) -> None:
    chunks = [
        {"doc_id": "d_test", "page": None, "chunk_no": 0, "text": "สวัสดี", "tables": []},
    ]
    out_path = tmp_path / "d_test.json.gz"
    write_doc_chunks_gz(out_path, chunks)
    assert read_doc_chunks_gz(out_path) == chunks


def test_write_doc_chunks_gz_is_byte_identical_across_runs(tmp_path: Path) -> None:
    chunks = [
        {"doc_id": "d_test", "page": 1, "chunk_no": 0, "text": "เนื้อหาเดิมทุกครั้ง", "tables": []},
    ]
    path1 = tmp_path / "run1.json.gz"
    path2 = tmp_path / "run2.json.gz"
    write_doc_chunks_gz(path1, chunks)
    write_doc_chunks_gz(path2, chunks)
    assert path1.read_bytes() == path2.read_bytes()
    assert (
        hashlib.sha256(path1.read_bytes()).hexdigest()
        == hashlib.sha256(path2.read_bytes()).hexdigest()
    )


def test_write_doc_chunks_gz_uses_mtime_zero(tmp_path: Path) -> None:
    path = tmp_path / "out.json.gz"
    write_doc_chunks_gz(
        path, [{"doc_id": "d", "page": None, "chunk_no": 0, "text": "x", "tables": []}]
    )
    with gzip.open(path, "rb") as gz:
        gz.read()  # gzip lazily parses the header — mtime ว่างจนกว่าจะอ่านจริง
        assert gz.mtime == 0


# ---------------------------------------------------------------------------
# docx extraction
# ---------------------------------------------------------------------------


def _write_docx(path: Path) -> None:
    document = docx.Document()
    document.add_paragraph("งบกลาง รายการที่อยู่ในความรับผิดชอบของกรมบัญชีกลาง")
    document.add_paragraph("รายละเอียดคำของบประมาณรายจ่ายประจำปีงบประมาณ พ.ศ. 2570")
    table = document.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "รายการ"
    table.cell(0, 1).text = "วงเงินงบประมาณที่ขอรับจัดสรร"
    table.cell(1, 0).text = "ค่าใช้จ่ายชดใช้เงินทดรองราชการ"
    table.cell(1, 1).text = "6,000.00"
    document.save(path)


def test_extract_docx_file_reads_paragraphs_and_table_in_order(tmp_path: Path) -> None:
    path = tmp_path / "งบกลาง.docx"
    _write_docx(path)

    chunks = extract_docx_file("d_docx1", path)

    assert len(chunks) == 1  # เนื้อหาสั้น รวมเป็น chunk เดียว
    chunk = chunks[0]
    assert chunk["doc_id"] == "d_docx1"
    assert chunk["page"] is None  # docx ไม่มีเลขหน้าเสมอ
    assert chunk["chunk_no"] == 0
    assert "งบกลาง รายการที่อยู่ในความรับผิดชอบของกรมบัญชีกลาง" in chunk["text"]
    assert "ค่าใช้จ่ายชดใช้เงินทดรองราชการ" in chunk["text"]
    # ย่อหน้าต้องมาก่อนตารางในข้อความ (ตามลำดับจริงในเอกสาร)
    assert chunk["text"].index("งบกลาง") < chunk["text"].index("รายการ")

    assert len(chunk["tables"]) == 1
    assert chunk["tables"][0]["rows"] == [
        ["รายการ", "วงเงินงบประมาณที่ขอรับจัดสรร"],
        ["ค่าใช้จ่ายชดใช้เงินทดรองราชการ", "6,000.00"],
    ]


def test_extract_docx_file_skips_blank_paragraphs_and_rows(tmp_path: Path) -> None:
    path = tmp_path / "blank.docx"
    document = docx.Document()
    document.add_paragraph("")
    document.add_paragraph("   ")
    document.add_paragraph("เนื้อหาเดียวที่ไม่ว่าง")
    document.save(path)

    chunks = extract_docx_file("d_docx2", path)
    assert len(chunks) == 1
    assert chunks[0]["text"] == "เนื้อหาเดียวที่ไม่ว่าง"


def test_extract_docx_file_empty_document_produces_no_chunks(tmp_path: Path) -> None:
    path = tmp_path / "empty.docx"
    docx.Document().save(path)
    assert extract_docx_file("d_empty", path) == []


# ---------------------------------------------------------------------------
# pptx extraction
# ---------------------------------------------------------------------------


def _write_pptx(path: Path) -> None:
    prs = Presentation()
    blank_layout = prs.slide_layouts[6]

    slide1 = prs.slides.add_slide(blank_layout)
    box1 = slide1.shapes.add_textbox(Inches(1), Inches(1), Inches(5), Inches(1))
    box1.text_frame.text = "องค์การบริหารส่วนจังหวัดพิจิตร\nสรุปแผนงานงบประมาณ"
    slide1.notes_slide.notes_text_frame.text = "หมายเหตุสำหรับผู้บรรยาย"

    table_shape = slide1.shapes.add_table(2, 2, Inches(1), Inches(3), Inches(4), Inches(1))
    table = table_shape.table
    table.cell(0, 0).text = "โครงการ"
    table.cell(0, 1).text = "งบประมาณ"
    table.cell(1, 0).text = "ฝายน้ำล้น"
    table.cell(1, 1).text = "500,000"

    prs.slides.add_slide(blank_layout)  # slide 2: ว่างสนิท ไม่มีข้อความ/ตาราง/notes
    prs.save(path)


def test_extract_pptx_file_page_is_slide_number_and_skips_empty_slides(tmp_path: Path) -> None:
    path = tmp_path / "แผนงบ.pptx"
    _write_pptx(path)

    chunks = extract_pptx_file("d_pptx1", path)

    pages = {c["page"] for c in chunks}
    assert pages == {1}  # สไลด์ 2 ว่างสนิท → ไม่มี chunk เลย (ไม่ใช่ page=2 chunk ว่าง)
    assert all(c["doc_id"] == "d_pptx1" for c in chunks)

    joined_text = "\n".join(c["text"] for c in chunks)
    assert "องค์การบริหารส่วนจังหวัดพิจิตร" in joined_text
    assert "[notes] หมายเหตุสำหรับผู้บรรยาย" in joined_text

    all_tables = [t for c in chunks for t in c["tables"]]
    assert any(t["rows"] == [["โครงการ", "งบประมาณ"], ["ฝายน้ำล้น", "500,000"]] for t in all_tables)


def test_extract_pptx_file_no_slides_produces_no_chunks(tmp_path: Path) -> None:
    path = tmp_path / "empty.pptx"
    Presentation().save(path)
    assert extract_pptx_file("d_empty_pptx", path) == []


# ---------------------------------------------------------------------------
# discover_office_files / extract_office_file / extract_office_text
# ---------------------------------------------------------------------------


def test_discover_office_files_finds_docx_and_pptx_sorted(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    sub_a = raw_dir / "a"
    sub_b = raw_dir / "b"
    sub_a.mkdir(parents=True)
    sub_b.mkdir(parents=True)

    _write_docx(sub_b / "z.docx")
    _write_pptx(sub_a / "a.pptx")
    (raw_dir / "ignore.xlsx").write_bytes(b"not office text")

    class _Cfg:
        raw_data_dir = raw_dir

    found = discover_office_files(_Cfg())
    rels = [p.relative_to(raw_dir).as_posix() for p in found]
    assert rels == ["a/a.pptx", "b/z.docx"]


def test_extract_office_file_writes_cache_and_returns_result(tmp_path: Path) -> None:
    pipeline_dir = tmp_path / "pipeline"
    pipeline_dir.mkdir()
    raw_dir = tmp_path / "raw"
    committee_dir = raw_dir / "กมธ.ติดตามงบ" / "หน่วยงาน"
    committee_dir.mkdir(parents=True)
    doc_path = committee_dir / "4.งบกลาง.docx"
    _write_docx(doc_path)

    import yaml

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
    cfg = PipelineConfig.load(config_path)
    cache_dir = tmp_path / "docs_out"

    result = extract_office_file(cfg, doc_path, cache_dir=cache_dir)

    assert result.error is None
    assert result.kind == "docx"
    assert result.n_chunks == 1
    assert result.cache_path == cache_dir / f"{result.doc_id}.json.gz"
    assert result.cache_path.is_file()

    chunks = read_doc_chunks_gz(result.cache_path)
    assert len(chunks) == 1
    assert chunks[0]["doc_id"] == result.doc_id


def test_extract_office_text_processes_all_files_under_raw_dir(tmp_path: Path) -> None:
    pipeline_dir = tmp_path / "pipeline"
    pipeline_dir.mkdir()
    raw_dir = tmp_path / "raw"
    d1 = raw_dir / "d1"
    d1.mkdir(parents=True)
    _write_docx(d1 / "a.docx")
    _write_pptx(d1 / "b.pptx")

    import yaml

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
    cfg = PipelineConfig.load(config_path)
    cache_dir = tmp_path / "docs_out"

    summary = extract_office_text(cfg, cache_dir=cache_dir)
    kinds = {r.kind for r in summary.results}
    assert kinds == {"docx", "pptx"}
    assert all(r.error is None for r in summary.results)
    assert all(r.cache_path.is_file() for r in summary.results)


def test_extract_office_file_handles_corrupt_file_without_raising(tmp_path: Path) -> None:
    pipeline_dir = tmp_path / "pipeline"
    pipeline_dir.mkdir()
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    bad_path = raw_dir / "corrupt.docx"
    bad_path.write_bytes(b"not a real docx file at all")

    import yaml

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
    cfg = PipelineConfig.load(config_path)
    cache_dir = tmp_path / "docs_out"

    result = extract_office_file(cfg, bad_path, cache_dir=cache_dir)
    assert result.error is not None
    assert result.n_chunks == 0
    assert not (cache_dir / f"{result.doc_id}.json.gz").exists()


@pytest.mark.rawdata
def test_rawdata_extract_real_committee_docx_and_pptx(tmp_path: Path) -> None:
    """T-108 close-out: docx/pptx จริงใน `กมธ.ติดตามงบ` ต้อง extract ได้ไม่ error

    เขียน output ไป `tmp_path` เท่านั้น — ห้ามแตะ `pipeline/.cache` จริง
    """
    real_cfg = PipelineConfig.load()
    files = discover_office_files(real_cfg)
    if not files:
        pytest.skip("ไม่มีโฟลเดอร์ข้อมูลดิบจริงบนเครื่องนี้ (หรือไม่มีไฟล์ docx/pptx)")

    cache_dir = tmp_path / "docs_out"
    summary = extract_office_text(real_cfg, cache_dir=cache_dir)
    assert all(r.error is None for r in summary.results)
    assert all(r.cache_path.is_relative_to(tmp_path) for r in summary.results)
