"""T-102: `util/hash.py` — source_id/doc_id คงที่ (golden values) + posix/NFC normalize"""

from __future__ import annotations

import hashlib
import unicodedata

from tgbp_pipeline.util.hash import doc_id_for_path, sha1_file, source_id


def test_source_id_is_deterministic() -> None:
    a = source_id("pbo_disbursement", "PBO/2564.xlsx", "เบิกจ่ายภาพรวมทุกมิติ (5)", 3)
    b = source_id("pbo_disbursement", "PBO/2564.xlsx", "เบิกจ่ายภาพรวมทุกมิติ (5)", 3)
    assert a == b
    assert len(a) == 16


def test_source_id_golden_value() -> None:
    # ค่าคงที่: คำนวณจาก sha1("pbo_disbursement|PBO/2564.xlsx|เบิกจ่ายภาพรวมทุกมิติ (5)|3")[:16]
    # ถ้าเทสต์นี้พังแปลว่า algorithm ของ source_id เปลี่ยน (ต้องคิดผลกระทบกับ source_id เก่าที่ publish ไปแล้ว)
    dataset = "pbo_disbursement"
    rel_path = "PBO/2564.xlsx"
    sheet = "เบิกจ่ายภาพรวมทุกมิติ (5)"
    row_index = 3
    joined = "|".join([dataset, rel_path, sheet, str(row_index)])
    expected = hashlib.sha1(unicodedata.normalize("NFC", joined).encode("utf-8")).hexdigest()[:16]

    assert source_id(dataset, rel_path, sheet, row_index) == expected


def test_source_id_differs_by_row_index() -> None:
    a = source_id("pbo_disbursement", "PBO/2564.xlsx", "Sheet1", 3)
    b = source_id("pbo_disbursement", "PBO/2564.xlsx", "Sheet1", 4)
    assert a != b


def test_source_id_normalizes_windows_path_separators() -> None:
    a = source_id("committee_table", "กมธ.ติดตามงบ/x/y.pdf", None, 1)
    b = source_id("committee_table", "กมธ.ติดตามงบ\\x\\y.pdf", None, 1)
    assert a == b


def test_source_id_none_sheet_uses_empty_string() -> None:
    a = source_id("act_2570_draft", "a.xlsx", None, 1)
    b = source_id("act_2570_draft", "a.xlsx", "", 1)
    assert a == b


def test_doc_id_for_path_is_deterministic_and_prefixed() -> None:
    doc_id = doc_id_for_path("กมธ.ติดตามงบ/ครั้งที่ 4 (4 มิ.ย. 2569)/2_ราคากลาง21.pdf")
    assert doc_id.startswith("d_")
    assert len(doc_id) == len("d_") + 12
    assert doc_id == doc_id_for_path("กมธ.ติดตามงบ/ครั้งที่ 4 (4 มิ.ย. 2569)/2_ราคากลาง21.pdf")


def test_doc_id_for_path_windows_and_posix_equivalent() -> None:
    a = doc_id_for_path("a/b/c.pdf")
    b = doc_id_for_path("a\\b\\c.pdf")
    assert a == b


def test_doc_id_for_path_nfc_equivalent() -> None:
    # ก unicode ที่ decompose ได้ (สระ+วรรณยุกต์แยก) ควรได้ doc_id เดียวกันหลัง NFC
    decomposed = "é.pdf"
    composed = unicodedata.normalize("NFC", decomposed)
    assert doc_id_for_path(decomposed) == doc_id_for_path(composed)


def test_sha1_file_streams_and_matches_hashlib(tmp_path) -> None:
    p = tmp_path / "sample.bin"
    content = b"x" * (1024 * 1024) + b"tail-bytes"
    p.write_bytes(content)

    expected = hashlib.sha1(content).hexdigest()
    assert sha1_file(str(p), chunk_size=4096) == expected


def test_sha1_file_empty_file(tmp_path) -> None:
    p = tmp_path / "empty.bin"
    p.write_bytes(b"")
    assert sha1_file(str(p)) == hashlib.sha1(b"").hexdigest()
