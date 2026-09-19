"""TGBP pipeline CLI (`tgbp`)

T-002: เป็นโครง CLI เท่านั้น — ทุก subcommand เป็น stub ที่ยังไม่ implement
(รอ Phase 1: T-101..T-113 ตาม docs/BACKLOG.md และ docs/03-DATA-PIPELINE.md §2)

T-110a: `extract --dataset` เพิ่ม act2570/local/committee/office/pdf (นอกเหนือจาก pbo ที่ทำใน
T-105) — `act2570`/`local` import ตรง ๆ (โมดูลใน scope งานนี้) ส่วน `committee`/`office`/`pdf`
import **แบบ lazy** ภายในฟังก์ชันรายงานผล (ไม่ import ระดับ module) เพราะเดิมโมดูลเหล่านั้นถูก
agent อื่นแก้ขนานกัน — คง pattern นี้ไว้แม้ตอนนี้จะ import ได้แน่นอนแล้ว (T-108/T-109 commit แล้ว)
เพื่อกันเคสอนาคตที่โมดูลพังชั่วคราวไม่ให้ทั้ง CLI ใช้งานไม่ได้ (`try/except Exception` ครอบทุก
dataset ที่ไม่ใช่ pbo — dataset หนึ่งพัง ไม่ทำให้ dataset อื่นใน `--dataset all` หยุดตาม)
"""

from __future__ import annotations

import time
from collections.abc import Callable

import typer

from tgbp_pipeline.config import PipelineConfig, load_config
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


def _report_act2570(cfg: PipelineConfig) -> list[str]:
    from tgbp_pipeline.extract.act2570 import extract_act2570

    report = extract_act2570(cfg)
    lines = [
        f"act2570 draft [{report.draft.rel_path}]: {report.draft.rows_written:,} แถว "
        f"({report.draft.total_amount_thb:,} บาท) | {report.draft.cache_bytes:,} bytes"
    ]
    for r in report.province_and_subsidy:
        lines.append(
            f"act2570 {r.dataset} [{r.format}] {r.rel_path}: {r.rows_written:,} แถว "
            f"({r.total_amount_thb:,} บาท) | {r.cache_bytes:,} bytes"
        )
    if report.unclassified_rel_paths:
        lines.append(f"act2570 ไฟล์ที่จำแนก dataset ไม่ได้: {report.unclassified_rel_paths}")
    total_rows = report.draft.rows_written + sum(
        r.rows_written for r in report.province_and_subsidy
    )
    lines.append(f"รวม act2570: {total_rows:,} แถว ({1 + len(report.province_and_subsidy)} ไฟล์)")
    return lines


def _report_local(cfg: PipelineConfig) -> list[str]:
    from tgbp_pipeline.extract.local_sheets import extract_local_sheets

    report = extract_local_sheets(cfg)
    lines = []
    for r in report.results:
        v3_tag = ""
        if r.v3 is not None:
            v3_tag = f" | V3={'pass' if r.v3.passed else 'fail'}"
        lines.append(
            f"local [{r.rel_path}]: {r.rows_written:,} แถว | sheets_used="
            f"{len(r.sheets_used)} sheets_skipped={len(r.sheets_skipped)}{v3_tag} | "
            f"{r.cache_bytes:,} bytes"
        )
    lines.append(f"รวม local: {report.total_rows:,} แถว ({report.total_files} ไฟล์)")
    return lines


def _report_committee(cfg: PipelineConfig) -> list[str]:
    from tgbp_pipeline.extract.committee_xlsx import extract_committee_xlsx

    summary = extract_committee_xlsx(cfg)
    lines = []
    for r in summary.results:
        status = f"skipped ({r.skip_reason})" if r.skipped else f"{r.mapped_rows:,} แถว"
        lines.append(f"committee [{r.rel_path}]: {status}")
    lines.append(f"รวม committee: {summary.total_mapped_rows:,} แถว ({len(summary.results)} ไฟล์)")
    return lines


