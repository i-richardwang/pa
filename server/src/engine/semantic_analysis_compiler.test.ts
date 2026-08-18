import { describe, expect, test } from "bun:test";
import type { CompilerCatalog, CompilerCatalogMember } from "../semantic_core/compiler_catalog.js";
import { compileSemanticAnalysis } from "./semantic_analysis_compiler.js";
import { parseSemanticAnalysisSpec } from "../semantic_core/semantic_analysis.js";
import { isDerivedViewSpec, type QueryViewSpec } from "../semantic_core/analysis_spec.js";

function member(
  id: string,
  name: string,
  title: string,
  kind: CompilerCatalogMember["kind"],
  bindings: Array<[string, string]>,
  relation?: CompilerCatalogMember["relation"],
  recordProjectionViews: string[] = [],
): CompilerCatalogMember {
  return {
    id,
    name,
    title,
    kind,
    ...(kind === "measure"
      ? {
          metric_domain_id:
            id === CURRENT_MONTH_FULFILLMENT_RATE
              ? ("metric_domain:headcount_plan" as const)
              : id === YTD_EVENT_RATE
                ? ("metric_domain:workforce_movement" as const)
                : ("metric_domain:workforce_structure" as const),
        }
      : {}),
    description: `${title}。`,
    available_in: [
      ...bindings.map(([view, qualified]) => ({
        view,
        member: qualified,
      })),
      ...(kind === "dimension" || recordProjectionViews.length
        ? [
            {
              view: "employee_detail",
              member: `employee_detail.${name.split(".").at(-1)}`,
              detail: true as const,
              ...(recordProjectionViews.length ? { records_available: true as const } : {}),
            },
          ]
        : []),
    ],
    ...(relation ? { relation } : {}),
    ...(recordProjectionViews.length ? { records_available: true as const } : {}),
  };
}

const ACTIVE_EMPLOYEE = "measure:active_employee_count";
const YTD_EVENT_RATE = "measure:ytd_event_rate";
const CURRENT_MONTH_FULFILLMENT_RATE = "measure:current_month_fulfillment_rate";
const ACTIVE_EMPLOYEE_SHARE = "measure:active_employee_share";
const ORG = "dimension:organization_name";
const DEPARTMENT = "dimension:department_name";
const AGE_BAND = "dimension:age_band";
const JULY_2026 = {
  window: { kind: "current_month" as const, month: "2026-07" },
};
const JAN_TO_JULY_2026 = {
  window: { kind: "range" as const, from: "2026-01", to: "2026-07" },
  display: "month" as const,
};

