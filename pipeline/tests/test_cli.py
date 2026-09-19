"""T-002: ตรวจว่า CLI โครงทำงานได้ — `--help` ผ่าน, subcommand ที่ยังไม่ implement exit code != 0
T-105: `extract --dataset pbo` ทำงานจริงแล้ว (ทดสอบแยกจาก stub เดิม)
T-110a: `extract --dataset act2570|local|committee|office|pdf|all` ทำงานจริงแล้ว — ใช้ monkeypatch
แทนไฟล์ raw จริง (ตาม CLAUDE.md §8: ห้าม test พึ่งไฟล์ raw จริงยกเว้น `@pytest.mark.rawdata`)
"""

from __future__ import annotations

from pathlib import Path

import openpyxl
import pytest
import yaml
from typer.testing import CliRunner

from tgbp_pipeline.cli import app
from tgbp_pipeline.extract.pbo import EXPECTED_HEADER

runner = CliRunner()


def test_help_exits_zero() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "tgbp" in result.output.lower()


@pytest.mark.parametrize(
    "args",
    [
        ["publish"],
        ["build"],
        ["sample"],
    ],
)
def test_stub_commands_exit_nonzero(args: list[str]) -> None:
    result = runner.invoke(app, args)
    assert result.exit_code != 0
    assert "ยังไม่ implement" in result.output


def test_inventory_command_help_exits_zero() -> None:
    result = runner.invoke(app, ["inventory", "--help"])
    assert result.exit_code == 0
    assert "--limit" in result.output
    assert "--no-pdf-probe" in result.output


def test_subcommand_help_exits_zero() -> None:
    result = runner.invoke(app, ["build", "--help"])
    assert result.exit_code == 0
    assert "--dataset" in result.output


def test_extract_command_help_exits_zero() -> None:
    result = runner.invoke(app, ["extract", "--help"])
    assert result.exit_code == 0
    assert "--year" in result.output
    assert "--limit-rows" in result.output


def test_normalize_command_help_exits_zero() -> None:
    result = runner.invoke(app, ["normalize", "--help"])
    assert result.exit_code == 0
    assert "--dataset" in result.output
    assert "--workers" in result.output


# ---------------------------------------------------------------------------
# T-105: `extract --dataset pbo` — ทำงานจริง (dataset อื่นยังเป็น stub)
# ---------------------------------------------------------------------------


def _write_pbo_cli_config(tmp_path: Path) -> Path:
    pipeline_dir = tmp_path / "pipeline"
    pipeline_dir.mkdir()
    (tmp_path / "raw" / "PBO").mkdir(parents=True)
    (tmp_path / "web" / "public" / "data").mkdir(parents=True)
    (tmp_path / "web" / "tests" / "fixtures" / "data").mkdir(parents=True)

    config_path = pipeline_dir / "config.yaml"
    config_path.write_text(
        yaml.safe_dump(
            {
                "raw_data_dir": "../raw",
                "output_dir": "../web/public/data",
                "cache_dir": ".cache",
                "fixtures_dir": "../web/tests/fixtures/data",
            }
        ),
        encoding="utf-8",
    )

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "เบิกจ่ายภาพรวมทุกมิติ (7)"
    ws.append(list(EXPECTED_HEADER))
    ws.append(
        (
            2566,
            "กระทรวงกลาโหม",
            "กรมทหารบก",
            "ยุทธศาสตร์ A",
            "แผนงาน A",
            "ผลผลิต A",
            "งาน A",
            "งบลงทุน",
            "รายจ่ายลงทุน",
            "เครื่องปรับอากาศ",
            1.5,
            1.5,
            0.1,
            1.0,
            1.1,
            0.4,
            0.05,
            0.0,
            "-",
            0.0,
            "-",
            0.0,
        )
    )
    wb.save(tmp_path / "raw" / "PBO" / "2566.xlsx")
    return config_path


def test_extract_dataset_pbo_runs_and_reports_rows(tmp_path: Path) -> None:
    config_path = _write_pbo_cli_config(tmp_path)

    result = runner.invoke(
        app, ["extract", "--dataset", "pbo", "--year", "2566", "--config", str(config_path)]
    )

    assert result.exit_code == 0
    assert "PBO 2566" in result.output
    assert "1" in result.output  # 1 แถว
    assert "รวม 1 แถว" in result.output


