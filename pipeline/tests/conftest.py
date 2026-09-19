"""pytest bootstrap — ทำให้ output ของ typer/rich เป็น plain text เหมือนกันทุกเครื่อง

typer (rich_utils) ตัดสินใจ force terminal/สี จาก env ตอน **import** (`GITHUB_ACTIONS`,
`FORCE_COLOR`, `PY_COLORS`) → บน GitHub Actions ข้อความ help ถูกแทรก ANSI escape จน
assert แบบ substring (`"--dataset" in output`) พัง จึงต้องล้าง env ก่อน import `tgbp_pipeline.cli`
"""

from __future__ import annotations

import os

for _var in ("GITHUB_ACTIONS", "FORCE_COLOR", "PY_COLORS"):
    os.environ.pop(_var, None)
os.environ["NO_COLOR"] = "1"
os.environ["TERM"] = "dumb"
# ความกว้างคงที่ กัน rich ตัดบรรทัดกลาง option ยาว ๆ
os.environ["COLUMNS"] = "120"