const catalog: CompilerCatalog = {
  default_population_scope: "测试口径。",
  views: [
    {
      name: "test_people_metrics",
      title: "人员总览",
      hierarchies: [[ORG, DEPARTMENT]],
    },
    {
      name: "headcount_plan",
      title: "人员与编制",
      hierarchies: [[ORG, DEPARTMENT]],
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
    {
      ...member(
        ACTIVE_EMPLOYEE,
        "test_people_metrics.active_employee_count",
        "在职人数",
        "measure",
        [["test_people_metrics", "test_people_metrics.active_employee_count"]],
        undefined,
        ["test_people_metrics"],
      ),
      report_calculations: ["percent_of_total"],
    },
    member(
      YTD_EVENT_RATE,
      "test_people_metrics.ytd_event_rate",
      "YTD事件率",
      "measure",
      [["test_people_metrics", "test_people_metrics.ytd_event_rate"]],
      undefined,
      ["test_people_metrics"],
    ),
    member(
      CURRENT_MONTH_FULFILLMENT_RATE,
      "headcount_plan.current_month_fulfillment_rate",
      "当月编制完成率",
      "measure",
      [["headcount_plan", "headcount_plan.current_month_fulfillment_rate"]],
    ),
    member(
      ACTIVE_EMPLOYEE_SHARE,
      "test_people_metrics.active_employee_share",
      "在职人数占比",
      "measure",
      [["test_people_metrics", "test_people_metrics.active_employee_share"]],
      { kind: "structure_share", numerator_id: ACTIVE_EMPLOYEE },
    ),
  ],
  dimensions: [
    member(ORG, "test_people_metrics.organization_name", "组织", "dimension", [
      ["test_people_metrics", "test_people_metrics.organization_name"],
      ["headcount_plan", "headcount_plan.organization_name"],
    ]),
    member(DEPARTMENT, "test_people_metrics.department_name", "部门", "dimension", [
      ["test_people_metrics", "test_people_metrics.department_name"],
      ["headcount_plan", "headcount_plan.department_name"],
    ]),
    member(AGE_BAND, "test_people_metrics.age_band", "年龄段", "dimension", [
      ["test_people_metrics", "test_people_metrics.age_band"],
    ]),
  ],
};

describe("semantic analysis compiler", () => {
  test("语义分析只接受唯一 TimeIntent", () => {
    const invalid = {
      version: 2,
      analysis: {
        views: [{ id: "result", measures: [ACTIVE_EMPLOYEE], time: { cutoff: "2026-07" } }],
      },
      presentation: { type: "table" },
    };
    expect(() => parseSemanticAnalysisSpec(invalid)).toThrow(/语义分析规格无效/);
  });

  test("报告构成占比编译为两个 Cube 聚合查询与一个 many_to_one 标量变换", () => {
    const calculationId = "calculation:active_employee_age_band_share";
    const compiled = compileSemanticAnalysis(catalog, {
      version: 2,
      analysis: {
        title: "组织内年龄段结构",
        views: [
          {
            id: "result",
            measures: [ACTIVE_EMPLOYEE],
            dimensions: [ORG, AGE_BAND],
            calculations: [
              {
                id: calculationId,
                title: "年龄段结构",
                kind: "percent_of_total",
                measure: ACTIVE_EMPLOYEE,
                category_dimension: AGE_BAND,
              },
            ],
            time: JULY_2026,
          },
        ],
      },
      presentation: { type: "table" },
    });
    expect(compiled.plan.nodes).toHaveLength(3);
    const queries = compiled.plan.nodes.filter(
      (node): node is QueryViewSpec => !isDerivedViewSpec(node),
    );
    const derived = compiled.plan.nodes.find(isDerivedViewSpec);
    expect(queries).toHaveLength(2);
    expect(queries[0]?.dimensions).toContain("test_people_metrics.age_band");
    expect(queries[1]?.dimensions).not.toContain("test_people_metrics.age_band");
    expect(derived?.join?.cardinality).toBe("many_to_one");
    expect(derived?.join?.on).toEqual([{ left: "organization_name", right: "organization_name" }]);
    expect(derived?.structure_shares).toEqual([
      { measure: "年龄段结构", numerator: "active_employee_count" },
    ]);
    expect(compiled.plan.output.columns["年龄段结构"]).toBe(calculationId);
    expect(compiled.routes).toEqual([
      expect.objectContaining({ status: "composed", view_id: "result" }),
    ]);
  });

  test("维度最大项数编译为层级补全后的私有选择规格，不生成物理行 limit", () => {
    const compiled = compileSemanticAnalysis(catalog, {
      version: 2,
      analysis: {
        views: [
          {
            id: "result",
            measures: [ACTIVE_EMPLOYEE, YTD_EVENT_RATE],
            dimensions: [DEPARTMENT],
            time: {
              window: { kind: "current_month", month: "2026-07" },
              display: "year",
              comparison: { kind: "previous_year" },
            },
            group_sort: {
              dimension: DEPARTMENT,
              by: YTD_EVENT_RATE,
              direction: "desc",
              max_items: 15,
            },
            summary: { mode: "grand_total" },
          },
        ],
      },
      presentation: { type: "table" },
    });
    expect(compiled.plan.nodes[0]).toMatchObject({
      dimensions: ["test_people_metrics.organization_name", "test_people_metrics.department_name"],
      selection: {
        type: "top_n",
        dimensions: [
          "test_people_metrics.organization_name",
          "test_people_metrics.department_name",
        ],
        by: "test_people_metrics.ytd_event_rate",
        window: "anchor",
        count: 15,
        direction: "desc",
      },
      summary: { mode: "grand_total" },
    });
    expect(compiled.plan.nodes[0]).not.toHaveProperty("limit");
    expect(compiled.plan.nodes[0]).not.toHaveProperty("order");
  });

  test("按名称限制维度项数时，以目标维度自身作为私有排名字段", () => {
    const compiled = compileSemanticAnalysis(catalog, {
      version: 2,
      analysis: {
        views: [
          {
            id: "result",
            measures: [ACTIVE_EMPLOYEE],
            dimensions: [DEPARTMENT],
            time: JULY_2026,
            group_sort: {
              dimension: DEPARTMENT,
              by: "name",
              direction: "asc",
              max_items: 10,
            },
          },
        ],
      },
      presentation: { type: "table" },
    });
    expect(compiled.plan.nodes[0]).toMatchObject({
      selection: {
        dimensions: [
          "test_people_metrics.organization_name",
          "test_people_metrics.department_name",
        ],
        by: "test_people_metrics.department_name",
        count: 10,
        direction: "asc",
      },
    });
  });

  test("聚合语义查询拒绝物理行 limit，排行只能使用 Top-N 分组选择", () => {
    expect(() =>
      parseSemanticAnalysisSpec({
        version: 2,
        analysis: {
          views: [
            {
              id: "result",
              measures: [ACTIVE_EMPLOYEE],
              dimensions: [DEPARTMENT],
              time: JULY_2026,
              order: [{ member: ACTIVE_EMPLOYEE, direction: "desc" }],
              limit: 20,
            },
          ],
        },
        presentation: { type: "table" },
      }),
    ).toThrow(/语义分析规格无效/);
  });

  test("总体只允许指标与业务分组并存的结果", () => {
    expect(() =>
      parseSemanticAnalysisSpec({
        version: 2,
        analysis: {
          views: [
            {
              id: "result",
              measures: [ACTIVE_EMPLOYEE],
              time: JULY_2026,
              summary: { mode: "grand_total" },
            },
          ],
        },
      }),
    ).toThrow(/总体行只适用于同时包含指标与业务分组维度/);
  });

  test("分组排序只能作用于唯一直接结果，不允许中间查询各自选组", () => {
    expect(() =>
      parseSemanticAnalysisSpec({
        version: 2,
        analysis: {
          views: [
            {
              id: "source",
              view_title: "人员数据",
              measures: [ACTIVE_EMPLOYEE],
              dimensions: [DEPARTMENT],
              time: JULY_2026,
              group_sort: {
                dimension: DEPARTMENT,
                by: ACTIVE_EMPLOYEE,
                direction: "desc",
                max_items: 20,
              },
            },
            {
              id: "result",
              view_title: "结果",
              from: ["source"],
              columns: [{ member: ACTIVE_EMPLOYEE, source: "source", as: "在职人数" }],
            },
          ],
        },
        presentation: { type: "table" },
      }),
    ).toThrow(/只能声明在唯一直接结果视图/);
  });

  test("公共语义规格对派生来源强制业务标题，独立直查不被额外约束", () => {
    expect(() =>
      parseSemanticAnalysisSpec({
        version: 2,
        analysis: {
          views: [
            { id: "source", measures: [ACTIVE_EMPLOYEE], time: JULY_2026 },
            {
              id: "result",
              view_title: "结果",
              from: ["source"],
              columns: [{ source: "source", member: ACTIVE_EMPLOYEE, as: "在职人数" }],
            },
          ],
        },
        presentation: { type: "table" },
      }),
    ).toThrow(/来源查询.*业务标题/);
    expect(() =>
      parseSemanticAnalysisSpec({
        version: 2,
        analysis: {
          views: [{ id: "standalone", measures: [ACTIVE_EMPLOYEE], time: JULY_2026 }],
        },
        presentation: { type: "table" },
      }),
    ).not.toThrow();
  });

  test("presentation 必填：服务端不存在自动判型入口", () => {
    expect(() =>
      parseSemanticAnalysisSpec({
        version: 2,
        analysis: {
          views: [
            {
              id: "result",
              measures: [ACTIVE_EMPLOYEE],
              dimensions: [DEPARTMENT],
              time: JULY_2026,
            },
          ],
        },
      }),
    ).toThrow(/语义分析规格无效/);
  });

  test("规格外字段一律拒绝", () => {
    expect(() =>
      parseSemanticAnalysisSpec({
        version: 2,
        analysis: {
          views: [
            {
              id: "result",
              unknown_field: "anything",
              measures: [ACTIVE_EMPLOYEE],
              dimensions: [DEPARTMENT],
              time: JULY_2026,
            },
          ],
        },
        presentation: { type: "table" },
      }),
    ).toThrow(/语义分析规格无效/);
  });

  test("KPI 作为显式呈现直接编译，不注入图表通道", () => {
    const compiled = compileSemanticAnalysis(catalog, {
      version: 2,
      analysis: {
        views: [
          {
            id: "result",
            measures: [ACTIVE_EMPLOYEE],
            time: JULY_2026,
          },
        ],
      },
      presentation: { type: "kpi" },
    });
    expect(compiled.presentation).toEqual({
      type: "kpi",
      y: [],
      tableLayout: { rows: [], columns: [{ kind: "metrics" }] },
    });
  });

  test("table 的语义列轴绑定编译为内部行列布局", () => {
    const compiled = compileSemanticAnalysis(catalog, {
      version: 2,
      analysis: {
        views: [
          {
            id: "result",
            measures: [ACTIVE_EMPLOYEE],
            dimensions: [ORG, DEPARTMENT],
            time: JULY_2026,
          },
        ],
      },
      presentation: { type: "table", columns: [DEPARTMENT] },
    });
    expect(compiled.presentation).toMatchObject({
      type: "table",
      y: [],
      tableLayout: {
        rows: [{ kind: "field", column: "organization_name" }],
        columns: [{ kind: "field", column: "department_name" }, { kind: "metrics" }],
      },
    });
  });

  test("table 的热力着色原样穿过编译，其他形态拒绝", () => {
    const shading = { palette: "traffic_lights", flipped: true, thresholds: { mid: 0.5 } };
    const compiled = compileSemanticAnalysis(catalog, {
      version: 2,
      analysis: {
        views: [{ id: "result", measures: [ACTIVE_EMPLOYEE], dimensions: [ORG], time: JULY_2026 }],
      },
      presentation: { type: "table", shading },
    });
    expect(compiled.presentation).toMatchObject({ type: "table", shading });
    expect(() =>
      compileSemanticAnalysis(catalog, {
        version: 2,
        analysis: {
          views: [
            { id: "result", measures: [ACTIVE_EMPLOYEE], dimensions: [ORG], time: JULY_2026 },
          ],
        },
        presentation: { type: "bar", shading } as never,
      }),
    ).toThrow(/Unrecognized key\(s\) in object: 'shading'/);
  });

  test("table 列轴支持时间，业务维度轴拒绝总体行和未查询维度", () => {
    const temporal = compileSemanticAnalysis(catalog, {
      version: 2,
      analysis: {
        views: [
          {
            id: "result",
            measures: [ACTIVE_EMPLOYEE],
            dimensions: [ORG],
            time: JAN_TO_JULY_2026,
          },
        ],
      },
      presentation: { type: "table", columns: ["time", "metrics"] },
    });
    expect(temporal.presentation).toMatchObject({
      tableLayout: {
        rows: [{ kind: "field", column: "organization_name" }],
        columns: [{ kind: "time", level: "bucket" }, { kind: "metrics" }],
      },
    });
    expect(() =>
      compileSemanticAnalysis(catalog, {
        version: 2,
        analysis: {
          views: [
            {
              id: "result",
              measures: [ACTIVE_EMPLOYEE],
              dimensions: [ORG, DEPARTMENT],
              time: JULY_2026,
              summary: { mode: "grand_total" },
            },
          ],
        },
        presentation: { type: "table", columns: [DEPARTMENT] },
      }),
    ).toThrow(/业务维度列轴与 summary 互斥/);
    expect(() =>
      compileSemanticAnalysis(catalog, {
        version: 2,
        analysis: {
          views: [
            {
              id: "result",
              measures: [ACTIVE_EMPLOYEE],
              dimensions: [ORG, DEPARTMENT],
              time: JULY_2026,
            },
          ],
        },
        presentation: { type: "table", columns: [AGE_BAND] },
      }),
    ).toThrow(/不在查询中/);
  });

  test("同月在职人数与 YTD 事件率落到人员总览", () => {
    const compiled = compileSemanticAnalysis(catalog, {
      version: 2,
      analysis: {
        views: [
          {
            id: "result",
            measures: [ACTIVE_EMPLOYEE, YTD_EVENT_RATE],
            dimensions: [DEPARTMENT],
            time: JULY_2026,
          },
        ],
      },
      presentation: { type: "table" },
    });
    expect(compiled.routes[0]).toMatchObject({ status: "direct" });
    // 选路已内部化：物理落点由 plan.nodes 的物理成员名验证（test_people_metrics.*）
    expect(compiled.plan.nodes[0]).toMatchObject({
      measures: ["test_people_metrics.active_employee_count", "test_people_metrics.ytd_event_rate"],
      dimensions: ["test_people_metrics.organization_name", "test_people_metrics.department_name"],
    });
    expect(compiled.plan.output.columns).toMatchObject({
      active_employee_count: ACTIVE_EMPLOYEE,
      ytd_event_rate: YTD_EVENT_RATE,
      organization_name: ORG,
      department_name: DEPARTMENT,
    });
    expect(compiled.record_projection_bindings.views).toEqual([
      {
        view_id: "result",
        metrics: {
          [ACTIVE_EMPLOYEE]: { metric_id: ACTIVE_EMPLOYEE, title: "在职人数" },
          [YTD_EVENT_RATE]: { metric_id: YTD_EVENT_RATE, title: "YTD事件率" },
        },
        dimensions: {
          [ORG]: { dimension_id: ORG, title: "组织" },
          [DEPARTMENT]: { dimension_id: DEPARTMENT, title: "部门" },
        },
      },
    ]);
  });

  test("部门在职人数与编制完成率落到人员与编制", () => {
    const compiled = compileSemanticAnalysis(catalog, {
      version: 2,
      analysis: {
        views: [
          {
            id: "result",
            measures: [ACTIVE_EMPLOYEE, CURRENT_MONTH_FULFILLMENT_RATE],
            dimensions: [DEPARTMENT],
            time: JULY_2026,
          },
        ],
      },
      presentation: { type: "table" },
    });
    expect(compiled.routes[0]).toMatchObject({ status: "direct" });
    // 选路已内部化：物理落点由 plan.nodes 的物理成员名验证。
    expect(compiled.plan.nodes[0]).toMatchObject({
      measures: [
        "test_people_metrics.active_employee_count",
        "headcount_plan.current_month_fulfillment_rate",
      ],
      dimensions: ["test_people_metrics.organization_name", "test_people_metrics.department_name"],
    });
    expect(compiled.record_projection_bindings.views[0]?.metrics).toEqual({
      [ACTIVE_EMPLOYEE]: { metric_id: ACTIVE_EMPLOYEE, title: "在职人数" },
    });
  });

  test("单值上级过滤同时约束查询输出与明细坐标", () => {
    const compiled = compileSemanticAnalysis(catalog, {
      version: 2,
      analysis: {
        views: [
          {
            id: "result",
            measures: [ACTIVE_EMPLOYEE],
            dimensions: [DEPARTMENT],
            filters: [{ member: ORG, relation: "one_of", values: ["平台"] }],
            time: JULY_2026,
          },
        ],
      },
      presentation: { type: "table" },
    });
    expect(compiled.plan.nodes[0]).toMatchObject({
      dimensions: ["test_people_metrics.department_name"],
      filters: [
        {
          member: "test_people_metrics.organization_name",
          operator: "equals",
          values: ["平台"],
        },
      ],
    });
    expect(compiled.record_projection_bindings.views[0]?.dimensions).toEqual({
      [DEPARTMENT]: { dimension_id: DEPARTMENT, title: "部门" },
    });
  });

  test("公开排除关系只在编译边界映射为物理 notEquals", () => {
    const compiled = compileSemanticAnalysis(catalog, {
      version: 2,
      analysis: {
        views: [
          {
            id: "result",
            measures: [ACTIVE_EMPLOYEE],
            filters: [{ member: AGE_BAND, relation: "none_of", values: ["互联网"] }],
            time: JULY_2026,
          },
        ],
      },
      presentation: { type: "table" },
    });
    expect(compiled.plan.nodes[0]).toMatchObject({
      filters: [
        {
          member: "test_people_metrics.age_band",
          operator: "notEquals",
          values: ["互联网"],
        },
      ],
    });
  });

  test("多值下级过滤补出的上级同时进入查询输出与明细坐标", () => {
    const compiled = compileSemanticAnalysis(catalog, {
      version: 2,
      analysis: {
        views: [
          {
            id: "result",
            measures: [ACTIVE_EMPLOYEE],
            filters: [{ member: DEPARTMENT, relation: "one_of", values: ["部门甲", "部门乙"] }],
            time: JULY_2026,
          },
        ],
      },
      presentation: { type: "table" },
    });
    expect(compiled.plan.nodes[0]).toMatchObject({
      dimensions: ["test_people_metrics.organization_name"],
    });
    expect(compiled.record_projection_bindings.views[0]?.dimensions).toEqual({
      [ORG]: { dimension_id: ORG, title: "组织" },
    });
  });

  test("组织维度上的人员、离职与编制指标跨指标域原生直查", () => {
    const compiled = compileSemanticAnalysis(catalog, {
      version: 2,
      analysis: {
        views: [
          {
            id: "result",
            measures: [ACTIVE_EMPLOYEE, YTD_EVENT_RATE, CURRENT_MONTH_FULFILLMENT_RATE],
            dimensions: [DEPARTMENT],
            group_sort: {
              dimension: DEPARTMENT,
              by: ACTIVE_EMPLOYEE,
              direction: "desc",
            },
            time: JULY_2026,
          },
        ],
      },
      presentation: { type: "table" },
    });
    const binding = compiled.record_projection_bindings.views[0];
    expect(Object.values(binding.metrics).map((metric) => metric.metric_id)).toEqual([
      ACTIVE_EMPLOYEE,
      YTD_EVENT_RATE,
    ]);
    expect(Object.values(binding.dimensions).map((dimension) => dimension.dimension_id)).toEqual([
      ORG,
      DEPARTMENT,
    ]);
    expect(compiled.routes[0]).toEqual({
      status: "direct",
      view_id: "result",
    });
    expect(compiled.plan.nodes).toHaveLength(1);
    expect(compiled.plan.nodes[0]).toMatchObject({
      id: "result",
      measures: [
        "test_people_metrics.active_employee_count",
        "test_people_metrics.ytd_event_rate",
        "headcount_plan.current_month_fulfillment_rate",
      ],
      dimensions: ["test_people_metrics.organization_name", "test_people_metrics.department_name"],
      order: [{ member: "test_people_metrics.active_employee_count", direction: "desc" }],
    });
    expect(compiled.presentation).toMatchObject({
      type: "table",
      y: [],
      tableLayout: {
        rows: [
          { kind: "field", column: "organization_name" },
          { kind: "field", column: "department_name" },
        ],
        columns: [{ kind: "metrics" }],
      },
    });
  });

  test("人员与编制直查与明细共用单值上级过滤后的有效分组", () => {
    const compiled = compileSemanticAnalysis(catalog, {
      version: 2,
      analysis: {
        views: [
          {
            id: "result",
            measures: [YTD_EVENT_RATE, CURRENT_MONTH_FULFILLMENT_RATE],
            dimensions: [DEPARTMENT],
            filters: [{ member: ORG, relation: "one_of", values: ["平台"] }],
            time: JULY_2026,
          },
        ],
      },
      presentation: { type: "table" },
    });
    expect(compiled.routes[0]).toEqual({ status: "direct", view_id: "result" });
    expect(compiled.plan.nodes).toEqual([
      expect.objectContaining({
        dimensions: ["test_people_metrics.department_name"],
      }),
    ]);
    expect(compiled.plan.output.id).toBe("result");
    expect(compiled.plan.nodes.length).toBe(1);
    expect(Object.values(compiled.plan.output.columns)).toEqual(
      expect.arrayContaining([YTD_EVENT_RATE, CURRENT_MONTH_FULFILLMENT_RATE, DEPARTMENT]),
    );
    expect(compiled.plan.output.provenance).toBeUndefined();
    expect(compiled.record_projection_bindings.views[0]?.dimensions).toEqual({
      [DEPARTMENT]: { dimension_id: DEPARTMENT, title: "部门" },
    });
  });

  test("人员单值维度与流动指标编译为直接查询", () => {
    const compiled = compileSemanticAnalysis(catalog, {
      version: 2,
      analysis: {
        views: [
          {
            id: "result",
            measures: [YTD_EVENT_RATE],
            dimensions: [AGE_BAND],
            time: JULY_2026,
          },
        ],
      },
      presentation: { type: "table" },
    });
    expect(compiled.routes).toEqual([
      expect.objectContaining({ status: "direct", view_id: "result" }),
    ]);
    expect(compiled.plan.nodes[0]).toMatchObject({
      measures: ["test_people_metrics.ytd_event_rate"],
      dimensions: ["test_people_metrics.age_band"],
    });
  });

  test("多个独立结果在规划前被拒绝", () => {
    const view = (id: string) => ({
      id,
      measures: [YTD_EVENT_RATE, CURRENT_MONTH_FULFILLMENT_RATE],
      dimensions: [DEPARTMENT],
      time: JULY_2026,
    });
    try {
      compileSemanticAnalysis(catalog, {
        version: 2,
        analysis: { views: [view("first"), view("second")] },
        presentation: { type: "table" },
      });
      throw new Error("预期单结果护栏失败");
    } catch (error) {
      expect((error as Error).message).toMatch(/一次分析只能回答一个问题.*拆成多次/);
      expect((error as Error).message).not.toMatch(/Array|element|Zod/);
    }
  });

  test("分子与结构占比显式分流为柱系列和辅助标注", () => {
    const compiled = compileSemanticAnalysis(catalog, {
      version: 2,
      analysis: {
        views: [
          {
            id: "result",
            measures: [ACTIVE_EMPLOYEE, ACTIVE_EMPLOYEE_SHARE],
            dimensions: [AGE_BAND],
            time: JULY_2026,
          },
        ],
      },
      presentation: {
        type: "bar",
        category: AGE_BAND,
        series: [ACTIVE_EMPLOYEE],
        annotations: [ACTIVE_EMPLOYEE_SHARE],
      },
    });
    expect(compiled.plan.nodes[0]).toMatchObject({
      measures: [
        "test_people_metrics.active_employee_count",
        "test_people_metrics.active_employee_share",
      ],
    });
    expect(compiled.presentation).toMatchObject({
      type: "bar",
      x: "age_band",
      y: ["active_employee_count"],
      annotations: ["active_employee_share"],
    });
  });

  test("只选结构占比时它仍是一等柱系列", () => {
    const compiled = compileSemanticAnalysis(catalog, {
      version: 2,
      analysis: {
        views: [
          {
            id: "result",
            measures: [ACTIVE_EMPLOYEE_SHARE],
            dimensions: [AGE_BAND],
            time: JULY_2026,
          },
        ],
      },
      presentation: {
        type: "bar",
        category: AGE_BAND,
        series: [ACTIVE_EMPLOYEE_SHARE],
      },
    });
    expect(compiled.presentation.y).toEqual(["active_employee_share"]);
  });

  test("趋势图中的分子与结构占比都是显式主系列", () => {
    const compiled = compileSemanticAnalysis(catalog, {
      version: 2,
      analysis: {
        views: [
          {
            id: "result",
            measures: [ACTIVE_EMPLOYEE, ACTIVE_EMPLOYEE_SHARE],
            time: JAN_TO_JULY_2026,
          },
        ],
      },
      presentation: { type: "line", series: [ACTIVE_EMPLOYEE, ACTIVE_EMPLOYEE_SHARE] },
    });
    expect(compiled.presentation).toMatchObject({
      type: "line",
      y: ["active_employee_count", "active_employee_share"],
      annotations: [],
    });
  });

  test("分子与结构占比不能同时塞进主系列", () => {
    expect(() =>
      compileSemanticAnalysis(catalog, {
        version: 2,
        analysis: {
          views: [
            {
              id: "result",
              measures: [ACTIVE_EMPLOYEE, ACTIVE_EMPLOYEE_SHARE],
              dimensions: [AGE_BAND],
              time: JULY_2026,
            },
          ],
        },
        presentation: {
          type: "bar",
          category: AGE_BAND,
          series: [ACTIVE_EMPLOYEE, ACTIVE_EMPLOYEE_SHARE],
        },
      }),
    ).toThrow(/辅助标注通道/);
  });

  test("同一语义关联键可编译为左右不同的物理列名", () => {
    const renamedCatalog: CompilerCatalog = {
      ...catalog,
      dimensions: catalog.dimensions.map((dimension) =>
        dimension.id === DEPARTMENT
          ? {
              ...dimension,
              available_in: dimension.available_in.map((binding) =>
                binding.view === "headcount_plan"
                  ? {
                      ...binding,
                      member: "headcount_plan.department_name",
                    }
                  : binding,
              ),
            }
          : dimension,
      ),
    };
    const compiled = compileSemanticAnalysis(renamedCatalog, {
      version: 2,
      analysis: {
        views: [
          {
            id: "test_people_metrics",
            view_title: "人员数据",
            measures: [ACTIVE_EMPLOYEE, YTD_EVENT_RATE],
            dimensions: [DEPARTMENT],
            time: JULY_2026,
          },
          {
            id: "staffing",
            view_title: "编制数据",
            measures: [CURRENT_MONTH_FULFILLMENT_RATE],
            dimensions: [DEPARTMENT],
            time: JULY_2026,
          },
          {
            id: "combined",
            view_title: "人员与编制",
            from: ["test_people_metrics", "staffing"],
            join: { on: [DEPARTMENT], how: "left" },
            columns: [
              { source: "test_people_metrics", member: DEPARTMENT, as: "org" },
              {
                source: "test_people_metrics",
                member: ACTIVE_EMPLOYEE,
                as: "active_employee_count",
              },
              {
                source: "staffing",
                member: CURRENT_MONTH_FULFILLMENT_RATE,
                as: "current_month_fulfillment_rate",
              },
            ],
            summary: { mode: "grand_total" },
          },
        ],
      },
      presentation: { type: "table" },
    });
    expect(compiled.plan.nodes[2]).toMatchObject({
      join: {
        on: [{ left: "department_name", right: "department_name" }],
        how: "left",
      },
      summary: { mode: "grand_total" },
    });
    expect(compiled.plan.output.provenance).toEqual({
      sources: [{ title: "人员数据" }, { title: "编制数据" }],
      join_keys: [{ id: DEPARTMENT, title: "部门" }],
    });
  });

  test("派生视图按输出别名编译 table 列轴声明", () => {
    const compiled = compileSemanticAnalysis(catalog, {
      version: 2,
      analysis: {
        views: [
          {
            id: "source",
            view_title: "组织人数数据",
            measures: [ACTIVE_EMPLOYEE],
            dimensions: [ORG, DEPARTMENT],
            time: JULY_2026,
          },
          {
            id: "result",
            view_title: "组织人数",
            from: ["source"],
            columns: [
              { source: "source", member: ORG, as: "一级组织" },
              { source: "source", member: DEPARTMENT, as: "二级组织" },
              { source: "source", member: ACTIVE_EMPLOYEE, as: "在职人数" },
            ],
          },
        ],
      },
      presentation: { type: "table", columns: ["二级组织"] },
    });
    expect(compiled.presentation).toEqual({
      type: "table",
      y: [],
      tableLayout: {
        rows: [{ kind: "field", column: "一级组织" }],
        columns: [{ kind: "field", column: "二级组织" }, { kind: "metrics" }],
      },
    });
  });

  test("派生视图的 columns 同样只允许 table", () => {
    expect(() =>
      compileSemanticAnalysis(catalog, {
        version: 2,
        analysis: {
          views: [
            {
              id: "source",
              view_title: "组织人数数据",
              measures: [ACTIVE_EMPLOYEE],
              dimensions: [ORG, DEPARTMENT],
              time: JULY_2026,
            },
            {
              id: "result",
              view_title: "组织人数",
              from: ["source"],
              columns: [
                { source: "source", member: ORG, as: "一级组织" },
                { source: "source", member: DEPARTMENT, as: "二级组织" },
                { source: "source", member: ACTIVE_EMPLOYEE, as: "在职人数" },
              ],
            },
          ],
        },
        presentation: {
          type: "bar",
          columns: ["二级组织"],
          category: "一级组织",
          series: ["在职人数"],
        },
      }),
    ).toThrow(/Unrecognized key.*columns/);
  });
});
