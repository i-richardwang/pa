# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb"]
# ///
"""生成完全虚构、确定性的 PA 公开演示 parquet，并原子切换 current。"""

from __future__ import annotations

import json
import os
import shutil
import uuid
from pathlib import Path

import duckdb

REPO_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_ID = "pa_demo"
VERSION = "demo_v1"


def output_root() -> Path:
    configured = os.environ.get("PA_SEMANTIC_DATA_DIR", "data/semantic_data")
    path = Path(configured)
    return path.resolve() if path.is_absolute() else (REPO_ROOT / path).resolve()


def publish_current(root: Path, version_dir: Path) -> None:
    current = root / "current"
    if current.exists() and not current.is_symlink():
        raise RuntimeError(f"{current} 必须是可原子替换的软链接")
    temporary = root / f".current-{uuid.uuid4().hex}"
    temporary.symlink_to(os.path.relpath(version_dir, root), target_is_directory=True)
    os.replace(temporary, current)


def main() -> None:
    root = output_root()
    versions = root / "versions"
    staging = root / f".demo-staging-{uuid.uuid4().hex}"
    target = versions / VERSION
    root.mkdir(parents=True, exist_ok=True)
    versions.mkdir(parents=True, exist_ok=True)
    staging.mkdir()
    connection = duckdb.connect()
    try:
        connection.execute(
            """
            CREATE TEMP TABLE demo_employees AS
            SELECT
              i,
              printf('DEMO-%03d', i) AS employee_id,
              printf('Demo Employee %03d', i) AS employee_name,
              DATE '2024-07-01' + ((i * 5) % 18) * INTERVAL '1 month'
                + ((i * 7) % 20) * INTERVAL '1 day' AS hire_date,
              CASE WHEN i % 6 = 0 THEN
                DATE '2025-04-01' + ((i * 3) % 14) * INTERVAL '1 month'
                  + ((i * 11) % 20) * INTERVAL '1 day'
              END AS leave_date,
              CASE WHEN i % 2 = 0 THEN 'Aurora Labs' ELSE 'Harbor Works' END AS organization_name,
              CASE i % 4
                WHEN 0 THEN 'Product'
                WHEN 1 THEN 'Engineering'
                WHEN 2 THEN 'Operations'
                ELSE 'Customer Success'
              END AS department_name,
              CASE WHEN i % 2 = 0 THEN '女' ELSE '男' END AS gender,
              23 + (i * 3) % 28 AS age,
              CASE
                WHEN 23 + (i * 3) % 28 < 30 THEN '30岁以下'
                WHEN 23 + (i * 3) % 28 < 40 THEN '30-39岁'
                ELSE '40岁及以上'
              END AS age_band,
              CASE i % 3 WHEN 0 THEN '初级' WHEN 1 THEN '中级' ELSE '高级' END AS job_level_band,
              CASE WHEN i % 12 = 0 THEN '被动离职' ELSE '主动离职' END AS leave_type
            FROM range(1, 81) AS employees(i)
            """
        )
        queries = {
            "employee_month_snapshot_fact": """
                WITH months AS (
                  SELECT month_start::DATE AS period_month
                  FROM generate_series(DATE '2025-01-01', DATE '2026-06-01', INTERVAL '1 month') AS t(month_start)
                )
                SELECT
                  employee_id || ':' || strftime(period_month, '%Y-%m') AS record_key,
                  employee_id, employee_name,
                  year(period_month)::INTEGER AS year,
                  month(period_month)::INTEGER AS month,
                  period_month,
                  last_day(period_month) AS record_date,
                  organization_name, department_name, gender, age_band, age, job_level_band
                FROM demo_employees CROSS JOIN months
                WHERE hire_date <= last_day(period_month)
                  AND (leave_date IS NULL OR leave_date > last_day(period_month))
            """,
            "employee_hire_event_fact": """
                SELECT
                  employee_id || ':hire' AS record_key,
                  employee_id, employee_name,
                  year(hire_date)::INTEGER AS year,
                  month(hire_date)::INTEGER AS month,
                  date_trunc('month', hire_date)::DATE AS period_month,
                  hire_date::DATE AS record_date,
                  organization_name, department_name, gender, age_band, age, job_level_band
                FROM demo_employees
                WHERE hire_date BETWEEN DATE '2025-01-01' AND DATE '2026-06-30'
            """,
            "employee_leave_event_fact": """
                SELECT
                  employee_id || ':leave' AS record_key,
                  employee_id, employee_name,
                  year(leave_date)::INTEGER AS year,
                  month(leave_date)::INTEGER AS month,
                  date_trunc('month', leave_date)::DATE AS period_month,
                  leave_date::DATE AS record_date,
                  organization_name, department_name, gender, age_band, age, job_level_band,
                  leave_type
                FROM demo_employees
                WHERE leave_date BETWEEN DATE '2025-01-01' AND DATE '2026-06-30'
            """,
            "department_headcount_plan_fact": """
                WITH months AS (
                  SELECT month_start::DATE AS period_month
                  FROM generate_series(DATE '2025-01-01', DATE '2026-06-01', INTERVAL '1 month') AS t(month_start)
                ), departments AS (
                  SELECT * FROM (VALUES
                    ('Aurora Labs', 'Product', 25),
                    ('Aurora Labs', 'Operations', 23),
                    ('Harbor Works', 'Engineering', 26),
                    ('Harbor Works', 'Customer Success', 24)
                  ) AS d(organization_name, department_name, base_plan)
                )
                SELECT
                  organization_name || ':' || department_name || ':' || strftime(period_month, '%Y-%m') AS record_key,
                  year(period_month)::INTEGER AS year,
                  month(period_month)::INTEGER AS month,
                  period_month,
                  organization_name,
                  department_name,
                  base_plan + CASE WHEN month(period_month) >= 7 THEN 2 ELSE 0 END AS planned_headcount
                FROM months CROSS JOIN departments
            """,
        }
        manifest: dict[str, object] = {
            "semantic_package": PACKAGE_ID,
            "version": VERSION,
            "synthetic": True,
            "files": {},
        }
        for name, query in queries.items():
            path = staging / f"{name}.parquet"
            connection.execute(f"COPY ({query}) TO ? (FORMAT PARQUET)", [str(path)])
            rows = connection.execute(
                "SELECT count(*) FROM read_parquet(?)", [str(path)]
            ).fetchone()[0]
            manifest["files"][f"{name}.parquet"] = {"rows": rows}
        (staging / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        if target.exists():
            shutil.rmtree(target)
        os.replace(staging, target)
        publish_current(root, target)
    finally:
        connection.close()
        if staging.exists():
            shutil.rmtree(staging)
    print(f"demo semantic data: {target} -> {root / 'current'}")


if __name__ == "__main__":
    main()
