"""T-002: ตรวจ config loader — resolve path, env override, write-guard (N6)"""

from __future__ import annotations

from pathlib import Path

import pytest

from tgbp_pipeline.config import PipelineConfig, RawDataWriteError

PIPELINE_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = PIPELINE_ROOT / "config.yaml"
PROJECT_ROOT = PIPELINE_ROOT.parent


def test_load_resolves_relative_paths_against_config_dir() -> None:
    cfg = PipelineConfig.load(CONFIG_PATH)

    assert cfg.raw_data_dir.is_absolute()
    assert cfg.output_dir.is_absolute()
    assert cfg.cache_dir.is_absolute()
    assert cfg.fixtures_dir.is_absolute()

    assert cfg.raw_data_dir == (PROJECT_ROOT / "เพราะ AI ไม่ใช่แค่ CHATBOT").resolve()
    assert cfg.output_dir == (PROJECT_ROOT / "web" / "public" / "data").resolve()
    assert cfg.cache_dir == (PIPELINE_ROOT / ".cache").resolve()
    assert cfg.fixtures_dir == (PROJECT_ROOT / "web" / "tests" / "fixtures" / "data").resolve()


def test_load_uses_default_config_path_when_omitted() -> None:
    cfg = PipelineConfig.load()
    assert cfg.config_path == CONFIG_PATH.resolve()


def test_env_override_raw_data_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    override_dir = tmp_path / "custom_raw"
    monkeypatch.setenv("TGBP_RAW_DATA_DIR", str(override_dir))

    cfg = PipelineConfig.load(CONFIG_PATH)

    assert cfg.raw_data_dir == override_dir.resolve()
    # ค่าอื่นไม่ควรถูกกระทบ
    assert cfg.output_dir == (PROJECT_ROOT / "web" / "public" / "data").resolve()


def test_write_guard_rejects_path_under_raw_dir(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("TGBP_RAW_DATA_DIR", str(tmp_path))
    cfg = PipelineConfig.load(CONFIG_PATH)

    with pytest.raises(RawDataWriteError):
        cfg.assert_writable_path(tmp_path / "some_file.xlsx")

    with pytest.raises(RawDataWriteError):
        cfg.assert_writable_path(tmp_path / "nested" / "deeper" / "file.pdf")

    # raw dir เอง (path ตรงตัว) ก็ต้องถูกปฏิเสธ
    with pytest.raises(RawDataWriteError):
        cfg.assert_writable_path(tmp_path)


def test_write_guard_allows_output_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("TGBP_RAW_DATA_DIR", str(tmp_path / "raw"))
    cfg = PipelineConfig.load(CONFIG_PATH)

    target = cfg.output_dir / "sample.parquet"
    resolved = cfg.assert_writable_path(target)
    assert resolved == target.resolve()


@pytest.mark.rawdata
def test_raw_data_dir_exists_and_thai_path_is_readable() -> None:
    cfg = PipelineConfig.load(CONFIG_PATH)
    if not cfg.raw_data_dir.exists():
        pytest.skip("ไม่มีโฟลเดอร์ข้อมูลดิบจริงบนเครื่องนี้")

    entries = list(cfg.raw_data_dir.iterdir())
    assert len(entries) > 0
