"""T-002: ตรวจว่า CLI โครงทำงานได้ — `--help` ผ่าน, ทุก subcommand stub exit code != 0
T-105: `extract --dataset pbo` ทำงานจริงแล้ว (ทดสอบแยกจาก stub เดิม)
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
        ["extract"],
        ["normalize"],
        ["validate"],
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


def test_extract_dataset_other_still_stub(tmp_path: Path) -> None:
    result = runner.invoke(app, ["extract", "--dataset", "act2570"])
    assert result.exit_code != 0
    assert "ยังไม่ implement" in result.output
