import { describe, expect, test } from "bun:test";
import type { PublicCatalogDocument as CatalogPayload } from "@contracts/catalog_contract";
import type { ReplayPayload } from "@contracts/replay_contract";
import type { AnalysisDefinition, SemanticQueryView } from "@semantic-analysis";
import {
  beginAnalysisEdit,
  analysisReadiness,
  blankAnalysisDefinition,
  defaultSemanticViewIntent,
  hasAnalysisChanges,
  hasViewChanges,
  isAnalysisEditDirty,
  isPreviewCurrent,
  removeSemanticQueryMember,
  renameAnalysisDraft,
  replaceSemanticQueryDimension,
  semanticEditableQuery,
  setSemanticQueryView,
  setSemanticViewIntent,
  setViewPreferences,
  settlePreview,
  settleSaved,
} from "./analysis_draft";
import { formAvailability } from "@shape";

const catalog: CatalogPayload = {
  access_scope: { id: "organization", title: "组织" },
  observation_scopes: ["统计口径"],
  data_as_of: "2026-07",
  time_context: [],
  metric_domains: [],
  measures: [
    {
      id: "measure:active_employee_count",
      kind: "measure",
      title: "在职人数",
      description: "所选期间内处于在职状态的人数。",
      query_capabilities: {
        dimension_ids: ["dimension:organization_name", "dimension:department_name"],
      },
      time: { value_basis: "bucket_end" as const },
    },
    {
      id: "measure:new_hire_count",
      kind: "measure",
      title: "入职人数",
      description: "所选期间内入职的人数。",
      query_capabilities: {
        dimension_ids: ["dimension:organization_name", "dimension:department_name"],
      },
      time: { value_basis: "whole_bucket" as const },
    },
  ],
  dimensions: [
    {
      id: "dimension:organization_name",
      kind: "dimension",
      title: "组织",
      description: "人员所属组织。",
      dimension_group: { id: "organization", title: "组织与部门" },
    },
    {
      id: "dimension:department_name",
      kind: "dimension",
      title: "部门",
      description: "人员所属部门。",
      dimension_group: { id: "organization", title: "组织与部门" },
    },
  ],
};

const definition: AnalysisDefinition = {
  title: "组织人数",
  query: {
    measures: ["measure:active_employee_count", "measure:new_hire_count"],
    dimensions: ["dimension:organization_name"],
    time: { window: { kind: "current_month", month: "2026-07" } },
  },
};

const begin = (saved = true) =>
  beginAnalysisEdit(
    {
      name: "组织人数",
      analysis: definition,
      view: {
        type: "bar",
        category: "dimension:organization_name",
        series: ["measure:active_employee_count"],
      },
      view_preferences: {
        series: { "measure:active_employee_count": { color: "#509ee3" } },
      },
    },
    saved,
  );

function replay(view: ReplayPayload["view"] = { type: "table" }): ReplayPayload {
  const rawView = {
    id: "result",
    columns: ["organization_name", "active_employee_count"],
    column_roles: {
      organization_name: "dimension" as const,
      active_employee_count: "measure" as const,
    },
    rows: [["示例组织甲", 10]],
    row_count: 1,
    query_notes: [],
  };
  return {
    at: "2026-07-21T00:00:00Z",
    caller: "alice@x",
    analysis_id: "11111111-1111-4111-8111-111111111111",
    view_id: "22222222-2222-4222-8222-222222222222",
    analysis: definition,
    view,
    view_preferences: {},
    record_projection_bindings: { views: [] },
    payload: {
      view: rawView,
      observation_scopes: ["统计口径"],
      data_as_of: "2026-07",
      time_context: [],
    },
    render_bundle: {
      view: rawView,
      decl: { type: "table" },
    },
    presentation: {
      type: "table",
      table: {
        columns: [
          {
            label: "组织",
            formatKey: "organization_name",
            numeric: false,
            headerPath: [{ key: "organization_name", label: "组织" }],
          },
          {
            label: "在职人数",
            formatKey: "active_employee_count",
            numeric: true,
            headerPath: [{ key: "active_employee_count", label: "在职人数" }],
          },
        ],
        rows: [["示例组织甲", 10]],
      },
    },
  };
}

