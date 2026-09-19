# pipeline — TGBP data pipeline

Python offline ETL ที่แปลงข้อมูลงบประมาณดิบใน `เพราะ AI ไม่ใช่แค่ CHATBOT/` (read-only)
เป็นชุดข้อมูลสำหรับเว็บใน `web/public/data/` ดูสเปคเต็มที่ `../docs/03-DATA-PIPELINE.md`

สถานะปัจจุบัน: **โครง CLI เท่านั้น (T-002)** — ทุก subcommand ยัง exit ด้วย "ยังไม่ implement"
รอ implement จริงใน Phase 1 (`docs/BACKLOG.md` T-101..T-113)

## ติดตั้ง

### วิธีหลัก — uv

```bash
cd pipeline
uv sync            # ติดตั้ง dependencies + dev group ลง .venv/
uv run tgbp --help
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

ถ้าเครื่องยังไม่มี `uv` และไม่อยู่ใน PATH (เช่น Windows ที่ลงผ่าน `pip install --user uv`)
ให้เรียกผ่าน `python -m uv` แทนคำสั่ง `uv` ตรง ๆ ได้ทุกจุด เช่น:

```bash
python -m pip install --user uv
python -m uv sync
python -m uv run tgbp --help
```

### Fallback — pip + venv (ถ้า uv ใช้ไม่ได้จริง ๆ)

```bash
cd pipeline
python -m venv .venv
.venv/Scripts/activate       # Windows (PowerShell/Git Bash: .venv/Scripts/activate)
# source .venv/bin/activate  # macOS/Linux
pip install -e ".[dev]"
tgbp --help
pytest
ruff check .
ruff format --check .
```

### หมายเหตุ Windows: `UnicodeEncodeError` (cp1252) เวลารัน `tgbp`

บาง terminal บน Windows (พบใน Git Bash/MSYS บนเครื่อง dev) ตั้ง stdout เป็น `cp1252` แทน UTF-8
ทำให้ print ข้อความไทย (เช่น help text ของ `tgbp`) พังด้วย `UnicodeEncodeError` — เป็นปัญหาระดับ
terminal/OS ไม่ใช่บั๊กของโค้ด แก้ได้โดยตั้ง `PYTHONUTF8=1` ก่อนรัน:

```bash
PYTHONUTF8=1 uv run tgbp --help
# หรือ export ทิ้งไว้ทั้ง session
export PYTHONUTF8=1
```

บน PowerShell/CMD ปกติ (Windows Terminal, code page UTF-8) มักไม่เจอปัญหานี้

## Config

`config.yaml` เก็บ path (`raw_data_dir`, `output_dir`, `cache_dir`, `fixtures_dir`) แบบ relative
กับตำแหน่งไฟล์ `config.yaml` เอง — เรียก `tgbp` จากไดเรกทอรีไหนก็ resolve เหมือนกัน

Override `raw_data_dir` ได้ด้วย environment variable:

```bash
TGBP_RAW_DATA_DIR=/path/to/raw uv run tgbp inventory
```

`tgbp_pipeline/config.py` มี guard `PipelineConfig.assert_writable_path(...)` ที่ปฏิเสธ
(raise `RawDataWriteError`) การเขียนไฟล์ใด ๆ ใต้ `raw_data_dir` เสมอ (N6 — ข้อมูลดิบ read-only)

## โครงสร้าง

```
pipeline/
├── pyproject.toml
├── config.yaml
├── tgbp_pipeline/
│   ├── cli.py            # typer app: inventory | extract | normalize | validate | publish | build | sample
│   ├── config.py         # config loader + write-guard (N6)
│   ├── extract/          # ว่าง — implement ใน T-105..T-109
│   ├── normalize/        # ว่าง — implement ใน T-102..T-104
│   └── util/             # ว่าง — implement พร้อม T-101 (source_id hash ฯลฯ)
└── tests/
    ├── test_cli.py
    └── test_config.py
```
