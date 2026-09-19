"""T-103: `normalize/item_parser.py` — accuracy บน fixture 3 หมวด (`tests/fixtures/item_names.yaml`)
+ unit tests เคสเฉพาะ (03 §5 ข้อ 2 / 02 §A1) + property tests

fixture มี 3 หมวด:
- `pbo2566`: 200 ตัวอย่างจริงจาก PBO/2566.xlsx สุ่ม stratified (seed=42)
- `holdout_2563`: เคสจาก coordinator (main thread) — expected ตามที่ระบุมาตรงตัว
- `holdout_2560_2568`: เคสจาก hold-out อิสระ (PBO 2560+2568) ที่อ่านผลด้วยตาก่อนแก้โค้ด

เกณฑ์ผ่าน (บนชุดที่ไม่ใช่ `ambiguous: true`, รวมทั้ง 3 หมวด):
- province ถูก ≥ 95%
- qty+unit ถูก ≥ 90% (เฉพาะเคสที่ `expected.qty` ไม่เป็น null)
- item_key contains/not_contains ผ่าน ≥ 90% (ทุกเคส รวม ambiguous เพราะ ambiguity เป็นเรื่อง
  ตัวเลข qty เท่านั้น ไม่กระทบ contains/not_contains)

ไม่พึ่งไฟล์ raw จริง — fixture เป็นไฟล์ yaml ที่ commit ไว้ (ดู `pipeline/scripts/sample_item_names.py`
สำหรับที่มาของการสุ่มหมวด `pbo2566`)
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml

from tgbp_pipeline.normalize.item_parser import parse

FIXTURE_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "item_names.yaml"


def _load_fixture() -> dict[str, list[dict[str, Any]]]:
    with FIXTURE_PATH.open(encoding="utf-8") as f:
        return yaml.safe_load(f)


_FIXTURE_SECTIONS = _load_fixture()
PBO2566 = _FIXTURE_SECTIONS["pbo2566"]
HOLDOUT_2563 = _FIXTURE_SECTIONS["holdout_2563"]
HOLDOUT_2560_2568 = _FIXTURE_SECTIONS["holdout_2560_2568"]
ALL_CASES = PBO2566 + HOLDOUT_2563 + HOLDOUT_2560_2568
NON_AMBIGUOUS = [c for c in ALL_CASES if not c.get("ambiguous")]


def test_fixture_has_200_pbo2566_cases() -> None:
    assert len(PBO2566) == 200


def test_fixture_has_holdout_sections() -> None:
    assert len(HOLDOUT_2563) >= 10, "holdout_2563 ต้องครอบคลุมหมวด A-G จาก coordinator"
    assert len(HOLDOUT_2560_2568) >= 4, "holdout_2560_2568 ต้องมีอย่างน้อยเคสที่พบบั๊กจริง"


def test_fixture_strata_favor_capital_budget_types() -> None:
    """≥ 60% ของ pbo2566 ต้องเป็นงบลงทุน (ครุภัณฑ์/สิ่งก่อสร้าง — เป้าหมายหลักของการเทียบราคา)"""
    n_capital = sum(1 for c in PBO2566 if c["budget_type"] == "งบลงทุน")
    ratio = n_capital / len(PBO2566)
    assert ratio >= 0.60, f"สัดส่วนงบลงทุนใน pbo2566 = {ratio:.1%} (ต้องการ >= 60%)"


def test_fixture_has_required_case_diversity() -> None:
    """ต้องมีเคสที่มีสถานที่, มี qty/unit, มี spec, และไม่มีอะไรเลย (ตาม backlog T-103)"""

    def has_location(c: dict[str, Any]) -> bool:
        e = c["expected"]
        return bool(e.get("province") or e.get("amphoe") or e.get("tambon"))

    has_loc = [c for c in PBO2566 if has_location(c)]
    has_qty = [c for c in PBO2566 if c["expected"].get("qty") is not None]
    has_spec = [c for c in PBO2566 if c["expected"].get("spec_tokens")]
    has_nothing = [
        c
        for c in PBO2566
        if not has_location(c)
        and c["expected"].get("qty") is None
        and not c["expected"].get("spec_tokens")
    ]
    assert has_loc, "fixture ต้องมีเคสที่มีสถานที่ (province/amphoe/tambon)"
    assert has_qty, "fixture ต้องมีเคสที่มี qty/unit"
    assert has_spec, "fixture ต้องมีเคสที่มี spec token"
    assert has_nothing, "fixture ต้องมีเคสที่ไม่มีสถานที่/qty/spec เลย"


def test_province_accuracy_on_fixture() -> None:
    total = len(NON_AMBIGUOUS)
    wrong: list[tuple[object, str, object, object]] = []
    for c in NON_AMBIGUOUS:
        result = parse(c["raw"])
        expected_province = c["expected"].get("province")
        if result.province != expected_province:
            wrong.append((c.get("source_row"), c["raw"], expected_province, result.province))
    correct = total - len(wrong)
    accuracy = correct / total
    assert accuracy >= 0.95, (
        f"province accuracy = {correct}/{total} = {accuracy:.1%} (ต้องการ >= 95%); "
        f"ตัวอย่างที่พลาด (source_row, raw, expected, actual): {wrong[:5]}"
    )


def test_qty_unit_accuracy_on_cases_with_expected_qty() -> None:
    cases_with_qty = [c for c in NON_AMBIGUOUS if c["expected"].get("qty") is not None]
    assert cases_with_qty, "fixture ต้องมีเคสที่ expected มี qty อย่างน้อย 1 เคส"

    wrong: list[tuple[object, str, object, object, object, object]] = []
    for c in cases_with_qty:
        result = parse(c["raw"])
        exp_qty = c["expected"]["qty"]
        exp_unit = c["expected"]["unit"]
        if result.item_qty != exp_qty or result.item_unit != exp_unit:
            wrong.append(
                (
                    c.get("source_row"),
                    c["raw"],
                    exp_qty,
                    exp_unit,
                    result.item_qty,
                    result.item_unit,
                )
            )
    correct = len(cases_with_qty) - len(wrong)
    accuracy = correct / len(cases_with_qty)
    assert accuracy >= 0.90, (
        f"qty+unit accuracy = {correct}/{len(cases_with_qty)} = {accuracy:.1%} (ต้องการ >= 90%); "
        f"ตัวอย่างที่พลาด (source_row, raw, exp_qty, exp_unit, actual_qty, actual_unit): {wrong[:5]}"
    )


def test_item_key_contains_and_not_contains_accuracy() -> None:
    # รวมเคส ambiguous ด้วย — ambiguity เป็นเรื่องของ "qty ตัวไหนคือตัวหลัก" ไม่กระทบว่า
    # keyword คงอยู่/สถานที่ถูกตัดออกจาก item_key หรือไม่
    wrong: list[tuple[object, str, str]] = []
    for c in ALL_CASES:
        result = parse(c["raw"])
        ok = all(kw in result.item_key for kw in c["expected"].get("item_key_contains", []))
        not_contains = c["expected"].get("item_key_not_contains", [])
        ok = ok and all(kw not in result.item_key for kw in not_contains)
        if not ok:
            wrong.append((c.get("source_row"), c["raw"], result.item_key))
    correct = len(ALL_CASES) - len(wrong)
    accuracy = correct / len(ALL_CASES)
    assert accuracy >= 0.90, (
        f"item_key contains/not_contains accuracy = {correct}/{len(ALL_CASES)} = {accuracy:.1%} "
        f"(ต้องการ >= 90%); ตัวอย่างที่พลาด (source_row, raw, item_key): {wrong[:5]}"
    )


def test_quality_flags_contains_on_holdout_cases() -> None:
    """เคส holdout ที่ระบุ `quality_flags_contains` (เช่น qty_is_measure/qty_parsed_low_conf)"""
    checked = 0
    wrong: list[tuple[str, list[str], list[str]]] = []
    for c in HOLDOUT_2563 + HOLDOUT_2560_2568:
        expected_flags = c.get("quality_flags_contains")
        if not expected_flags:
            continue
        checked += 1
        result = parse(c["raw"])
        if not all(f in result.quality_flags for f in expected_flags):
            wrong.append((c["raw"], expected_flags, result.quality_flags))
    assert checked > 0, "ต้องมีเคส holdout ที่ตรวจ quality_flags_contains อย่างน้อย 1 เคส"
    assert not wrong, f"quality_flags ไม่ตรงตามที่ coordinator ระบุ: {wrong}"


# ── property tests (03 backlog T-103 รอบแก้ไข — ตรวจทุกเคสใน fixture) ──────────


def test_property_item_key_never_empty_for_nonempty_input() -> None:
    wrong = []
    for c in ALL_CASES:
        result = parse(c["raw"])
        if c["raw"].strip() and not result.item_key.strip():
            wrong.append((c.get("source_row"), c["raw"]))
    assert not wrong, f"item_key ว่างเปล่าทั้งที่ input ไม่ว่าง: {wrong[:5]}"


def test_property_no_leftover_comma_broken_thousands_in_item_key() -> None:
    """`item_key` ต้องไม่มีรูปแบบเลขคั่นหลักพันที่แตกด้วยช่องว่างจาก comma เดิม (เช่น "30 000")"""
    import re

    # \b ก่อน \d ตัวแรก กันจับ false positive จากรหัสที่มีขีด (เช่น "71-061" -> "71 061" ซึ่ง
    # "1" ตัวหน้าไม่ใช่ต้นคำ ไม่ใช่เลขคั่นหลักพันที่แตกจาก comma จริง)
    broken_re = re.compile(r"\b\d \d{3}\b")
    wrong = []
    for c in ALL_CASES:
        result = parse(c["raw"])
        m = broken_re.search(result.item_key)
        if m:
            wrong.append((c.get("source_row"), c["raw"], result.item_key, m.group()))
    assert not wrong, f"item_key มีเลขคั่นหลักพันที่แตกจาก comma หลงเหลือ: {wrong[:5]}"


def test_property_idempotent_on_all_fixture_cases() -> None:
    """`parse(parse(x).item_key).item_key == parse(x).item_key` ทุกเคสใน fixture (deterministic)"""
    wrong = []
    for c in ALL_CASES:
        first = parse(c["raw"])
        second = parse(first.item_key)
        if second.item_key != first.item_key:
            wrong.append((c.get("source_row"), c["raw"], first.item_key, second.item_key))
    assert not wrong, f"parse ไม่ idempotent: {wrong[:5]}"


# ── unit tests เคสเฉพาะ ──────────────────────────────────────────────────────


def test_documented_example_air_conditioner() -> None:
    """ตัวอย่างจริงจาก docs/02-DATA-INVENTORY.md §A1 (เครื่องปรับอากาศ + สำนักงานพลังงานจังหวัด)"""
    raw = (
        "เครื่องปรับอากาศ แบบแยกส่วน (ราคารวมค่าติดตั้ง) แบบตั้งพื้นหรือแบบแขวน ขนาด 18,000 บีทียู "
        "สำนักงานพลังงานจังหวัดเชียงใหม่ ตำบลช้างเผือก อำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่"
    )
    result = parse(raw)
    assert result.province == "เชียงใหม่"
    assert result.amphoe == "เมืองเชียงใหม่"
    assert result.tambon == "ช้างเผือก"
    assert "18000 บีทียู" in result.spec_tokens
    assert "เชียงใหม่" not in result.item_key
    assert "สำนักงานพลังงาน" not in result.item_key
    assert "เครื่องปรับอากาศ" in result.item_key


def test_documented_example_futsal_field_construction() -> None:
    """ตัวอย่างจริงจาก docs/02-DATA-INVENTORY.md §A1 (ก่อสร้างลานกีฬา + องค์การบริหารส่วนตำบล)"""
    raw = "ก่อสร้างลานกีฬา สนามฟุตซอล บ้านทุ่งฝูง หมู่ที่ 4 องค์การบริหารส่วนตำบลร่องเคาะ อำเภอวังเหนือ จังหวัดลำปาง"
    result = parse(raw)
    assert result.province == "ลำปาง"
    assert result.amphoe == "วังเหนือ"
    assert result.tambon == "ร่องเคาะ"
    assert result.item_key == "ก่อสร้างลานกีฬา สนามฟุตซอล"
    assert "ลำปาง" not in result.item_key
    assert "ร่องเคาะ" not in result.item_key


def test_thai_digits_in_item_name() -> None:
    result = parse("เสาไฟฟ้าส่องสว่าง จำนวน ๕ ต้น ตำบลในเมือง อำเภอเมืองขอนแก่น จังหวัดขอนแก่น")
    assert result.item_qty == 5.0
    assert result.item_unit == "ต้น"
    assert result.province == "ขอนแก่น"


def test_no_location_at_all() -> None:
    result = parse("ค่าใช้จ่ายในการรักษาพยาบาลข้าราชการ ลูกจ้าง และพนักงานของรัฐ")
    assert result.province is None
    assert result.amphoe is None
    assert result.tambon is None
    assert result.location_text is None
    assert result.item_key == "ค่าใช้จ่ายในการรักษาพยาบาลข้าราชการ ลูกจ้าง และพนักงานของรัฐ"


def test_idempotent_parse_of_item_key() -> None:
    raw = (
        "เครื่องปรับอากาศ แบบแยกส่วน (ราคารวมค่าติดตั้ง) แบบตั้งพื้นหรือแบบแขวน ขนาด 18,000 บีทียู "
        "สำนักงานพลังงานจังหวัดเชียงใหม่ ตำบลช้างเผือก อำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่"
    )
    first = parse(raw)
    second = parse(first.item_key)
    assert second.item_key == first.item_key
    # parse ซ้ำต้องไม่ error และไม่เจอสถานที่อีก (ถูกตัดออกไปหมดแล้วในรอบแรก)
    assert second.province is None
    assert second.amphoe is None
    assert second.tambon is None


def test_ban_prefix_does_not_false_positive_on_staff_housing() -> None:
    """'บ้านพักข้าราชการ' ไม่ใช่ชื่อสถานที่ (บ้านX) — ต้องไม่ถูกตัดออกจาก item_key"""
    result = parse("ก่อสร้างบ้านพักข้าราชการของหน่วยป้องกันรักษาป่า ตำบลหนองหญ้าลาด อำเภอกันทรลักษ์ จังหวัดศรีสะเกษ")
    assert "บ้านพักข้าราชการ" in result.item_key
    assert result.province == "ศรีสะเกษ"
    assert result.tambon == "หนองหญ้าลาด"


def test_location_markers_written_without_spaces() -> None:
    """ข้อมูลจริงบางแถวเขียน 'ตำบลXอำเภอY' ติดกันไม่มีช่องว่าง (gotcha ที่พบใน PBO/2566.xlsx)"""
    result = parse("สแกนเนอร์สำหรับงานเก็บเอกสารทั่วไป ตำบลบ่อยางอำเภอเมืองสงขลา จังหวัดสงขลา")
    assert result.tambon == "บ่อยาง"
    assert result.amphoe == "เมืองสงขลา"
    assert result.province == "สงขลา"


def test_org_names_hook() -> None:
    """org_names hook (สำหรับ T-104 org_master ในอนาคต) ตัดชื่อหน่วยงานที่ตรง exact substring"""
    result = parse(
        "พัดลมอุตสาหกรรม กองบังคับการตำรวจจราจร",
        org_names=["กองบังคับการตำรวจจราจร"],
    )
    assert "กองบังคับการตำรวจจราจร" not in result.item_key
    assert "พัดลมอุตสาหกรรม" in result.item_key


def test_dimension_spec_marker_produces_spec_not_qty() -> None:
    """hold-out 2563 ข้อ A: ตัวเลข+หน่วยมิตินำด้วยคำบอกสเปค (กว้าง/ยาว/หนา) ต้องเป็น spec ไม่ใช่ qty"""
    result = parse(
        "ก่อสร้างถนนคอนกรีตเสริมเหล็ก กว้าง 4.00 เมตร ยาว 500.00 เมตร หนา 0.15 เมตร "
        "ตำบลแสนสุข อำเภอวารินชำราบ จังหวัดอุบลราชธานี"
    )
    assert result.item_qty is None
    assert result.item_unit is None
    assert "qty_parsed_low_conf" not in result.quality_flags
    assert {"4 เมตร", "500 เมตร", "0.15 เมตร"}.issubset(set(result.spec_tokens))


def test_qty_parsed_low_conf_flag_when_jamnuan_competes_with_measure() -> None:
    """hold-out 2563 ข้อ A ข้อ 4: 'จำนวน' ต้องชนะ 'พื้นที่' และติดธง qty_parsed_low_conf"""
    result = parse(
        "ซ่อมแซมคลองส่งน้ำสายใหญ่และสายซอย จำนวน 3 สายพื้นที่ 2,890 ตารางเมตร "
        "ระบบกระจายน้ำบ้านเขว้า โครงการส่งน้ำและบำรุงรักษามูลกลาง "
        "ตำบลบ้านแพ อำเภอคูเมือง จังหวัดบุรีรัมย์"
    )
    assert result.item_qty == 3.0
    assert result.item_unit == "สาย"
    assert "qty_parsed_low_conf" in result.quality_flags


# --- hold-out 2565 (main thread): canonical key เพื่อให้รายการเดียวกัน group กันได้ ---
@pytest.mark.parametrize(
    ("raw", "expected_key"),
    [
        (
            "เครื่องคอมพิวเตอร์โน้ตบุ๊กสำหรับงานประมวลผลจำนวน 4 เครื่อง",
            "เครื่องคอมพิวเตอร์โน้ตบุ๊กสำหรับงานประมวลผล",
        ),
        (
            "เครื่องคอมพิวเตอร์โน้ตบุ๊กสำหรับงานประมวลผล จำนวน 2 เครื่อง",
            "เครื่องคอมพิวเตอร์โน้ตบุ๊กสำหรับงานประมวลผล",
        ),
    ],
)
def test_item_key_drops_dangling_count_word(raw: str, expected_key: str) -> None:
    assert parse(raw).item_key == expected_key


def test_item_key_spaces_digits_glued_to_thai_units() -> None:
    glued = parse("รถบรรทุก (ดีเซล) ขนาด 1ตัน ขับเคลื่อน 2ล้อ แบบดับเบิ้ลแค็บ").item_key
    spaced = parse("รถบรรทุก (ดีเซล) ขนาด 1 ตัน ขับเคลื่อน 2 ล้อ แบบดับเบิ้ลแค็บ").item_key
    assert glued == spaced
    assert "1 ตัน" in glued and "2 ล้อ" in glued


def test_item_key_drops_dangling_measure_tail_and_stays_idempotent() -> None:
    key = parse(
        "อาคารบังคับน้ำลำห้วยวังแก้งพื้นที่รับผลประโยชน์ 620 ไร่ตำบลพะลาน อำเภอนาตาลจังหวัดอุบลราชธานี"
    ).item_key
    assert key == "อาคารบังคับน้ำลำห้วยวังแก้ง"
    assert parse(key).item_key == key
