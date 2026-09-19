"""ตัวโหลด config ของ pipeline (`config.yaml`)

- path ทุกตัวใน config.yaml resolve แบบ relative กับตำแหน่งไฟล์ config.yaml เอง
  (ไม่ใช่ relative กับ cwd ที่เรียกคำสั่ง) เพื่อให้เรียก `tgbp` จากที่ไหนก็ได้ผลเหมือนกัน
- `raw_data_dir` override ได้ด้วย environment variable `TGBP_RAW_DATA_DIR`
- `assert_writable_path` เป็น guard ตาม N6: ห้ามเขียนไฟล์ใด ๆ ใต้ raw_data_dir
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

DEFAULT_CONFIG_FILENAME = "config.yaml"
ENV_RAW_DATA_DIR = "TGBP_RAW_DATA_DIR"


class RawDataWriteError(PermissionError):
    """เขียนไฟล์ใต้ raw_data_dir ไม่ได้ — ข้อมูลดิบเป็น read-only เสมอ (N6)"""


@dataclass(frozen=True)
class PipelineConfig:
    config_path: Path
    raw_data_dir: Path
    output_dir: Path
    cache_dir: Path
    fixtures_dir: Path

    @classmethod
    def load(cls, config_path: str | Path | None = None) -> PipelineConfig:
        """โหลดและ resolve `config.yaml`

        ถ้าไม่ระบุ `config_path` จะใช้ `pipeline/config.yaml` (sibling ของ package นี้)
        """
        if config_path is None:
            path = Path(__file__).resolve().parent.parent / DEFAULT_CONFIG_FILENAME
        else:
            path = Path(config_path)
        path = path.resolve()

        if not path.is_file():
            raise FileNotFoundError(f"ไม่พบ config.yaml ที่ {path}")

        with path.open("r", encoding="utf-8") as f:
            raw: dict[str, Any] = yaml.safe_load(f) or {}

        base_dir = path.parent

        def _resolve(key: str, env_var: str | None = None) -> Path:
            value = raw.get(key)
            if env_var is not None and os.environ.get(env_var):
                value = os.environ[env_var]
            if value is None or str(value).strip() == "":
                raise ValueError(f"config.yaml ขาดค่า '{key}' (และไม่มี env override)")
            value_path = Path(str(value))
            if not value_path.is_absolute():
                value_path = base_dir / value_path
            return value_path.resolve()

        return cls(
            config_path=path,
            raw_data_dir=_resolve("raw_data_dir", ENV_RAW_DATA_DIR),
            output_dir=_resolve("output_dir"),
            cache_dir=_resolve("cache_dir"),
            fixtures_dir=_resolve("fixtures_dir"),
        )

    def assert_writable_path(self, target: str | Path) -> Path:
        """Guard ตาม N6: raise `RawDataWriteError` ถ้า `target` อยู่ใต้ (หรือคือ) raw_data_dir

        คืนค่า resolved absolute path ถ้าปลอดภัย เพื่อให้เรียกแบบ
        `path = cfg.assert_writable_path(some_path)` แล้วใช้ path ต่อได้เลย
        """
        target_path = Path(target).resolve()
        if target_path == self.raw_data_dir or self.raw_data_dir in target_path.parents:
            raise RawDataWriteError(f"ห้ามเขียนไฟล์ใต้ raw_data_dir (read-only ตาม N6): {target_path}")
        return target_path


def load_config(config_path: str | Path | None = None) -> PipelineConfig:
    """เรียกใช้ง่ายกว่า `PipelineConfig.load` ตรง ๆ"""
    return PipelineConfig.load(config_path)
