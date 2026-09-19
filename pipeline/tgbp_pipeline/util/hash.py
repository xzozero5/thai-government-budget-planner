"""Hash helpers ที่ใช้ร่วมกันทั้ง pipeline (T-101/T-102)

- `source_id` ตาม 03-DATA-PIPELINE.md §3.1: `sha1(dataset|rel_path|sheet|row_index)[:16]`
  ใช้ผูก `BudgetLine` แต่ละแถวกลับไปยังต้นทาง (file/sheet/row) แบบ **คงที่ข้ามการรัน**
- `doc_id_for_path` ตาม §3.2: `"d_" + sha1(rel_path แบบ posix, NFC)[:12]` ใช้เป็น key ของ
  `SourceDoc` ใน `sources.json` (T-101 `inventory.py`)

ทั้งสองฟังก์ชัน normalize path เป็น posix (`/`) และ Unicode NFC ก่อน hash เสมอ
เพื่อไม่ให้ผลต่างกันระหว่าง Windows (`\\`) กับ POSIX
"""

from __future__ import annotations

import hashlib
import unicodedata


def _posix_path(rel_path: str) -> str:
    """แปลง path separator เป็น posix (`/`) โดยไม่แตะเนื้อหา unicode อื่น ๆ"""
    return rel_path.replace("\\", "/")


def source_id(dataset: str, rel_path: str, sheet: str | None, row_index: int) -> str:
    """`source_id` คงที่ของหนึ่งแถวใน `budget_lines`

    `sheet` เป็น `None` ได้ (เช่นข้อมูลที่ไม่มีแนวคิด sheet) → ใช้สตริงว่างแทนในการ hash
    """
    posix_rel_path = _posix_path(rel_path)
    joined = "|".join([dataset, posix_rel_path, sheet or "", str(row_index)])
    normalized = unicodedata.normalize("NFC", joined)
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:16]


def doc_id_for_path(rel_path: str) -> str:
    """`doc_id` คงที่ของไฟล์หนึ่งไฟล์ใน `sources.json` (`"d_" + sha1(...)[:12]`)"""
    posix_rel_path = _posix_path(rel_path)
    normalized = unicodedata.normalize("NFC", posix_rel_path)
    return "d_" + hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:12]


def sha1_file(path: str, chunk_size: int = 8 * 1024 * 1024) -> str:
    """sha1 ของเนื้อไฟล์ทั้งก้อน อ่านแบบ stream ทีละ `chunk_size` ไบต์

    ใช้กับไฟล์ใหญ่ (มีไฟล์ ~260 MB ใน raw data) โดยไม่ต้องโหลดทั้งไฟล์เข้า memory
    """
    hasher = hashlib.sha1()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            hasher.update(chunk)
    return hasher.hexdigest()
