"""T-109: `extract/pdf_text.py` — PUA mapping, garbled detection, resume/timeout, batch behaviour

ห้ามพึ่งไฟล์ raw จริง (สร้าง fixture PDF เล็ก ๆ ในเทสต์เอง ผ่าน `tests/pdf_fixtures.py`) และ
ห้ามแตะ `pipeline/.cache` จริง — ทุก output ลง `tmp_path`
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path

import pytest
import yaml

from tests.pdf_fixtures import _build_pdf, make_corrupt_pdf, make_pdf_no_text
from tgbp_pipeline.config import PipelineConfig
from tgbp_pipeline.extract.pdf_text import (
    GARBLED_RATIO_THRESHOLD,
    PUA_TO_THAI,
    PdfExtractResult,
    _classify_chars,
    extract_pdf_text,
    map_thai_pua,
    select_pdf_targets,
)
from tgbp_pipeline.normalize.schema import SourceDoc
from tgbp_pipeline.util.hash import doc_id_for_path, sha1_file

# ---------------------------------------------------------------------------
# fixture helpers
# ---------------------------------------------------------------------------


def _make_pdf_pages(texts: list[str | bytes | None]) -> bytes:
    """PDF หลายหน้า แต่ละหน้ามีเนื้อหาต่างกัน (`None` = หน้าไม่มี text เลย)

    `texts` เป็น `bytes` ได้ตรง ๆ (ใช้ทดสอบ garbled: byte ที่ decode ผ่าน StandardEncoding
    เริ่มเป็นสัญลักษณ์นอกชุดไทย/ละติน) หรือ `str` (จะ encode เป็น latin-1)
    """
    n = len(texts)
    page_obj_start = 3
    content_obj_start = page_obj_start + n
    font_obj_num = content_obj_start + n

    page_refs = " ".join(f"{page_obj_start + i} 0 R" for i in range(n))
    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{page_refs}] /Count {n} >>".encode(),
    ]
    for i in range(n):
        content_num = content_obj_start + i
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 {font_obj_num} 0 R >> >>"
                f" /MediaBox [0 0 200 200] /Contents {content_num} 0 R >>"
            ).encode()
        )
    for text in texts:
        if text is None:
            stream = b""
        else:
            raw_bytes = text if isinstance(text, bytes) else text.encode("latin-1", errors="ignore")
            stream = b"BT /F1 12 Tf 10 100 Td (" + raw_bytes + b") Tj ET"
        content_obj = f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream"
        objects.append(content_obj)
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    return _build_pdf(objects)


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


def _write_pdf_and_source_doc(
    cfg: PipelineConfig,
    rel_path: str,
    pdf_bytes: bytes,
    *,
    pages: int,
    has_text_layer: bool = True,
    duplicates: list[str] | None = None,
) -> SourceDoc:
    abs_path = cfg.raw_data_dir / rel_path
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(pdf_bytes)
    doc_id = doc_id_for_path(rel_path)
    return SourceDoc(
        doc_id=doc_id,
        rel_path=rel_path,
        kind="pdf",
        bytes=len(pdf_bytes),
        sha1=sha1_file(str(abs_path)),
        pages=pages,
        has_text_layer=has_text_layer,
        extracted=has_text_layer,
        title_guess=Path(rel_path).stem,
        collection="committee",
        fiscal_years=[],
        duplicates=duplicates,
    )


def _write_sources_json(cfg: PipelineConfig, docs: list[SourceDoc]) -> None:
    out_path = cfg.output_dir / "sources.json"
    out_path.write_text(
        json.dumps([d.model_dump(mode="json") for d in docs], ensure_ascii=False),
        encoding="utf-8",
    )


def _read_chunks_gz(path: Path) -> list[dict]:
    with gzip.open(path, "rb") as gz:
        return json.loads(gz.read().decode("utf-8"))


# ---------------------------------------------------------------------------
# PUA mapping (unit — ทุก codepoint U+F700-U+F71A)
# ---------------------------------------------------------------------------


def test_pua_table_covers_every_codepoint_in_range() -> None:
    expected = set(range(0xF700, 0xF71A + 1))
    assert set(PUA_TO_THAI.keys()) == expected


@pytest.mark.parametrize("codepoint", sorted(range(0xF700, 0xF71A + 1)))
def test_map_thai_pua_translates_every_codepoint(codepoint: int) -> None:
    target = PUA_TO_THAI[codepoint]
    mapped = map_thai_pua(chr(codepoint))
    assert mapped == chr(target)
    # ผลลัพธ์ต้องเป็นอักษรไทยมาตรฐาน (U+0E01-U+0E4F ครอบคลุมพยัญชนะ/สระ/วรรณยุกต์ที่ตารางนี้ใช้)
    assert 0x0E01 <= target <= 0x0E4F


def test_map_thai_pua_leaves_normal_text_untouched() -> None:
    text = "งบประมาณจังหวัดเชียงใหม่ 2570 (ABC 123)"
    assert map_thai_pua(text) == text


def test_map_thai_pua_fixes_real_word_example() -> None:
    # "ที่" พิมพ์ผิดเป็น PUA sara i ซ้าย (0xF701 -> ิ ปกติ) ในฟอนต์ UPC เก่า
    garbled = "ท" + chr(0xF701) + "่"
    assert map_thai_pua(garbled) == "ทิ่"


# ---------------------------------------------------------------------------
# garbled ratio classification (unit)
# ---------------------------------------------------------------------------


def test_classify_chars_thai_and_latin_are_allowed() -> None:
    total, bad = _classify_chars("งบประมาณ 2570 ABC-123 (บาท)")
    assert total > 0
    assert bad == 0


def test_classify_chars_replacement_char_counts_as_bad() -> None:
    total, bad = _classify_chars("งบ�ประมาณ")
    assert bad == 1
    assert total == 9


def test_classify_chars_symbol_glyphs_count_as_bad() -> None:
    total, bad = _classify_chars("†‡•…»«ˆ˜¯˘")
    assert bad == total


# ---------------------------------------------------------------------------
# select_pdf_targets
# ---------------------------------------------------------------------------


def test_select_pdf_targets_filters_text_layer_size_and_duplicates() -> None:
    docs = [
        SourceDoc(
            doc_id="d_1",
            rel_path="a.pdf",
            kind="pdf",
            bytes=1000,
            sha1="s1",
            has_text_layer=True,
            collection="committee",
            duplicates=["a_copy.pdf"],
        ),
        SourceDoc(
            doc_id="d_2",
            rel_path="a_copy.pdf",
            kind="pdf",
            bytes=1000,
            sha1="s1",
            has_text_layer=True,
            collection="committee",
        ),
        SourceDoc(
            doc_id="d_3",
            rel_path="scanned.pdf",
            kind="pdf",
            bytes=1000,
            sha1="s2",
            has_text_layer=False,
            collection="committee",
        ),
        SourceDoc(
            doc_id="d_4",
            rel_path="huge.pdf",
            kind="pdf",
            bytes=200 * 1024 * 1024,
            sha1="s3",
            has_text_layer=True,
            collection="committee",
        ),
        SourceDoc(
            doc_id="d_5",
            rel_path="b.xlsx",
            kind="xlsx",
            bytes=1000,
            sha1="s4",
            has_text_layer=None,
            collection="committee",
        ),
    ]
    targets = select_pdf_targets(docs)
    assert [d.rel_path for d in targets] == ["a.pdf"]


def test_select_pdf_targets_only_doc_ids_filter() -> None:
    docs = [
        SourceDoc(
            doc_id="d_1",
            rel_path="a.pdf",
            kind="pdf",
            bytes=1000,
            sha1="s1",
            has_text_layer=True,
            collection="committee",
        ),
        SourceDoc(
            doc_id="d_2",
            rel_path="b.pdf",
            kind="pdf",
            bytes=1000,
            sha1="s2",
            has_text_layer=True,
            collection="committee",
        ),
    ]
    targets = select_pdf_targets(docs, only_doc_ids={"d_2"})
    assert [d.rel_path for d in targets] == ["b.pdf"]


# ---------------------------------------------------------------------------
# end-to-end: extract_pdf_text (in-process, max_workers=1)
# ---------------------------------------------------------------------------


def test_extract_page_with_and_without_text(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)

    pdf_bytes = _make_pdf_pages(["Hello page one", None, "Hello page three"])
    doc = _write_pdf_and_source_doc(cfg, "mixed.pdf", pdf_bytes, pages=3)
    _write_sources_json(cfg, [doc])

    report = extract_pdf_text(cfg, max_workers=1)
    assert len(report.results) == 1
    row = report.results[0]
    assert row.status == "ok"
    assert row.pages == 3
    assert row.pages_with_text == 2
    assert row.pages_without_text == 1
    assert row.chunks >= 2

    out_path = cfg.cache_dir / "docs" / f"{doc.doc_id}.json.gz"
    assert out_path.is_file()
    chunks = _read_chunks_gz(out_path)
    pages_present = {c["page"] for c in chunks}
    assert pages_present == {1, 3}


def test_extract_no_text_pdf_produces_all_pages_without_text(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)

    pdf_bytes = make_pdf_no_text(n_pages=2)
    doc = _write_pdf_and_source_doc(cfg, "blank.pdf", pdf_bytes, pages=2)
    _write_sources_json(cfg, [doc])

    report = extract_pdf_text(cfg, max_workers=1)
    row = report.results[0]
    assert row.status == "ok"
    assert row.pages_without_text == 2
    assert row.chunks == 0
    out_path = cfg.cache_dir / "docs" / f"{doc.doc_id}.json.gz"
    assert out_path.is_file()
    assert _read_chunks_gz(out_path) == []


def test_extract_garbled_text_not_written(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)

    # byte เหล่านี้ผ่าน StandardEncoding ของ Helvetica decode เป็นสัญลักษณ์เดี่ยวนอกชุดไทย/ละติน
    # เสมอ (ไม่ตกไป fallback "(cid:NNN)" ที่ดันมีแต่ ASCII) — ยืนยันด้วยสคริปต์สำรวจก่อนใช้จริง
    garbled_bytes = bytes(
        [
            161,
            162,
            163,
            164,
            165,
            166,
            167,
            168,
            170,
            171,
            172,
            173,
            177,
            178,
            179,
            180,
            182,
            183,
            184,
            185,
            186,
            187,
            188,
            189,
            191,
            194,
            195,
            196,
            197,
            198,
            199,
            200,
            202,
            203,
            205,
            206,
            207,
            208,
            225,
            227,
            232,
            233,
            234,
            235,
            241,
            245,
            248,
            249,
            250,
            251,
        ]
    )
    pdf_bytes = _make_pdf_pages([garbled_bytes])
    doc = _write_pdf_and_source_doc(cfg, "garbled.pdf", pdf_bytes, pages=1)
    _write_sources_json(cfg, [doc])

    report = extract_pdf_text(cfg, max_workers=1)
    row = report.results[0]
    assert row.status == "text_layer_garbled"
    assert row.garbled_ratio > GARBLED_RATIO_THRESHOLD
    assert row.chunks == 0
    out_path = cfg.cache_dir / "docs" / f"{doc.doc_id}.json.gz"
    assert not out_path.exists()


def test_extract_is_deterministic_across_runs(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)

    pdf_bytes = _make_pdf_pages(["Hello world one", "Hello world two"])
    doc = _write_pdf_and_source_doc(cfg, "det.pdf", pdf_bytes, pages=2)
    _write_sources_json(cfg, [doc])

    extract_pdf_text(cfg, max_workers=1)
    out_path = cfg.cache_dir / "docs" / f"{doc.doc_id}.json.gz"
    first_bytes = out_path.read_bytes()

    # ลบ index/report แล้วรันใหม่ทั้งหมด (ไม่ resume) ต้องได้ byte เดิมเป๊ะ
    (cfg.cache_dir / "docs" / "_pdf_index.json").unlink()
    (cfg.cache_dir / "docs" / "_pdf_report.json").unlink()
    extract_pdf_text(cfg, max_workers=1)
    second_bytes = out_path.read_bytes()

    assert first_bytes == second_bytes


def test_extract_resume_skips_unchanged_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)

    pdf_bytes = _make_pdf_pages(["Hello world one"])
    doc = _write_pdf_and_source_doc(cfg, "resume.pdf", pdf_bytes, pages=1)
    _write_sources_json(cfg, [doc])

    report1 = extract_pdf_text(cfg, max_workers=1)
    assert report1.results[0].status == "ok"

    calls = []
    import tgbp_pipeline.extract.pdf_text as pdf_text_mod

    original = pdf_text_mod._process_one_pdf

    def _spy(*args, **kwargs):
        calls.append(args)
        return original(*args, **kwargs)

    monkeypatch.setattr(pdf_text_mod, "_process_one_pdf", _spy)

    report2 = extract_pdf_text(cfg, max_workers=1)
    assert calls == []  # ไม่ประมวลผลซ้ำเพราะ sha1 เดิม
    assert report2.results[0].status == "ok"
    assert report2.results[0].rel_path == "resume.pdf"


def test_extract_only_doc_ids_limits_batch(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)

    doc_a = _write_pdf_and_source_doc(cfg, "a.pdf", _make_pdf_pages(["Hello A"]), pages=1)
    doc_b = _write_pdf_and_source_doc(cfg, "b.pdf", _make_pdf_pages(["Hello B"]), pages=1)
    _write_sources_json(cfg, [doc_a, doc_b])

    report = extract_pdf_text(cfg, max_workers=1, only_doc_ids={doc_a.doc_id})
    assert [r.rel_path for r in report.results] == ["a.pdf"]


def test_extract_duplicate_secondary_is_skipped(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)

    pdf_bytes = _make_pdf_pages(["Hello dup"])
    primary = _write_pdf_and_source_doc(
        cfg, "primary.pdf", pdf_bytes, pages=1, duplicates=["secondary.pdf"]
    )
    # secondary ไฟล์จริงก็มีอยู่ (สำเนาเหมือนกัน) แต่ต้องไม่ถูกประมวลผล
    secondary_abs = cfg.raw_data_dir / "secondary.pdf"
    secondary_abs.write_bytes(pdf_bytes)
    secondary = SourceDoc(
        doc_id=doc_id_for_path("secondary.pdf"),
        rel_path="secondary.pdf",
        kind="pdf",
        bytes=len(pdf_bytes),
        sha1=sha1_file(str(secondary_abs)),
        has_text_layer=True,
        collection="committee",
    )
    _write_sources_json(cfg, [primary, secondary])

    report = extract_pdf_text(cfg, max_workers=1)
    assert [r.rel_path for r in report.results] == ["primary.pdf"]


def test_extract_one_failed_file_does_not_fail_batch(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)

    good_doc = _write_pdf_and_source_doc(cfg, "good.pdf", _make_pdf_pages(["Hello good"]), pages=1)
    # ประกาศว่ามี text layer (จริงตาม inventory) แต่ไฟล์จริงพังตอน extract (เช่นเสียหายหลัง probe)
    corrupt_abs = cfg.raw_data_dir / "corrupt.pdf"
    corrupt_abs.write_bytes(make_corrupt_pdf())
    corrupt_doc = SourceDoc(
        doc_id=doc_id_for_path("corrupt.pdf"),
        rel_path="corrupt.pdf",
        kind="pdf",
        bytes=corrupt_abs.stat().st_size,
        sha1=sha1_file(str(corrupt_abs)),
        pages=1,
        has_text_layer=True,
        collection="committee",
    )
    _write_sources_json(cfg, [good_doc, corrupt_doc])

    report = extract_pdf_text(cfg, max_workers=1)
    by_path = {r.rel_path: r for r in report.results}
    assert by_path["good.pdf"].status == "ok"
    assert by_path["corrupt.pdf"].status == "failed"
    assert by_path["corrupt.pdf"].error


def test_extract_timeout_writes_partial(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)

    pdf_bytes = _make_pdf_pages(["Hello one", "Hello two", "Hello three"])
    doc = _write_pdf_and_source_doc(cfg, "slow.pdf", pdf_bytes, pages=3)
    _write_sources_json(cfg, [doc])

    report = extract_pdf_text(cfg, max_workers=1, timeout_seconds=-1.0)
    row = report.results[0]
    assert row.status == "partial_timeout"
    assert row.pages_with_text < 3

    out_path = cfg.cache_dir / "docs" / f"{doc.doc_id}.json.gz"
    assert out_path.is_file()


def test_extract_report_and_index_files_written(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)

    doc = _write_pdf_and_source_doc(cfg, "one.pdf", _make_pdf_pages(["Hello world"]), pages=1)
    _write_sources_json(cfg, [doc])

    extract_pdf_text(cfg, max_workers=1)

    report_path = cfg.cache_dir / "docs" / "_pdf_report.json"
    index_path = cfg.cache_dir / "docs" / "_pdf_index.json"
    assert report_path.is_file()
    assert index_path.is_file()

    report_rows = json.loads(report_path.read_text(encoding="utf-8"))
    assert report_rows[0]["doc_id"] == doc.doc_id
    index_data = json.loads(index_path.read_text(encoding="utf-8"))
    assert index_data[doc.doc_id]["sha1"] == doc.sha1


def test_extract_raises_without_sources_json(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)
    with pytest.raises(FileNotFoundError):
        extract_pdf_text(cfg, max_workers=1)


def test_pdf_extract_result_is_dataclass_with_expected_fields() -> None:
    row = PdfExtractResult(
        doc_id="d_1",
        rel_path="a.pdf",
        pages=1,
        pages_with_text=1,
        pages_without_text=0,
        chunks=1,
        tables=0,
        chars=10,
        garbled_ratio=0.0,
        seconds=0.1,
        status="ok",
        out_bytes=100,
    )
    assert row.error is None
