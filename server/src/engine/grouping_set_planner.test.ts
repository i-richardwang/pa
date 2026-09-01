import { describe, expect, test } from "bun:test";
import type { CubeQuery, CubeView } from "../ports/cube_gateway.js";
import type { GroupingSetsSpec } from "../semantic_core/analysis_spec.js";
import { completeHierarchy } from "./hierarchy.js";
import { planMetricQueryWithPlanning, resolveMetricQueryPlanning } from "./metric_planner.js";
import { planGroupingSets } from "./grouping_set_planner.js";

const VIEW = "test_people_metrics";
const T0 = `${VIEW}.organization_level_0`;
const T1 = `${VIEW}.organization_level_1`;
const DEPARTMENT = `${VIEW}.department_name`;
const STATUS = `${VIEW}.employment_status`;
const MEASURE = `${VIEW}.active_employee_count`;
const semantic = (member: string) => `dimension:${member.slice(member.indexOf(".") + 1)}`;

const views: CubeView[] = [
  {
    name: VIEW,
    title: "测试人员",
    meta: { time_source: "workforce" },
    measures: [
      {
        name: MEASURE,
        title: "在职人数",
        type: "number",
        meta: { time_contract: { aggregation: "last", window: "selected" } },
      },
    ],
    dimensions: [
      ...[T0, T1, DEPARTMENT, STATUS].map((name) => ({ name, title: name, type: "string" })),
      { name: `${VIEW}.year`, title: "年", type: "number" },
      { name: `${VIEW}.month`, title: "月", type: "number" },
      { name: `${VIEW}.period_month`, title: "月份", type: "time" },
    ],
    hierarchies: [{ name: "organization", levels: [T0, T1, DEPARTMENT] }],
  },
];

const context = {
  dataAsOf: "2026-07",
  sources: { workforce: { actualThrough: "2026-07", availableThrough: "2026-07" } },
};

function plannedBase(dimensions: string[], filters?: CubeQuery["filters"]) {
  const query = completeHierarchy({ measures: [MEASURE], dimensions, filters }, views).query;
  const timePlanning = resolveMetricQueryPlanning(query, { last: { years: 2 } }, context, views, {
    defaultOutput: "total",
  });
  return {
    query,
    timePlanning,
    plan: planMetricQueryWithPlanning(query, timePlanning, views),
  };
}

function grouping(base: string[], category: string): GroupingSetsSpec {
  return {
    base: base.map((member) => ({ id: semantic(member), member })),
    calculations: [
      {
        kind: "grouping_share",
        id: "calculation:share",
        title: "构成占比",
        measure: MEASURE,
        category_dimension: semantic(category),
      },
    ],
  };
}

describe("grouping-set hierarchy invariants", () => {
  test("分类维度位于层级中间且下级仍分组时拒绝静默自除", () => {
    const base = plannedBase([T0, T1]);
    expect(() =>
      planGroupingSets({
        viewId: "result",
        baseQuery: base.query,
        baseGroupingSet: [semantic(T0), semantic(T1)],
        basePlan: base.plan,
        timePlanning: base.timePlanning,
        grouping: grouping([T0, T1], T0),
        includeSummary: false,
        views,
      }),
    ).toThrow("分类维度是层级中间级，移除后无法形成更粗的分组集");
  });

  test("移除层级最细级形成真正粗分组时正常规划", () => {
    const base = plannedBase([T0, T1]);
    const plan = planGroupingSets({
      viewId: "result",
      baseQuery: base.query,
      baseGroupingSet: [semantic(T0), semantic(T1)],
      basePlan: base.plan,
      timePlanning: base.timePlanning,
      grouping: grouping([T0, T1], T1),
      includeSummary: false,
      views,
    });
    expect(plan.legs[0]?.plan.dimensions).toEqual([T0]);
  });

  test("总体腿保留筛选但不因筛选层级成员产生分组", () => {
    const filters = [{ member: T1, operator: "equals", values: ["Platform"] }];
    const base = plannedBase([DEPARTMENT], filters);
    const plan = planGroupingSets({
      viewId: "result",
      baseQuery: base.query,
      baseGroupingSet: [semantic(DEPARTMENT)],
      basePlan: base.plan,
      timePlanning: base.timePlanning,
      baselineFilters: filters,
      includeSummary: true,
      views,
    });
    expect(plan.legs.find((leg) => leg.id === plan.summary_leg)?.plan.dimensions).toEqual([]);
  });

  test("占比分母沿用基础人群筛选，总体腿沿用展示选择筛选且不会错误合并", () => {
    const baselineFilters = [{ member: STATUS, operator: "equals", values: ["active"] }];
    const selectionFilter = { member: T0, operator: "equals", values: ["Platform"] };
    const base = plannedBase([T0], [...baselineFilters, selectionFilter]);
    const plan = planGroupingSets({
      viewId: "result",
      baseQuery: base.query,
      baseGroupingSet: [semantic(T0)],
      basePlan: base.plan,
      timePlanning: base.timePlanning,
      baselineFilters,
      grouping: grouping([T0], T0),
      includeSummary: true,
      views,
    });
    expect(plan.legs).toHaveLength(2);
    const denominator = plan.legs.find((leg) => leg.id === plan.calculations[0]?.denominator_leg);
    const summary = plan.legs.find((leg) => leg.id === plan.summary_leg);
    expect(denominator?.filter_lineage.filters).toEqual(baselineFilters);
    expect(summary?.filter_lineage.filters).toEqual([...baselineFilters, selectionFilter]);
  });
});
