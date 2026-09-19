"""TGBP pipeline CLI (`tgbp`)

T-002: เป็นโครง CLI เท่านั้น — ทุก subcommand เป็น stub ที่ยังไม่ implement
(รอ Phase 1: T-101..T-113 ตาม docs/BACKLOG.md และ docs/03-DATA-PIPELINE.md §2)
"""

from __future__ import annotations

import typer

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
def inventory() -> None:
    """เดินโฟลเดอร์ raw ทั้งหมด → sources.json + docs/02 appendix (T-101)"""
    _stub("T-101")


@app.command()
def extract(
    dataset: str = typer.Option(
        "all",
        "--dataset",
        help="pbo | act2570 | local | committee | pdf | office | all",
    ),
) -> None:
    """แยกข้อมูลดิบตาม dataset → pipeline/.cache/*.parquet (T-105..T-109)"""
    _stub("T-105..T-109")


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
