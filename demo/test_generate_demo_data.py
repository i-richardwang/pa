# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb"]
# ///
from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

import duckdb
from generate_demo_data import Q12_ITEMS, configured_anchor, main, publish_current


class DemoDataTest(unittest.TestCase):
    def generate(self, root: Path, anchor: str) -> dict[str, object]:
        with patch.dict(
            os.environ,
            {"PA_SEMANTIC_DATA_DIR": str(root), "PA_DEMO_AS_OF_MONTH": anchor},
            clear=False,
        ):
            main()
        return json.loads((root / "current" / "manifest.json").read_text())

    def test_generator_publishes_five_year_synthetic_contracts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "semantic_data"
            first = self.generate(root, "2026-07")
            second = self.generate(root, "2026-07")

            self.assertTrue((root / "current").is_symlink())
            self.assertEqual(first, second)
            self.assertEqual(len(list((root / "versions").iterdir())), 1)
            self.assertEqual(first["semantic_package"], "pa_demo")
            self.assertEqual(first["generator_version"], "demo_v3")
            self.assertRegex(first["version"], r"^demo_v3_2026_07_[0-9a-f]{12}$")
            self.assertRegex(first["content_fingerprint"], r"^[0-9a-f]{64}$")
            self.assertIs(first["synthetic"], True)
            self.assertEqual(first["as_of_month"], "2026-07")
            self.assertEqual(first["history_from"], "2021-08")
            self.assertEqual(first["validation"]["month_coverage"], 60)
            self.assertEqual(first["validation"]["department_balance"], "passed")
            self.assertGreaterEqual(first["validation"]["current_headcount"], 1800)
            self.assertGreaterEqual(first["validation"]["q12_wave_count"], 9)
            self.assertLessEqual(first["validation"]["q12_wave_count"], 11)
            self.assertGreater(first["validation"]["q12_current_response_rate"], 0.58)
            self.assertEqual(first["validation"]["q12_consistency"], "passed")
            self.assertEqual(
                set(first["files"]),
                {
                    "department_headcount_plan_fact.parquet",
                    "employee_hire_event_fact.parquet",
                    "employee_leave_event_fact.parquet",
                    "employee_month_snapshot_fact.parquet",
                    "q12_survey_participation_fact.parquet",
                    "q12_survey_response_fact.parquet",
                    "workforce_month_exposure_fact.parquet",
                },
            )
            for metadata in first["files"].values():
                self.assertGreater(metadata["rows"], 0)
                self.assertEqual(metadata["period_to"], "2026-07-01")
                self.assertRegex(metadata["sha256"], r"^[0-9a-f]{64}$")

    def test_workforce_lifecycle_and_monthly_balances_are_consistent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "semantic_data"
            self.generate(root, "2026-07")
            current = root / "current"
            snapshot = str(current / "employee_month_snapshot_fact.parquet")
            hires = str(current / "employee_hire_event_fact.parquet")
            leaves = str(current / "employee_leave_event_fact.parquet")
            exposure = str(current / "workforce_month_exposure_fact.parquet")
            plans = str(current / "department_headcount_plan_fact.parquet")
            survey_participation = str(current / "q12_survey_participation_fact.parquet")
            survey_response = str(current / "q12_survey_response_fact.parquet")

            with duckdb.connect() as connection:
                dimensions = connection.execute(
                    """
                    SELECT count(DISTINCT legal_entity_name),
                           count(DISTINCT organization_name),
                           count(DISTINCT department_name),
                           count(DISTINCT work_location),
                           count(DISTINCT employment_type),
                           count(DISTINCT gender),
                           count(DISTINCT age_band),
                           count(DISTINCT job_family_name),
                           count(DISTINCT job_level_band),
                           count(DISTINCT period_month)
                    FROM read_parquet(?)
                    """,
                    [snapshot],
                ).fetchone()
                self.assertEqual(dimensions, (2, 3, 12, 4, 2, 3, 5, 12, 5, 60))

                invalid_ids = connection.execute(
                    "SELECT count(*) FROM read_parquet(?) WHERE employee_id NOT LIKE 'DEMO-%'",
                    [snapshot],
                ).fetchone()[0]
                self.assertEqual(invalid_ids, 0)

                invalid_exposure = connection.execute(
                    """
                    SELECT count(*) FROM read_parquet(?)
                    WHERE workforce_exposure <= 0 OR workforce_exposure > 1
                    """,
                    [exposure],
                ).fetchone()[0]
                self.assertEqual(invalid_exposure, 0)

                plan_coverage = connection.execute(
                    """
                    SELECT count(*), count(DISTINCT department_name),
                           count(DISTINCT period_month)
                    FROM read_parquet(?)
                    """,
                    [plans],
                ).fetchone()
                self.assertEqual(plan_coverage, (720, 12, 60))

                plan_scenarios = connection.execute(
                    """
                    WITH actual AS (
                      SELECT period_month, department_name, count(*) AS active_headcount
                      FROM read_parquet(?) GROUP BY ALL
                    )
                    SELECT count(*) FILTER (WHERE active_headcount < planned_headcount),
                           count(*) FILTER (WHERE active_headcount > planned_headcount)
                    FROM actual JOIN read_parquet(?) USING (period_month, department_name)
                    """,
                    [snapshot, plans],
                ).fetchone()
                self.assertGreater(plan_scenarios[0], 0)
                self.assertGreater(plan_scenarios[1], 0)

                leave_scenarios = connection.execute(
                    """
                    SELECT count(DISTINCT leave_type), count(DISTINCT period_month)
                    FROM read_parquet(?)
                    """,
                    [leaves],
                ).fetchone()
                self.assertEqual(leave_scenarios, (3, 60))

                balance_errors = connection.execute(
                    """
                    WITH closing AS (
                      SELECT period_month, organization_name, department_name,
                             count(*) AS headcount
                      FROM read_parquet(?) GROUP BY ALL
                    ), movement AS (
                      SELECT period_month, organization_name, department_name,
                             sum(hires) AS hires, sum(separations) AS separations
                      FROM (
                        SELECT period_month, organization_name, department_name,
                               count(*) AS hires, 0 AS separations
                        FROM read_parquet(?) GROUP BY ALL
                        UNION ALL
                        SELECT period_month, organization_name, department_name,
                               0 AS hires, count(*) AS separations
                        FROM read_parquet(?) GROUP BY ALL
                      ) GROUP BY ALL
                    )
                    SELECT count(*)
                    FROM closing current
                    JOIN closing previous
                      ON previous.period_month = current.period_month - INTERVAL '1 month'
                     AND previous.organization_name = current.organization_name
                     AND previous.department_name = current.department_name
                    LEFT JOIN movement
                      ON movement.period_month = current.period_month
                     AND movement.organization_name = current.organization_name
                     AND movement.department_name = current.department_name
                    WHERE current.headcount <> previous.headcount
                          + coalesce(movement.hires, 0)
                          - coalesce(movement.separations, 0)
                    """,
                    [snapshot, hires, leaves],
                ).fetchone()[0]
                self.assertEqual(balance_errors, 0)

                invalid_ages = connection.execute(
                    """
                    WITH history AS (
                      SELECT employee_id, period_month, age, tenure_years,
                             lag(age) OVER employee_history AS previous_age,
                             lag(tenure_years) OVER employee_history AS previous_tenure
                      FROM read_parquet(?)
                      WINDOW employee_history AS (
                        PARTITION BY employee_id ORDER BY period_month
                      )
                    )
                    SELECT count(*) FROM history
                    WHERE previous_age IS NOT NULL
                      AND (age < previous_age OR age > previous_age + 1
                           OR tenure_years < previous_tenure)
                    """,
                    [snapshot],
                ).fetchone()[0]
                self.assertEqual(invalid_ages, 0)

                survey_coverage = connection.execute(
                    """
                    SELECT count(DISTINCT period_month), count(DISTINCT wave_id),
                           min(wave_month), max(wave_month)
                    FROM read_parquet(?)
                    """,
                    [survey_participation],
                ).fetchone()
                self.assertEqual(survey_coverage[0], 60)
                self.assertGreaterEqual(survey_coverage[1], 9)
                self.assertLessEqual(survey_coverage[1], 11)
                self.assertLessEqual(survey_coverage[2], date(2021, 8, 1))
                self.assertLessEqual(survey_coverage[3], date(2026, 7, 1))

                survey_balance = connection.execute(
                    """
                    WITH participation AS (
                      SELECT period_month, wave_id, count(*) AS invited,
                             sum(responded_flag) AS responded
                      FROM read_parquet(?) GROUP BY ALL
                    ), responses AS (
                      SELECT period_month, wave_id, count(*) AS responded,
                             min(q12_average_score) AS min_score,
                             max(q12_average_score) AS max_score
                      FROM read_parquet(?) GROUP BY ALL
                    )
                    SELECT count(*) FILTER (
                             WHERE participation.responded <> responses.responded
                                OR participation.responded > participation.invited
                           ),
                           min(responses.min_score), max(responses.max_score)
                    FROM participation JOIN responses USING (period_month, wave_id)
                    """,
                    [survey_participation, survey_response],
                ).fetchone()
                self.assertEqual(survey_balance[0], 0)
                self.assertGreaterEqual(survey_balance[1], 1)
                self.assertLessEqual(survey_balance[2], 5)

                q12_item_columns = [f"{item.code}_score" for item in Q12_ITEMS]
                invalid_q12_scores = connection.execute(
                    f"""
                    SELECT count(*) FROM read_parquet(?)
                    WHERE {" OR ".join(f"{column} NOT BETWEEN 1 AND 5" for column in q12_item_columns)}
                       OR q12_answered_item_count <> 12
                       OR q12_strongly_agree_item_count > q12_favorable_item_count
                    """,
                    [survey_response],
                ).fetchone()[0]
                self.assertEqual(invalid_q12_scores, 0)
                survey_logic_errors = connection.execute(
                    """
                    SELECT count(*) FROM read_parquet(?)
                    WHERE abs(q12_average_score
                              - (q01_score + q02_score + q03_score + q04_score
                                 + q05_score + q06_score + q07_score + q08_score
                                 + q09_score + q10_score + q11_score + q12_score) / 12.0) > 0.0001
                       OR abs(q12_basic_needs_score - (q01_score + q02_score) / 2.0) > 0.0001
                       OR abs(q12_growth_score - (q11_score + q12_score) / 2.0) > 0.0001
                    """,
                    [survey_response],
                ).fetchone()[0]
                self.assertEqual(survey_logic_errors, 0)

                wave_cohort_errors = connection.execute(
                    """
                    WITH invited AS (
                      SELECT wave_month, count(*) AS invited
                      FROM read_parquet(?) WHERE period_month = wave_month GROUP BY ALL
                    ), active AS (
                      SELECT period_month AS wave_month, count(*) AS active
                      FROM read_parquet(?) GROUP BY ALL
                    )
                    SELECT count(*) FROM invited JOIN active USING (wave_month)
                    WHERE invited <> active
                    """,
                    [survey_participation, snapshot],
                ).fetchone()[0]
                self.assertEqual(wave_cohort_errors, 0)
                self.assertEqual(
                    tuple(item.code for item in Q12_ITEMS), tuple(f"q{i:02d}" for i in range(1, 13))
                )

    def test_new_anchor_preserves_overlapping_history(self) -> None:
        with (
            tempfile.TemporaryDirectory() as first_temporary,
            tempfile.TemporaryDirectory() as second_temporary,
        ):
            first_root = Path(first_temporary) / "semantic_data"
            second_root = Path(second_temporary) / "semantic_data"
            self.generate(first_root, "2026-07")
            self.generate(second_root, "2026-08")
            with duckdb.connect() as connection:
                for filename in (
                    "employee_month_snapshot_fact.parquet",
                    "q12_survey_participation_fact.parquet",
                    "q12_survey_response_fact.parquet",
                ):
                    first_fact = str(first_root / "current" / filename)
                    second_fact = str(second_root / "current" / filename)
                    differences = connection.execute(
                        """
                        SELECT count(*) FROM (
                          (SELECT * FROM read_parquet(?) WHERE period_month = DATE '2026-07-01')
                          EXCEPT ALL
                          (SELECT * FROM read_parquet(?) WHERE period_month = DATE '2026-07-01')
                        )
                        """,
                        [first_fact, second_fact],
                    ).fetchone()[0]
                    reverse_differences = connection.execute(
                        """
                        SELECT count(*) FROM (
                          (SELECT * FROM read_parquet(?) WHERE period_month = DATE '2026-07-01')
                          EXCEPT ALL
                          (SELECT * FROM read_parquet(?) WHERE period_month = DATE '2026-07-01')
                        )
                        """,
                        [second_fact, first_fact],
                    ).fetchone()[0]
                    self.assertEqual((differences, reverse_differences), (0, 0), filename)

    def test_anchor_defaults_to_last_complete_month_and_rejects_invalid_values(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(configured_anchor(date(2026, 8, 20)), date(2026, 7, 1))
        with patch.dict(os.environ, {"PA_DEMO_AS_OF_MONTH": "2026/07"}, clear=True):
            with self.assertRaisesRegex(ValueError, "YYYY-MM"):
                configured_anchor()

    def test_current_must_remain_an_atomic_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "current").mkdir()
            version = root / "versions" / "demo_v3_2026_07"
            version.mkdir(parents=True)
            with self.assertRaisesRegex(RuntimeError, "必须是可原子替换的软链接"):
                publish_current(root, version)


if __name__ == "__main__":
    unittest.main()
