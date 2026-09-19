"""pytest bootstrap — ทำให้ output ของ typer/rich เป็น plain text เหมือนกันทุกเครื่อง

typer (rich_utils) ตัดสินใจ force terminal/สี จาก env ตอน **import** (`GITHUB_ACTIONS`,
`FORCE_COLOR`, `PY_COLORS`) → บน GitHub Actions ข้อความ help ถูกแทรก ANSI escape จน
assert แบบ substring (`"--dataset" in output`) พัง จึงต้องล้าง env ก่อน import `tgbp_pipeline.cli`
"""

from __future__ import annotations

import os

import pytest

for _var in ("GITHUB_ACTIONS", "FORCE_COLOR", "PY_COLORS"):
    os.environ.pop(_var, None)
os.environ["NO_COLOR"] = "1"
os.environ["TERM"] = "dumb"
# ความกว้างคงที่ กัน rich ตัดบรรทัดกลาง option ยาว ๆ
os.environ["COLUMNS"] = "120"


@pytest.fixture(autouse=True)
def _isolate_raw_data_dir_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """กัน `TGBP_RAW_DATA_DIR` ของ shell ที่รัน pytest (เช่น dev ตั้งไว้ในเครื่อง) รั่วเข้าเทสต์

    ทุกเทสต์ต้องคุม raw dir ของตัวเองผ่าน `PipelineConfig.load(config_path)` (tmp config) หรือ
    `monkeypatch.setenv("TGBP_RAW_DATA_DIR", ...)` เอง (ทำงานได้ตามปกติ — เรียกหลัง fixture นี้เสมอ)
    ยกเว้นเทสต์ `@pytest.mark.rawdata` ที่ตั้งใจอ่าน `config.yaml` จริงหลังลบ env นี้แล้ว
    """
    monkeypatch.delenv("TGBP_RAW_DATA_DIR", raising=False)