def test_extract_dataset_invalid_value_exits_nonzero_without_crash(tmp_path: Path) -> None:
    config_path = _write_pbo_cli_config(tmp_path)
    result = runner.invoke(app, ["extract", "--dataset", "ไม่มีจริง", "--config", str(config_path)])
    assert result.exit_code != 0
    assert isinstance(result.exception, SystemExit)  # typer.Exit ปกติ ไม่ใช่ traceback หลุด
    assert "--dataset ต้องเป็นหนึ่งใน" in result.output


# ---------------------------------------------------------------------------
# T-110a: `extract --dataset act2570|local|committee|office|pdf|all`
#
# `act2570`/`local` import ตรง ๆ ใน cli.py; `committee`/`office`/`pdf` import แบบ lazy
# ภายในฟังก์ชันรายงานผล — ทุกเทสต์ monkeypatch ฟังก์ชัน extract จริงของแต่ละโมดูล (ไม่พึ่งไฟล์ raw
# จริง ไม่แตะ `pipeline/.cache`) ด้วย `SimpleNamespace` แทน dataclass จริงเพื่อไม่ผูกกับ field
# ภายในของโมดูลที่ agent อื่นเป็นเจ้าของ (`committee_xlsx`/`office_text`/`pdf_text`)
# ---------------------------------------------------------------------------

from types import SimpleNamespace  # noqa: E402


def _write_minimal_cli_config(tmp_path: Path) -> Path:
    pipeline_dir = tmp_path / "pipeline"
    pipeline_dir.mkdir()
    (tmp_path / "raw").mkdir()
    (tmp_path / "web" / "public" / "data").mkdir(parents=True)
    (tmp_path / "web" / "tests" / "fixtures" / "data").mkdir(parents=True)
    config_path = pipeline_dir / "config.yaml"
    config_path.write_text(
        yaml.safe_dump(
            {
                "raw_data_dir": "../raw",
                "output_dir": "../web/public/data",
                "cache_dir": ".cache",
                "fixtures_dir": "../web/tests/fixtures/data",
            }
        ),
        encoding="utf-8",
    )
    return config_path


def _fake_act2570_report() -> SimpleNamespace:
    draft = SimpleNamespace(
        rel_path="ร่าง พ.ร.บ. งบ 2570 ฉบับเต็ม - Excel.xlsx",
        rows_written=2,
        total_amount_thb=300,
        cache_bytes=1234,
    )
    subset = SimpleNamespace(
        dataset="act_2570_province",
        format="A",
        rel_path="เฉพาะส่วนราชการ.xlsx",
        rows_written=1,
        total_amount_thb=100,
        cache_bytes=99,
    )
    return SimpleNamespace(draft=draft, province_and_subsidy=[subset], unclassified_rel_paths=[])


def test_extract_dataset_act2570_reports_rows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import tgbp_pipeline.extract.act2570 as act2570_mod

    monkeypatch.setattr(act2570_mod, "extract_act2570", lambda cfg: _fake_act2570_report())
    config_path = _write_minimal_cli_config(tmp_path)

    result = runner.invoke(app, ["extract", "--dataset", "act2570", "--config", str(config_path)])

    assert result.exit_code == 0
    assert "act2570 draft" in result.output
    assert "รวม act2570: 3 แถว (2 ไฟล์)" in result.output


def test_extract_dataset_local_reports_rows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import tgbp_pipeline.extract.local_sheets as local_mod

    fake_report = SimpleNamespace(
        results=[
            SimpleNamespace(
                rel_path="ร่างข้อบัญญัติงบ 2570 อบต. ราชาเทวะ - Sheets.xlsx",
                rows_written=345,
                sheets_used=["แผนงานงบกลาง"],
                sheets_skipped=[],
                cache_bytes=555,
                v3=SimpleNamespace(passed=True),
            )
        ],
        total_rows=345,
        total_files=1,
    )
    monkeypatch.setattr(local_mod, "extract_local_sheets", lambda cfg: fake_report)
    config_path = _write_minimal_cli_config(tmp_path)

    result = runner.invoke(app, ["extract", "--dataset", "local", "--config", str(config_path)])

    assert result.exit_code == 0
    assert "V3=pass" in result.output
    assert "รวม local: 345 แถว (1 ไฟล์)" in result.output


