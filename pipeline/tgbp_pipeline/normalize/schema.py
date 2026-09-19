"""Canonical pydantic schemas — 03-DATA-PIPELINE.md §3

หมายเหตุ: ตอนนี้ (T-101/T-102) implement เฉพาะ `SourceDoc` (ต้องใช้ใน `inventory.py`)
`BudgetLine` และ `EconIndicator` จะเพิ่มใน T-105+ / T-111 ตามลำดับ backlog
เพื่อไม่ให้สร้าง schema ที่ยังไม่มีโค้ดใช้จริง (และยังไม่ผ่านการตรวจข้อมูลจริงตาม 02)
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
