import { expect, test } from "bun:test";
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
});

test("看板瓦片重放键位随板级时间覆盖分开，取数选项与键位同源", () => {
  const override = { window: { kind: "trailing" as const, count: 12, unit: "month" as const } };
  expect(dashboardKeys.boardReportReplay("board-1", "report-1", null)).toEqual([
    "board_report_replay",
    "board-1",
    "report-1",
    null,
  ]);
  expect(dashboardKeys.boardReportReplay("board-1", "report-1", override)).toEqual([
    "board_report_replay",
    "board-1",
    "report-1",
    override,
  ]);
  expect(boardReportReplayQueryOptions("board-1", "report-1", override).queryKey).toEqual(
    dashboardKeys.boardReportReplay("board-1", "report-1", override),
  );
});

test("分页与时间窗进入键位，失效用前缀键覆盖所有页", () => {
  expect(dashboardKeys.feedbackPage(20)).toEqual([...dashboardKeys.feedback, 20]);
  expect(dashboardKeys.usage(30, 0)).toEqual(["usage", 30, 0]);
});