def test_extract_dataset_committee_lazy_import_failure_reports_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """โมดูลที่ import แบบ lazy พังต้องไม่ทำ CLI ทั้งก้อน crash — จับ error แล้ว exit 1"""
    import tgbp_pipeline.extract.committee_xlsx as committee_mod

    def _boom(cfg: object) -> None:
        raise RuntimeError("จำลอง committee_xlsx พังระหว่างแก้ไข")

    monkeypatch.setattr(committee_mod, "extract_committee_xlsx", _boom)
    config_path = _write_minimal_cli_config(tmp_path)

    result = runner.invoke(app, ["extract", "--dataset", "committee", "--config", str(config_path)])

    assert result.exit_code == 1
    assert isinstance(result.exception, SystemExit)  # typer.Exit ปกติ ไม่ใช่ traceback หลุด
    assert "extract committee ล้มเหลว" in result.output
    assert "จำลอง committee_xlsx พังระหว่างแก้ไข" in result.output


def test_extract_dataset_all_continues_after_one_dataset_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`--dataset all`: dataset หนึ่งพัง (local) ต้องไม่ทำให้ dataset อื่น (act2570/office/pdf) ไม่รัน"""
    import tgbp_pipeline.extract.act2570 as act2570_mod
    import tgbp_pipeline.extract.committee_xlsx as committee_mod
    import tgbp_pipeline.extract.local_sheets as local_mod
    import tgbp_pipeline.extract.office_text as office_mod
    import tgbp_pipeline.extract.pdf_text as pdf_mod

    monkeypatch.setattr(act2570_mod, "extract_act2570", lambda cfg: _fake_act2570_report())

    def _boom(cfg: object) -> None:
        raise RuntimeError("local พัง")

    monkeypatch.setattr(local_mod, "extract_local_sheets", _boom)
    monkeypatch.setattr(
        committee_mod,
        "extract_committee_xlsx",
        lambda cfg: SimpleNamespace(results=[], total_mapped_rows=0),
    )
    monkeypatch.setattr(office_mod, "extract_office_text", lambda cfg: SimpleNamespace(results=[]))
    monkeypatch.setattr(pdf_mod, "extract_pdf_text", lambda cfg: SimpleNamespace(results=[]))

    config_path = _write_minimal_cli_config(tmp_path)
    (tmp_path / "raw" / "PBO").mkdir()  # ไม่มีไฟล์ .xlsx จริง — pbo จะรายงาน "ไม่พบไฟล์" (had_error)

    result = runner.invoke(app, ["extract", "--dataset", "all", "--config", str(config_path)])

    assert result.exit_code == 1
    assert isinstance(result.exception, SystemExit)  # typer.Exit ปกติ ไม่ใช่ traceback หลุด
    assert "act2570 draft" in result.output  # act2570 ยังรันสำเร็จ
    assert "extract local ล้มเหลว" in result.output
    assert "local พัง" in result.output
    assert "รวม committee: 0 แถว (0 ไฟล์)" in result.output  # committee ยังรันต่อได้หลัง local พัง
    assert "รวม pdf: 0 ไฟล์" in result.output  # pdf (ท้ายสุด) ก็ยังรันต่อได้เช่นกัน


# ---------------------------------------------------------------------------
# T-110a: `tgbp normalize --dataset ...`
# ---------------------------------------------------------------------------


def _fake_normalize_report(dataset: str, n_rows: int = 5) -> SimpleNamespace:
    file_result = SimpleNamespace(
        source_path=Path(f"{dataset}.parquet"),
        dataset=dataset,
        out_path=Path(f"/normalized/{dataset}/{dataset}.parquet"),
        stats=SimpleNamespace(
            n_rows=n_rows,
            n_distinct_item_names=3,
            n_org_unmapped=1,
            n_unit_price_computed=2,
            n_group_mismatch_rows=0,
        ),
        elapsed_seconds=0.1,
        cache_bytes=999,
    )
    return SimpleNamespace(results=[file_result], total_rows=n_rows)


def test_normalize_dataset_invalid_value_exits_nonzero(tmp_path: Path) -> None:
    config_path = _write_minimal_cli_config(tmp_path)
    result = runner.invoke(app, ["normalize", "--dataset", "ไม่มีจริง", "--config", str(config_path)])
    assert result.exit_code != 0
    assert isinstance(result.exception, SystemExit)
    assert "--dataset ต้องเป็นหนึ่งใน" in result.output


def test_normalize_dataset_pbo_reports_stats(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import tgbp_pipeline.normalize.run as run_mod

    monkeypatch.setattr(
        run_mod,
        "normalize_dataset",
        lambda cfg, name, max_workers=None: _fake_normalize_report(name),
    )
    config_path = _write_minimal_cli_config(tmp_path)

    result = runner.invoke(app, ["normalize", "--dataset", "pbo", "--config", str(config_path)])

    assert result.exit_code == 0
    assert "distinct_item_names=3" in result.output
    assert "org_unmapped=1" in result.output
    assert "รวม normalize pbo: 5 แถว" in result.output
    assert "รวมทั้งหมด: 5 แถว" in result.output


def test_normalize_dataset_all_continues_after_one_dataset_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import tgbp_pipeline.normalize.run as run_mod

    def _fake(cfg, name, max_workers=None):
        if name == "local":
            raise RuntimeError("local normalize พัง")
        return _fake_normalize_report(name)

    monkeypatch.setattr(run_mod, "normalize_dataset", _fake)
    config_path = _write_minimal_cli_config(tmp_path)

    result = runner.invoke(app, ["normalize", "--dataset", "all", "--config", str(config_path)])

    assert result.exit_code == 1
    assert isinstance(result.exception, SystemExit)
    assert "normalize local ล้มเหลว" in result.output
    assert "local normalize พัง" in result.output
    assert "รวม normalize act2570: 5 แถว" in result.output
    assert "รวม normalize committee: 5 แถว" in result.output


# ---------------------------------------------------------------------------
# T-110a: `tgbp validate`
# ---------------------------------------------------------------------------


def test_validate_command_help_exits_zero() -> None:
    result = runner.invoke(app, ["validate", "--help"])
    assert result.exit_code == 0


def test_validate_command_pass_exits_zero(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import tgbp_pipeline.validate as validate_mod

    fake_report = SimpleNamespace(passed=True, notable_statuses=[], hard_failures=[])
    monkeypatch.setattr(validate_mod, "build_validation_report", lambda cfg: fake_report)
    monkeypatch.setattr(
        validate_mod,
        "write_validation_report",
        lambda cfg, report: (Path("/x/validation.json"), Path("/x/validation_report.md")),
    )
    config_path = _write_minimal_cli_config(tmp_path)

    result = runner.invoke(app, ["validate", "--config", str(config_path)])

    assert result.exit_code == 0
    assert "สถานะรวม: PASS" in result.output


def test_validate_command_fail_exits_nonzero_and_prints_hard_failures(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import tgbp_pipeline.validate as validate_mod

    fake_report = SimpleNamespace(
        passed=False,
        notable_statuses=["V1 PBO 2562: source_incomplete"],
        hard_failures=["V7 pbo_disbursement: 1 แถวปีนอกช่วง"],
    )
    monkeypatch.setattr(validate_mod, "build_validation_report", lambda cfg: fake_report)
    monkeypatch.setattr(
        validate_mod,
        "write_validation_report",
        lambda cfg, report: (Path("/x/validation.json"), Path("/x/validation_report.md")),
    )
    config_path = _write_minimal_cli_config(tmp_path)

    result = runner.invoke(app, ["validate", "--config", str(config_path)])

    assert result.exit_code == 1
    assert isinstance(result.exception, SystemExit)
    assert "สถานะรวม: FAIL" in result.output
    assert "source_incomplete" in result.output
    assert "V7 pbo_disbursement" in result.output
