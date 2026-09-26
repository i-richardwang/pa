import { expect, test } from "bun:test";
import { boardReportReplayQueryOptions, dashboardKeys } from "./dashboard_queries";

test("维度候选值的查询键包含维度和过滤词，不同维度或过滤词不共用结果", () => {
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

test("看板瓦片重放的查询键包含看板级时间覆盖，查询选项使用同一个键", () => {
  const override = {
    window: {
      kind: "trailing" as const,
      count: 12,
      unit: "month" as const,
      grain: "month" as const,
    },
  };
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

test("分页和时间窗进入查询键，前缀键可失效所有页", () => {
  expect(dashboardKeys.feedbackPage(20)).toEqual([...dashboardKeys.feedback, 20]);
  expect(dashboardKeys.usage(30, 0)).toEqual(["usage", 30, 0]);
});
