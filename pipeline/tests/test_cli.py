"""T-002: ตรวจว่า CLI โครงทำงานได้ — `--help` ผ่าน, ทุก subcommand stub exit code != 0"""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

from tgbp_pipeline.cli import app

runner = CliRunner()


def test_help_exits_zero() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "tgbp" in result.output.lower()


@pytest.mark.parametrize(
    "args",
    [
        ["inventory"],
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


def test_subcommand_help_exits_zero() -> None:
    result = runner.invoke(app, ["build", "--help"])
    assert result.exit_code == 0
    assert "--dataset" in result.output
