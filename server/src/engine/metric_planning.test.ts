import { describe, expect, test } from "bun:test";
import type {
  CubeGateway,
  CubeMember,
  CubeQuery,
  CubeView,
  LoadResponse,
} from "../ports/cube_gateway.js";
import type { CubeSecurityContext } from "../ports/cube_gateway.js";
import { executeMetricQuery } from "./metric_executor.js";
import { planMetricQuery } from "../test_support/planning.js";
import { parseMetricQueryPlan, type MetricQueryPlan } from "./metric_planner.js";

const attrition = "employee_leave_metrics";
const structure = "employee_snapshot_metrics";
const organization = `${attrition}.organization_name`;
const leavers = `${attrition}.turnover_count`;
const active_employee_count = `${structure}.active_employee_count`;
const rate = `${attrition}.current_month_turnover_rate`;
const guardedCount = `${attrition}.guarded_count`;
const rawCount = `${attrition}.raw_count`;
const availability = `${structure}.availability`;

const dimension = (view: string, name: string, type = "string"): CubeMember => ({
  name: `${view}.${name}`,
  title: name,
  type,
});

const views: CubeView[] = [
  {
    name: attrition,
    title: "人员离职",
    meta: { time_source: "workforce" },
    measures: [
      {
        name: leavers,
        title: "离职人数",
        type: "number",
        meta: { time_contract: { aggregation: "sum", window: "selected" } },
      },
      {
        name: rate,
        title: "本月离职率",
        type: "number",
        format: "percent",
        meta: {
          time_contract: {
            aggregation: "recompute",
            window: "selected",
            grain: "month",
          },
          metric_node: {
            kind: "ratio",
            numerator: { metric_id: "measure:turnover_count", missing: "zero" },
            denominator: { metric_id: "measure:active_employee_count", missing: "null" },
            division_by_zero: "null",
          },
        },
      },
      {
        name: rawCount,
        title: "原始人数",
        type: "number",
        meta: { time_contract: { aggregation: "sum", window: "selected" } },
      },
      {
        name: guardedCount,
        title: "受可用性保护人数",
        type: "number",
        meta: {
          time_contract: { aggregation: "sum", window: "selected" },
          metric_node: {
            kind: "availability_guard",
            value: { metric_id: "measure:raw_count", missing: "zero" },
            availability: {
              metric_id: "measure:availability",
              missing: "null",
            },
            unavailable: "null",
          },
        },
      },
    ],
    dimensions: [
      dimension(attrition, "organization_name"),
      dimension(attrition, "year", "number"),
      dimension(attrition, "month", "number"),
      dimension(attrition, "period_month", "time"),
    ],
  },
  {
    name: structure,
    title: "人员规模",
    meta: { time_source: "workforce" },
    measures: [
      {
        name: active_employee_count,
        title: "在职人数",
        type: "number",
        meta: { time_contract: { aggregation: "last", window: "selected" } },
      },
      {
        name: availability,
        title: "可用性",
        type: "number",
        meta: { time_contract: { aggregation: "last", window: "selected" } },
      },
    ],
    dimensions: [
      dimension(structure, "organization_name"),
      dimension(structure, "year", "number"),
      dimension(structure, "month", "number"),
      dimension(structure, "period_month", "time"),
    ],
  },
];

const context = {
  dataAsOf: "2026-07",
  sources: {
    workforce: { actualThrough: "2026-07", availableThrough: "2026-07" },
  },
};

const security: CubeSecurityContext = {
  subject: "tester",
  groups: [],
  accessScope: { kind: "all" },
};

function response(query: CubeQuery, rows: LoadResponse["data"]): LoadResponse {
  return {
    data: rows,
    annotation: {
      measures: Object.fromEntries(
        (query.measures ?? []).map((member) => [member, { title: member }]),
      ),
      dimensions: Object.fromEntries(
        (query.dimensions ?? []).map((member) => [member, { title: member }]),
      ),
    },
  };
}

function cubeWith(
  load: (query: CubeQuery) => Promise<LoadResponse>,
): Pick<CubeGateway, "load" | "loadMulti"> {
  return {
    load: (query) => load(query),
    loadMulti: async (query) => [await load(query)],
  };
}

