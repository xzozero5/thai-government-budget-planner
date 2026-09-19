"""TGBP pipeline CLI (`tgbp`)

T-002: เป็นโครง CLI เท่านั้น — ทุก subcommand เป็น stub ที่ยังไม่ implement
(รอ Phase 1: T-101..T-113 ตาม docs/BACKLOG.md และ docs/03-DATA-PIPELINE.md §2)
"""

from __future__ import annotations

import typer

from tgbp_pipeline.config import load_config
from tgbp_pipeline.extract.pbo import extract_all as extract_pbo_all
from tgbp_pipeline.inventory import scan_raw_dir, write_inventory_appendix, write_sources_json

app = typer.Typer(
    name="tgbp",
    help=(
        "TGBP data pipeline — แปลงข้อมูลงบประมาณดิบ "
        "('เพราะ AI ไม่ใช่แค่ CHATBOT/') เป็นชุดข้อมูลที่เว็บใช้ได้ "
        "(ดู docs/03-DATA-PIPELINE.md)"
    ),
    no_args_is_help=True,
    add_completion=False,
)


def _stub(task_id: str) -> None:
    typer.echo(f"ยังไม่ implement ({task_id})", err=True)
    raise typer.Exit(code=1)


@app.command()
def inventory(
    limit: int | None = typer.Option(
        None, "--limit", help="จำกัดจำนวนไฟล์ (เรียงตาม rel_path) — ใช้ตอนทดสอบ"
    ),
    pdf_probe: bool = typer.Option(
        True,
        "--pdf-probe/--no-pdf-probe",
        help="ตรวจจำนวนหน้า/text layer ของ PDF (ปิดเพื่อสแกนเร็วขึ้น)",
    ),
    config: str | None = typer.Option(
        None, "--config", hidden=True, help="path ของ config.yaml อื่น (ใช้ใน test เท่านั้น)"
    ),
) -> None:
    """เดินโฟลเดอร์ raw ทั้งหมด → sources.json + docs/02 appendix (T-101)"""
    cfg = load_config(config)
    docs, stats = scan_raw_dir(cfg, limit=limit, probe_pdf=pdf_probe)
    sources_path = write_sources_json(cfg, docs)
    appendix_path = write_inventory_appendix(cfg, docs, stats)

    typer.echo(f"สแกนไฟล์: {stats.total_files} ไฟล์ ({stats.elapsed_seconds:.1f} วินาที)")
    typer.echo(f"เขียน {sources_path} ({sources_path.stat().st_size:,} bytes)")
    typer.echo(f"เขียนภาคผนวก {appendix_path}")
    typer.echo("นับตาม kind:")
    for kind, n in sorted(stats.by_kind.items()):
        typer.echo(f"  {kind}: {n}")
    typer.echo("นับตาม collection:")
    for collection, n in sorted(stats.by_collection.items()):
        typer.echo(f"  {collection}: {n}")
    typer.echo("PDF has_text_layer:")
    for key, n in sorted(stats.by_has_text_layer.items()):
        typer.echo(f"  {key}: {n}")
    typer.echo(
        f"duplicates: {stats.duplicate_groups} กลุ่ม ({stats.duplicate_files} ไฟล์ซ้ำ), "
        f"probe ไม่สำเร็จ: {len(stats.pdf_probe_failures)}, "
        f"probe timeout: {len(stats.pdf_probe_timeouts)}"
    )


@app.command()
def extract(
    dataset: str = typer.Option(
        "all",
        "--dataset",
        help="pbo | act2570 | local | committee | pdf | office | all",
    ),
    year: int | None = typer.Option(
        None, "--year", help="จำกัดเฉพาะปีงบประมาณเดียว (เฉพาะ --dataset pbo)"
    ),
    limit_rows: int | None = typer.Option(
        None, "--limit-rows", help="จำกัดจำนวนแถวข้อมูลต่อไฟล์ (ใช้ตอนทดสอบ/สุ่มดู)"
    ),
    config: str | None = typer.Option(
        None, "--config", hidden=True, help="path ของ config.yaml อื่น (ใช้ใน test เท่านั้น)"
    ),
) -> None:
    """แยกข้อมูลดิบตาม dataset → pipeline/.cache/*.parquet (T-105 ทำ pbo; T-106..T-109 ที่เหลือ)"""
    if dataset != "pbo":
        _stub("T-106..T-109")
        return

    cfg = load_config(config)
    years = [year] if year is not None else None
    results = extract_pbo_all(cfg, years=years, limit_rows=limit_rows)
    if not results:
        typer.echo("ไม่พบไฟล์ PBO ให้ extract", err=True)
        raise typer.Exit(code=1)

    partial_tag = " [PARTIAL — ไม่ทับไฟล์เต็ม, ไม่อัปเดต oracle.json]" if limit_rows is not None else ""
    total_rows = 0
    for r in results:
        total_rows += r.rows_written
        flags = dict(r.flag_counts) if r.flag_counts else {}
        typer.echo(
            f"PBO {r.year}: {r.rows_written:,} แถว | sheet={r.sheet_name!r} | "
            f"grand_total_rows={r.n_grand_total_rows} | oracle={r.oracle['kind']} | "
            f"flags={flags} | {r.cache_bytes:,} bytes | {r.elapsed_seconds:.1f}s{partial_tag}"
        )
    typer.echo(f"รวม {total_rows:,} แถว ({len(results)} ปี){partial_tag}")


@app.command()
def normalize() -> None:
    """ทำความสะอาด/สกัด field (thai_text, item_parser, org_master, money) (T-102..T-104)"""
    _stub("T-102..T-104")


@app.command()
def validate() -> None:
    """ตรวจ hard/soft rules V1-V10 → validation_report.md + validation.json (T-110)"""
    _stub("T-110")


@app.command()
def publish() -> None:
    """เขียน parquet shards / catalog / manifest.json ไป web/public/data (T-110)"""
    _stub("T-110")


@app.command()
def build(
    dataset: str = typer.Option(
        "all",
        "--dataset",
        help="ตาม `extract --dataset` — รัน extract → normalize → validate → publish ทั้งหมด",
    ),
) -> None:
    """รันทุกขั้นตอนตามลำดับ: extract → normalize → validate → publish (T-110)"""
    _stub("T-110")


@app.command()
def sample(
    rows: int = typer.Option(1000, "--rows", help="จำนวนแถวต่อ dataset สำหรับ fixtures"),
) -> None:
    """สร้าง web/tests/fixtures/data/ สำหรับ dev/test ฝั่ง web โดยไม่ต้องรอ pipeline เต็ม (T-112)"""
    _stub("T-112")


if __name__ == "__main__":
    app()
