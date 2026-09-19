"""Canonical pydantic schemas — 03-DATA-PIPELINE.md §3

หมายเหตุ: `SourceDoc` มาจาก T-101 · `BudgetLine` เพิ่มใน T-105 (ตาม 03 §3.1) ให้ extractor อื่น
(T-106..T-109) ใช้ร่วมกันได้ — ทุกฟิลด์ที่ต้องรอขั้น normalize (item_parser/org_master เช่น
`item_name`, `item_key`, `ministry_code`, `province`) เป็น optional เพราะ extract stage ของ
แต่ละ dataset (เช่น `extract/pbo.py`) ยังไม่ทำ normalize (T-102..T-104 ทำขนาน/ภายหลัง)
`EconIndicator` จะเพิ่มใน T-111 ตามลำดับ backlog
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# ตาม 03 §3.2: "committee|province_budget|open_sso|pbo"
Collection = Literal["committee", "province_budget", "open_sso", "pbo"]

# ตาม 03 §3.2: "pdf|xlsx|xls|docx|pptx|jpg|other"
# เพิ่ม "zip-office" สำหรับไฟล์ไม่มีนามสกุล/นามสกุลแปลกที่ magic bytes เป็น zip (PK)
# แต่ยังแยกชนิด xlsx/docx/pptx ที่แท้จริงจากโครงสร้างภายในไม่ได้ (ดูรายงาน T-101)
Kind = Literal["pdf", "xlsx", "xls", "docx", "pptx", "jpg", "zip-office", "other"]

GovLevel = Literal["central", "local", "state_enterprise"]


class SourceDoc(BaseModel):
    """เมทาดาทาของไฟล์ดิบหนึ่งไฟล์ — แถวหนึ่งใน `sources.json` (03 §3.2)"""

    model_config = ConfigDict(extra="forbid")

    doc_id: str
    rel_path: str
    kind: Kind
    bytes: int
    sha1: str

    pages: int | None = None
    has_text_layer: bool | None = None
    extracted: bool = False

    title_guess: str | None = None
    collection: Collection

    meeting_no: int | None = None
    meeting_date: str | None = None  # ISO พ.ศ. เช่น "2569-06-04"
    topic: str | None = None
    agency_guess: str | None = None

    province: str | None = None
    gov_level: GovLevel | None = None
    level: str | None = None  # ระดับ อปท./คำอธิบายโฟลเดอร์ ตามจริง (เช่น "งบ อบจ. เชียงใหม่")

    fiscal_years: list[int] = Field(default_factory=list)

    text_chunks_file: str | None = None
    note: str | None = None

    # ไฟล์ที่ sha1 ซ้ำกัน (03 §4.2) — เก็บไว้เฉพาะที่ตัวหลัก (ตัวแรกตามลำดับตัวอักษรของ rel_path)
    duplicates: list[str] | None = None


# ตาม 03 §3.1
Dataset = Literal[
    "pbo_disbursement",
    "act_2570_draft",
    "act_2570_province",
    "local_ordinance_2570",
    "local_subsidy_2570",
    "committee_table",
]


class BudgetLine(BaseModel):
    """แถวหนึ่งในตาราง `budget_lines` (canonical, 03 §3.1) — dataset ทุกตัวใช้ schema เดียวกัน

    Extract stage (T-105..T-109) กรอกเฉพาะฟิลด์ที่รู้ได้จากไฟล์ต้นทางตรง ๆ; ฟิลด์ที่ต้องผ่าน
    `normalize/` (item_parser/org_master — T-102..T-104) ปล่อยเป็น `None` ไว้ก่อน แล้ว
    ขั้น normalize จะเติมทีหลัง (ไม่ใช่หน้าที่ของ extractor)
    """

    model_config = ConfigDict(extra="forbid")

    source_id: str
    dataset: Dataset

    fiscal_year_be: int | None = None
    fiscal_year_ce: int | None = None

    gov_level: GovLevel | None = None
    ministry: str | None = None
    ministry_code: str | None = None
    agency: str | None = None
    agency_code: str | None = None
    province: str | None = None
    local_gov_name: str | None = None

    strategy: str | None = None
    plan: str | None = None
    output_project: str | None = None
    activity: str | None = None

    budget_type: str | None = None
    expense_category: str | None = None
    is_capital: bool | None = None

    item_name_raw: str | None = None
    item_name: str | None = None
    item_key: str | None = None
    item_qty: float | None = None
    item_unit: str | None = None
    spec_tokens: list[str] = Field(default_factory=list)
    location_text: str | None = None

    amount_thb: int | None = None
    unit_price_thb: int | None = None
    revised_thb: int | None = None
    po_thb: int | None = None
    disbursed_thb: int | None = None
    disbursed_incl_po_thb: int | None = None
    reserved_thb: int | None = None
    carryover_thb: int | None = None
    disbursement_rate: float | None = None

    description: str | None = None
    legal_reference: str | None = None

    source_path: str
    source_sheet: str | None = None
    source_row: int | None = None
    source_page: int | None = None
    source_doc_id: str

    quality_flags: list[str] = Field(default_factory=list)
