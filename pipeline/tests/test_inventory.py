"""T-101: `inventory.py` — folder metadata parsing, magic bytes, duplicates, doc_id, PDF probe

ห้ามพึ่งไฟล์ raw จริง (สร้าง fixture ในเทสต์เอง) ยกเว้นเทสต์ที่ mark `@pytest.mark.rawdata`
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml
from typer.testing import CliRunner

from tests.pdf_fixtures import make_corrupt_pdf, make_pdf_no_text, make_pdf_with_text
from tgbp_pipeline.cli import app
from tgbp_pipeline.config import PipelineConfig
from tgbp_pipeline.inventory import (
    _detect_kind,
    _extract_fiscal_years,
    _fiscal_year_search_text,
    _normalize_for_parse,
    _parse_folder_metadata,
    _parse_meeting_folder,
    _probe_pdf_inner,
    _ProbeCache,
    build_source_doc,
    scan_raw_dir,
    write_inventory_appendix,
    write_sources_json,
)
from tgbp_pipeline.util.hash import doc_id_for_path

runner = CliRunner()


# ---------------------------------------------------------------------------
# folder metadata parsing
# ---------------------------------------------------------------------------


def test_parse_meeting_folder_with_zero_width_space() -> None:
    raw = "ครั้งที่​ 10 (16 ก.ค.​ 2569)"
    normalized = _normalize_for_parse(raw)
    meeting_no, meeting_date = _parse_meeting_folder(normalized)
    assert meeting_no == 10
    assert meeting_date == "2569-07-16"


def test_parse_meeting_folder_full_month_name() -> None:
    normalized = _normalize_for_parse("ครั้งที่ 2 (21 พฤษภาคม 2569)")
    meeting_no, meeting_date = _parse_meeting_folder(normalized)
    assert meeting_no == 2
    assert meeting_date == "2569-05-21"


def test_parse_meeting_folder_no_match_returns_none() -> None:
    assert _parse_meeting_folder("ไม่ใช่ชื่อการประชุม") == (None, None)


def test_parse_folder_metadata_committee_topic_and_agency() -> None:
    parts = [
        "ครั้งที่​ 4 (4 มิ.ย.​ 2569)",
        "วาระบ่าย​ (NDLP ศธ.)",
        "2_ราคากลาง21.pdf",
    ]
    meta = _parse_folder_metadata(["กมธ.ติดตามงบ", *parts])
    assert meta.collection == "committee"
    assert meta.meeting_no == 4
    assert meta.meeting_date == "2569-06-04"
    assert meta.topic == "วาระบ่าย (NDLP ศธ.)"
    assert meta.agency_guess is None  # ไม่มีโฟลเดอร์หน่วยงานแยก (แค่ topic + ไฟล์)


def test_parse_folder_metadata_committee_with_agency_subfolder() -> None:
    parts = [
        "ครั้งที่​ 11 (23 ก.ค.​ 2569)",
        "กรมทรัพยากรน้ำบาดาล",
        "สทนช.pdf",
    ]
    meta = _parse_folder_metadata(["กมธ.ติดตามงบ", *parts])
    assert meta.topic == "กรมทรัพยากรน้ำบาดาล"
    # มีแค่ 1 ระดับ subfolder ก่อนไฟล์ -> agency_guess ยังเป็น None (topic == agency ในเคสนี้)
    assert meta.agency_guess is None


def test_parse_folder_metadata_province_level_and_gov_level() -> None:
    meta = _parse_folder_metadata(
        [
            "งบประมาณ เชียงใหม่",
            "3 - งบเทศบาลนครเชียงใหม่",
            "ร่างเทศบัญญัติงบ 2570 ทน. เชียงใหม่ - Excel.xlsx",
        ]
    )
    assert meta.collection == "province_budget"
    assert meta.province == "เชียงใหม่"
    assert meta.level == "งบเทศบาลนครเชียงใหม่"
    assert meta.gov_level == "local"


def test_parse_folder_metadata_province_function_level_is_central() -> None:
    meta = _parse_folder_metadata(
        [
            "งบประมาณ สมุทรปราการ",
            "1 - งบฟังก์ชันที่มาลงในสมุทรปราการ",
            "ร่าง พ.ร.บ. งบ 2570 ฉบับเต็ม - Excel.xlsx",
        ]
    )
    assert meta.province == "สมุทรปราการ"
    assert meta.gov_level == "central"


def test_parse_folder_metadata_open_sso() -> None:
    meta = _parse_folder_metadata(["OPEN SSO", "1.1ผลเบิกจ่ายปี 2563- final.pdf"])
    assert meta.collection == "open_sso"
    assert meta.agency_guess == "สำนักงานประกันสังคม"


def test_parse_folder_metadata_pbo() -> None:
    meta = _parse_folder_metadata(["PBO", "2564.xlsx"])
    assert meta.collection == "pbo"
    assert meta.province is None


# ---------------------------------------------------------------------------
# fiscal year extraction
# ---------------------------------------------------------------------------


def test_extract_fiscal_years_four_digit() -> None:
    assert _extract_fiscal_years("ร่าง พ.ร.บ. งบ 2570 ฉบับเต็ม") == [2570]


def test_extract_fiscal_years_range() -> None:
    assert _extract_fiscal_years("1.1ผลเบิกจ่ายปี 2563-2567") == [2563, 2564, 2565, 2566, 2567]


def test_extract_fiscal_years_two_digit_with_keyword() -> None:
    assert _extract_fiscal_years("2.คำของบประมาณ พ.ศ. 70") == [2570]
    assert _extract_fiscal_years("2.1 รายละเอียดคำของบฯ 70") == [2570]


def test_extract_fiscal_years_no_false_positive_on_unrelated_numbers() -> None:
    # "500 ล้านบาทขึ้นไป" ไม่ควรถูกตีความเป็นปีงบประมาณ
    assert _extract_fiscal_years("โครงการวงเงิน 500 ล้านบาทขึ้นไป") == []


def test_extract_fiscal_years_dedupes_and_sorts() -> None:
    assert _extract_fiscal_years("2567 กับ 2567 และ 2565") == [2565, 2567]


# ---------------------------------------------------------------------------
# fiscal_years ห้ามเดาจากวันที่ประชุม กมธ. (N3) — ตัดโฟลเดอร์ "ครั้งที่ N (...)" ออกก่อนเสมอ
# ---------------------------------------------------------------------------


def test_fiscal_year_search_text_strips_committee_meeting_folder() -> None:
    rel_parts = [
        "กมธ.ติดตามงบ",
        "ครั้งที่​ 4 (4 มิ.ย.​ 2569)",
        "วาระบ่าย (NDLP ศธ.)",
        "2_ราคากลาง21.pdf",
    ]
    text = _fiscal_year_search_text(rel_parts, "committee")
    assert "2569" not in text
    assert "วาระบ่าย" in text and "ราคากลาง21" in text


def test_fiscal_year_search_text_keeps_explicit_year_in_filename() -> None:
    rel_parts = [
        "กมธ.ติดตามงบ",
        "ครั้งที่​ 3 (28 พ.ค.​ 2569)",
        "กรมวิชาการเกษตร",
        "2.คำของบประมาณ พ.ศ. 2570.xlsx",
    ]
    text = _fiscal_year_search_text(rel_parts, "committee")
    assert _extract_fiscal_years(_normalize_for_parse(text)) == [2570]


def test_fiscal_year_search_text_non_committee_untouched() -> None:
    rel_parts = ["PBO", "2564.xlsx"]
    assert _fiscal_year_search_text(rel_parts, "pbo") == "PBO/2564.xlsx"


def test_build_source_doc_committee_meeting_date_year_not_guessed_as_fiscal_year(
    tmp_path: Path,
) -> None:
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)
    committee_dir = cfg.raw_data_dir / "กมธ.ติดตามงบ" / "ครั้งที่​ 4 (4 มิ.ย.​ 2569)" / "หน่วยงาน"
    committee_dir.mkdir(parents=True)
    file_path = committee_dir / "เอกสารทั่วไป.pdf"
    file_path.write_bytes(make_pdf_no_text())

    cache = _ProbeCache(cfg.cache_dir / "inventory_probe.json")
    doc = build_source_doc(cfg.raw_data_dir, file_path, cache, probe_pdf=False)

    assert doc.meeting_date == "2569-06-04"
    assert doc.fiscal_years == []  # ปีประชุมไม่ใช่ปีงบ — ห้ามเดา


def test_build_source_doc_committee_explicit_year_in_filename_is_kept(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)
    committee_dir = cfg.raw_data_dir / "กมธ.ติดตามงบ" / "ครั้งที่​ 3 (28 พ.ค.​ 2569)" / "กรมวิชาการเกษตร"
    committee_dir.mkdir(parents=True)
    file_path = committee_dir / "2.คำของบประมาณ พ.ศ. 2570.xlsx"
    file_path.write_bytes(b"fake-xlsx")

    cache = _ProbeCache(cfg.cache_dir / "inventory_probe.json")
    doc = build_source_doc(cfg.raw_data_dir, file_path, cache, probe_pdf=False)

    assert doc.meeting_date == "2569-05-28"
    assert doc.fiscal_years == [2570]


# ---------------------------------------------------------------------------
# magic bytes / kind detection
# ---------------------------------------------------------------------------


def test_detect_kind_from_known_extension(tmp_path: Path) -> None:
    p = tmp_path / "a.PDF"
    p.write_bytes(b"%PDF-1.4\n%%EOF")
    assert _detect_kind(p) == "pdf"


def test_detect_kind_no_extension_pdf_magic(tmp_path: Path) -> None:
    p = tmp_path / "สิ่งที่ส่งมาด้วย 1 แผนแก้ไขสถานการณ์ อสค ณ 22เม.ย.69"
    p.write_bytes(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\nrest")
    assert _detect_kind(p) == "pdf"


def test_detect_kind_ds_store_is_other(tmp_path: Path) -> None:
    p = tmp_path / ".DS_Store"
    p.write_bytes(b"\x00\x00\x00\x01Bud1\x00\x00\x10\x00\x00\x00\x08\x00")
    assert _detect_kind(p) == "other"


def test_detect_kind_zip_office_xlsx_from_contents(tmp_path: Path) -> None:
    import zipfile

    p = tmp_path / "no_extension_but_xlsx"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("xl/workbook.xml", "<workbook/>")
        zf.writestr("[Content_Types].xml", "<Types/>")
    assert _detect_kind(p) == "xlsx"


def test_detect_kind_zip_without_office_markers_is_zip_office(tmp_path: Path) -> None:
    import zipfile

    p = tmp_path / "mystery_zip"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("readme.txt", "hello")
    assert _detect_kind(p) == "zip-office"


def test_detect_kind_random_bytes_is_other(tmp_path: Path) -> None:
    p = tmp_path / "mystery"
    p.write_bytes(b"\x01\x02\x03\x04random-bytes-not-a-known-format")
    assert _detect_kind(p) == "other"


# ---------------------------------------------------------------------------
# PDF probe
# ---------------------------------------------------------------------------


def test_probe_pdf_with_text_layer(tmp_path: Path) -> None:
    p = tmp_path / "with_text.pdf"
    p.write_bytes(make_pdf_with_text("ทดสอบข้อความภาษาไทยและอังกฤษ " * 20))
    result = _probe_pdf_inner(p)
    assert result.pages == 1
    assert result.has_text_layer is True
    assert result.extracted is True
    assert result.note is None


def test_probe_pdf_without_text_layer(tmp_path: Path) -> None:
    p = tmp_path / "no_text.pdf"
    p.write_bytes(make_pdf_no_text(n_pages=3))
    result = _probe_pdf_inner(p)
    assert result.pages == 3
    assert result.has_text_layer is False
    assert result.extracted is False
    assert result.note == "OCR out of scope"


def test_probe_pdf_corrupt_returns_none_with_note(tmp_path: Path) -> None:
    p = tmp_path / "corrupt.pdf"
    p.write_bytes(make_corrupt_pdf())
    result = _probe_pdf_inner(p)
    assert result.has_text_layer is None
    assert result.pages is None
    assert result.extracted is False
    assert result.note is not None


def test_probe_cache_roundtrip(tmp_path: Path) -> None:
    cache_path = tmp_path / "cache.json"
    cache = _ProbeCache(cache_path)
    assert cache.get("a.pdf", 100, 1) is None
    cache.put(
        "a.pdf", 100, 1, {"pages": 5, "has_text_layer": True, "extracted": True, "note": None}
    )
    cache.save()

    reloaded = _ProbeCache(cache_path)
    cached = reloaded.get("a.pdf", 100, 1)
    assert cached is not None
    assert cached["pages"] == 5
    # เปลี่ยน mtime/size -> cache miss
    assert reloaded.get("a.pdf", 999, 1) is None


# ---------------------------------------------------------------------------
# doc_id คงที่ + build_source_doc
# ---------------------------------------------------------------------------


def _write_config(tmp_path: Path) -> Path:
    pipeline_dir = tmp_path / "pipeline"
    pipeline_dir.mkdir()
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
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


def test_build_source_doc_doc_id_constant_across_runs(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)
    pbo_dir = cfg.raw_data_dir / "PBO"
    pbo_dir.mkdir(parents=True)
    (pbo_dir / "2564.xlsx").write_bytes(b"fake-xlsx-bytes")

    cache = _ProbeCache(cfg.cache_dir / "inventory_probe.json")
    doc1 = build_source_doc(cfg.raw_data_dir, pbo_dir / "2564.xlsx", cache, probe_pdf=True)
    doc2 = build_source_doc(cfg.raw_data_dir, pbo_dir / "2564.xlsx", cache, probe_pdf=True)

    assert doc1.doc_id == doc2.doc_id
    assert doc1.doc_id == doc_id_for_path("PBO/2564.xlsx")
    assert doc1.rel_path == "PBO/2564.xlsx"  # posix เสมอ แม้รันบน Windows (backslash ห้ามหลุด)
    assert doc1.collection == "pbo"
    assert doc1.kind == "xlsx"


def test_build_source_doc_rel_path_is_always_posix_on_nested_windows_style_dirs(
    tmp_path: Path,
) -> None:
    """จำลอง path ลึกหลายชั้น (เหมือน `os.walk`/`Path.relative_to` บน Windows คืน backslash)

    `rel_path` ที่เก็บใน `SourceDoc` ต้องเป็น posix (`/`) เสมอ ตัวอักษรไทย/U+200B คงตามจริง
    """
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)
    nested_dir = cfg.raw_data_dir / "กมธ.ติดตามงบ" / "ครั้งที่​ 4 (4 มิ.ย.​ 2569)" / "หน่วยงาน"
    nested_dir.mkdir(parents=True)
    file_path = nested_dir / "เอกสาร.pdf"
    file_path.write_bytes(make_pdf_no_text())

    cache = _ProbeCache(cfg.cache_dir / "inventory_probe.json")
    doc = build_source_doc(cfg.raw_data_dir, file_path, cache, probe_pdf=False)

    assert "\\" not in doc.rel_path
    assert doc.rel_path == "กมธ.ติดตามงบ/ครั้งที่​ 4 (4 มิ.ย.​ 2569)/หน่วยงาน/เอกสาร.pdf"


# ---------------------------------------------------------------------------
# scan_raw_dir + duplicates + sources.json (integration, fixture ทั้งต้นไม้)
# ---------------------------------------------------------------------------


def _build_fixture_tree(cfg: PipelineConfig) -> None:
    raw = cfg.raw_data_dir

    pbo_dir = raw / "PBO"
    pbo_dir.mkdir(parents=True)
    (pbo_dir / "2564.xlsx").write_bytes(b"pbo-2564-content")

    committee_dir = raw / "กมธ.ติดตามงบ" / "ครั้งที่​ 4 (4 มิ.ย.​ 2569)" / "วาระบ่าย (NDLP ศธ.)"
    committee_dir.mkdir(parents=True)
    (committee_dir / "2_ราคากลาง21.pdf").write_bytes(make_pdf_with_text("ราคากลาง " * 40))

    province_dir = raw / "งบประมาณ เชียงใหม่" / "2 - งบ อบจ. เชียงใหม่"
    province_dir.mkdir(parents=True)
    duplicate_content = b"same-content-for-dedupe-test"
    (province_dir / "a_ต้นฉบับ.xlsx").write_bytes(duplicate_content)
    (province_dir / "z_สำเนา.xlsx").write_bytes(duplicate_content)

    open_sso_dir = raw / "OPEN SSO"
    open_sso_dir.mkdir(parents=True)
    (open_sso_dir / "1.1ผลเบิกจ่ายปี 2563- final.pdf").write_bytes(make_pdf_no_text())

    ds_store = province_dir / ".DS_Store"
    ds_store.write_bytes(b"\x00\x00\x00\x01Bud1\x00\x00\x10\x00\x00\x00\x08\x00")


def test_scan_raw_dir_end_to_end(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)
    _build_fixture_tree(cfg)

    docs, stats = scan_raw_dir(cfg, probe_pdf=True)

    assert stats.total_files == 6
    assert len(docs) == 6
    # เรียงตาม rel_path (deterministic)
    assert [d.rel_path for d in docs] == sorted(d.rel_path for d in docs)

    assert all("\\" not in d.rel_path for d in docs)
    by_rel = {d.rel_path: d for d in docs}

    pbo_doc = by_rel["PBO/2564.xlsx"]
    assert pbo_doc.collection == "pbo"
    assert pbo_doc.kind == "xlsx"

    committee_doc = by_rel["กมธ.ติดตามงบ/ครั้งที่​ 4 (4 มิ.ย.​ 2569)/วาระบ่าย (NDLP ศธ.)/2_ราคากลาง21.pdf"]
    assert committee_doc.collection == "committee"
    assert committee_doc.meeting_no == 4
    assert committee_doc.meeting_date == "2569-06-04"
    assert committee_doc.topic == "วาระบ่าย (NDLP ศธ.)"
    assert committee_doc.has_text_layer is True
    # ปี 2569 อยู่ในชื่อโฟลเดอร์ประชุม (วันที่ประชุม) เท่านั้น ไม่ใช่ปีงบของเอกสาร -> ห้ามเดา (N3)
    assert committee_doc.fiscal_years == []

    open_sso_doc = by_rel["OPEN SSO/1.1ผลเบิกจ่ายปี 2563- final.pdf"]
    assert open_sso_doc.collection == "open_sso"
    assert open_sso_doc.agency_guess == "สำนักงานประกันสังคม"
    assert open_sso_doc.has_text_layer is False
    assert 2563 in open_sso_doc.fiscal_years

    ds_store_doc = by_rel["งบประมาณ เชียงใหม่/2 - งบ อบจ. เชียงใหม่/.DS_Store"]
    assert ds_store_doc.kind == "other"

    # duplicates: ตัวหลัก = a_ต้นฉบับ.xlsx (เรียงตัวอักษรก่อน z_สำเนา.xlsx)
    primary = by_rel["งบประมาณ เชียงใหม่/2 - งบ อบจ. เชียงใหม่/a_ต้นฉบับ.xlsx"]
    duplicate = by_rel["งบประมาณ เชียงใหม่/2 - งบ อบจ. เชียงใหม่/z_สำเนา.xlsx"]
    assert primary.duplicates == [duplicate.rel_path]
    assert duplicate.duplicates is None
    assert stats.duplicate_groups == 1
    assert stats.duplicate_files == 1


def test_scan_raw_dir_limit(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)
    _build_fixture_tree(cfg)

    docs, stats = scan_raw_dir(cfg, limit=2, probe_pdf=False)
    assert len(docs) == 2
    assert stats.total_files == 2


def test_write_sources_json_writes_valid_sorted_json(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)
    _build_fixture_tree(cfg)

    docs, stats = scan_raw_dir(cfg, probe_pdf=False)
    out_path = write_sources_json(cfg, docs)

    assert out_path == cfg.output_dir / "sources.json"
    payload = json.loads(out_path.read_text(encoding="utf-8"))
    assert len(payload) == stats.total_files
    rel_paths = [entry["rel_path"] for entry in payload]
    assert rel_paths == sorted(rel_paths)
    for entry in payload:
        assert entry["doc_id"].startswith("d_")


def test_write_inventory_appendix_creates_markdown(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)
    _build_fixture_tree(cfg)

    docs, stats = scan_raw_dir(cfg, probe_pdf=True)
    out_path = write_inventory_appendix(cfg, docs, stats)

    assert out_path.is_file()
    content = out_path.read_text(encoding="utf-8")
    assert "นับตาม kind" in content
    assert "นับตาม collection" in content


def test_sources_json_never_written_under_raw_dir(tmp_path: Path) -> None:
    """N6 guard: `assert_writable_path` ต้อง raise ถ้า output_dir ถูกตั้งให้ชี้เข้าไปใน raw dir"""
    pipeline_dir = tmp_path / "pipeline"
    pipeline_dir.mkdir()
    (tmp_path / "raw").mkdir()

    config_path = pipeline_dir / "config.yaml"
    config_path.write_text(
        yaml.safe_dump(
            {
                "raw_data_dir": "../raw",
                "output_dir": "../raw/should_not_write_here",
                "cache_dir": ".cache",
                "fixtures_dir": "../web/tests/fixtures/data",
            }
        ),
        encoding="utf-8",
    )
    cfg = PipelineConfig.load(config_path)
    from tgbp_pipeline.config import RawDataWriteError

    with pytest.raises(RawDataWriteError):
        write_sources_json(cfg, [])


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def test_cli_inventory_runs_end_to_end(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    cfg = PipelineConfig.load(config_path)
    _build_fixture_tree(cfg)

    result = runner.invoke(app, ["inventory", "--config", str(config_path), "--no-pdf-probe"])

    assert result.exit_code == 0, result.output
    assert "สแกนไฟล์: 6 ไฟล์" in result.output
    assert (cfg.output_dir / "sources.json").is_file()


# ---------------------------------------------------------------------------
# rawdata (skip อัตโนมัติถ้าไม่มีโฟลเดอร์ข้อมูลดิบจริง)
# ---------------------------------------------------------------------------


@pytest.mark.rawdata
def test_rawdata_v10_every_pdf_in_sources(tmp_path: Path) -> None:
    """V10: ทุก PDF ใน raw ต้องปรากฏใน sources.json (นับไฟล์ตรง)"""
    cfg = PipelineConfig.load()
    if not cfg.raw_data_dir.exists():
        pytest.skip("ไม่มีโฟลเดอร์ข้อมูลดิบจริงบนเครื่องนี้")

    pdf_ext_count_on_disk = sum(
        1 for p in cfg.raw_data_dir.rglob("*") if p.is_file() and p.suffix.lower() == ".pdf"
    )
    total_files_on_disk = sum(1 for p in cfg.raw_data_dir.rglob("*") if p.is_file())

    docs, stats = scan_raw_dir(cfg, probe_pdf=False)
    pdf_count_in_sources = sum(1 for d in docs if d.kind == "pdf")

    # ทุกไฟล์บนดิสก์ต้องมี SourceDoc ตรงกัน (V10 เชิงจำนวนไฟล์รวม)
    assert stats.total_files == total_files_on_disk
    # ไฟล์ .pdf ทุกไฟล์ต้องถูกจัดเป็น kind=pdf เสมอ (>=  เพราะบางไฟล์ไม่มีนามสกุลแต่เป็น PDF จริง
    # ตาม magic bytes — ตรวจแล้ว 19 ก.ย. 2569 มี 1 ไฟล์แบบนี้ใน กมธ.ติดตามงบ/องค์การโคนม)
    assert pdf_count_in_sources >= pdf_ext_count_on_disk


@pytest.mark.rawdata
def test_rawdata_all_rel_paths_are_posix() -> None:
    """rel_path ต้องเป็น posix (`/`) เสมอ แม้รันบน Windows — ไม่มี `\\` หลุดออกมาสักไฟล์"""
    cfg = PipelineConfig.load()
    if not cfg.raw_data_dir.exists():
        pytest.skip("ไม่มีโฟลเดอร์ข้อมูลดิบจริงบนเครื่องนี้")

    docs, _stats = scan_raw_dir(cfg, probe_pdf=False)
    offenders = [d.rel_path for d in docs if "\\" in d.rel_path]
    assert offenders == []
