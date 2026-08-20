/** Cube /sql 单窗与多窗原始形态的产品边界归一。 */
import { describe, expect, test } from "bun:test";
import {
  normalizeMetaViews,
  normalizeSqlResponse,
  resolveTimeSourceAnchors,
} from "./cube_gateway.js";
import type { CubeView } from "../ports/cube_gateway.js";
import { buildTimeSourceRegistry } from "../semantic_core/time_source.js";

const GENERIC_TIME_SOURCES = buildTimeSourceRegistry([
  {
    id: "sales_actual",
    title: "Sales actuals",
    role: "actual",
    primary: true,
    comparison_policy: "calendar",
  },
  {
    id: "sales_plan",
    title: "Sales plan",
    role: "plan",
    primary: false,
    reference_source: "sales_actual",
    comparison_policy: "calendar",
  },
  {
    id: "inventory_count",
    title: "Inventory counts",
    role: "actual",
    primary: false,
    comparison_policy: "explicit_only",
  },
]);

test("内部成员只保留在服务端契约解析面", () => {
  const view = {
    type: "view",
    name: "test_people_metrics",
    title: "人员总览",
    measures: [
      { name: "test_people_metrics.active_employee_count", title: "在职人数", type: "number" },
      {
        name: "test_people_metrics.raw_count",
        title: "基础人数",
        type: "number",
        meta: { internal: true },
      },
    ],
    dimensions: [
      { name: "test_people_metrics.organization_name", title: "组织", type: "string" },
      {
        name: "test_people_metrics.employee_id",
        title: "员工编号",
        type: "string",
        meta: { internal: true },
      },
    ],
  } satisfies CubeView & { type: string };

  const [normalized] = normalizeMetaViews([view]);
  expect(normalized.measures.map(({ name }) => name)).toEqual([
    "test_people_metrics.active_employee_count",
  ]);
  expect(normalized.dimensions.map(({ name }) => name)).toEqual([
    "test_people_metrics.organization_name",
  ]);
  expect(normalized.internalMeasures?.map(({ name }) => name)).toEqual([
    "test_people_metrics.raw_count",
  ]);
  expect(normalized.internalDimensions?.map(({ name }) => name)).toEqual([
    "test_people_metrics.employee_id",
  ]);
});

test("非 HR 数据时钟从包注册表和执行 View 元数据解析", () => {
  const metricView = (
    name: string,
    source: "sales_actual" | "sales_plan" | "inventory_count",
    measure: string,
  ): CubeView => ({
    name,
    title: name,
    meta: {
      query_surface: "metric_source",
      time_source: source,
      time_anchor_measure: measure,
    },
    measures: [{ name: `${name}.${measure}`, title: measure, type: "number" }],
    dimensions: [],
  });
  const anchors = resolveTimeSourceAnchors(
    [
      metricView("sales_execution", "sales_actual", "revenue"),
      metricView("plan_execution", "sales_plan", "planned_revenue"),
      metricView("inventory_execution", "inventory_count", "counted_units"),
    ],
    GENERIC_TIME_SOURCES,
  );
  expect(Object.fromEntries(anchors)).toEqual({
    sales_actual: { view: "sales_execution", measure: "revenue" },
    sales_plan: { view: "plan_execution", measure: "planned_revenue" },
    inventory_count: { view: "inventory_execution", measure: "counted_units" },
  });
  // 注册表里的非主来源不在当前包模型中出现时，不要求锚点。
  expect(
    Object.fromEntries(
      resolveTimeSourceAnchors(
        [metricView("sales_execution", "sales_actual", "revenue")],
        GENERIC_TIME_SOURCES,
      ),
    ),
  ).toEqual({ sales_actual: { view: "sales_execution", measure: "revenue" } });
  // 声明了某来源的执行 View 在场却没人给锚点：fail-closed
  expect(() =>
    resolveTimeSourceAnchors(
      [
        metricView("sales_execution", "sales_actual", "revenue"),
        {
          ...metricView("plan_execution", "sales_plan", "planned_revenue"),
          meta: { query_surface: "metric_source", time_source: "sales_plan" },
        },
      ],
      GENERIC_TIME_SOURCES,
    ),
  ).toThrow("sales_plan 缺少唯一时间锚点");
  // 主时钟恒必须在场
  expect(() =>
    resolveTimeSourceAnchors(
      [metricView("plan_execution", "sales_plan", "planned_revenue")],
      GENERIC_TIME_SOURCES,
    ),
  ).toThrow("sales_actual 缺少唯一时间锚点");
});

describe("normalizeSqlResponse", () => {
  test("单窗统一返回长度为一的逐窗数组", () => {
    const result = normalizeSqlResponse(
      {
        measures: ["test_people_metrics.active_employee_count"],
        timeDimensions: [
          {
            dimension: "test_people_metrics.period_month",
            granularity: "month",
            dateRange: ["2026-06-01", "2026-06-30"],
          },
        ],
      },
      { sql: { sql: ["select ?", ["2026"]] } },
    );
    expect(result).toEqual([
      {
        window: { from: "2026-06-01", to: "2026-06-30" },
        sql: "select ?",
        params: ["2026"],
      },
    ]);
  });

  test("多窗逐项配对窗口，不泄漏 Cube 包装对象", () => {
    const result = normalizeSqlResponse(
      {
        measures: ["test_people_metrics.ytd_primary_event_rate"],
        timeDimensions: [
          {
            dimension: "test_people_metrics.period_month",
            granularity: "month",
            compareDateRange: [
              ["2025-06-01", "2025-06-30"],
              ["2026-06-01", "2026-06-30"],
            ],
          },
        ],
      },
      [
        { sql: { external: false, sql: ["select 2025", ["2025", "2026"]] } },
        { sql: { external: false, sql: ["select 2026", ["2025", "2026"]] } },
      ],
    );
    expect(result.map(({ window, sql }) => ({ window, sql }))).toEqual([
      { window: { from: "2025-06-01", to: "2025-06-30" }, sql: "select 2025" },
      { window: { from: "2026-06-01", to: "2026-06-30" }, sql: "select 2026" },
    ]);
  });

  test("SQL 缺失或窗口数量不一致时以稳定网关错误拒绝", () => {
    expect(() => normalizeSqlResponse({}, { sql: {} })).toThrow("数据引擎暂时不可用");
    expect(() =>
      normalizeSqlResponse(
        {
          timeDimensions: [
            {
              dimension: "v.period_month",
              compareDateRange: [
                ["2025-01-01", "2025-01-31"],
                ["2026-01-01", "2026-01-31"],
              ],
            },
          ],
        },
        { sql: { sql: ["select 1", []] } },
      ),
    ).toThrow("数据引擎暂时不可用");
  });
});