def _report_office(cfg: PipelineConfig) -> list[str]:
    from tgbp_pipeline.extract.office_text import extract_office_text

    summary = extract_office_text(cfg)
    lines = []
    n_error = 0
    for r in summary.results:
        if r.error:
            n_error += 1
            lines.append(f"office [{r.rel_path}]: error — {r.error}")
        else:
            lines.append(f"office [{r.rel_path}] ({r.kind}): {r.n_chunks} chunks")
    lines.append(f"รวม office: {len(summary.results)} ไฟล์ ({n_error} error)")
    return lines


def _report_pdf(cfg: PipelineConfig) -> list[str]:
    from tgbp_pipeline.extract.pdf_text import extract_pdf_text

    report = extract_pdf_text(cfg)
    by_status: dict[str, int] = {}
    for r in report.results:
        by_status[r.status] = by_status.get(r.status, 0) + 1
    return [f"รวม pdf: {len(report.results)} ไฟล์ | สถานะ: {by_status}"]


# dataset ที่ไม่ใช่ pbo — เรียกผ่าน dict นี้เสมอ (`--dataset all` วนตามลำดับนี้)
_EXTRACT_REPORTERS: dict[str, Callable[[PipelineConfig], list[str]]] = {
    "act2570": _report_act2570,
    "local": _report_local,
    "committee": _report_committee,
    "office": _report_office,
    "pdf": _report_pdf,
}

_EXTRACT_DATASET_ORDER: tuple[str, ...] = (
    "pbo",
    "act2570",
    "local",
    "committee",
    "office",
    "pdf",
)


def _run_extract_pbo(cfg: PipelineConfig, *, year: int | None, limit_rows: int | None) -> bool:
    """คืน `True` ถ้าสำเร็จ — พิมพ์ผลลัพธ์/ข้อความ error เองผ่าน `typer.echo`"""
    try:
        years = [year] if year is not None else None
        results = extract_pbo_all(cfg, years=years, limit_rows=limit_rows)
    except Exception as exc:  # noqa: BLE001 — dataset หนึ่งพังต้องไม่ทำ CLI ทั้งก้อนล้ม
        typer.echo(f"extract pbo ล้มเหลว ({type(exc).__name__}): {exc}", err=True)
        return False

    if not results:
        typer.echo("ไม่พบไฟล์ PBO ให้ extract", err=True)
        return False

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
    return True


@app.command()
def extract(
    dataset: str = typer.Option(
        "all",
        "--dataset",
        help="pbo | act2570 | local | committee | office | pdf | all",
    ),
    year: int | None = typer.Option(
        None, "--year", help="จำกัดเฉพาะปีงบประมาณเดียว (เฉพาะ --dataset pbo)"
    ),
    limit_rows: int | None = typer.Option(
        None,
        "--limit-rows",
        help="จำกัดจำนวนแถวข้อมูลต่อไฟล์ (ใช้ตอนทดสอบ/สุ่มดู, เฉพาะ --dataset pbo)",
    ),
    config: str | None = typer.Option(
        None, "--config", hidden=True, help="path ของ config.yaml อื่น (ใช้ใน test เท่านั้น)"
    ),
) -> None:
    """แยกข้อมูลดิบตาม dataset → pipeline/.cache/*.parquet"""
    valid_datasets = {*_EXTRACT_DATASET_ORDER, "all"}
    if dataset not in valid_datasets:
        typer.echo(f"--dataset ต้องเป็นหนึ่งใน {sorted(valid_datasets)} (ได้ {dataset!r})", err=True)
        raise typer.Exit(code=1)

    cfg = load_config(config)
    targets = list(_EXTRACT_DATASET_ORDER) if dataset == "all" else [dataset]
    had_error = False

    for name in targets:
        if name == "pbo":
            if not _run_extract_pbo(cfg, year=year, limit_rows=limit_rows):
                had_error = True
            continue

        reporter = _EXTRACT_REPORTERS[name]
        try:
            lines = reporter(cfg)
        except Exception as exc:  # noqa: BLE001 — dataset หนึ่ง (โดยเฉพาะที่ import แบบ lazy)
            # พังต้องไม่ทำ `--dataset all` ทั้งก้อนล้ม — แจ้ง error ชัดเจนแล้วไปต่อ dataset ถัดไป
            had_error = True
            typer.echo(f"extract {name} ล้มเหลว ({type(exc).__name__}): {exc}", err=True)
            continue
        for line in lines:
            typer.echo(line)

    if had_error:
        raise typer.Exit(code=1)


