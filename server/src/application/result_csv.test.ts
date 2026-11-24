import { expect, test } from "bun:test";
import { observationSummary, type ViewBlock } from "../semantic_core/query_payload.js";
import { materializeResultCsv } from "./result_csv.js";

test("同月不同调研时钟的 CSV 各自保留指标、请求期间和实际期次", () => {
  const requested = { from: "2026-01", to: "2026-06" };
  const view: ViewBlock = {
    id: "query",
    columns: ["score", "participation"],
    column_roles: { score: "measure", participation: "measure" },
    rows: [[0, null]],
    row_count: 1,
    query_notes: [],
    observations: [
      {
        columns: ["score"],
        requested,
        status: "observed",
        occurrence: { id: "wave_a", title: "员工调研", date: "2026-06-02" },
      },
      { columns: ["participation"], requested, status: "not_observed" },
    ],
  };
  const { csv } = materializeResultCsv(view, "2026-06");
  expect(csv).toContain("score · 实际期次");
  expect(csv).toContain("participation · 实际期次");
  expect(csv).toContain(
    "0,,2026-01 至 2026-06,wave_a,2026-06-02,已观测,2026-01 至 2026-06,,,未观测",
  );
  expect(observationSummary(view.observations![0])).toContain("员工调研（wave_a，2026-06-02）");
});
