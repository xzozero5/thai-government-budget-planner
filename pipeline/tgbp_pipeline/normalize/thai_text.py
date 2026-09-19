"""ทำความสะอาดข้อความไทย (T-102) — 03-DATA-PIPELINE.md §5 ข้อ 1

`clean()` ใช้กับข้อความที่จะเอาไป regex/parse/group ต่อ (item_name, ชื่อโฟลเดอร์ ฯลฯ)
`nfc_only()` ใช้กับฟิลด์ที่ต้องคง "ตามต้นฉบับ" ไว้มากที่สุด (`item_name_raw`) —
ทำแค่ Unicode NFC เท่านั้น ห้ามลบ/แก้อย่างอื่น (CLAUDE.md §7: ห้าม transliterate ของต้นฉบับ)
"""

from __future__ import annotations

import re
import unicodedata

# U+200B ZERO WIDTH SPACE, U+FEFF ZERO WIDTH NO-BREAK SPACE (BOM)
_ZERO_WIDTH_CHARS = ("​", "﻿")

# Sara Am ที่พิมพ์แยกเป็น Nikhahit (U+0E4D) + Sara Aa (U+0E32) แทนตัวรวม U+0E33 (ำ)
_SPLIT_SARA_AM = "ํา"
_PRECOMPOSED_SARA_AM = "ำ"

_THAI_DIGIT_TRANSLATION = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")

_WHITESPACE_RE = re.compile(r"\s+")


def nfc_only(text: str) -> str:
    """Unicode NFC เท่านั้น — ไม่ลบ/แก้อย่างอื่น (สำหรับ `item_name_raw`)"""
    return unicodedata.normalize("NFC", text)


def clean(text: str) -> str:
    """ทำความสะอาดข้อความไทยตามกฎ 03 §5 ข้อ 1

    ลำดับ: NFC → ลบ zero-width chars → รวม Sara Am ที่พิมพ์แยก → เลขไทย→อารบิก →
    ยุบ whitespace/newline เป็นช่องว่างเดียว + strip หัวท้าย
    """
    normalized = unicodedata.normalize("NFC", text)
    for zw in _ZERO_WIDTH_CHARS:
        normalized = normalized.replace(zw, "")
    normalized = normalized.replace(_SPLIT_SARA_AM, _PRECOMPOSED_SARA_AM)
    normalized = normalized.translate(_THAI_DIGIT_TRANSLATION)
    normalized = _WHITESPACE_RE.sub(" ", normalized).strip()
    return normalized
