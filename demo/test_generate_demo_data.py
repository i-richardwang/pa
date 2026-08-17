# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb"]
# ///
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import duckdb
from generate_demo_data import main, publish_current


class DemoDataTest(unittest.TestCase):
    def test_generator_publishes_only_deterministic_synthetic_contracts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "semantic_data"
            with patch.dict(os.environ, {"PA_SEMANTIC_DATA_DIR": str(root)}):
                main()
                first_manifest = json.loads((root / "current" / "manifest.json").read_text())
                main()
                second_manifest = json.loads((root / "current" / "manifest.json").read_text())

            self.assertTrue((root / "current").is_symlink())
            self.assertEqual(first_manifest, second_manifest)
            self.assertEqual(first_manifest["semantic_package"], "pa_demo")
            self.assertIs(first_manifest["synthetic"], True)
            self.assertEqual(
                set(first_manifest["files"]),
                {
                    "department_headcount_plan_fact.parquet",
                    "employee_hire_event_fact.parquet",
                    "employee_leave_event_fact.parquet",
                    "employee_month_snapshot_fact.parquet",
                },
            )
            for metadata in first_manifest["files"].values():
                self.assertGreater(metadata["rows"], 0)

            with duckdb.connect() as connection:
                rows = connection.execute(
                    """SELECT DISTINCT organization_name
                       FROM read_parquet(?) ORDER BY organization_name""",
                    [str(root / "current" / "employee_month_snapshot_fact.parquet")],
                ).fetchall()
                names = connection.execute(
                    """SELECT count(*)
                       FROM read_parquet(?)
                       WHERE employee_name NOT LIKE 'Demo Employee %'""",
                    [str(root / "current" / "employee_month_snapshot_fact.parquet")],
                ).fetchone()[0]
            self.assertEqual(rows, [("Aurora Labs",), ("Harbor Works",)])
            self.assertEqual(names, 0)

    def test_current_must_remain_an_atomic_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "current").mkdir()
            version = root / "versions" / "demo_v1"
            version.mkdir(parents=True)
            with self.assertRaisesRegex(RuntimeError, "必须是可原子替换的软链接"):
                publish_current(root, version)


if __name__ == "__main__":
    unittest.main()
