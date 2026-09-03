import { describe, expect, test } from "bun:test";
import type { SemanticQueryView } from "./semantic_analysis.js";
import {
  queryCandidateFeasibilityIssue,
  queryFeasibilityIssue,
  queryFeasibilityIssueMessage,
} from "./query_feasibility.js";

const EMPLOYEES = "measure:employee_count";
const RESTRICTED = "measure:restricted_count";
const SHARE = "measure:employee_share";
const COMPANY = "dimension:company";
const DEPARTMENT = "dimension:department";
const CATEGORY = "dimension:category";

const catalog = {
  measures: [
    {
      id: EMPLOYEES,
      kind: "measure",
      title: "人数",
      query_capabilities: {
        dimension_ids: [COMPANY, DEPARTMENT, CATEGORY],
        hierarchies: [[COMPANY, DEPARTMENT]],
      },
      report_calculations: ["percent_of_total"],
    },
    {
      id: RESTRICTED,
      kind: "measure",
      title: "受限人数",
      query_capabilities: { dimension_ids: [COMPANY] },
      time_constraints: { comparison: "explicit_only" },
    },
    {
      id: SHARE,
      kind: "measure",
      title: "人数占比",
      query_capabilities: {
        dimension_ids: [COMPANY, DEPARTMENT, CATEGORY],
        grouping: { minimum_varying_dimensions: 1 },
      },
    },
  ],
  dimensions: [
    { id: COMPANY, kind: "dimension", title: "公司" },
    { id: DEPARTMENT, kind: "dimension", title: "部门" },
    { id: CATEGORY, kind: "dimension", title: "类别", dimension_kind: "categorical" },
  ],
} satisfies Parameters<typeof queryFeasibilityIssue>[0];

const view = (overrides: Partial<SemanticQueryView> = {}): SemanticQueryView => ({
  id: "result",
  measures: [EMPLOYEES],
  dimensions: [COMPANY],
  time: { window: { kind: "current_month", month: "2026-07" } },
  ...overrides,
});

