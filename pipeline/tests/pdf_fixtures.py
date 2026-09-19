"""Helper สร้าง PDF ขั้นต่ำ (byte-exact, xref offset ถูกต้อง) สำหรับเทสต์ `inventory.py`

ไม่พึ่ง reportlab/fpdf (ไม่มีใน deps ของ pipeline) — ประกอบ PDF object stream เองตรง ๆ
pypdf (`strict=False`) และ pdfplumber อ่านไฟล์ที่สร้างจากฟังก์ชันเหล่านี้ได้จริง
(ตรวจแล้วด้วยมือก่อนใช้ในเทสต์)
"""

from __future__ import annotations


def _build_pdf(objects: list[bytes]) -> bytes:
    header = b"%PDF-1.4\n"
    offsets: list[int] = [0]
    offset = len(header)
    body_parts: list[bytes] = []
    for i, obj in enumerate(objects, start=1):
        offsets.append(offset)
        entry = f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
        body_parts.append(entry)
        offset += len(entry)
    body_bytes = b"".join(body_parts)
    xref_offset = len(header) + len(body_bytes)
    n = len(objects) + 1
    xref = f"xref\n0 {n}\n".encode() + b"0000000000 65535 f \n"
    for off in offsets[1:]:
        xref += f"{off:010d} 00000 n \n".encode()
    trailer = f"trailer\n<< /Size {n} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF".encode()
    return header + body_bytes + xref + trailer


def make_pdf_with_text(text: str = "Hello", n_pages: int = 1) -> bytes:
    """PDF ที่มี text layer จริง (เพียงพอผ่าน `has_text_layer` threshold ถ้า `text` ยาวพอ)"""
    stream = f"BT /F1 12 Tf 10 100 Td ({text}) Tj ET".encode()
    content_obj = f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream"

    page_refs = " ".join(f"{3 + i} 0 R" for i in range(n_pages))
    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{page_refs}] /Count {n_pages} >>".encode(),
    ]
    content_obj_num = 3 + n_pages
    font_obj_num = content_obj_num + 1
    for _ in range(n_pages):
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 {font_obj_num} 0 R >> >>"
                f" /MediaBox [0 0 200 200] /Contents {content_obj_num} 0 R >>"
            ).encode()
        )
    objects.append(content_obj)
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    return _build_pdf(objects)


def make_pdf_no_text(n_pages: int = 1) -> bytes:
    """PDF ที่มีหน้าจริงแต่ไม่มี text (เหมือน PDF สแกนที่ไม่มี text layer)"""
    content_obj_num = 3 + n_pages
    page_refs = " ".join(f"{3 + i} 0 R" for i in range(n_pages))
    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{page_refs}] /Count {n_pages} >>".encode(),
    ]
    for _ in range(n_pages):
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 200 200]"
                f" /Contents {content_obj_num} 0 R >>"
            ).encode()
        )
    objects.append(b"<< /Length 0 >>\nstream\n\nendstream")
    return _build_pdf(objects)


def make_corrupt_pdf() -> bytes:
    """ไบต์ที่ขึ้นต้นด้วย %PDF แต่โครงสร้างพังทั้งหมด — จำลอง PDF เสีย"""
    return b"%PDF-1.4\nthis is not a valid pdf body at all\n%%EOF"
