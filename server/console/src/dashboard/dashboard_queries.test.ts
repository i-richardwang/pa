import { expect, test } from "bun:test";
import type { TimeIntent } from "@time";
import { boardReportReplayQueryOptions, dashboardKeys } from "./dashboard_queries";

test("维度取值键位含维度与过滤词，避免跨维度、跨过滤词复用结果", () => {
  expect(dashboardKeys.catalog).toEqual(["catalog"]);
  expect(dashboardKeys.me).toEqual(["me"]);
  expect(dashboardKeys.dimensionValues("organization_name", "研发")).toEqual([
    "dimension_values",
    "organization_name",
    "研发",
  ]);
  expect(dashboardKeys.dimensionValues("organization_name", "研发")).not.toEqual(
    dashboardKeys.dimensionValues("organization_name", "产品"),
  );
  expect(dashboardKeys.boardReportReplay("board-1", "report-1")).toEqual([
    "board_report_replay",
    "board-1",
    "report-1",
    null,
  ]);
  const time: TimeIntent = { window: { kind: "trailing", unit: "month", count: 12 } };
  expect(dashboardKeys.boardReportReplay("board-1", "report-1", time)).toEqual([
    "board_report_replay",
    "board-1",
    "report-1",
    time,
  ]);
  expect(boardReportReplayQueryOptions("board-1", "report-1")).toMatchObject({
    queryKey: ["board_report_replay", "board-1", "report-1", null],
    refetchOnWindowFocus: false,
  });
});
