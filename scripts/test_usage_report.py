# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
from __future__ import annotations

import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


class UsageReportTest(unittest.TestCase):
    def test_report_reads_minimized_usage_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "app.db"
            connection = sqlite3.connect(database)
            connection.executescript(
                """
                CREATE TABLE usage_log (
                  id INTEGER PRIMARY KEY,
                  at TEXT NOT NULL,
                  caller TEXT NOT NULL,
                  tool TEXT NOT NULL,
                  title TEXT,
                  outcome TEXT NOT NULL,
                  error TEXT,
                  row_count INTEGER,
                  has_more INTEGER,
                  duration_ms INTEGER NOT NULL,
                  term_count INTEGER,
                  query_fingerprint TEXT,
                  derived_formulas TEXT,
                  unmatched_terms TEXT,
                  analysis_id TEXT,
                  view_id TEXT
                );
                INSERT INTO usage_log (
                  at, caller, tool, title, outcome, row_count, duration_ms,
                  query_fingerprint, derived_formulas
                ) VALUES (
                  '2099-01-01T00:00:00+00:00', 'demo', 'run_analysis', '派生分析',
                  'ok', 1, 10, 'q-0123456789', '["rate = numerator ÷ denominator"]'
                );
                """
            )
            connection.commit()
            connection.close()

            result = subprocess.run(
                [
                    sys.executable,
                    str(REPO / "scripts" / "usage_report.py"),
                    "--days",
                    "30000",
                    "--db",
                    str(database),
                ],
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("q-0123456789", result.stdout)
            self.assertIn("rate = numerator ÷ denominator", result.stdout)


if __name__ == "__main__":
    unittest.main()