@app.command()
def normalize(
    dataset: str = typer.Option(
        "all",
        "--dataset",
        help="pbo | act2570 | local | committee | all",
    ),
    workers: int | None = typer.Option(
        None,
        "--workers",
        help="จำนวน process ขนานสำหรับ item_parser (ค่าเริ่มต้น = os.cpu_count())",
    ),
    config: str | None = typer.Option(
        None, "--config", hidden=True, help="path ของ config.yaml อื่น (ใช้ใน test เท่านั้น)"
    ),
) -> None:
    """เติม item_parser/org_master/unit_price/gov_level → `.cache/normalized/{dataset}/*.parquet`"""
    from tgbp_pipeline.normalize.run import ALL_NORMALIZE_DATASETS, normalize_dataset

    valid_datasets = {*ALL_NORMALIZE_DATASETS, "all"}
    if dataset not in valid_datasets:
        typer.echo(f"--dataset ต้องเป็นหนึ่งใน {sorted(valid_datasets)} (ได้ {dataset!r})", err=True)
        raise typer.Exit(code=1)

    cfg = load_config(config)
    targets = list(ALL_NORMALIZE_DATASETS) if dataset == "all" else [dataset]
    had_error = False
    total_rows = 0

    for name in targets:
        start = time.monotonic()
        try:
            report = normalize_dataset(cfg, name, max_workers=workers)
        except Exception as exc:  # noqa: BLE001 — dataset หนึ่งพังต้องไม่ทำ CLI ทั้งก้อนล้ม
            had_error = True
            typer.echo(f"normalize {name} ล้มเหลว ({type(exc).__name__}): {exc}", err=True)
            continue
        elapsed = time.monotonic() - start
        total_rows += report.total_rows
        for r in report.results:
            typer.echo(
                f"normalize {name} [{r.source_path.name}] → {r.dataset}: "
                f"{r.stats.n_rows:,} แถว | distinct_item_names={r.stats.n_distinct_item_names:,} "
                f"| org_unmapped={r.stats.n_org_unmapped:,} "
                f"| unit_price_computed={r.stats.n_unit_price_computed:,} "
                f"| high_qty_low_conf={r.stats.n_high_qty_low_conf:,} "
                f"| group_mismatch={r.stats.n_group_mismatch_rows:,} | {r.cache_bytes:,} bytes "
                f"| {r.elapsed_seconds:.1f}s"
            )
        typer.echo(f"รวม normalize {name}: {report.total_rows:,} แถว ({elapsed:.1f}s)")

    typer.echo(f"รวมทั้งหมด: {total_rows:,} แถว")
    if had_error:
        raise typer.Exit(code=1)


