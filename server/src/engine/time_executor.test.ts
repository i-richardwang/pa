/** TimeExecutor 最终行契约：测试产品结果，而不是只给 CubeQuery 拍照。 */
import { describe, expect, test } from "bun:test";
import { executeCompletePlanned, outputMembers, resolvePlannedResults } from "./time_executor.js";
import type { LoadResponse } from "../ports/cube_gateway.js";
import type { PlannedQuery } from "./time_plan.js";
import { timeBuckets } from "../semantic_core/time_contract.js";

const plan: PlannedQuery = {
  query: {
    measures: ["test_people_metrics.new_hire_count"],
    dimensions: ["test_people_metrics.organization_name"],
    timeDimensions: [
      {
        dimension: "test_people_metrics.period_month",
        granularity: "month",
        dateRange: ["2024-01-01", "2025-06-30"],
      },
    ],
  },
  time: {
    view: "test_people_metrics",
    windows: [{ from: "2024-01-01", to: "2025-06-30" }],
  },
  businessTime: {
    outputGrain: "month",
    coordinates: [
      {
        kind: "range",
        from: "2024-01",
        to: "2025-06",
        buckets: timeBuckets({ kind: "range", from: "2024-01", to: "2025-06" }, "month"),
      },
    ],
  },
};

const response = (data: Record<string, unknown>[]): LoadResponse => ({
  data,
  annotation: {
    measures: { "test_people_metrics.new_hire_count": { title: "入职人数" } },
    dimensions: { "test_people_metrics.organization_name": { title: "组织" } },
  },
});

describe("TimeExecutor 月粒度输出", () => {
  test("跨年月粒度始终输出 year + month 完整时间键", () => {
    const result = resolvePlannedResults(plan, [
      response([
        {
          "test_people_metrics.organization_name": "A",
          "test_people_metrics.period_month.month": "2025-01-01T00:00:00.000",
          "test_people_metrics.new_hire_count": "170",
        },
        {
          "test_people_metrics.organization_name": "A",
          "test_people_metrics.period_month.month": "2024-01-01T00:00:00.000",
          "test_people_metrics.new_hire_count": "281",
        },
      ]),
    ]);

    expect(outputMembers(plan)).toEqual([
      "test_people_metrics.organization_name",
      "test_people_metrics.year",
      "test_people_metrics.month",
      "test_people_metrics.new_hire_count",
    ]);
    expect(result.data).toEqual([
      {
        "test_people_metrics.organization_name": "A",
        "test_people_metrics.year": "2024",
        "test_people_metrics.month": "1",
        "test_people_metrics.new_hire_count": "281",
      },
      {
        "test_people_metrics.organization_name": "A",
        "test_people_metrics.year": "2025",
        "test_people_metrics.month": "1",
        "test_people_metrics.new_hire_count": "170",
      },
    ]);
    expect(Object.keys(result.annotation.dimensions)).toEqual([
      "test_people_metrics.organization_name",
      "test_people_metrics.year",
      "test_people_metrics.month",
    ]);
  });

  test("显式业务排序后追加年月稳定键", () => {
    const ordered: PlannedQuery = {
      ...plan,
      query: {
        ...plan.query,
        order: [["test_people_metrics.organization_name", "asc"]],
      },
    };
    const result = resolvePlannedResults(ordered, [
      response([
        {
          "test_people_metrics.organization_name": "B",
          "test_people_metrics.period_month.month": "2024-02-01T00:00:00.000",
          "test_people_metrics.new_hire_count": "1",
        },
        {
          "test_people_metrics.organization_name": "A",
          "test_people_metrics.period_month.month": "2025-01-01T00:00:00.000",
          "test_people_metrics.new_hire_count": "2",
        },
        {
          "test_people_metrics.organization_name": "A",
          "test_people_metrics.period_month.month": "2024-12-01T00:00:00.000",
          "test_people_metrics.new_hire_count": "3",
        },
      ]),
    ]);
    expect(
      result.data.map((row) => [
        row["test_people_metrics.organization_name"],
        row["test_people_metrics.year"],
        row["test_people_metrics.month"],
      ]),
    ).toEqual([
      ["A", "2024", "12"],
      ["A", "2025", "1"],
      ["B", "2024", "2"],
    ]);
  });

  test("多窗跨年结果恒以真实桶年份为准，窗口起点只作缺省兜底", () => {
    const compared: PlannedQuery = {
      ...plan,
      query: {
        ...plan.query,
        timeDimensions: [
          {
            dimension: "test_people_metrics.period_month",
            granularity: "month",
            compareDateRange: [
              ["2025-11-01", "2026-02-28"],
              ["2024-11-01", "2025-02-28"],
            ],
          },
        ],
      },
      time: {
        ...plan.time,
        windows: [
          { from: "2025-11-01", to: "2026-02-28" },
          { from: "2024-11-01", to: "2025-02-28" },
        ],
      },
    };
    const result = resolvePlannedResults(compared, [
      response([
        {
          "test_people_metrics.organization_name": "A",
          "test_people_metrics.period_month.month": "2025-11-01T00:00:00.000",
          "test_people_metrics.new_hire_count": "1",
        },
        {
          "test_people_metrics.organization_name": "A",
          "test_people_metrics.period_month.month": "2026-01-01T00:00:00.000",
          "test_people_metrics.new_hire_count": "2",
        },
      ]),
      response([
        {
          "test_people_metrics.organization_name": "A",
          "test_people_metrics.period_month.month": "2024-11-01T00:00:00.000",
          "test_people_metrics.new_hire_count": "3",
        },
      ]),
    ]);
    expect(
      result.data.map((row) => [row["test_people_metrics.year"], row["test_people_metrics.month"]]),
    ).toEqual([
      ["2024", "11"],
      ["2025", "11"],
      ["2026", "1"],
    ]);
  });
});

test("完整执行按单窗探测上限 fail-closed，不返回部分比较矩阵", async () => {
  const compared: PlannedQuery = {
    ...plan,
    query: {
      ...plan.query,
      timeDimensions: [
        {
          dimension: "test_people_metrics.period_month",
          granularity: "month",
          compareDateRange: [
            ["2026-07-01", "2026-07-31"],
            ["2025-07-01", "2025-07-31"],
          ],
        },
      ],
    },
  };
  const cube = {
    load: async () => response([]),
    loadMulti: async () => [
      response([
        { "test_people_metrics.organization_name": "A" },
        { "test_people_metrics.organization_name": "B" },
      ]),
      response([]),
    ],
  };
  const failure = executeCompletePlanned(
    cube,
    compared,
    { subject: "test", groups: ["pa_full"], accessScope: { kind: "all" } },
    2,
  );
  await expect(failure).rejects.toThrow(/完整查询命中单窗取回上限/);
  await expect(failure).rejects.not.toThrow(/Top-N|分组选择/);
});
