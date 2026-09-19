"""T-102: `normalize/money.py` — ล้านบาท→บาท, parse_baht, edge cases"""

from __future__ import annotations

from tgbp_pipeline.normalize.money import parse_baht, to_baht_from_million


class TestToBahtFromMillion:
    def test_simple_integer_million(self) -> None:
        assert to_baht_from_million(1) == 1_000_000

    def test_decimal_million_string(self) -> None:
        # ทศนิยม 4 ตำแหน่งของล้านบาท = 100 บาท ความละเอียด
        assert to_baht_from_million("1.2345") == 1_234_500

    def test_smallest_unit_0001_million_equals_100_baht(self) -> None:
        assert to_baht_from_million("0.0001") == 100
        assert to_baht_from_million(0.0001) == 100

    def test_float_input_no_precision_error(self) -> None:
        # ค่าที่ทำให้ float คูณตรง ๆ พังบ่อย (0.1 * 1_000_000 != 100000.0 เป๊ะในบาง lib)
        assert to_baht_from_million(0.1) == 100_000
        assert to_baht_from_million(1.1) == 1_100_000

    def test_dash_and_empty_string_are_none(self) -> None:
        assert to_baht_from_million("-") == None  # noqa: E711
        assert to_baht_from_million("") == None  # noqa: E711
        assert to_baht_from_million("   ") is None

    def test_none_is_none(self) -> None:
        assert to_baht_from_million(None) is None

    def test_thai_digit_string(self) -> None:
        assert to_baht_from_million("๑.๕") == 1_500_000

    def test_comma_thousands_separator(self) -> None:
        assert to_baht_from_million("1,234.5") == 1_234_500_000

    def test_negative_value_kept_as_is(self) -> None:
        assert to_baht_from_million("-1.5") == -1_500_000

    def test_negative_parentheses(self) -> None:
        assert to_baht_from_million("(1.5)") == -1_500_000

    def test_zero(self) -> None:
        assert to_baht_from_million("0") == 0
        assert to_baht_from_million(0) == 0


class TestParseBaht:
    def test_plain_integer(self) -> None:
        assert parse_baht(9_043_395_000) == 9_043_395_000

    def test_comma_separated_string(self) -> None:
        assert parse_baht("9,043,395,000") == 9_043_395_000

    def test_dash_is_none(self) -> None:
        assert parse_baht("-") is None

    def test_empty_is_none(self) -> None:
        assert parse_baht("") is None
        assert parse_baht(None) is None

    def test_negative_parentheses(self) -> None:
        assert parse_baht("(500)") == -500

    def test_thai_digits(self) -> None:
        assert parse_baht("๑๒๓๔") == 1234

    def test_float_with_fraction_rounds_half_up(self) -> None:
        assert parse_baht(1234.5) == 1235
        assert parse_baht("1234.4") == 1234

    def test_zero_width_space_in_string_is_ignored(self) -> None:
        assert parse_baht("1,234​") == 1234
