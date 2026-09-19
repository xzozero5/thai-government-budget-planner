"""แปลงค่าเงิน (T-102) — 03-DATA-PIPELINE.md §5 ข้อ 4

- `to_baht_from_million`: คอลัมน์เงินของ PBO เป็น **ล้านบาท** ทศนิยม 4 ตำแหน่ง
  (0.0001 ล้านบาท = 100 บาท) → คูณ 1,000,000 แล้วปัดเป็น int64 บาท
- `parse_baht`: ค่าที่เป็นบาทอยู่แล้ว (A2 `p_total_bud`, A3, committee tables ฯลฯ)
- ทั้งคู่ใช้ `Decimal` (ไม่ใช้ float ตรง ๆ) กัน rounding error, รับ `'-'`/ว่าง → `None`,
  รับสตริงที่มี `,` คั่นหลักพัน / เลขไทย / วงเล็บแทนค่าติดลบ `(1,234)` → `-1234`
- ค่าติดลบเก็บตามจริง (ไม่ clip เป็น 0) ตาม CLAUDE.md — หน้าที่ flag `negative_amount`
  เป็นของ `extract`/`validate`, ไม่ใช่ของโมดูลนี้
"""

from __future__ import annotations

import math
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from tgbp_pipeline.normalize.thai_text import clean

_MILLION = Decimal(1_000_000)
_EMPTY_TOKENS = {"", "-", "–", "—", "none", "null", "nan"}


def _to_decimal(value: object) -> Decimal | None:
    """แปลง input หลากหลายชนิดให้เป็น `Decimal` หรือ `None` ถ้าไม่มีค่า

    รองรับ: `None`, `int`/`float`/`Decimal` ตรง ๆ, และ `str` ที่อาจมี `,`/เลขไทย/
    วงเล็บลบ/เครื่องหมายลบนำหน้า/ช่องว่างรอบตัวเลข
    """
    if value is None:
        return None

    if isinstance(value, Decimal):
        return value

    if isinstance(value, bool):
        # bool เป็น subclass ของ int ใน Python — ไม่ใช่ค่าที่เราคาดว่าจะเจอ ตัดทิ้งชัดเจน
        return None

    if isinstance(value, int):
        return Decimal(value)

    if isinstance(value, float):
        if math.isnan(value):
            return None
        return Decimal(str(value))

    text = clean(str(value)).strip()
    if text.lower() in _EMPTY_TOKENS:
        return None

    negative = False
    if text.startswith("(") and text.endswith(")"):
        negative = True
        text = text[1:-1].strip()
    if text.startswith("-"):
        negative = True
        text = text[1:].strip()
    elif text.startswith("+"):
        text = text[1:].strip()

    text = text.replace(",", "").replace(" ", "")
    if text.lower() in _EMPTY_TOKENS:
        return None

    try:
        decimal_value = Decimal(text)
    except InvalidOperation:
        return None

    return -decimal_value if negative else decimal_value


def to_baht_from_million(value: object) -> int | None:
    """ล้านบาท (ทศนิยม 4 ตำแหน่ง) → บาท (int) ปัดแบบ round-half-up"""
    decimal_value = _to_decimal(value)
    if decimal_value is None:
        return None
    baht = decimal_value * _MILLION
    return int(baht.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def parse_baht(value: object) -> int | None:
    """ค่าที่เป็นบาทอยู่แล้ว → int ปัดแบบ round-half-up (กันเศษสตางค์หลุดมา)"""
    decimal_value = _to_decimal(value)
    if decimal_value is None:
        return None
    return int(decimal_value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