describe("analysis draft 三层状态", () => {
  test("Analysis、View 与视觉偏好分别判定变化", () => {
    const draft = begin();
    expect(hasAnalysisChanges(draft)).toBe(false);
    expect(hasViewChanges(draft)).toBe(false);

    const viewOnly = setSemanticViewIntent(draft, { type: "table" }, catalog);
    expect(hasAnalysisChanges(viewOnly)).toBe(false);
    expect(hasViewChanges(viewOnly)).toBe(true);

    const query = semanticEditableQuery(draft.analysis)!;
    const analysisChanged = setSemanticQueryView(
      draft,
      { ...query, measures: ["measure:new_hire_count"] },
      catalog,
    );
    expect(hasAnalysisChanges(analysisChanged)).toBe(true);
  });

  test("名称只影响编辑脏态，不改变 Analysis 或 View", () => {
    const renamed = renameAnalysisDraft(begin(), "新名称");
    expect(isAnalysisEditDirty(renamed)).toBe(true);
    expect(hasAnalysisChanges(renamed)).toBe(false);
    expect(hasViewChanges(renamed)).toBe(false);
  });

  test("对象键顺序不制造伪变更，数组顺序仍属于语义", () => {
    const base = begin();
    const samePreferences = {
      value_labels: "all" as const,
      series: { "measure:active_employee_count": { color: "#509ee3" } },
    };
    const reorderedPreferences = {
      series: { "measure:active_employee_count": { color: "#509ee3" } },
      value_labels: "all" as const,
    };
    const reordered = {
      ...base,
      view_preferences: samePreferences,
      baseline_view_preferences: reorderedPreferences,
    };
    expect(hasViewChanges(reordered)).toBe(false);
    expect(isAnalysisEditDirty(reordered)).toBe(false);

    const reversedSeries = {
      ...base,
      view: {
        ...base.view,
        series: ["measure:active_employee_count", "measure:new_hire_count"],
      },
      baseline_view: {
        ...base.view,
        series: ["measure:new_hire_count", "measure:active_employee_count"],
      },
    };
    expect(hasViewChanges(reversedSeries)).toBe(true);
  });

  test("保存落定三层基线，预览身份只由预览结果落定", () => {
    const changed = setSemanticViewIntent(begin(), { type: "table" }, catalog);
    expect(isPreviewCurrent(changed)).toBe(false);
    const previewed = settlePreview(changed, replay());
    expect(isPreviewCurrent(previewed)).toBe(true);
    expect(isAnalysisEditDirty(settleSaved(previewed))).toBe(false);
  });

  test("声明的条件时间列轴保留到结果布局解析", () => {
    const next = setSemanticViewIntent(
      begin(),
      { type: "table", columns: ["metrics", "time"] },
      catalog,
    );
    expect(next.view).toEqual({ type: "table", columns: ["metrics", "time"] });
  });

  test("省略 series 表示默认通道，不会误删已有系列配色", () => {
    const draft = { ...begin(), view: { type: "line" as const } };
    const next = setViewPreferences(draft, {
      series: { "measure:active_employee_count": { color: "#509ee3" } },
      value_labels: "main",
    });
    expect(next.view_preferences).toEqual({
      series: { "measure:active_employee_count": { color: "#509ee3" } },
      value_labels: "main",
    });
  });

  test("显式 series 改变时只保留仍在通道内的系列偏好", () => {
    const next = setSemanticViewIntent(
      begin(),
      {
        type: "bar",
        category: "dimension:organization_name",
        series: ["measure:new_hire_count"],
      },
      catalog,
    );
    expect(next.view_preferences).toEqual({});
  });

  test("默认呈现由语义结果成员生成，不读取物理字段", () => {
    expect(defaultSemanticViewIntent(begin(), "bar", catalog)).toEqual({
      type: "bar",
      category: "dimension:organization_name",
      series: ["measure:active_employee_count", "measure:new_hire_count"],
    });
  });

  test("切图型时的默认绑定与图型可选性同源：趋势结果上的折线按维度拆线", () => {
    const result = {
      id: "result",
      columns: ["year", "month", "dimension:organization_name", "measure:active_employee_count"],
      column_roles: {
        year: "time" as const,
        month: "time" as const,
        "dimension:organization_name": "dimension" as const,
        "measure:active_employee_count": "measure" as const,
      },
      rows: [
        [2026, 1, "甲", 10],
        [2026, 1, "乙", 20],
        [2026, 2, "甲", 11],
        [2026, 2, "乙", 21],
      ],
      row_count: 4,
      query_notes: [],
    };
    expect(formAvailability(result, "line")).toEqual({ state: "available" });
    expect(defaultSemanticViewIntent(begin(), "line", catalog, result)).toMatchObject({
      type: "line",
      series: ["measure:active_employee_count"],
      group_by: "dimension:organization_name",
    });
  });

  test("指标卡没有任何维度通道：查询带分组维度时退回表格", () => {
    const draft = begin();
    const query = semanticEditableQuery(draft.analysis)!;
    expect(defaultSemanticViewIntent(draft, "kpi", catalog)).toEqual({ type: "table" });
    const flat = setSemanticQueryView(draft, { ...query, dimensions: [] }, catalog);
    expect(defaultSemanticViewIntent(flat, "kpi", catalog)).toMatchObject({ type: "kpi" });
  });

  test("查询声明的维度在结果里只有一个取值时不拿它拆线，指标各成一条", () => {
    const single = {
      id: "result",
      columns: ["year", "month", "dimension:organization_name", "measure:active_employee_count"],
      column_roles: {
        year: "time" as const,
        month: "time" as const,
        "dimension:organization_name": "dimension" as const,
        "measure:active_employee_count": "measure" as const,
      },
      rows: [
        [2026, 1, "甲", 10],
        [2026, 2, "甲", 11],
      ],
      row_count: 2,
      query_notes: [],
    };
    expect(defaultSemanticViewIntent(begin(), "line", catalog, single)).toEqual({
      type: "line",
      series: ["measure:active_employee_count"],
    });
  });

  test("查询加到两个维度时折线没有第二个拆分通道，呈现退回表格", () => {
    const draft = begin();
    const query = semanticEditableQuery(draft.analysis)!;
    const line = setSemanticViewIntent(
      draft,
      { type: "line", series: ["measure:active_employee_count"] },
      catalog,
    );
    expect(line.view.type).toBe("line");
    const widened = setSemanticQueryView(
      line,
      {
        ...query,
        dimensions: ["dimension:organization_name", "dimension:department_name"],
      },
      catalog,
    );
    expect(widened.view).toEqual({ type: "table" });
  });

  test("空白定义是合法编辑中间态，但没有成员前不可执行", () => {
    const blank = beginAnalysisEdit(
      {
        name: "未命名分析",
        analysis: blankAnalysisDefinition("未命名分析"),
        view: { type: "table" },
      },
      false,
    );
    expect(analysisReadiness(blank, catalog).issues).toEqual([
      { code: "analysis_empty", message: "至少选择一个指标或分组维度" },
    ]);
    const query = semanticEditableQuery(blank.analysis)!;
    expect(
      analysisReadiness(
        setSemanticQueryView(
          blank,
          { ...query, measures: ["measure:active_employee_count"] },
          catalog,
        ),
        catalog,
      ).issues,
    ).toEqual([]);
  });

  test("按月定义的指标在年度草稿中返回结构化阻断", () => {
    const monthly = {
      id: "measure:monthly_hire_rate",
      kind: "measure" as const,
      title: "月度入职率",
      description: "所选月份的入职率。",
      query_capabilities: { dimension_ids: [] },
      time: { value_basis: "whole_bucket" as const, constraints: { grain: "month" as const } },
    };
    const annual = beginAnalysisEdit(
      {
        name: "年度分析",
        analysis: {
          title: "年度分析",
          query: {
            measures: [monthly.id],
            time: { window: { kind: "trailing", count: 3, unit: "year", grain: "year" } },
          },
        },
        view: { type: "table" },
      },
      false,
    );
    const readiness = analysisReadiness(annual, {
      ...catalog,
      measures: [...catalog.measures, monthly],
    });
    expect(readiness.issues).toEqual([
      {
        code: "metric_time_grain_incompatible",
        metric_titles: ["月度入职率"],
        required_grain: "month",
        selected_grain: "year",
        message: "指标「月度入职率」按月定义；连续期间请改为按月呈现，不能合并多个月份",
      },
    ]);
  });

  test("历史规格中的时间自身冲突稳定阻断，不依赖指标能力", () => {
    const historical = beginAnalysisEdit(
      {
        name: "历史分析",
        analysis: {
          title: "历史分析",
          query: {
            measures: ["measure:active_employee_count"],
            time: {
              window: { kind: "trailing", count: 5, unit: "year", grain: "year" },
              comparison: { kind: "previous_year" },
            },
          },
        },
        view: { type: "table" },
      },
      true,
    );
    expect(analysisReadiness(historical, catalog).issues).toEqual([
      {
        code: "time_output_bucket_overlap",
        selected_grain: "year",
        bucket: "2022",
        message:
          "主时间与对照时间在按年呈现时都会产生 2022 年，结果无法区分；请选择互不重叠的主时间或对照时间",
      },
    ]);
  });

  test("派生分析没有唯一可编辑查询收敛点", () => {
    const derived: AnalysisDefinition = {
      query: { ...definition.query, view_title: "来源" },
      derived: {
        view_title: "派生结果",
        columns: [
          {
            source: "query",
            member: "measure:active_employee_count",
            as: "active_employee_count",
          },
        ],
      },
    };
    expect(semanticEditableQuery(derived)).toBeNull();
  });
});

describe("查询成员纯转换", () => {
  const query: SemanticQueryView = {
    measures: ["measure:active_employee_count"],
    dimensions: ["dimension:organization_name"],
    time: { window: { kind: "current_month" } },
    group_sort: {
      dimension: "dimension:organization_name",
      by: "measure:active_employee_count",
      direction: "desc",
    },
    calculations: [
      {
        id: "calculation:share",
        title: "组织占比",
        kind: "percent_of_total",
        measure: "measure:active_employee_count",
        category_dimension: "dimension:organization_name",
      },
    ],
  };

  test("删除指标同时清理依赖排序和计算", () => {
    const removed = removeSemanticQueryMember(query, "measure:active_employee_count", "measure");
    expect(removed.group_sort).toBeUndefined();
    expect(removed.calculations).toBeUndefined();
  });

  test("替换分组维度保持位次并清理旧维度计算", () => {
    const replaced = replaceSemanticQueryDimension(
      query,
      "dimension:organization_name",
      "dimension:department_name",
    );
    expect(replaced.dimensions).toEqual(["dimension:department_name"]);
    expect(replaced.group_sort?.dimension).toBe("dimension:department_name");
    expect(replaced.calculations).toEqual([]);
  });
});