@app.command()
def validate(
    config: str | None = typer.Option(
        None, "--config", hidden=True, help="path ของ config.yaml อื่น (ใช้ใน test เท่านั้น)"
    ),
) -> None:
    """ตรวจ hard/soft rules V1-V10 → `.cache/validation/{validation.json,validation_report.md}`

    exit 1 เมื่อมี hard rule fail; สถานะ `source_incomplete`/`no_oracle`/อื่น ๆ ที่ไม่ fail แต่ต้องรู้
    จะพิมพ์เด่นในหัวข้อ "notable" เสมอ (ไม่ทำให้ exit code เปลี่ยน)
    """
    from tgbp_pipeline.validate import build_validation_report, write_validation_report

    cfg = load_config(config)
    report = build_validation_report(cfg)
    json_path, md_path = write_validation_report(cfg, report)

    typer.echo(f"เขียน {json_path}")
    typer.echo(f"เขียน {md_path}")
    typer.echo(f"สถานะรวม: {'PASS' if report.passed else 'FAIL'}")

    if report.notable_statuses:
        typer.echo("สถานะที่ต้องรู้ (ไม่ fail แต่สำคัญ):")
        for msg in report.notable_statuses:
            typer.echo(f"  - {msg}")

    if report.hard_failures:
        typer.echo("Hard failures:", err=True)
        for msg in report.hard_failures:
            typer.echo(f"  - {msg}", err=True)
        raise typer.Exit(code=1)


def _echo_search_index_summary(manifest: dict) -> None:
    """T-208: พิมพ์สถานะ + ขนาดของ catalog/items-slim.json.gz + catalog/search-index.json.gz"""
    search_index = manifest.get("search_index") or {"built": False}
    if not search_index.get("built"):
        typer.echo("search index: ข้าม (--skip-search-index)")
        return
    sizes = {
        f["path"]: f["bytes"]
        for f in manifest.get("files", [])
        if f["path"] in ("catalog/items-slim.json.gz", "catalog/search-index.json.gz")
    }
    size_str = " | ".join(f"{p}={n:,} bytes" for p, n in sorted(sizes.items()))
    typer.echo(
        f"search index: built (tokenizer_version={search_index.get('tokenizer_version')}) | "
        f"{size_str}"
    )


@app.command()
def publish(
    skip_search_index: bool = typer.Option(
        False,
        "--skip-search-index",
        help=(
            "ข้ามการสร้าง catalog/items-slim.json.gz + catalog/search-index.json.gz "
            "(ต้องมี node และ web/node_modules มิฉะนั้น publish จะ error — ใช้ตอนไม่มี node บนเครื่อง)"
        ),
    ),
    config: str | None = typer.Option(
        None, "--config", hidden=True, help="path ของ config.yaml อื่น (ใช้ใน test เท่านั้น)"
    ),
) -> None:
    """เขียน parquet shards / catalog / manifest.json ไป web/public/data (T-110b)"""
    from tgbp_pipeline.publish import publish as run_publish

    cfg = load_config(config)
    result = run_publish(cfg, build_search_index=not skip_search_index)
    typer.echo(
        f"เขียน {result.manifest_path} (data_version={result.manifest['data_version'][:12]}…)"
    )
    typer.echo(
        f"budget_lines: {len(result.shard_parts)} ไฟล์ | "
        f"catalog: {len(result.catalog.entries):,} entries (threshold={result.catalog.min_lines}/"
        f"{result.catalog.min_years}/{result.catalog.min_unit_price_distinct}) | "
        f"trends: {result.n_trend_items:,} item_key | docs: {result.docs.n_copied} ไฟล์"
    )
    _echo_search_index_summary(result.manifest)
    typer.echo(f"รวมขนาด web/public/data/: {result.total_bytes:,} bytes")
    typer.echo(f"validation: {'PASS' if result.validation_passed else 'FAIL'}")
    if not result.validation_passed:
        raise typer.Exit(code=1)


