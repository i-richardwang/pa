/**
 * 导出通道纯函数单测：CSV 装配；短票据见 export_ticket.test.ts。
 * /export 路由与真实查询由 scripts/smoke.ts 端到端覆盖。
 */
import { describe, expect, test } from "bun:test";
import type { CubeGateway } from "../ports/cube_gateway.js";
import { runExport, toCsv } from "./export.js";
import type { MetricQueryPlan } from "./metric_planner.js";

describe("toCsv", () => {
  test("UTF-8 BOM + CRLF + RFC 4180 转义", () => {
    const csv = toCsv(
      ["名称", "备注"],
      [
        ["甲", '含"引号"'],
        ["乙,带逗号", "多\n行"],
        ["丙", null],
      ],
    );
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("名称,备注");
    expect(lines[1]).toBe('甲,"含""引号"""');
    expect(lines[2]).toBe('"乙,带逗号","多\n行"');
    expect(lines[3]).toBe("丙,");
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

test("异构时间指标计划的导出与预览复用同一结果计算", async () => {
  const view = "test_people_metrics";
  const dimension = `${view}.organization_name`;
  const active_employee_count = `${view}.active_employee_count`;
  const leavers = `${view}.turnover_count`;
  // 两腿同源于一个业务坐标：2025-01 至 2026-07 按年切成 2025 整年与 2026 部分年两个桶。
  const coordinates = [
    {
      kind: "range" as const,
      from: "2025-01",
      to: "2026-07",
      buckets: [
        { from: "2025-01", to: "2025-12" },
        { from: "2026-01", to: "2026-07" },
      ],
    },
  ];
  const businessTime = {
    outputGrain: "year" as const,
    coordinates,
  };
  const plan: MetricQueryPlan = {
    kind: "metric_query",
    dimensions: [dimension],
    measures: [active_employee_count, leavers],
    business_time: businessTime,
    time_view: view,
    output_metric_ids: {
      [active_employee_count]: "measure:active_employee_count",
      [leavers]: "measure:turnover_count",
    },
    nodes: {
      "measure:active_employee_count": { kind: "aggregate", member: active_employee_count },
      "measure:turnover_count": { kind: "aggregate", member: leavers },
    },
    legs: [
      {
        source_view: view,
        dimensions: { [dimension]: dimension },
        measures: { [active_employee_count]: "measure:active_employee_count" },
        plan: {
          query: {
            dimensions: [dimension],
            measures: [active_employee_count],
            timeDimensions: [
              {
                dimension: `${view}.period_month`,
                granularity: "month",
                compareDateRange: [
                  ["2025-12-01", "2025-12-31"],
                  ["2026-07-01", "2026-07-31"],
                ],
              },
            ],
          },
          time: {
            view,
            windows: [
              { from: "2025-12-01", to: "2025-12-31" },
              { from: "2026-07-01", to: "2026-07-31" },
            ],
          },
        },
      },
      {
        source_view: view,
        dimensions: { [dimension]: dimension },
        measures: { [leavers]: "measure:turnover_count" },
        plan: {
          query: {
            dimensions: [dimension],
            measures: [leavers],
            timeDimensions: [
              {
                dimension: `${view}.period_month`,
                granularity: "year",
                dateRange: ["2025-01-01", "2026-07-31"],
              },
            ],
          },
          time: {
            view,
            windows: [{ from: "2025-01-01", to: "2026-07-31" }],
          },
        },
      },
    ],
  };
  const annotation = (measure: string) => ({
    measures: {
      [measure]: { title: measure === active_employee_count ? "在职人数" : "离职人数" },
    },
    dimensions: { [dimension]: { title: "组织" } },
  });
  const cube = {
    loadMulti: async () =>
      [2025, 2026].map((year) => ({
        data: [
          {
            [dimension]: "示例组织甲",
            [`${view}.period_month.month`]: `${year}-07-01T00:00:00.000`,
            [active_employee_count]: year,
          },
        ],
        annotation: annotation(active_employee_count),
      })),
    load: async () => ({
      data: [2025, 2026].map((year) => ({
        [dimension]: "示例组织甲",
        [`${view}.period_month.year`]: `${year}-01-01T00:00:00.000`,
        [leavers]: year - 1900,
      })),
      annotation: annotation(leavers),
    }),
    meta: async () => [
      {
        name: view,
        title: "人员总览",
        measures: [
          { name: active_employee_count, title: "在职人数", type: "number" },
          { name: leavers, title: "离职人数", type: "number" },
        ],
        dimensions: [{ name: dimension, title: "组织", type: "string" }],
      },
    ],
    timeContext: async () => ({ dataAsOf: "2026-07", sources: {} }),
  } as unknown as CubeGateway;

  const result = await runExport(cube, plan, {
    subject: "tester",
    groups: [],
    accessScope: { kind: "all" },
  });
  expect(result.complete).toBe(true);
  expect(result.rowCount).toBe(2);
  expect(result.csv).toContain("组织,年,在职人数,离职人数");
  expect(result.csv).toContain("示例组织甲,2025,2025,125");
  expect(result.csv).toContain("示例组织甲,2026,2026,126");
});
