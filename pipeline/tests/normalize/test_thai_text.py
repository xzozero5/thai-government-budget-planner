"""T-102: `normalize/thai_text.py` — NFC, zero-width, Sara Am, เลขไทย, whitespace"""

from __future__ import annotations

import unicodedata

from tgbp_pipeline.normalize.thai_text import clean, nfc_only


def test_clean_removes_zero_width_space() -> None:
    assert clean("ครั้งที่​ 10") == "ครั้งที่ 10"


def test_clean_removes_bom() -> None:
    assert clean("﻿กระทรวงมหาดไทย") == "กระทรวงมหาดไทย"


def test_clean_fixes_split_sara_am() -> None:
    # "ทำ" พิมพ์ด้วย Nikhahit (U+0E4D) + Sara Aa (U+0E32) แยกกัน ต้องรวมเป็น ำ (U+0E33)
    split_form = "ทํา"
    assert clean(split_form) == "ทำ"


def test_clean_converts_thai_digits_to_arabic() -> None:
    assert clean("๒๕๖๙") == "2569"
    assert clean("ครั้งที่ ๑๐") == "ครั้งที่ 10"


def test_clean_collapses_whitespace_and_strips() -> None:
    assert clean("  กระทรวง   มหาดไทย \n\t ") == "กระทรวง มหาดไทย"


def test_clean_applies_nfc() -> None:
    # สระ + วรรณยุกต์แบบแยก code point ควร normalize เป็นรูปเดียวกับ NFC ต้นฉบับ
    decomposed = "é"  # e + combining acute accent
    assert clean(decomposed) == unicodedata.normalize("NFC", decomposed)


def test_clean_idempotent() -> None:
    text = "ครั้งที่​ 10 (16 ก.ค.​ 2569)"
    once = clean(text)
    twice = clean(once)
    assert once == twice


def test_nfc_only_normalizes_but_does_not_strip_zero_width() -> None:
    text = "ครั้งที่​ 10"
    result = nfc_only(text)
    assert result == unicodedata.normalize("NFC", text)
    assert "​" in result  # nfc_only ต้องไม่ลบ zero-width (ต่างจาก clean)


def test_nfc_only_does_not_convert_thai_digits() -> None:
    assert nfc_only("๒๕๖๙") == "๒๕๖๙"
