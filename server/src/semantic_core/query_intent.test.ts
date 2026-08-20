import { describe, expect, test } from "bun:test";
import type { CompilerCatalog, CompilerCatalogMember } from "./compiler_catalog.js";
import { planQueryIntent } from "./query_intent.js";

function member(
  id: string,
  title: string,
  kind: CompilerCatalogMember["kind"],
  bindings: Array<[view: string, member: string, detail?: boolean]>,
  options: Partial<CompilerCatalogMember> = {},
): CompilerCatalogMember {
  return {
    id,
    name: id,
    title,
    kind,
    description: `${title}。`,
    available_in: bindings.map(([view, qualified, detail]) => ({
      view,
      member: qualified,
      ...(detail ? { detail: true as const, records_available: true as const } : {}),
    })),
    ...options,
  };
}

const ACTIVE_EMPLOYEE = "measure:active_employee_count";
const YTD_EVENT_RATE = "measure:ytd_event_rate";
const CURRENT_MONTH_FULFILLMENT_RATE = "measure:current_month_fulfillment_rate";
const ORG = "dimension:department_name";
const AGE_BAND = "dimension:age_band";
const CURRENT_MONTH = { window: { kind: "current_month" as const } };
const JULY_2026 = {
  window: { kind: "current_month" as const, month: "2026-07" },
};

const catalog: CompilerCatalog = {
  default_population_scope: "测试口径。",
  views: [
    {
      name: "employee_snapshot_metrics",
      title: "员工月末快照",
      comparison_policy: "calendar",
    },
    {
      name: "employee_leave_metrics",
      title: "员工离职事件",
      comparison_policy: "calendar",
    },
    {
      name: "headcount_plan_metrics",
      title: "部门编制计划",
      comparison_policy: "calendar",
    },
  ],
  metric_domains: [
    {
      id: "metric_domain:workforce_structure",
      title: "人员规模与结构",
      query_contract: "人员规模与结构。",
      time_source: "workforce",
      synonyms: [],
    },
    {
      id: "metric_domain:workforce_movement",
      title: "人员流动",
      query_contract: "人员流动。",
      time_source: "workforce",
      synonyms: [],
    },
    {
      id: "metric_domain:headcount_plan",
      title: "编制计划与完成",
      query_contract: "编制计划与完成。",
      time_source: "headcount_plan",
      synonyms: [],
    },
  ],
  measures: [
    member(
      ACTIVE_EMPLOYEE,
      "在职人数",
      "measure",
      [
        ["employee_snapshot_metrics", "employee_snapshot_metrics.active_employee_count"],
        ["employee_detail", "employee_detail.active_employee_count", true],
      ],
      { metric_domain_id: "metric_domain:workforce_structure" },
    ),
    member(
      YTD_EVENT_RATE,
      "YTD事件率",
      "measure",
      [
        ["employee_leave_metrics", "employee_leave_metrics.ytd_event_rate"],
        ["employee_detail", "employee_detail.ytd_event_rate", true],
      ],
      { metric_domain_id: "metric_domain:workforce_movement" },
    ),
    member(
      CURRENT_MONTH_FULFILLMENT_RATE,
      "当月编制完成率",
      "measure",
      [["headcount_plan_metrics", "headcount_plan_metrics.current_month_fulfillment_rate"]],
      { metric_domain_id: "metric_domain:headcount_plan" },
    ),
  ],
  dimensions: [
    member(ORG, "部门", "dimension", [
      ["employee_snapshot_metrics", "employee_snapshot_metrics.department_name"],
      ["employee_leave_metrics", "employee_leave_metrics.department_name"],
      ["headcount_plan_metrics", "headcount_plan_metrics.department_name"],
      ["employee_detail", "employee_detail.department_name", true],
    ]),
    member(AGE_BAND, "年龄段", "dimension", [
      ["employee_snapshot_metrics", "employee_snapshot_metrics.age_band"],
      ["employee_leave_metrics", "employee_leave_metrics.age_band"],
      ["employee_detail", "employee_detail.age_band", true],
    ]),
    member("dimension:employee_id", "员工工号", "dimension", [
      ["employee_detail", "employee_detail.employee_id", true],
    ]),
  ],
};

