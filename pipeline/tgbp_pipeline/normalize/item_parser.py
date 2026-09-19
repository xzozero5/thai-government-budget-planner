"""แยกส่วนประกอบของ `ชื่อรหัสงบประมาณ` (T-103) — 03-DATA-PIPELINE.md §5 ข้อ 2

`ชื่อรหัสงบประมาณ` ของ PBO มักผสม **สเปค + จำนวน + สถานที่/หน่วยงาน** ไว้ในสตริงเดียว เช่น
(ตัวอย่างจริงจาก `docs/02-DATA-INVENTORY.md` §A1):
    "เครื่องปรับอากาศ แบบแยกส่วน (ราคารวมค่าติดตั้ง) แบบตั้งพื้นหรือแบบแขวน ขนาด 18,000 บีทียู
     สำนักงานพลังงานจังหวัดเชียงใหม่ ตำบลช้างเผือก อำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่"
    "ก่อสร้างลานกีฬา สนามฟุตซอล บ้านทุ่งฝูง หมู่ที่ 4 องค์การบริหารส่วนตำบลร่องเคาะ
     อำเภอวังเหนือ จังหวัดลำปาง"

`parse()` แยกออกเป็น province/amphoe/tambon, qty+unit, spec tokens แล้วสร้าง `item_key`
(item_name − location − qty phrase − org names) ที่ใช้ group ราคาข้ามหน่วยงาน/ปี

## กลยุทธ์ตัดสถานที่/ชื่อหน่วยงาน (ยังไม่มี org_master — T-104 ทำขนาน)

ชื่อหน่วยงาน/สถานที่ในข้อมูลจริงมักเขียน**ติดกันไม่มีช่องว่าง** กับคำนำหน้าสถานที่
(เช่น `สำนักงานพลังงานจังหวัดเชียงใหม่`, `องค์การบริหารส่วนตำบลร่องเคาะ`, `โรงเรียนบ้านทุ่งฝูง`)
เมื่อ regex เจอคำนำหน้า (`ตำบล`/`อำเภอ`/`จังหวัด`/`บ้าน`/`หมู่ที่`) กลางคำ ฟังก์ชันนี้จะขยาย
จุดเริ่มต้นของช่วงที่ตัดออกย้อนกลับไปจนถึง "ต้นคำ" (ช่องว่าง หรือ `)` ก่อนหน้า แล้วแต่ตัวไหนใกล้กว่า —
`)` นับเป็นขอบเขตด้วยเพราะสเปคในวงเล็บที่ไม่มีช่องว่างคั่นจากคำหลังวงเล็บ เช่น `(28 หน้า/นาที)สำนักงาน...`
ไม่งั้นการขยายย้อนจะกินเข้าไปในสเปคที่อยู่ในวงเล็บด้วย)
เพื่อดึงชื่อหน่วยงานที่พ่วงมาด้วยออกจาก `item_key` โดยไม่ต้องมี org_master
(รับ `org_names` เป็น hook เสริมสำหรับกรณีที่ชื่อหน่วยงานแยกคำด้วยช่องว่างจาก location — ยังไม่ครอบคลุมทุกกรณี)

นอกจากนี้ยังมีกลไก **org tail แบบ prefix list** (`_ORG_TAIL_PREFIXES`) แยกต่างหาก สำหรับกรณีที่
ชื่อหน่วยงานอยู่ท้ายชื่อครุภัณฑ์แต่ไม่ได้เกาะติดกับ marker สถานที่โดยตรง (เช่นหลังหน่วยสเปค) —
ดู `_find_org_tail_span` และ docstring ของ `parse()`

## หน่วย/สเปคที่ขยายเพิ่มจากที่พบจริงใน `PBO/2566.xlsx` (นอกเหนือจากที่ระบุใน 03 §5 ข้อ 2)

หน่วย qty เพิ่ม (พบบ่อยในรายการก่อสร้าง/ถนน): `ตารางเมตร`, `ลูกบาศก์เมตร`, `กิโลเมตร`, `ห้องเรียน`,
`ห้อง`, `ป้าย`, `สาย` (เรียงยาว→สั้นใน alternation กัน `ห้อง` แย่งจับคำก่อน `ห้องเรียน`)
หน่วยสเปคเพิ่ม: `หน้า/นาที` (ความเร็วเครื่องพิมพ์)

## ขนาด/มิติ (spec) vs จำนวนงาน (qty) — พบจาก hold-out 2563

ตัวเลข+หน่วยมิติ (`เมตร|ม.|กิโลเมตร|กม.|ตารางเมตร|ตร.ม.|ลูกบาศก์เมตร|ลบ.ม.|เซนติเมตร|ซม.|นิ้ว|ฟุต|ไร่`)
ที่นำหน้าด้วยคำบอกสเปค (`ขนาด|กว้าง|หน้ากว้าง|ยาว|หนา|สูง|ลึก|เส้นผ่าศูนย์กลาง|ความจุ|ปริมาตร`) →
เป็น **spec_token ไม่ใช่ qty** (ไม่ตัดออกจาก item_key) ส่วนที่นำหน้าด้วยคำบอกปริมาณงาน
(`ระยะทางรวม|ระยะทาง|ความยาวรวม|พื้นที่|ปริมาณ`) → เป็น qty ได้ แต่ติดธง `qty_is_measure` เสมอ
ถ้ามี `จำนวน N unit` ปรากฏด้วย ให้ `จำนวน` ชนะเสมอ (เช่น "จำนวน 3 สาย" ชนะ "พื้นที่ 2,890 ตารางเมตร")
นับทุกคู่ตัวเลข+หน่วยที่พบ (ยกเว้นที่ถูกจัดเป็น spec ตามกฎข้างต้น) รวมกันเป็นตัวส่วนของการนับ
`qty_parsed_low_conf` (ติดธงเมื่อมีมากกว่า 1 คู่)

## normalize ตัวเลขก่อนหน่วยที่รู้จัก (กัน `30 000` จาก comma และคง spec ให้ต่างกันตามขนาดจริง)

ตัวเลขที่มี `,` คั่นหลักพัน (`30,000`) และตัวเลขทศนิยมที่มีศูนย์ท้ายเกิน (`1.30`, `5.100`) จะถูก
normalize เป็น `30000`/`1.3`/`5.1` **เฉพาะเมื่อตามด้วยหน่วยที่รู้จัก** (qty/spec/dimension unit) เท่านั้น
ทำเป็น pass แยกก่อน parse ตำแหน่งอื่น ๆ ทั้งหมด เพื่อไม่ให้กระทบตัวเลขอื่นที่ไม่เกี่ยวกับหน่วย
(เช่นเลขรหัสสายทาง, รายการเลขหมู่ที่คั่นด้วย comma ซึ่งไม่ใช่ตัวเลขคั่นหลักพัน)

`spec_tokens` ของตัวเลข+หน่วย (BTU/ตัน/ฯลฯ) เก็บ**ตามที่พบในต้นฉบับหลัง normalize** ไม่แปลงหน่วยเป็น
ภาษาอังกฤษ (ตัวอย่าง `["18000 BTU", ...]` ใน 03 §3.1 เป็นภาพประกอบ ไม่ใช่สเปคการแปลงหน่วยที่ regex
ใน §5 ข้อ 2 ระบุไว้ — จึงเก็บเป็น `"18000 บีทียู"` ตามต้นฉบับแทน) `spec_tokens` **ไม่ถูกตัดออกจาก
`item_key`** (มีแค่ location/qty phrase/org name เท่านั้นที่ตัดออก ตาม 03 §3.1)

ถ้า `item_key` ที่ได้ว่างเปล่าทั้งที่ input ไม่ว่าง (เช่น input เป็นสถานที่ล้วน ไม่มีคำอธิบายอื่น) จะ
fallback กลับไปใช้ข้อความเต็ม (lower + strip punct) แทนการคืนสตริงว่าง เพื่อรักษา invariant
"item_key ไม่ว่างเมื่อ input ไม่ว่าง"
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field

from tgbp_pipeline.normalize import thai_geo
from tgbp_pipeline.normalize.thai_text import clean

# ── หน่วย qty (03 §5 ข้อ 2 + ขยายจากของจริงใน PBO — ดู docstring ด้านบน) ──
# เรียงยาว→สั้นในกลุ่มที่ทับกัน (ตารางเมตร ก่อน เมตร, ห้องเรียน ก่อน ห้อง) กัน alternation
# จับคำสั้นก่อนคำยาวผิด
_QTY_UNITS = (
    "ตารางเมตร",
    "ลูกบาศก์เมตร",
    "กิโลเมตร",
    "ตร.ม.",
    "เมตร",
    "กม.",
    "ห้องเรียน",
    "ห้อง",
    "เครื่อง",
    "คัน",
    "ชุด",
    "ตัว",
    "หลัง",
    "แห่ง",
    "รายการ",
    "ราย",
    "คน",
    "ไร่",
    "ต้น",
    "เล่ม",
    "ระบบ",
    "งาน",
    "โครงการ",
    "ป้าย",
    "สาย",
)

_QTY_RE = re.compile(
    r"(?P<num>\d[\d,]*(?:\.\d+)?)\s*(?P<unit>" + "|".join(re.escape(u) for u in _QTY_UNITS) + r")"
)

# ── สเปคตัวเลข+หน่วย (03 §5 ข้อ 2 + หน้า/นาที จาก hold-out 2563) ──
_SPEC_UNITS = (
    "บีทียู",
    "BTU",
    "ตัน",
    "ล้อ",
    "ฟุต",
    "นิ้ว",
    "kW",
    "กิโลวัตต์",
    "แรงม้า",
    "ที่นั่ง",
    "ลิตร",
    "ซีซี",
    "GB",
    "TB",
    "หน้า/นาที",
)
_SPEC_NUMBER_RE = re.compile(
    r"(?P<num>\d[\d,]*(?:\.\d+)?)\s*(?P<unit>" + "|".join(re.escape(u) for u in _SPEC_UNITS) + r")"
)
_SPEC_KEYWORDS = ("inverter", "ติดผนัง", "ตั้งพื้น", "แขวน")

# ── ขนาด/มิติ vs ปริมาณงาน (hold-out 2563 ข้อ A) ──
_DIMENSION_UNITS = (
    "ลูกบาศก์เมตร",
    "ตารางเมตร",
    "เซนติเมตร",
    "กิโลเมตร",
    "ลบ.ม.",
    "ตร.ม.",
    "กม.",
    "ซม.",
    "ฟุต",
    "นิ้ว",
    "ไร่",
    "เมตร",
    "ม.",
)
# คำนำหน้าที่บอกว่าตัวเลข+หน่วยมิติที่ตามมาเป็น "สเปค" (ขนาดของตัวชิ้นงาน ไม่ใช่ปริมาณงาน)
_SPEC_MARKER_WORDS = (
    "เส้นผ่าศูนย์กลาง",
    "หน้ากว้าง",
    "ปริมาตร",
    "ความจุ",
    "ขนาด",
    "กว้าง",
    "ยาว",
    "หนา",
    "สูง",
    "ลึก",
)
# คำนำหน้าที่บอกว่าตัวเลข+หน่วยมิติที่ตามมาเป็น "ปริมาณงาน" (นับเป็น qty ได้ แต่ flag qty_is_measure)
# "ความยาว" (ไม่มี "รวม") นับรวมด้วย เพราะพบจริงใน hold-out 2560/2568 ว่าใช้ความหมายเดียวกับ
# "ความยาวรวม" (ความยาวรวมของโครงสร้างทั้งชิ้น ไม่ใช่มิติของส่วนประกอบย่อยแบบ "ยาว X เมตร" ในกลุ่ม
# กว้าง/ยาว/หนา) — ต้องเรียงยาว→สั้นก่อน "ยาว" เสมอ กัน alternation จับแค่ "ยาว" ที่ซ้อนอยู่ข้างในผิด
_QTY_MARKER_WORDS = (
    "ระยะทางรวม",
    "ความยาวรวม",
    "ความยาว",
    "ระยะทาง",
    "พื้นที่",
    "ปริมาณ",
)
_SPEC_MARKER_WORDS_SET = set(_SPEC_MARKER_WORDS)
_QTY_MARKER_WORDS_SET = set(_QTY_MARKER_WORDS)
_DIMENSION_MARKER_ALT = sorted(_SPEC_MARKER_WORDS + _QTY_MARKER_WORDS, key=len, reverse=True)
_DIMENSION_UNIT_ALT = sorted(set(_DIMENSION_UNITS), key=len, reverse=True)
# คำเติมที่มักคั่นกลางระหว่างคำนำหน้ากับตัวเลข (เช่น "พื้นที่ไม่น้อยกว่า 100", "กว้างข้างละ 1") —
# พบจริงใน hold-out 2560/2568 ยอมให้มีคำไทย/ช่องว่างคั่นได้ไม่เกิน 20 ตัวอักษร (ห้ามมีเลขคั่น กัน
# ข้ามไปจับเลขอื่นที่ไม่เกี่ยวข้องไกลออกไป)
_DIMENSION_FILLER = r"(?:(?!\d)[ก-๙\s]){0,20}"
_DIMENSION_RE = re.compile(
    r"(?P<marker>"
    + "|".join(re.escape(w) for w in _DIMENSION_MARKER_ALT)
    + r")"
    + _DIMENSION_FILLER
    + r"(?P<num>\d+(?:\.\d+)?)\s*(?P<unit>"
    + "|".join(re.escape(u) for u in _DIMENSION_UNIT_ALT)
    + r")"
)

# "จำนวน N unit" ชนะเสมอเมื่อแข่งกับตัวเลข+หน่วยแบบอื่นในชื่อเดียวกัน (hold-out 2563 ข้อ A)
_JAMNUAN_RE = re.compile(
    r"จำนวน\s*(?P<num>\d[\d,]*(?:\.\d+)?)\s*(?P<unit>"
    + "|".join(re.escape(u) for u in _QTY_UNITS)
    + r")"
)

# ── normalize ตัวเลขก่อนหน่วยที่รู้จัก (comma หลักพัน + ศูนย์ท้ายทศนิยมเกิน) ──
_ALL_KNOWN_UNITS_FOR_NORMALIZE = sorted(
    set(_QTY_UNITS) | set(_SPEC_UNITS) | set(_DIMENSION_UNITS),
    key=len,
    reverse=True,
)
_NUMBER_BEFORE_UNIT_RE = re.compile(
    r"(?P<num>\d[\d,]*(?:\.\d+)?)(?=\s*(?:"
    + "|".join(re.escape(u) for u in _ALL_KNOWN_UNITS_FOR_NORMALIZE)
    + r"))"
)


def _normalize_number_text(num_str: str) -> str:
    """ตัด `,` หลักพัน + ศูนย์ท้ายทศนิยมที่เกิน (`30,000`→`30000`, `1.30`→`1.3`, `5.100`→`5.1`)"""
    s = num_str.replace(",", "")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
        return s or "0"
    return s.lstrip("0") or "0"


def _rewrite_numbers_before_known_units(text: str) -> str:
    return _NUMBER_BEFORE_UNIT_RE.sub(lambda m: _normalize_number_text(m.group("num")), text)


# ตัวเลขคั่นหลักพันแบบ comma ที่ **ไม่มีหน่วยตามหลังที่รู้จัก** (เช่น "3,500 ANSILumens",
# "จำนวน 1,000,200 โดส") ก็ต้องไม่เหลือเป็น "3 500"/"1 000 200" ใน item_key เช่นกัน (property test:
# ห้ามมีรูปแบบเลขคั่นหลักพันที่แตกด้วยช่องว่างจาก comma) — ใช้ regex ที่จำเพาะกับรูปแบบ "หลักพันจริง"
# เท่านั้น (กลุ่มแรก 1-3 หลัก ตามด้วย `,หลักละ 3 ตัว` ซ้ำได้ ไม่มีช่องว่างรอบ comma เลย) เพื่อไม่ไป
# ทำลายรายการเลขคั่นด้วย comma แบบอื่นที่ไม่ใช่หลักพัน (เช่น "หมู่ที่ 8,14, 4, 16, 3" ที่กลุ่มขนาด
# ไม่สม่ำเสมอ/มีช่องว่างคั่น — ไม่ใช่หลักพันจริง จึงไม่ถูกแตะ)
_THOUSANDS_GROUPED_NUMBER_RE = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?")


def _strip_all_thousands_commas(text: str) -> str:
    return _THOUSANDS_GROUPED_NUMBER_RE.sub(lambda m: m.group().replace(",", ""), text)


# ── สถานที่ ──
# ข้อมูลจริงบางแถวเขียน marker สถานที่ **ติดกันไม่มีช่องว่างคั่น** เช่น "ตำบลบ่อยางอำเภอเมืองสงขลา"
# หรือ "อำเภอพลจังหวัดขอนแก่น" — ถ้าจับด้วย `[ก-๙]+` เฉย ๆ จะกินยาวเลย marker ถัดไปทั้งหมด
# (เช่น tambon กลายเป็น "บ่อยางอำเภอเมืองสงขลา" ทั้งดุ้น) จึงต้องเช็คทีละตัวอักษรว่ายังไม่ชน
# marker คำอื่นด้วย negative lookahead ก่อนนับเป็นส่วนหนึ่งของชื่อ — รวมคำย่อ "จ./อ./ต." ด้วย
# (กัน "อ.ท่ายางจ.เพชรบุรี" จับ amphoe เป็น "ท่ายางจ" ผิด — hold-out 2563 ข้อ E)
_NAME_CHAR = r"(?:(?!ตำบล|อำเภอ|จังหวัด|หมู่ที่|หมู่|เทศบาล|จว\.|จ\.|อ\.|ต\.)[ก-๙])"

# ชื่อจังหวัด/alias เรียงยาว→สั้น กัน alternation จับ substring ผิด (เช่น "สมุทรสาคร" ก่อน "สมุทร"-ไม่มีในลิสต์)
_PROVINCE_ALT = "|".join(re.escape(n) for n in thai_geo.PROVINCE_NAMES_SORTED_DESC)
# หมายเหตุ: ไม่ใส่ negative lookahead กันตัวอักษรไทยตามหลัง เพราะข้อมูลจริงมีชื่อจังหวัดเขียนติด
# กับคำถัดไปไม่มีช่องว่างบ่อยมาก (เช่น "...จังหวัดสกลนครขนาด 6.00 นิ้ว") — alternation ที่จับเฉพาะ
# ชื่อ 77 จังหวัดตรง ๆ ปลอดภัยพอแล้ว (ไม่มีชื่อจังหวัดใดเป็น prefix ของอีกชื่อในลิสต์เดียวกัน)
# "จว." พบจริงใน hold-out 2560 (เอกสารสไตล์กองทัพอากาศ) เป็นคำย่อ "จังหวัด" อีกแบบ นอกเหนือจาก "จ."
_PROVINCE_MARKER_RE = re.compile(r"(?:จังหวัด|จว\.|จ\.)\s*(" + _PROVINCE_ALT + r")")
# กรุงเทพมหานครมักไม่มีคำว่า "จังหวัด" นำหน้า (ไม่ใช่ "จังหวัด" ทางปกครอง) — จับแบบไม่มี marker ด้วย
_BANGKOK_BARE_RE = re.compile(r"กรุงเทพมหานคร|กทม\.|กรุงเทพฯ")
# เทศบาลเมือง/เทศบาลนคร มักตั้งชื่อตามจังหวัด แต่ไม่มีคำว่า "จังหวัด"/"ตำบล" ในตัวเอง (ต่างจาก
# "เทศบาลตำบลX" ที่มีคำว่า "ตำบล" อยู่แล้วและถูกจับโดย _TAMBON_MARKER_RE)
_TESABAN_MUEANG_NAKHON_RE = re.compile(r"เทศบาล(?:เมือง|นคร)(" + _NAME_CHAR + r"{2,})")

# ต้องขึ้นต้นด้วยอักษรไทยและยาว ≥ 2 ตัวอักษร กันจับคำย่อวันที่ผิด (เช่น "ต.ค." → จะได้แค่ "ค" ยาว 1 ตัด)
# ท้าย group เสริม comma-list (hold-out 2563 ข้อ F): "อ.อุทุมพรพิสัย,ปรางค์กู่" → amphoe ใช้แค่ตัวแรก
# (group 1) แต่ตัดทั้ง match (รวม ",ปรางค์กู่") ออกจาก item_key
_AMPHOE_MARKER_RE = re.compile(
    r"(?:อำเภอ|อ\.)\s*(" + _NAME_CHAR + r"{2,})((?:,\s*" + _NAME_CHAR + r"{2,})*)"
)
_TAMBON_MARKER_RE = re.compile(
    r"(?:ตำบล|ต\.)\s*(" + _NAME_CHAR + r"{2,})((?:,\s*" + _NAME_CHAR + r"{2,})*)"
)
# "หมู่ที่ N" / "หมู่ N" / "ม.N" (hold-out 2563 ข้อ D) — ไม่รวม "ม." เดี่ยว ๆ ที่ตามด้วยหน่วยอื่น
# (แยกจาก "ม." ในฐานะหน่วยเมตรเพราะลำดับตรงข้ามกัน: มิเตอร์ = "เลขก่อนหน่วย", หมู่ = "ม.เลข")
# `(?<!ก)` กัน "ม." ใน "กม.7+000" (กม. = กิโลเมตร/chainage marker) ไม่ให้จับผิดเป็นเลขหมู่
# ท้าย group เสริม comma-list (พบจริงใน hold-out 2560: "หมู่ที่ 3,4") กันเลขหมู่ที่สองเหลือค้าง
_MOO_RE = re.compile(r"(?:หมู่ที่|หมู่|(?<!ก)ม\.)\s*\d+(?:,\s*\d+)*")
# "บ้าน" ตามด้วยชื่อสถานที่ (+ เลขหมู่ที่พ่วงติดชื่อแบบไม่มีช่องว่าง เช่น "บ้านคลอง16") —
# กัน false positive กับ "บ้านพัก"/"บ้านเลขที่" ฯลฯ ที่เป็นประเภทรายการ ไม่ใช่สถานที่
_BAN_RE = re.compile(r"บ้าน(?!พัก|เลขที่|เดี่ยว|แถว|เรือน|มั่นคง)(" + _NAME_CHAR + r"+\d*)")

# ── org tail แบบ prefix list (hold-out 2563 ข้อ G) ──
# ชื่อหน่วยงานที่อยู่ท้ายชื่อครุภัณฑ์แต่ไม่ได้เกาะติด marker สถานที่โดยตรง (เช่นอยู่หลังหน่วยสเปค)
_ORG_TAIL_PREFIXES = (
    "โครงการส่งน้ำและบำรุงรักษา",
    "องค์การบริหารส่วน",
    "แขวงทางหลวง",
    "หมวดทางหลวง",
    "โครงการชลประทาน",
    "มหาวิทยาลัย",
    "โรงพยาบาล",
    "สำนักงาน",
    "วิทยาลัย",
    "ที่ว่าการ",
    "โรงเรียน",
    "เทศบาล",
    "บ้านพัก",
    "สถาบัน",
    "สถานี",
    "ศูนย์",
    "ด่าน",
    "กอง",
)
_ORG_TAIL_RE = re.compile(
    "|".join(re.escape(p) for p in sorted(_ORG_TAIL_PREFIXES, key=len, reverse=True))
)
_LOCATION_MARKER_ANY_RE = re.compile(
    r"ตำบล|อำเภอ|จังหวัด|ต\.|อ\.|จ\.|หมู่ที่|หมู่|เทศบาล|กรุงเทพมหานคร|กทม\.|กรุงเทพฯ"
)

_WHITESPACE_RE = re.compile(r"\s+")
# ตัดเครื่องหมายวรรคตอนออกจาก item_key แต่ต้องคงอักษรไทยทั้งบล็อก U+0E00-U+0E7F ไว้ทั้งหมด
# (ห้ามใช้ `[^\w\s]` เพราะ \w ของ Python **ไม่นับ** สระ/วรรณยุกต์ไทยที่เป็น combining mark
# เช่น ่ ้ ึ ื ั ุ ู เป็นตัวอักษร — จะทำให้ "เครื่องปรับอากาศ" กลายเป็น "เคร องปร บอากาศ")
# คง "+" ไว้ด้วย (hold-out 2563 ข้อ G) กันเลข chainage แบบ "กม.7+000" แตกเป็น "กม 7 000"
# คง "." ไว้ **เฉพาะตอนเป็นจุดทศนิยมระหว่างตัวเลข** (hold-out 2563 ข้อ A/B: "1.3 เมตร" ต้องไม่แตก
# เป็น "1 3 เมตร") — ส่วน "." ที่เป็นคำย่อ (เช่น "กม.7+000", "1ซ.ส.1") ยังแปลงเป็นช่องว่างตามเดิม
# (เช่นต้องได้ "กม 7+000" ไม่ใช่ "กม.7+000") จึงต้องแยกสองรอบ: เก็บ "." ไว้ก่อน แล้วเปลี่ยน "."
# ที่ไม่ได้อยู่ระหว่างตัวเลขสองตัวให้เป็นช่องว่างทีหลัง
_PUNCT_RE = re.compile(r"[^A-Za-z0-9฀-๿+.\s]")
_STRAY_DOT_RE = re.compile(r"(?<!\d)\.|\.(?!\d)")
# hold-out 2565 (main thread): ทำให้ key ของรายการเดียวกัน group กันได้
# - เลขติดอักษรไทย: "1ตัน"/"2ล้อ"/"ไม่ต่ำกว่า110" → เว้นวรรคเสมอ ("1 ตัน", "กว่า 110")
# - คำบอกปริมาณที่ค้างหลังตัด qty ออก: "…ประมวลผลจำนวน", "…ความยาว", "…พื้นที่รับประโยชน์"
_DIGIT_THAI_GLUE_RE = re.compile(r"(?<=\d)(?=[ก-๎])|(?<=[ก-๎])(?=\d)")
_DANGLING_COUNT_WORD_RE = re.compile(r"จำนวน(?!\s*\d)")
_DANGLING_TAIL_RE = re.compile(
    # วลียาว (ไม่กำกวม) ตัดได้แม้เขียนติดคำก่อนหน้า; คำสั้นต้องมีวรรคนำ กันตัดกลางคำ
    r"(?:ความยาวรวม|ระยะทางรวม|พื้นที่รับผลประโยชน์|พื้นที่รับประโยชน์|ความยาว|ระยะทาง)$"
    r"|(?:\s|^)(?:พื้นที่|ปริมาณ|รวม)$"
)


def _canon_key(value: str) -> str:
    """lower → ตัดวรรคตอน (คงทศนิยม/"+") → เว้นวรรคเลข-อักษรไทย → ตัดคำปริมาณที่ค้าง → collapse"""
    key = value.lower()
    key = _PUNCT_RE.sub(" ", key)
    key = _STRAY_DOT_RE.sub(" ", key)
    key = _DIGIT_THAI_GLUE_RE.sub(" ", key)
    key = _DANGLING_COUNT_WORD_RE.sub(" ", key)
    key = _WHITESPACE_RE.sub(" ", key).strip()
    while True:
        trimmed = _DANGLING_TAIL_RE.sub("", key).strip()
        if trimmed == key or not trimmed:
            break
        key = trimmed
    return key


@dataclass
class ParsedItem:
    """ผลลัพธ์การ parse หนึ่ง `item_name` — สอดคล้องฟิลด์ `item_*`/`location_text`/`spec_tokens`/
    `quality_flags` ใน `BudgetLine` (03 §3.1)
    """

    item_name: str
    item_key: str
    province: str | None = None
    amphoe: str | None = None
    tambon: str | None = None
    location_text: str | None = None
    item_qty: float | None = None
    item_unit: str | None = None
    spec_tokens: list[str] = field(default_factory=list)
    quality_flags: list[str] = field(default_factory=list)


_MAX_ORG_PREFIX_EXTENSION = 40  # ตัวอักษร — ยาวพอสำหรับ "สำนักงานส่งเสริมการปกครองท้องถิ่น" (33 ตัวอักษร)


def _extend_span_to_token_start(
    text: str, start: int, protected_ends: frozenset[int] = frozenset()
) -> int:
    """ขยายจุดเริ่มต้น span ย้อนกลับไปจนถึงต้นคำ (ช่องว่าง หรือ `)` แล้วแต่ตัวไหนใกล้กว่า)

    ใช้ดึงชื่อหน่วยงานที่เขียนติดกับคำนำหน้าสถานที่ (เช่น `สำนักงานพลังงานจังหวัดเชียงใหม่`)
    ออกมาเป็นส่วนหนึ่งของ span ที่จะตัดทิ้ง โดยไม่ต้องมีรายชื่อหน่วยงาน (org_master)

    `protected_ends` = เซตของตำแหน่งจบของคู่ตัวเลข+หน่วยที่รู้จักแล้ว (qty/spec/dimension) —
    ถ้า `start` ตรงกับตำแหน่งจบเหล่านี้พอดี (เช่น `ลูกบาศก์เมตรตำบลX` ที่ "ตำบล" เริ่มทันทีหลัง
    "ลูกบาศก์เมตร" แบบไม่มีช่องว่าง) **ห้ามขยายย้อนเข้าไปกินหน่วยนั้น** (hold-out 2563 ข้อ A)
    และถ้าการขยายย้อนด้วยช่องว่าง/`)` จะ**ข้าม**ผ่านตำแหน่งจบเหล่านี้ไป (เช่น เจอช่องว่างไกลออกไป
    ก่อนหน้าสเปคอีกที เพราะช่วงกลางไม่มีช่องว่างเลย) ต้อง**หยุดที่ตำแหน่งจบที่ใกล้ที่สุดแทน** ไม่ใช่
    ขยายเลยไปกินสเปคนั้น (เช่น `...30000 บีทียูบ้านพักเด็ก...จังหวัดเชียงราย` — ขยาย span ของ
    `จังหวัดเชียงราย` ย้อนไปหาช่องว่างจะไปเจอช่องว่างก่อน "บีทียู" ซึ่งไกลเกินไป ต้องหยุดที่ท้าย "บีทียู"
    แทน ไม่ใช่กินเข้าไปใน "บีทียู" ด้วย)

    นับ `)` เป็นขอบเขตด้วย ไม่ใช่แค่ช่องว่าง — ข้อมูลจริงบางรายการมีสเปคในวงเล็บที่ไม่มีช่องว่างคั่น
    จากคำถัดไป เช่น `(28 หน้า/นาที)สำนักงานเกษตรอำเภอบ้านตาก` ถ้าใช้ช่องว่างอย่างเดียวจะขยายย้อน
    เข้าไปกินสเปคในวงเล็บด้วย (hold-out 2563 ข้อ B)

    **ไม่ขยายย้อนไปจนถึงต้นสตริงถ้าไม่เจอขอบเขตเลย** — ข้อมูลจริงบางรายการเขียนประโยคยาวทั้งหมด
    ติดกันไม่มีช่องว่างแม้แต่ตัวเดียวก่อนคำนำหน้าสถานที่ (เช่น
    `ก่อสร้างรั้วบริเวณศูนย์ราชการอำเภอเดิมบางนางบวช จังหวัดสุพรรณบุรี` หรือ
    `ซ่อมแซมโครงการชลประทาน...ในเขตจังหวัดพระนครศรีอยุธยา`) ถ้าย้อนไปถึงต้นสตริงตรง ๆ
    (เหมือนที่เคย implement พลาดไว้) จะกลืนคำอธิบายรายการทั้งหมดจน `item_key` กลายเป็นสตริงว่าง
    จึงต้อง (1) ไม่ขยายเลยถ้าไม่เจอขอบเขตในข้อความก่อนหน้า และ (2) จำกัดระยะขยายไม่เกิน
    `_MAX_ORG_PREFIX_EXTENSION` ตัวอักษร กันกรณีมีขอบเขตอยู่ไกลเกินกว่าจะเป็นชื่อหน่วยงานจริง ๆ
    """
    if start in protected_ends:
        return start
    boundary = max(text.rfind(" ", 0, start), text.rfind(")", 0, start))
    effective_start = boundary + 1 if boundary != -1 else 0
    nearer_protected = max(
        (e for e in protected_ends if effective_start <= e < start), default=None
    )
    if nearer_protected is not None:
        return nearer_protected
    # เลขเปล่า ๆ ที่เกาะติด marker (เช่น "ระยะที่ 4จังหวัดX") ไม่ใช่ส่วนหนึ่งของชื่อหน่วยงาน —
    # ห้ามขยายย้อนไปกิน ("ระยะที่ 4" ต้องเหลืออยู่ ตัดแค่ "จังหวัดX") — hold-out 2563 ข้อ C
    if text[effective_start:start].isdigit():
        return start
    if boundary == -1:
        return start
    if start - effective_start > _MAX_ORG_PREFIX_EXTENSION:
        return start
    return effective_start


def _merge_spans(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not spans:
        return []
    spans = sorted(spans)
    merged = [spans[0]]
    for start, end in spans[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def _spans_overlap(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return not (a[1] <= b[0] or a[0] >= b[1])


def _org_tail_candidate(
    text: str, protected_ends: frozenset[int]
) -> tuple[tuple[int, int] | None, bool]:
    """หา span ของ "ชื่อหน่วยงานท้ายชื่อครุภัณฑ์" ตาม prefix list (hold-out 2563 ข้อ G)

    เงื่อนไข: ต้องอยู่หลังช่องว่าง/`)`/คู่ตัวเลข+หน่วยที่รู้จักแล้ว (`protected_ends` — ตำแหน่งจบของ
    qty/spec/dimension match จริง ไม่ใช่แค่ endswith ตรง ๆ กัน "พลังงาน" ชนคำว่า "งาน" ที่เป็นหน่วย
    qty เฉย ๆ ทั้งที่ไม่มีตัวเลขนำหน้าจริง) — ไม่ใช่ต้นชื่อ และไม่ใช่กริยางานเกาะติด
    เช่น "ก่อสร้างสำนักงาน..."/"ปรับปรุงโรงพยาบาล..." — และต้องมี location marker ปรากฏต่อจากนั้น
    ในข้อความที่เหลือ

    คืน `(span, uncertain)`: `span` ไม่ใช่ `None` เมื่อตัดได้จริง; `uncertain=True` เมื่อเจอ prefix ที่
    มี location marker ตามมาแต่เงื่อนไขตำแหน่งไม่ผ่าน (อยู่ต้นชื่อ/เกาะติดกริยา) — กรณีนี้ไม่ตัด
    แต่ติดธง `org_tail_uncertain` แทน

    **ต้องวนหาต่อจนจบ ไม่ return ทันทีที่เจอ match แรก** — ข้อความเดียวอาจมี prefix คำแรกที่กำกวม
    (เช่น `(โรงเรียน Stand Alone) โรงเรียนบ้านโพนขาว ตำบล...` ที่ "โรงเรียน" ตัวแรกอยู่ในวงเล็บ
    เกาะติด "(" ไม่ผ่านเงื่อนไข) แต่ตัวที่สอง/หลังจากนั้นตัดได้จริง — ถ้า return ทันทีจะพลาดตัวที่ตัดได้
    """
    found_uncertain = False
    for m in _ORG_TAIL_RE.finditer(text):
        start = m.start()
        if not _LOCATION_MARKER_ANY_RE.search(text, start):
            continue  # ไม่มี location marker ตามมาเลย ไม่ใช่ org tail ที่ต้องสนใจ
        if start == 0:
            found_uncertain = True
            continue  # ต้นชื่อ ห้ามตัด — กำกวม แต่ยังหาตัวถัดไปต่อ
        prev_char = text[start - 1]
        if prev_char in (" ", ")") or start in protected_ends:
            return (start, len(text)), False
        found_uncertain = True  # เกาะติดกริยางาน (เช่น "ก่อสร้างสำนักงาน...") — กำกวม ไม่ตัด แต่หาต่อ
    return None, found_uncertain


_MAX_FALLBACK_RECURSION_DEPTH = 5


def parse(item_name: str, org_names: Iterable[str] | None = None, _depth: int = 0) -> ParsedItem:
    """แยก `item_name` ออกเป็น province/amphoe/tambon, qty/unit, spec tokens และสร้าง `item_key`

    `org_names` เป็น hook เสริม (optional) สำหรับ T-104 (`org_master`) — ถ้าระบุ จะค้นหาชื่อ
    หน่วยงานที่ตรงแบบ exact substring เพิ่มเติม (เรียงยาว→สั้นกันชื่อสั้นบัง match ชื่อยาว) แล้วตัด
    ออกจาก `item_key`/รวมเข้า `location_text` เหมือนสถานที่อื่น ๆ

    Deterministic และ idempotent: `parse(parse(x).item_key)` ต้องไม่ error (item_key ไม่มีคำนำหน้า
    สถานที่หลงเหลือให้จับซ้ำ จึงได้ province/amphoe/tambon เป็น `None` เมื่อ parse ซ้ำ)

    `_depth` (T-110a — พบจริงจาก `PBO/2558.xlsx`) เป็นตัวกัน **stack overflow** ของ fixed-point
    loop ด้านล่าง: `for _ in range(3)` เดิมจำกัดจำนวนรอบ**ต่อการเรียกหนึ่งครั้ง** แต่ไม่ได้จำกัด
    ความลึกของการเรียกซ้อนกัน (nested) เมื่อผลลัพธ์ของรอบก่อนหน้ายังว่างอีก การเรียก `parse()`
    ซ้อนกันจึงลึกจน `RecursionError` ได้จริง (พบ item_name จริงใน 2558 ที่ไม่ลู่เข้าจุดคงที่ภายใน
    ~1000 ชั้น) — จำกัดความลึกรวมไว้ที่ `_MAX_FALLBACK_RECURSION_DEPTH` แล้วยอมรับผลลัพธ์ปัจจุบัน
    (ไม่ idempotent 100% สำหรับ input ผิดปกติเหล่านี้ แต่ปลอดภัยกว่าเดิมมาก ยังคง fallback ที่ถูก
    ต้องสำหรับ input ปกติทุกกรณีที่เคยผ่าน hold-out เพราะ input ปกติลู่เข้าภายใน 1-2 รอบเสมอ)
    """
    text = clean(item_name)
    text = _strip_all_thousands_commas(text)
    text = _rewrite_numbers_before_known_units(text)
    quality_flags: list[str] = []

    # ── ขนาด/มิติ (spec) vs ปริมาณงาน (qty) — คำนวณ**ก่อน**ตำแหน่งสถานที่ เพื่อรู้ตำแหน่งจบของ
    # คู่ตัวเลข+หน่วยที่รู้จักแล้ว (`protected_ends`) กัน location-span extension ย้อนกลับไปกิน
    # หน่วยที่เกาะติด marker แบบไม่มีช่องว่าง เช่น "ลูกบาศก์เมตรตำบลX" (hold-out 2563 ข้อ A) ──
    spec_tokens: list[str] = []
    spec_dimension_spans: list[tuple[int, int]] = []
    measure_candidates: list[tuple[int, int, str, str]] = []  # (start, end, num, unit)
    for m in _DIMENSION_RE.finditer(text):
        marker = m.group("marker")
        num, unit = m.group("num"), m.group("unit")
        span = (m.start("num"), m.end("unit"))
        if marker in _SPEC_MARKER_WORDS_SET:
            spec_dimension_spans.append(span)
            spec_tokens.append(f"{num} {unit}")
        elif marker in _QTY_MARKER_WORDS_SET:
            measure_candidates.append((span[0], span[1], num, unit))

    # "จำนวน N unit" — ชนะเสมอเมื่อมีมากกว่า 1 คู่ (hold-out 2563 ข้อ A)
    jamnuan_matches = list(_JAMNUAN_RE.finditer(text))
    jamnuan_candidates = [
        (m.start("num"), m.end("unit"), m.group("num"), m.group("unit")) for m in jamnuan_matches
    ]

    consumed_spans = (
        spec_dimension_spans
        + [(s, e) for s, e, _, _ in measure_candidates]
        + [(s, e) for s, e, _, _ in jamnuan_candidates]
    )
    generic_qty_candidates = [
        (m.start(), m.end(), m.group("num"), m.group("unit"))
        for m in _QTY_RE.finditer(text)
        if not any(_spans_overlap((m.start(), m.end()), c) for c in consumed_spans)
    ]

    all_qty_candidates = jamnuan_candidates + measure_candidates + generic_qty_candidates

    item_qty: float | None = None
    item_unit: str | None = None
    if all_qty_candidates:
        if jamnuan_candidates:
            chosen = jamnuan_candidates[-1]
            chosen_kind = "jamnuan"
        else:
            non_jamnuan_sorted = sorted(
                measure_candidates + generic_qty_candidates, key=lambda c: c[0]
            )
            chosen = non_jamnuan_sorted[-1]
            chosen_kind = "measure" if chosen in measure_candidates else "generic"
        try:
            item_qty = float(chosen[2].replace(",", ""))
        except ValueError:  # pragma: no cover - regex รับประกันรูปแบบตัวเลขแล้ว
            item_qty = None
        item_unit = chosen[3]
        if chosen_kind == "measure":
            quality_flags.append("qty_is_measure")
        if len(all_qty_candidates) > 1:
            quality_flags.append("qty_parsed_low_conf")

    qty_removal_spans = [(s, e) for s, e, _, _ in all_qty_candidates]

    # spec tokens อื่น (BTU/ตัน/ฯลฯ) — ไม่ตัดออกจาก item_key (03 §3.1: ตัดแค่ location/qty/org names)
    spec_number_spans: list[tuple[int, int]] = []
    for m in _SPEC_NUMBER_RE.finditer(text):
        spec_number_spans.append((m.start(), m.end()))
        spec_tokens.append(f"{m.group('num').replace(',', '')} {m.group('unit')}")
    lowered = text.lower()
    for kw in _SPEC_KEYWORDS:
        if kw.lower() in lowered:
            spec_tokens.append(kw)

    # ตำแหน่งจบของคู่ตัวเลข+หน่วยที่รู้จักแล้วทั้งหมด (spec + qty) — ใช้กัน location-span extension
    # ย้อนเข้าไปกินหน่วยที่เกาะติด marker สถานที่แบบไม่มีช่องว่าง
    protected_ends: frozenset[int] = frozenset(
        e for _, e in spec_dimension_spans + spec_number_spans + qty_removal_spans
    )

    location_spans: list[tuple[int, int]] = []
    province: str | None = None
    amphoe: str | None = None
    tambon: str | None = None

    # จังหวัด (marker-based เพื่อกัน false positive เช่น "เมือง" หรือชื่อจังหวัดที่เป็น substring คำอื่น)
    # ใช้ finditer เพราะ marker เดียวกันอาจพบ **มากกว่า 1 ครั้ง** ในชื่อเดียว (เช่นครั้งแรกพ่วงอยู่ใน
    # ชื่อหน่วยงาน `...จังหวัดเชียงใหม่` แล้วมี `จังหวัดเชียงใหม่` แบบเดี่ยวซ้ำท้ายสุดอีกครั้ง) —
    # ต้องตัดทุก match ออกจาก item_key ไม่ใช่แค่ match แรก มิฉะนั้นจะเหลือหลงเหลือ
    province_matches = list(_PROVINCE_MARKER_RE.finditer(text))
    for pm in province_matches:
        location_spans.append(
            (_extend_span_to_token_start(text, pm.start(), protected_ends), pm.end())
        )
    if province_matches:
        province = thai_geo.canonical_province(province_matches[-1].group(1))
    else:
        bkk_matches = list(_BANGKOK_BARE_RE.finditer(text))
        for bm in bkk_matches:
            location_spans.append(
                (_extend_span_to_token_start(text, bm.start(), protected_ends), bm.end())
            )
        if bkk_matches:
            province = thai_geo.BANGKOK

    # อำเภอ (group 2 = comma-list เสริมท้าย เช่น "อ.อุทุมพรพิสัย,ปรางค์กู่" — ตัดทั้งคู่ แต่เก็บ
    # แค่ตัวแรกเป็นค่า field ตาม hold-out 2563 ข้อ F)
    amphoe_matches = list(_AMPHOE_MARKER_RE.finditer(text))
    for am in amphoe_matches:
        location_spans.append(
            (_extend_span_to_token_start(text, am.start(), protected_ends), am.end())
        )
    if amphoe_matches:
        amphoe = amphoe_matches[-1].group(1)

    # ตำบล (ครอบคลุม "องค์การบริหารส่วนตำบลX" ด้วย เพราะมีคำว่า "ตำบล" อยู่ในตัว)
    tambon_matches = list(_TAMBON_MARKER_RE.finditer(text))
    for tm in tambon_matches:
        location_spans.append(
            (_extend_span_to_token_start(text, tm.start(), protected_ends), tm.end())
        )
    if tambon_matches:
        tambon = tambon_matches[-1].group(1)

    # เทศบาลเมือง/เทศบาลนคร — ไม่มี "จังหวัด"/"ตำบล" ในตัวเอง เติม province ถ้าชื่อตรงกับจังหวัดจริง
    for m in _TESABAN_MUEANG_NAKHON_RE.finditer(text):
        location_spans.append(
            (_extend_span_to_token_start(text, m.start(), protected_ends), m.end())
        )
        if province is None:
            candidate = thai_geo.canonical_province(m.group(1))
            if candidate:
                province = candidate

    # หมู่ที่ N / หมู่ N / ม.N
    for m in _MOO_RE.finditer(text):
        location_spans.append(
            (_extend_span_to_token_start(text, m.start(), protected_ends), m.end())
        )

    # บ้านX (กันชนกับ "บ้านพัก"/ฯลฯ ด้วย negative lookahead ในตัว regex; รวมเลขหมู่ที่พ่วงติดชื่อ)
    for m in _BAN_RE.finditer(text):
        location_spans.append(
            (_extend_span_to_token_start(text, m.start(), protected_ends), m.end())
        )

    # org tail แบบ prefix list (hold-out 2563 ข้อ G)
    org_tail_span, org_tail_uncertain = _org_tail_candidate(text, protected_ends)
    if org_tail_span:
        location_spans.append(org_tail_span)
    elif org_tail_uncertain:
        quality_flags.append("org_tail_uncertain")

    # hook org_names (T-104 ยังไม่พร้อม) — exact substring match เรียงยาว→สั้น
    if org_names:
        for name in sorted(set(org_names), key=len, reverse=True):
            if not name:
                continue
            idx = text.find(name)
            if idx != -1:
                location_spans.append(
                    (_extend_span_to_token_start(text, idx, protected_ends), idx + len(name))
                )

    merged_location_spans = _merge_spans(location_spans)
    location_text = " ".join(text[s:e] for s, e in merged_location_spans).strip() or None

    # item_key = item_name − location (รวมชื่อหน่วยงานที่พ่วงมา) − qty phrase
    # → lower → strip punct (คง "." ที่เป็นทศนิยมจริง) → collapse
    removal_spans = _merge_spans(merged_location_spans + qty_removal_spans)
    parts = []
    cursor = 0
    for start, end in removal_spans:
        parts.append(text[cursor:start])
        cursor = end
    parts.append(text[cursor:])
    item_key = _canon_key(" ".join(parts))

    if not item_key and text.strip():
        # input ไม่ว่างแต่ตัดจนเหลือว่าง (เช่น input เป็นสถานที่ล้วน) — fallback คงข้อความเต็มไว้
        # แทนคืนสตริงว่าง (invariant: item_key ต้องไม่ว่างเมื่อ input ไม่ว่าง)
        item_key = _canon_key(text)

        # fallback ข้างบนตัดวรรคตอน (รวม "." ใน "อ."/"จ.") ออกไปแล้ว ทำให้ re-parse ครั้งถัดไป
        # หา marker สถานที่ (ที่ต้องมีจุดกำกับ) ไม่เจออีก — ผลจึง**ไม่เท่าเดิม**เมื่อ parse ซ้ำ
        # (พบจริงจากเคส hold-out "บ้านพิมาย อ.X,Y จ.Z" ที่ input มีแต่สถานที่ล้วน ไม่มีคำอธิบายอื่น
        # เลย) วนซ้ำจนถึงจุดคงที่ (fixed point) ไม่เกิน 3 รอบ เพื่อรับประกัน idempotent เสมอ —
        # แต่จำกัดความลึกรวมของการเรียกซ้อนด้วย `_depth` กัน `RecursionError` (ดู docstring)
        if _depth < _MAX_FALLBACK_RECURSION_DEPTH:
            for _ in range(3):
                next_key = parse(item_key, _depth=_depth + 1).item_key
                if next_key == item_key:
                    break
                item_key = next_key

    return ParsedItem(
        item_name=text,
        item_key=item_key,
        province=province,
        amphoe=amphoe,
        tambon=tambon,
        location_text=location_text,
        item_qty=item_qty,
        item_unit=item_unit,
        spec_tokens=spec_tokens,
        quality_flags=quality_flags,
    )