@app.command()
def build(
    dataset: str = typer.Option(
        "all",
        "--dataset",
        help="ตาม `extract --dataset` — รัน extract → normalize → validate → publish ทั้งหมด",
    ),
    skip_extract: bool = typer.Option(
        False, "--skip-extract", help="ข้ามขั้น extract (ใช้ `.cache/` ที่มีอยู่แล้ว)"
    ),
    skip_search_index: bool = typer.Option(
        False,
        "--skip-search-index",
        help="ส่งต่อไปยัง `publish` — ข้ามการสร้าง catalog/items-slim.json.gz + search-index.json.gz",
    ),
    config: str | None = typer.Option(
        None, "--config", hidden=True, help="path ของ config.yaml อื่น (ใช้ใน test เท่านั้น)"
    ),
) -> None:
    """รันทุกขั้นตอนตามลำดับ: extract → normalize → validate → publish (T-110b)

    `--skip-extract` ใช้ตอน `.cache/{pbo,act2570,local,committee,docs}` ทำไว้แล้ว (extract PBO
    ใช้เวลานาน) — `normalize`/`validate`/`publish` ยังรันเสมอ exit code != 0 เมื่อขั้นใดพัง/hard fail

    เรียกฟังก์ชัน CLI อื่น (`extract`/`normalize`/`validate`/`publish`) **ตรง ๆ เป็นฟังก์ชัน Python**
    (ไม่ผ่าน Click dispatcher) — `@app.command()` ของ Typer คืนฟังก์ชันเดิมไม่เปลี่ยนแปลง จึงเรียกได้
    ตรง ๆ; ทุกฟังก์ชันใช้ `typer.Exit` (ไม่ใช่ `SystemExit`) ตอน error จึงต้อง `except typer.Exit`
    """
    had_error = False

    if not skip_extract:
        typer.echo("== extract ==")
        try:
            extract(dataset=dataset, year=None, limit_rows=None, config=config)
        except typer.Exit as exc:
            if exc.exit_code:
                had_error = True

    typer.echo("== normalize ==")
    try:
        normalize(dataset="all", workers=None, config=config)
    except typer.Exit as exc:
        if exc.exit_code:
            had_error = True

    typer.echo("== validate ==")
    try:
        validate(config=config)
    except typer.Exit as exc:
        if exc.exit_code:
            typer.echo("validate มี hard failure — publish ยังรันต่อ (ดูรายละเอียดด้านบน)", err=True)
            had_error = True

    typer.echo("== publish ==")
    try:
        publish(skip_search_index=skip_search_index, config=config)
    except typer.Exit as exc:
        if exc.exit_code:
            had_error = True

    if had_error:
        raise typer.Exit(code=1)


@app.command()
def sample(
    rows: int = typer.Option(1000, "--rows", help="จำนวนแถวต่อ dataset สำหรับ fixtures"),
    skip_search_index: bool = typer.Option(
        False,
        "--skip-search-index",
        help=(
            "ข้ามการสร้าง catalog/items-slim.json.gz + catalog/search-index.json.gz "
            "(ต้องมี node และ web/node_modules มิฉะนั้น sample จะ error)"
        ),
    ),
    config: str | None = typer.Option(
        None, "--config", hidden=True, help="path ของ config.yaml อื่น (ใช้ใน test เท่านั้น)"
    ),
) -> None:
    """สร้าง web/tests/fixtures/data/ สำหรับ dev/test ฝั่ง web โดยไม่ต้องรอ pipeline เต็ม (T-112)"""
    from tgbp_pipeline.publish import sample as run_sample

    cfg = load_config(config)
    result = run_sample(cfg, rows=rows, build_search_index=not skip_search_index)
    typer.echo(f"เขียน {result.manifest_path}")
    typer.echo(
        f"budget_lines: {len(result.shard_parts)} ไฟล์ | catalog: {len(result.catalog.entries)} "
        f"entries | trends: {result.n_trend_items} | docs: {result.docs.n_copied} ไฟล์ | "
        f"รวม {result.total_bytes:,} bytes"
    )
    _echo_search_index_summary(result.manifest)
    if not result.validation_passed:
        typer.echo("sample validation FAIL (ไฟล์ > 24 MB หรือรวมเกินเพดาน)", err=True)
        raise typer.Exit(code=1)


if __name__ == "__main__":
    app()