describe("semantic query intent", () => {
  test("单指标自动落到其唯一执行来源，不要求 analysis_topic", () => {
    const intent = {
      id: "query_1",
      measures: [ACTIVE_EMPLOYEE],
      dimensions: [ORG],
      time: CURRENT_MONTH,
    };
    expect(planQueryIntent(catalog, intent)).toMatchObject({
      view: "employee_snapshot_metrics",
      views: ["employee_snapshot_metrics"],
      query: {
        measures: ["employee_snapshot_metrics.active_employee_count"],
        dimensions: ["employee_snapshot_metrics.department_name"],
        time_view: "employee_snapshot_metrics",
      },
    });
  });

  test("跨指标域指标编译为一份逻辑查询，由正式指标 Planner 再拆事实腿", () => {
    const result = planQueryIntent(catalog, {
      id: "query_1",
      measures: [ACTIVE_EMPLOYEE, YTD_EVENT_RATE, CURRENT_MONTH_FULFILLMENT_RATE],
      dimensions: [ORG],
      group_sort: { dimension: ORG, by: ACTIVE_EMPLOYEE, direction: "desc" },
      time: JULY_2026,
    });
    expect(result).toMatchObject({
      view: "employee_snapshot_metrics",
      views: ["employee_snapshot_metrics", "employee_leave_metrics", "headcount_plan_metrics"],
      query: {
        measures: [
          "employee_snapshot_metrics.active_employee_count",
          "employee_leave_metrics.ytd_event_rate",
          "headcount_plan_metrics.current_month_fulfillment_rate",
        ],
        dimensions: ["employee_snapshot_metrics.department_name"],
        order: [{ member: "employee_snapshot_metrics.active_employee_count", direction: "desc" }],
      },
    });
  });

  test("跨域查询使用各指标域维度交集", () => {
    const plan = planQueryIntent(catalog, {
      id: "query_1",
      measures: [YTD_EVENT_RATE, CURRENT_MONTH_FULFILLMENT_RATE],
      dimensions: [AGE_BAND],
      time: JULY_2026,
    });
    expect(plan).toEqual({
      status: "incompatible",
      reason: "指标来源「部门编制计划」不支持维度「年龄段」；请移除该维度或拆成独立分析",
    });
  });

  test("单值员工属性可作用于支持它的流动指标", () => {
    const result = planQueryIntent(catalog, {
      id: "query_1",
      measures: [YTD_EVENT_RATE],
      dimensions: [AGE_BAND],
      time: JULY_2026,
    });
    expect(result).toMatchObject({
      query: {
        measures: ["employee_leave_metrics.ytd_event_rate"],
        dimensions: ["employee_leave_metrics.age_band"],
      },
    });
  });

  test("受控明细绑定不参与普通指标唯一归属", () => {
    expect(
      planQueryIntent(catalog, {
        id: "query_1",
        measures: [ACTIVE_EMPLOYEE, YTD_EVENT_RATE],
        dimensions: [ORG],
        time: JULY_2026,
      }),
    ).toMatchObject({
      status: "direct",
      views: ["employee_snapshot_metrics", "employee_leave_metrics"],
    });
  });

  test("跨域锚点按指标顺序确定，不要求调用方选择物理 View", () => {
    expect(
      planQueryIntent(catalog, {
        id: "query_1",
        measures: [YTD_EVENT_RATE, ACTIVE_EMPLOYEE],
        dimensions: [ORG],
        time: JULY_2026,
      }),
    ).toMatchObject({ view: "employee_leave_metrics" });
  });

  test("个体维度不能进入普通聚合查询", () => {
    expect(
      planQueryIntent(catalog, {
        id: "query_1",
        measures: [ACTIVE_EMPLOYEE],
        dimensions: ["dimension:employee_id"],
        time: JULY_2026,
      }),
    ).toEqual({
      status: "incompatible",
      reason: "指标来源「员工月末快照」不支持维度「员工工号」；请移除该维度或拆成独立分析",
    });
  });

  test("explicit_only 时钟拒绝日历相对对照，自定义对照期间放行", () => {
    const withInventory: CompilerCatalog = {
      ...catalog,
      views: [
        ...catalog.views,
        {
          name: "inventory_count_metrics",
          title: "库存盘点指标",
          time_source: "inventory_count",
          comparison_policy: "explicit_only",
        },
      ],
      measures: [
        ...catalog.measures,
        member(
          "measure:counted_units",
          "盘点数量",
          "measure",
          [["inventory_count_metrics", "inventory_count_metrics.counted_units"]],
          { metric_domain_id: "metric_domain:workforce_movement" },
        ),
      ],
      dimensions: [
        ...catalog.dimensions,
        member("dimension:warehouse", "仓库", "dimension", [
          ["inventory_count_metrics", "inventory_count_metrics.warehouse"],
        ]),
      ],
    };
    for (const kind of ["previous_year", "previous_period"] as const) {
      const blocked = planQueryIntent(withInventory, {
        id: "query_1",
        measures: ["measure:counted_units"],
        dimensions: ["dimension:warehouse"],
        time: {
          window: { kind: "range" as const, from: "2026-01", to: "2026-07" },
          comparison: { kind },
        },
      });
      expect(blocked.status).toBe("incompatible");
      if (blocked.status === "incompatible") {
        expect(blocked.reason).toContain("只允许显式对照");
      }
    }
    expect(
      planQueryIntent(withInventory, {
        id: "query_1",
        measures: ["measure:counted_units"],
        dimensions: ["dimension:warehouse"],
        time: {
          ...JULY_2026,
          comparison: {
            kind: "custom" as const,
            window: { kind: "current_month" as const, month: "2025-09" },
          },
        },
      }),
    ).toMatchObject({ status: "direct", view: "inventory_count_metrics" });
  });

  test("calendar 时钟来源允许日历相对对照", () => {
    const continuous: CompilerCatalog = {
      ...catalog,
      views: [
        {
          name: "employee_snapshot_metrics",
          title: "员工月末快照",
          time_source: "workforce",
          comparison_policy: "calendar",
        },
        {
          name: "employee_leave_metrics",
          title: "员工离职事件",
          time_source: "workforce",
          comparison_policy: "calendar",
        },
        {
          name: "headcount_plan_metrics",
          title: "部门编制计划",
          time_source: "headcount_plan",
          comparison_policy: "calendar",
        },
      ],
    };
    expect(
      planQueryIntent(continuous, {
        id: "query_1",
        measures: [ACTIVE_EMPLOYEE],
        dimensions: [ORG],
        time: { ...JULY_2026, comparison: { kind: "previous_year" as const } },
      }),
    ).toMatchObject({ status: "direct", view: "employee_snapshot_metrics" });
  });
});