describe("semantic query feasibility", () => {
  test("分组与筛选消费同一份正向维度能力，排序先要求已选分组", () => {
    expect(
      queryFeasibilityIssue(
        catalog,
        view({
          measures: [RESTRICTED],
          dimensions: [],
          filters: [{ member: DEPARTMENT, relation: "one_of", values: ["示例部门"] }],
        }),
      ),
    ).toEqual({
      code: "query_dimension_unsupported",
      measure_id: RESTRICTED,
      measure_title: "受限人数",
      dimension_id: DEPARTMENT,
      dimension_title: "部门",
      usage: "filter",
    });
    expect(
      queryFeasibilityIssue(
        catalog,
        view({
          measures: [RESTRICTED],
          dimensions: [COMPANY],
          group_sort: { dimension: DEPARTMENT, by: "name", direction: "asc" },
        }),
      ),
    ).toEqual({
      code: "query_sort_dimension_missing",
      dimension_id: DEPARTMENT,
      dimension_title: "部门",
    });
  });

  test("层级中间级无法形成更粗分母时在物理规划前拒绝", () => {
    const issue = queryFeasibilityIssue(
      catalog,
      view({
        dimensions: [COMPANY, DEPARTMENT],
        calculations: [
          {
            id: "calculation:company_share",
            title: "公司构成占比",
            kind: "percent_of_total",
            measure: EMPLOYEES,
            category_dimension: COMPANY,
          },
        ],
      }),
    );
    expect(issue).toEqual({
      code: "query_calculation_hierarchy_conflict",
      calculation_id: "calculation:company_share",
      calculation_title: "公司构成占比",
      category_dimension: COMPANY,
      category_title: "公司",
      descendant_dimensions: [DEPARTMENT],
      descendant_titles: ["部门"],
    });
    if (!issue) throw new Error("层级冲突必须被拒绝");
    expect(queryFeasibilityIssueMessage(issue)).toContain("不能移除层级中间维度");

    expect(
      queryFeasibilityIssue(
        catalog,
        view({
          dimensions: [COMPANY, DEPARTMENT],
          calculations: [
            {
              id: "calculation:department_share",
              title: "部门构成占比",
              kind: "percent_of_total",
              measure: EMPLOYEES,
              category_dimension: DEPARTMENT,
            },
          ],
        }),
      ),
    ).toBeUndefined();
  });

  test("构成占比与分组截断的冲突由可行性合同解释", () => {
    expect(
      queryFeasibilityIssue(
        catalog,
        view({
          dimensions: [CATEGORY],
          group_sort: {
            dimension: CATEGORY,
            by: EMPLOYEES,
            direction: "desc",
            max_items: 5,
          },
          calculations: [
            {
              id: "calculation:category_share",
              title: "类别构成占比",
              kind: "percent_of_total",
              measure: EMPLOYEES,
              category_dimension: CATEGORY,
            },
          ],
        }),
      ),
    ).toEqual({
      code: "query_calculation_top_n_conflict",
      calculation_id: "calculation:category_share",
      calculation_title: "类别构成占比",
    });
  });

  test("指标所需的可变分组是正向能力，不等到物理查询才发现恒为 100%", () => {
    expect(queryFeasibilityIssue(catalog, view({ measures: [SHARE], dimensions: [] }))).toEqual({
      code: "query_grouping_requirement_unsatisfied",
      measure_id: SHARE,
      measure_title: "人数占比",
      minimum_varying_dimensions: 1,
    });
    expect(
      queryFeasibilityIssue(
        catalog,
        view({
          measures: [SHARE],
          dimensions: [CATEGORY],
          filters: [{ member: CATEGORY, relation: "one_of", values: ["示例类别"] }],
        }),
      ),
    ).toMatchObject({ code: "query_grouping_requirement_unsatisfied" });
    expect(
      queryFeasibilityIssue(catalog, view({ measures: [SHARE], dimensions: [CATEGORY] })),
    ).toBeUndefined();
  });

  test("相对对照限制与成员引用都由同一可行性入口返回结构化原因", () => {
    expect(
      queryFeasibilityIssue(
        catalog,
        view({
          measures: [RESTRICTED],
          time: {
            window: { kind: "current_month", month: "2026-07" },
            comparison: { kind: "previous_year" },
          },
        }),
      ),
    ).toEqual({
      code: "metric_time_comparison_incompatible",
      metric_titles: ["受限人数"],
      required_comparison: "custom",
    });
    expect(queryFeasibilityIssue(catalog, view({ measures: ["人数"] }))).toEqual({
      code: "query_member_unknown",
      reference: "人数",
      field: "measures",
      expected_kind: "measure",
      title_match_id: EMPLOYEES,
    });
  });

  test("候选只为相对当前草稿新增的冲突负责", () => {
    const current = view({
      measures: [RESTRICTED],
      time: {
        window: { kind: "current_month", month: "2026-07" },
        comparison: { kind: "previous_year" },
      },
    });
    expect(
      queryCandidateFeasibilityIssue(catalog, current, { ...current, dimensions: [COMPANY] }),
    ).toBeUndefined();
    expect(
      queryCandidateFeasibilityIssue(catalog, current, { ...current, dimensions: [DEPARTMENT] }),
    ).toMatchObject({ code: "query_dimension_unsupported" });

    const multiple = view({
      measures: [SHARE, RESTRICTED],
      dimensions: [],
      time: {
        window: { kind: "current_month", month: "2026-07" },
        comparison: { kind: "previous_year" },
      },
    });
    expect(
      queryCandidateFeasibilityIssue(catalog, multiple, {
        ...multiple,
        dimensions: [COMPANY],
      }),
    ).toBeUndefined();
    expect(
      queryCandidateFeasibilityIssue(catalog, multiple, {
        ...multiple,
        dimensions: [DEPARTMENT],
      }),
    ).toMatchObject({ code: "query_dimension_unsupported" });
  });
});
