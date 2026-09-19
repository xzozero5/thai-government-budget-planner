"""Master ข้อมูลกระทรวง/หน่วยงาน + fuzzy matcher (T-104) — 03-DATA-PIPELINE.md §5 ข้อ 3, §7

Master สร้างจาก sheet `Data` ของ A2 (ร่าง พ.ร.บ. งบ 2570 ฉบับเต็ม - Excel.xlsx) — คอลัมน์
`min/min_name/agc/agc_name` ยืนยันแล้วว่ามี **33 กระทรวง (รวม pseudo-ministry ของสำนักงบฯ)**
และ **3,289 กรม/กรมเทียบเท่า** ครบทั้ง 9 กลุ่ม pseudo-ministry ที่ระบุใน docs/03 §3.1
(งบกลาง=90000, จังหวัดและกลุ่มจังหวัด=70000, รัฐวิสาหกิจ=50000,
กองทุนและเงินทุนหมุนเวียน=80000, หน่วยงานของรัฐสภา=27000/ศาล=28000/องค์กรอิสระ=29000,
ส่วนราชการไม่สังกัดฯ=25000, สภากาชาดไทย=60000, รายจ่ายเพื่อชดใช้เงินคงคลัง=95000,
ส่วนราชการในพระองค์=56000) — จึง**ไม่ต้องสร้าง synthetic code** สำหรับข้อมูลจริงชุดนี้
(กลไก synthetic `X-xx` ยังคงมีไว้เผื่ออนาคตที่ A2 อาจไม่ครอบคลุมกลุ่มใดกลุ่มหนึ่ง)

รหัสกระทรวง/กรมเก็บเป็น **string เสมอ** (ความยาว 5 ตัวอักษรเท่ากันทุกตัว แต่บาง `agc` เป็น
รหัส อปท. ที่ผสมตัวอักษร เช่น `7510A`, `7511E` — แปลงเป็น int ไม่ได้)

รหัส `agc` บางตัวถูกใช้ซ้ำโดยตั้งใจ (เช่น `80808` = กองทุนต่าง ๆ ที่ไหลผ่านกรม/สนง.
เจ้าของกองทุนคนละหน่วยงานกัน 35 ชื่อ) — เลือกชื่อที่พบบ่อยที่สุดเป็น canonical, ชื่ออื่นเป็น
alias ที่ derive จากข้อมูลเอง (ไม่กระทบการ `match()` เพราะยังคืน code เดียวกันถูกต้อง)

`match()` ใช้ลำดับ exact (หลัง `thai_text.clean`) → alias (`org_aliases.yaml` + alias ที่พบใน
A2 เอง) → rapidfuzz (`fuzz.WRatio`, threshold ≥ 92, จำกัด candidate ภายในกระทรวงเดียวกัน
ที่ resolve ได้แล้วเท่านั้น) → `None` + flag `org_unmapped`
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Literal

import openpyxl
import yaml
from rapidfuzz import fuzz, process

from tgbp_pipeline.config import PipelineConfig, load_config
from tgbp_pipeline.normalize.thai_text import clean

CACHE_FILENAME = "org_master.json"
ALIASES_FILENAME = "org_aliases.yaml"
A2_DATA_SHEET = "Data"

FUZZY_THRESHOLD = 92.0
_EXACT_SCORE = 100.0
_ALIAS_SCORE = 95.0

SYNTHETIC_CODE_PREFIX = "X-"

# 03-DATA-PIPELINE.md §3.1 — กลุ่ม pseudo-ministry ของสำนักงบประมาณที่ไม่ใช่กระทรวงจริง
# (คำค้นเป็น substring ของชื่อกระทรวงหลัง clean() — ยืนยันแล้วว่า A2 มีครบทุกกลุ่ม 19 ก.ย. 2569)
PSEUDO_MINISTRY_KEYWORDS: tuple[str, ...] = (
    "งบกลาง",
    "จังหวัดและกลุ่มจังหวัด",
    "รัฐวิสาหกิจ",
    "ทุนหมุนเวียน",  # ครอบคลุมทั้ง "กองทุนและเงินทุนหมุนเวียน" และ "ทุนหมุนเวียน"
    "หน่วยงานของรัฐสภา",
    "หน่วยงานของศาล",
    "องค์กรอิสระ",
    "ส่วนราชการไม่สังกัด",
    "สภากาชาดไทย",
    "รายจ่ายเพื่อชดใช้เงินคงคลัง",
    "ส่วนราชการในพระองค์",
)

OrgLevel = Literal["ministry", "agency"]
MatchMethod = Literal["exact", "alias", "fuzzy", "none"]


@dataclass(frozen=True)
class OrgRecord:
    """หนึ่งแถวของ master — กระทรวง (`level="ministry"`) หรือ กรม/หน่วยงาน (`level="agency"`)"""

    code: str
    name: str
    level: OrgLevel
    ministry_code: str | None  # None สำหรับ ministry เอง; FK ไปกระทรวงแม่สำหรับ agency
    aliases: tuple[str, ...] = ()
    synthetic: bool = False  # True เฉพาะ code ที่ pipeline ตั้งเอง (prefix `X-`) เมื่อ A2 ไม่มีให้


@dataclass(frozen=True)
class OrgMatch:
    """ผลลัพธ์ของ `OrgMaster.match()`"""

    ministry_code: str | None
    agency_code: str | None
    score: float
    method: MatchMethod
    flags: tuple[str, ...] = ()


@dataclass
class _RawAgencyAgg:
    ministry_code: str | None = None
    names: Counter[str] = field(default_factory=Counter)


def _code_str(value: object) -> str:
    """เก็บรหัสกระทรวง/กรมเป็น string เสมอ — บาง `agc` ผสมตัวอักษร (เช่น `7510A`)"""
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _cell_text(value: object) -> str:
    if value is None:
        return ""
    return clean(str(value))


def _iter_a2_rows(a2_path: str | Path):
    """stream (min_code, min_name, agc_code, agc_name) จาก sheet `Data` ของ A2 (read_only)"""
    wb = openpyxl.load_workbook(str(a2_path), read_only=True, data_only=True)
    try:
        ws = wb[A2_DATA_SHEET]
        rows = ws.iter_rows(values_only=True)
        header = next(rows)
        idx = {name: i for i, name in enumerate(header)}
        required = ("min", "min_name", "agc", "agc_name")
        missing = [c for c in required if c not in idx]
        if missing:
            raise ValueError(
                f"A2 sheet '{A2_DATA_SHEET}' ขาดคอลัมน์ {missing} (header จริง: {header})"
            )
        for row in rows:
            yield (
                _code_str(row[idx["min"]]),
                _cell_text(row[idx["min_name"]]),
                _code_str(row[idx["agc"]]),
                _cell_text(row[idx["agc_name"]]),
            )
    finally:
        wb.close()


def _pick_canonical(counter: Counter[str]) -> str:
    """เลือกชื่อที่พบบ่อยที่สุดเป็น canonical; เท่ากันให้เรียงตัวอักษร (deterministic)"""
    max_count = max(counter.values())
    candidates = sorted(name for name, count in counter.items() if count == max_count)
    return candidates[0]


def _load_alias_file(alias_path: str | Path | None) -> dict[str, dict[str, list[str]]]:
    """โหลด `org_aliases.yaml` — คืน `{"ministry": {canonical_clean: [alias, ...]}}` (+ agency)"""
    path = Path(alias_path) if alias_path is not None else _default_alias_path()
    if not path.is_file():
        return {"ministry": {}, "agency": {}}
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    out: dict[str, dict[str, list[str]]] = {"ministry": {}, "agency": {}}
    for section in ("ministry", "agency"):
        for canonical, aliases in (raw.get(section) or {}).items():
            out[section][clean(str(canonical))] = [clean(str(a)) for a in (aliases or [])]
    return out


def _default_alias_path() -> Path:
    return Path(__file__).resolve().parent / ALIASES_FILENAME


def _make_record(
    code: str,
    name_counter: Counter[str],
    level: OrgLevel,
    ministry_code: str | None,
    yaml_aliases_by_canonical: dict[str, list[str]],
) -> OrgRecord:
    canonical = _pick_canonical(name_counter)
    data_aliases = {name for name in name_counter if name != canonical}
    yaml_aliases = set(yaml_aliases_by_canonical.get(canonical, []))
    all_aliases = tuple(sorted(data_aliases | yaml_aliases))
    return OrgRecord(
        code=code, name=canonical, level=level, ministry_code=ministry_code, aliases=all_aliases
    )


def _ensure_pseudo_ministries(ministries: list[OrgRecord]) -> list[OrgRecord]:
    """เติม synthetic ministry (`X-xx`) เฉพาะกลุ่ม pseudo ที่ A2 **ไม่มี** ให้จริง

    ยืนยันแล้ว 19 ก.ย. 2569: A2 มีครบทั้ง 11 keyword (13 รหัสกระทรวง รวมที่แยกย่อย
    หน่วยงานของรัฐสภา/ศาล/องค์กรอิสระเป็น 3 รหัส) — ฟังก์ชันนี้จึงไม่เพิ่มอะไรกับข้อมูลชุดนี้
    แต่ยังคงตรวจไว้เผื่อ A2 เวอร์ชันอนาคตเปลี่ยน
    """
    haystack = " | ".join(clean(m.name) for m in ministries)
    missing = [kw for kw in PSEUDO_MINISTRY_KEYWORDS if kw not in haystack]
    extra = [
        OrgRecord(
            code=f"{SYNTHETIC_CODE_PREFIX}{i + 1:02d}",
            name=keyword,
            level="ministry",
            ministry_code=None,
            aliases=(),
            synthetic=True,
        )
        for i, keyword in enumerate(missing)
    ]
    return [*ministries, *extra]


def build_org_master(
    a2_path: str | Path,
    cfg: PipelineConfig | None = None,
    alias_path: str | Path | None = None,
    write_cache: bool = True,
) -> OrgMaster:
    """สร้าง `OrgMaster` จาก A2 sheet `Data` + `org_aliases.yaml` แล้วเขียน cache (ถ้า `write_cache`)"""
    ministry_agg: dict[str, Counter[str]] = defaultdict(Counter)
    agency_agg: dict[str, _RawAgencyAgg] = defaultdict(_RawAgencyAgg)

    for min_code, min_name, agc_code, agc_name in _iter_a2_rows(a2_path):
        if not min_code:
            continue
        ministry_agg[min_code][min_name] += 1
        if agc_code:
            agg = agency_agg[agc_code]
            if agg.ministry_code is None:
                agg.ministry_code = min_code
            agg.names[agc_name] += 1

    aliases = _load_alias_file(alias_path)

    ministries = [
        _make_record(code, counter, "ministry", None, aliases["ministry"])
        for code, counter in ministry_agg.items()
    ]
    ministries = _ensure_pseudo_ministries(ministries)

    agencies = [
        _make_record(code, agg.names, "agency", agg.ministry_code, aliases["agency"])
        for code, agg in agency_agg.items()
    ]

    org_master = OrgMaster(ministries=ministries, agencies=agencies)

    if write_cache:
        if cfg is None:
            cfg = load_config()
        write_org_master_cache(org_master, cfg, source_path=Path(a2_path))

    return org_master


def _record_to_dict(record: OrgRecord) -> dict:
    return {
        "code": record.code,
        "name": record.name,
        "level": record.level,
        "ministry_code": record.ministry_code,
        "aliases": list(record.aliases),
        "synthetic": record.synthetic,
    }


def write_org_master_cache(org_master: OrgMaster, cfg: PipelineConfig, source_path: Path) -> Path:
    """เขียน `pipeline/.cache/org_master.json` (guard N6 ผ่าน `assert_writable_path`)"""
    cache_path = cfg.assert_writable_path(cfg.cache_dir / CACHE_FILENAME)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source_a2_path": str(source_path),
        "ministries": [_record_to_dict(m) for m in org_master.ministries],
        "agencies": [_record_to_dict(a) for a in org_master.agencies],
    }
    cache_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n"
    )
    return cache_path


def load_org_master_cache(cfg: PipelineConfig | None = None) -> OrgMaster | None:
    """โหลด `OrgMaster` จาก cache json ที่ `build_org_master` เขียนไว้ — `None` ถ้ายังไม่มี"""
    if cfg is None:
        cfg = load_config()
    cache_path = cfg.cache_dir / CACHE_FILENAME
    if not cache_path.is_file():
        return None
    payload = json.loads(cache_path.read_text(encoding="utf-8"))
    ministries = [_record_from_dict(d) for d in payload["ministries"]]
    agencies = [_record_from_dict(d) for d in payload["agencies"]]
    return OrgMaster(ministries=ministries, agencies=agencies)


def _record_from_dict(d: dict) -> OrgRecord:
    return OrgRecord(
        code=d["code"],
        name=d["name"],
        level=d["level"],
        ministry_code=d["ministry_code"],
        aliases=tuple(d.get("aliases", [])),
        synthetic=d.get("synthetic", False),
    )


def export_catalog_orgs(org_master: OrgMaster) -> list[dict]:
    """export สำหรับ `catalog/orgs.json` (03 §7) — T-110 เป็นคนเขียนไฟล์จริง"""
    return [_record_to_dict(m) for m in org_master.ministries] + [
        _record_to_dict(a) for a in org_master.agencies
    ]


class OrgMaster:
    """Master กระทรวง/หน่วยงาน + fuzzy matcher — ดู module docstring"""

    def __init__(self, ministries: list[OrgRecord], agencies: list[OrgRecord]) -> None:
        self.ministries: tuple[OrgRecord, ...] = tuple(ministries)
        self.agencies: tuple[OrgRecord, ...] = tuple(agencies)

        self._ministry_by_code: dict[str, OrgRecord] = {m.code: m for m in self.ministries}
        self._agency_by_code: dict[str, OrgRecord] = {a.code: a for a in self.agencies}

        # exact/alias index: clean(name หรือ alias) -> code ; canonical set แยกไว้บอก exact vs alias
        self._ministry_index: dict[str, str] = {}
        self._ministry_canonical_keys: set[str] = set()
        for m in self.ministries:
            canonical_key = clean(m.name)
            self._ministry_index.setdefault(canonical_key, m.code)
            self._ministry_canonical_keys.add(canonical_key)
            for alias in m.aliases:
                self._ministry_index.setdefault(clean(alias), m.code)

        # fuzzy choices: list ขนาน (ชื่อ clean แล้ว, code) — ใช้ index กลับเป็น code
        self._ministry_fuzzy_names: list[str] = []
        self._ministry_fuzzy_codes: list[str] = []
        for m in self.ministries:
            self._ministry_fuzzy_names.append(clean(m.name))
            self._ministry_fuzzy_codes.append(m.code)
            for alias in m.aliases:
                self._ministry_fuzzy_names.append(clean(alias))
                self._ministry_fuzzy_codes.append(m.code)

        self._agency_index_by_ministry: dict[str, dict[str, str]] = defaultdict(dict)
        self._agency_canonical_keys: dict[str, set[str]] = defaultdict(set)
        self._agency_fuzzy_by_ministry: dict[str, tuple[list[str], list[str]]] = {}
        # global exact index (ใช้เมื่อ resolve ministry ไม่ได้เลย) — ชื่อที่ชี้ไปหลาย code ต่างกัน
        # ถือว่ากำกวม ตัดทิ้งจาก global fallback (ยืนยันแล้วใน A2 จริงไม่มีเคสนี้)
        self._agency_global_index: dict[str, str] = {}
        ambiguous_keys: set[str] = set()

        for a in self.agencies:
            m_code = a.ministry_code or ""
            canonical_key = clean(a.name)
            per_ministry = self._agency_index_by_ministry[m_code]
            per_ministry.setdefault(canonical_key, a.code)
            self._agency_canonical_keys[m_code].add(canonical_key)

            names, codes = self._agency_fuzzy_by_ministry.setdefault(m_code, ([], []))
            names.append(canonical_key)
            codes.append(a.code)

            all_keys = [canonical_key, *(clean(alias) for alias in a.aliases)]
            for key in all_keys:
                per_ministry.setdefault(key, a.code)
                if key != canonical_key:
                    names.append(key)
                    codes.append(a.code)
                existing = self._agency_global_index.get(key)
                if existing is None:
                    self._agency_global_index[key] = a.code
                elif existing != a.code:
                    ambiguous_keys.add(key)

        for key in ambiguous_keys:
            del self._agency_global_index[key]

        self._match_cached = lru_cache(maxsize=200_000)(self._match_impl)

    # -- public API ---------------------------------------------------

    def match(self, ministry_name: str | None, agency_name: str | None) -> OrgMatch:
        """หา (ministry_code, agency_code) จากชื่อดิบ — cache LRU (เรียกซ้ำ ๆ ~3 ล้านครั้งได้)"""
        return self._match_cached(ministry_name or "", agency_name or "")

    def cache_info(self):
        return self._match_cached.cache_info()

    # -- internals ------------------------------------------------------

    def _resolve_ministry(self, raw_name: str) -> tuple[str | None, MatchMethod, float]:
        if not raw_name:
            return None, "none", 0.0
        key = clean(raw_name)
        code = self._ministry_index.get(key)
        if code is not None:
            method: MatchMethod = "exact" if key in self._ministry_canonical_keys else "alias"
            score = _EXACT_SCORE if method == "exact" else _ALIAS_SCORE
            return code, method, score
        if not self._ministry_fuzzy_names:
            return None, "none", 0.0
        result = process.extractOne(
            key, self._ministry_fuzzy_names, scorer=fuzz.WRatio, score_cutoff=FUZZY_THRESHOLD
        )
        if result is None:
            return None, "none", 0.0
        _matched_name, score, index = result
        return self._ministry_fuzzy_codes[index], "fuzzy", float(score)

    def _resolve_agency_within_ministry(
        self, raw_name: str, ministry_code: str
    ) -> tuple[str | None, MatchMethod, float]:
        if not raw_name:
            return None, "none", 0.0
        key = clean(raw_name)
        per_ministry = self._agency_index_by_ministry.get(ministry_code)
        if per_ministry:
            code = per_ministry.get(key)
            if code is not None:
                canonical_keys = self._agency_canonical_keys.get(ministry_code, set())
                method: MatchMethod = "exact" if key in canonical_keys else "alias"
                score = _EXACT_SCORE if method == "exact" else _ALIAS_SCORE
                return code, method, score

        names_codes = self._agency_fuzzy_by_ministry.get(ministry_code)
        if not names_codes or not names_codes[0]:
            return None, "none", 0.0
        names, codes = names_codes
        result = process.extractOne(key, names, scorer=fuzz.WRatio, score_cutoff=FUZZY_THRESHOLD)
        if result is None:
            return None, "none", 0.0
        _matched_name, score, index = result
        return codes[index], "fuzzy", float(score)

    def _resolve_agency_global(self, raw_name: str) -> tuple[str | None, MatchMethod, float]:
        """ใช้เฉพาะตอน resolve กระทรวงไม่ได้เลย — exact/alias เท่านั้น (ห้าม fuzzy ข้ามกระทรวง)"""
        if not raw_name:
            return None, "none", 0.0
        key = clean(raw_name)
        code = self._agency_global_index.get(key)
        if code is None:
            return None, "none", 0.0
        agency = self._agency_by_code[code]
        method: MatchMethod = "exact" if key == clean(agency.name) else "alias"
        score = _EXACT_SCORE if method == "exact" else _ALIAS_SCORE
        return code, method, score

    _METHOD_ORDER: dict[MatchMethod, int] = {"none": 0, "fuzzy": 1, "alias": 2, "exact": 3}

    def _match_impl(self, ministry_name: str, agency_name: str) -> OrgMatch:
        flags: list[str] = []

        ministry_code, ministry_method, ministry_score = self._resolve_ministry(ministry_name)

        if ministry_code is not None:
            agency_code, agency_method, agency_score = self._resolve_agency_within_ministry(
                agency_name, ministry_code
            )
            method = (
                agency_method
                if self._METHOD_ORDER[agency_method] <= self._METHOD_ORDER[ministry_method]
                else ministry_method
            )
            score = min(ministry_score, agency_score) if agency_code is not None else 0.0
        else:
            flags.append("ministry_unmapped")
            agency_code, agency_method, agency_score = self._resolve_agency_global(agency_name)
            if agency_code is not None:
                ministry_code = self._agency_by_code[agency_code].ministry_code
                flags.remove("ministry_unmapped")
            method = agency_method
            score = agency_score

        if agency_code is None:
            flags.append("org_unmapped")
            method = "none"
            score = 0.0

        return OrgMatch(
            ministry_code=ministry_code,
            agency_code=agency_code,
            score=score,
            method=method,
            flags=tuple(flags),
        )
