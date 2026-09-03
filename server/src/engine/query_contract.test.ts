import { describe, expect, test } from "bun:test";

import type { CubeQuery, CubeView } from "../ports/cube_gateway.js";
import { assertPhysicalQueryInvariants, filterMembers } from "./query_contract.js";

const views: CubeView[] = [
  {
    name: "test_people_metrics",
    title: "员工信息",
    measures: [
      {
        name: "test_people_metrics.active_employee_share",
        title: "在职人数占比",
        type: "number",
        format: "percent",
        meta: {
          calculation_role: "structure_share",
          components: {
            numerator: "active_employee_count",
            denominator: "active_employee_scope_total",
          },
        },
      },
      { name: "test_people_metrics.active_employee_count", title: "在职人数", type: "number" },
    ],
    dimensions: [
      {
        name: "test_people_metrics.gender",
        title: "性别",
        type: "string",
      },
      { name: "test_people_metrics.category_band", title: "分类层级", type: "string" },
      { name: "test_people_metrics.year", title: "年", type: "number" },
      { name: "test_people_metrics.month", title: "月", type: "number" },
      { name: "test_people_metrics.period_month", title: "月份", type: "time" },
    ],
  },
  {
    name: "qualified_cohort_metrics",
    title: "资格人群指标",
    measures: [
      {
        name: "qualified_cohort_metrics.ytd_qualified_cohort_event_rate",
        title: "YTD资格事件率",
        type: "number",
      },
    ],
    dimensions: [
      {
        name: "qualified_cohort_metrics.gender",
        title: "性别",
        type: "string",
      },
      {
        name: "qualified_cohort_metrics.category_band",
        title: "分类层级",
        type: "string",
      },
    ],
  },
  {
    name: "headcount_plan",
    title: "人员与编制",
    measures: [
      {
        name: "headcount_plan.period_end_target_count",
        title: "期末目标数",
        type: "number",
        meta: {
          incompatible_dimensions: [
            {
              member: "department_name",
              reason: "期末目标只在组织层级登记，不能按部门分析。",
            },
            {
              member: "team_name",
              reason: "期末目标只在组织层级登记，不能按团队分析。",
            },
          ],
        },
      },
      {
        name: "headcount_plan.point_in_time_target_count",
        title: "时点目标数",
        type: "number",
      },
    ],
    dimensions: [
      {
        name: "headcount_plan.organization_name",
        title: "组织",
        type: "string",
      },
      {
        name: "headcount_plan.team_name",
        title: "团队",
        type: "string",
      },
      {
        name: "headcount_plan.department_name",
        title: "部门",
        type: "string",
      },
    ],
  },
];

describe("query contract", () => {
  test("递归收集布尔过滤成员", () => {
    expect(
      filterMembers([
        {
          or: [
            { member: "v.a", operator: "equals", values: ["1"] },
            { and: [{ member: "v.b", operator: "set" }] },
          ],
        },
      ]),
    ).toEqual(["v.a", "v.b"]);
  });

  test("普通快照指标允许按员工属性维度筛选", () => {
    const query: CubeQuery = {
      measures: ["test_people_metrics.active_employee_count"],
      filters: [
        {
          member: "test_people_metrics.gender",
          operator: "equals",
          values: ["女"],
        },
      ],
    };
    expect(() => assertPhysicalQueryInvariants(query, views)).not.toThrow();
  });

  test("资格人群允许按共同单值属性分析", () => {
    for (const dimension of [
      "qualified_cohort_metrics.gender",
      "qualified_cohort_metrics.category_band",
    ]) {
      expect(() =>
        assertPhysicalQueryInvariants(
          {
            measures: ["qualified_cohort_metrics.ytd_qualified_cohort_event_rate"],
            dimensions: [dimension],
          },
          views,
        ),
      ).not.toThrow();
    }
  });

  test("期末目标指标只允许按组织分析", () => {
    for (const dimension of ["department_name", "team_name"]) {
      for (const query of [
        {
          measures: ["headcount_plan.period_end_target_count"],
          dimensions: [`headcount_plan.${dimension}`],
        },
        {
          measures: ["headcount_plan.period_end_target_count"],
          filters: [
            {
              member: `headcount_plan.${dimension}`,
              operator: "equals",
              values: ["示例部门"],
            },
          ],
        },
      ] satisfies CubeQuery[]) {
        expect(() => assertPhysicalQueryInvariants(query, views)).toThrow(/期末目标数.*组织/);
      }
    }
  });

  test("时点目标指标可按部门和团队分析", () => {
    expect(() =>
      assertPhysicalQueryInvariants(
        {
          measures: ["headcount_plan.point_in_time_target_count"],
          dimensions: ["headcount_plan.department_name", "headcount_plan.team_name"],
        },
        views,
      ),
    ).not.toThrow();
  });

  test("结构占比没有分类分组时拒绝，时间轴不算分类", () => {
    for (const dimensions of [
      undefined,
      ["test_people_metrics.year"],
      ["test_people_metrics.period_month"],
    ]) {
      expect(() =>
        assertPhysicalQueryInvariants(
          { measures: ["test_people_metrics.active_employee_share"], dimensions },
          views,
        ),
      ).toThrow(/物理查询不变量失效.*在职人数占比.*可变分类分组/);
    }
  });

  test("结构占比的唯一分类维度被单值筛选时拒绝", () => {
    expect(() =>
      assertPhysicalQueryInvariants(
        {
          measures: ["test_people_metrics.active_employee_share"],
          dimensions: ["test_people_metrics.gender"],
          filters: [
            {
              member: "test_people_metrics.gender",
              operator: "equals",
              values: ["女"],
            },
          ],
        },
        views,
      ),
    ).toThrow(/物理查询不变量失效.*性别.*固定为单值/);
  });

  test("结构占比按未筛死的分类分组时放行", () => {
    for (const query of [
      {
        measures: ["test_people_metrics.active_employee_share"],
        dimensions: ["test_people_metrics.gender"],
      },
      {
        measures: ["test_people_metrics.active_employee_share"],
        dimensions: ["test_people_metrics.category_band"],
        filters: [
          {
            member: "test_people_metrics.gender",
            operator: "equals",
            values: ["女"],
          },
        ],
      },
    ] satisfies CubeQuery[]) {
      expect(() => assertPhysicalQueryInvariants(query, views)).not.toThrow();
    }
  });

  test("OR 单腿的单值条件不被误判为整个查询已筛死分类", () => {
    expect(() =>
      assertPhysicalQueryInvariants(
        {
          measures: ["test_people_metrics.active_employee_share"],
          dimensions: ["test_people_metrics.classification_level"],
          filters: [
            {
              or: [
                {
                  member: "test_people_metrics.classification_level",
                  operator: "equals",
                  values: ["类别乙"],
                },
                {
                  member: "test_people_metrics.category_band",
                  operator: "equals",
                  values: ["类别甲及以上"],
                },
              ],
            },
          ],
        },
        views,
      ),
    ).not.toThrow();
  });
});