describe("正式指标查询", () => {
  test("把跨事实比例拆成最少叶子查询，并按完整业务键 full outer 对齐后重算", async () => {
    const plan = planMetricQuery(
      { measures: [rate], dimensions: [organization] },
      { cutoff: "2026-07", grain: "total" },
      context,
      views,
      attrition,
    );

    expect(plan.legs).toHaveLength(2);
    expect(plan.legs.map((leg) => leg.source_view).sort()).toEqual([attrition, structure]);
    expect(plan.legs.find((leg) => leg.source_view === attrition)?.plan.query.measures).toEqual([
      leavers,
    ]);
    expect(plan.legs.find((leg) => leg.source_view === structure)?.plan.query.measures).toEqual([
      active_employee_count,
    ]);
    expect(plan.legs.find((leg) => leg.source_view === structure)?.plan.query.dimensions).toEqual([
      `${structure}.organization_name`,
    ]);

    const cube = cubeWith(async (query) => {
      if (query.measures?.includes(leavers)) {
        return response(query, [
          { [`${attrition}.organization_name`]: "A", [leavers]: 2 },
          { [`${attrition}.organization_name`]: "B", [leavers]: 1 },
        ]);
      }
      return response(query, [
        { [`${structure}.organization_name`]: "A", [active_employee_count]: 10 },
        { [`${structure}.organization_name`]: "C", [active_employee_count]: 5 },
      ]);
    });
    const result = await executeMetricQuery(cube, plan, security, views);

    expect(result.data).toEqual([
      { [organization]: "A", [rate]: 0.2 },
      { [organization]: "B", [rate]: null },
      { [organization]: "C", [rate]: 0 },
    ]);
    expect(result.annotation.measures[rate]?.title).toBe("本月离职率");
  });

  test("单个事实子查询返回重复业务键时报错，不隐式合并", async () => {
    const plan = planMetricQuery(
      { measures: [rate], dimensions: [organization] },
      { cutoff: "2026-07", grain: "total" },
      context,
      views,
      attrition,
    );
    const cube = cubeWith(async (query) => {
      if (query.measures?.includes(leavers)) {
        return response(query, [
          { [`${attrition}.organization_name`]: "A", [leavers]: 1 },
          { [`${attrition}.organization_name`]: "A", [leavers]: 2 },
        ]);
      }
      return response(query, [
        { [`${structure}.organization_name`]: "A", [active_employee_count]: 10 },
      ]);
    });

    await expect(executeMetricQuery(cube, plan, security, views)).rejects.toThrow("返回重复业务键");
  });

  test("分母为零或缺失时比例返回空值", async () => {
    const plan = planMetricQuery(
      { measures: [rate], dimensions: [organization] },
      { cutoff: "2026-07", grain: "total" },
      context,
      views,
      attrition,
    );
    const cube = cubeWith(async (query) =>
      query.measures?.includes(leavers)
        ? response(query, [
            { [`${attrition}.organization_name`]: "A", [leavers]: 1 },
            { [`${attrition}.organization_name`]: "B", [leavers]: 1 },
          ])
        : response(query, [
            { [`${structure}.organization_name`]: "A", [active_employee_count]: 0 },
          ]),
    );

    const result = await executeMetricQuery(cube, plan, security, views);
    expect(result.data).toEqual([
      { [organization]: "A", [rate]: null },
      { [organization]: "B", [rate]: null },
    ]);
  });

  test("Top-N 按算完的正式指标排名", async () => {
    const plan = planMetricQuery(
      { measures: [rate], dimensions: [organization] },
      { cutoff: "2026-07", grain: "total" },
      context,
      views,
      attrition,
      {
        type: "top_n",
        dimensions: [organization],
        by: rate,
        window: "anchor",
        count: 2,
        direction: "desc",
      },
    );
    const cube = cubeWith(async (query) =>
      query.measures?.includes(leavers)
        ? response(query, [
            { [`${attrition}.organization_name`]: "A", [leavers]: 5 },
            { [`${attrition}.organization_name`]: "B", [leavers]: 3 },
            { [`${attrition}.organization_name`]: "C", [leavers]: 2 },
          ])
        : response(query, [
            { [`${structure}.organization_name`]: "A", [active_employee_count]: 100 },
            { [`${structure}.organization_name`]: "B", [active_employee_count]: 10 },
            { [`${structure}.organization_name`]: "C", [active_employee_count]: 20 },
          ]),
    );

    const result = await executeMetricQuery(cube, plan, security, views);
    expect(result.data).toEqual([
      { [organization]: "B", [rate]: 0.3 },
      { [organization]: "C", [rate]: 0.1 },
    ]);
    expect(result.selection).toMatchObject({ selectedCount: 2, hasMoreGroups: true });
  });

  test("按维度名称选择分组时使用名称顺序，并标记为全时间范围", async () => {
    const plan = planMetricQuery(
      { measures: [active_employee_count], dimensions: [organization] },
      { cutoff: "2026-07", grain: "total" },
      context,
      views,
      structure,
      {
        type: "top_n",
        dimensions: [organization],
        by: organization,
        window: "anchor",
        count: 2,
        direction: "asc",
      },
    );
    const cube = cubeWith(async (query) =>
      response(query, [
        { [`${structure}.organization_name`]: "C", [active_employee_count]: 3 },
        { [`${structure}.organization_name`]: "A", [active_employee_count]: 1 },
        { [`${structure}.organization_name`]: "B", [active_employee_count]: 2 },
      ]),
    );

    const result = await executeMetricQuery(cube, plan, security, views);
    expect(result.data).toEqual([
      { [organization]: "A", [active_employee_count]: 1 },
      { [organization]: "B", [active_employee_count]: 2 },
    ]);
    expect(result.selection).toMatchObject({ window: "all", selectedCount: 2 });
  });

  test("可用性守卫把缺失事件记为零，缺失批次保留为空值", async () => {
    const plan = planMetricQuery(
      { measures: [guardedCount], dimensions: [organization] },
      { cutoff: "2026-07", grain: "total" },
      context,
      views,
      attrition,
    );
    expect(plan.legs).toHaveLength(2);
    const cube = cubeWith(async (query) =>
      query.measures?.includes(rawCount)
        ? response(query, [{ [`${attrition}.organization_name`]: "A", [rawCount]: 3 }])
        : response(query, [
            { [`${structure}.organization_name`]: "A", [availability]: 10 },
            { [`${structure}.organization_name`]: "B", [availability]: 4 },
            { [`${structure}.organization_name`]: "C", [availability]: null },
          ]),
    );

    const result = await executeMetricQuery(cube, plan, security, views);
    expect(result.data).toEqual([
      { [organization]: "A", [guardedCount]: 3 },
      { [organization]: "B", [guardedCount]: 0 },
      { [organization]: "C", [guardedCount]: null },
    ]);
  });

  test("持久化计划按封闭结构解析，物理查询中出现未知键时报错", () => {
    const persisted = {
      kind: "metric_query",
      business_time: {
        outputGrain: "total",
        coordinates: [
          {
            kind: "cutoff",
            from: "2026-07",
            to: "2026-07",
            buckets: [{ from: "2026-07", to: "2026-07" }],
          },
        ],
      },
      time_view: structure,
      legs: [
        {
          source_view: structure,
          plan: {
            query: { measures: [active_employee_count] },
            time: { view: structure, windows: [{ from: "2026-07-01", to: "2026-07-31" }] },
          },
          dimensions: {},
          measures: { [active_employee_count]: "measure:active_employee_count" },
        },
      ],
      nodes: {
        "measure:active_employee_count": { kind: "aggregate", member: active_employee_count },
      },
      dimensions: [],
      measures: [active_employee_count],
      output_metric_ids: { [active_employee_count]: "measure:active_employee_count" },
    };
    expect(parseMetricQueryPlan(persisted)).toEqual(persisted as MetricQueryPlan);
    const leg = persisted.legs[0];
    expect(() =>
      parseMetricQueryPlan({
        ...persisted,
        legs: [{ ...leg, plan: { ...leg.plan, query: { ...leg.plan.query, unknown: true } } }],
      }),
    ).toThrow(/持久化正式指标计划无效/);
  });
});
