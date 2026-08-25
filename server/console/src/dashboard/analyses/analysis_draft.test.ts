import { describe, expect, test } from "bun:test";
import type { PublicCatalogDocument as CatalogPayload } from "@contracts/catalog_contract";
import type { ReplayPayload } from "@contracts/replay_contract";
import type { AnalysisDefinition, SemanticQueryView } from "@semantic-analysis";
import {
  beginAnalysisEdit,
  blankAnalysisDefinition,
  defaultSemanticViewIntent,
  hasAnalysisChanges,
  hasViewChanges,
  isAnalysisEditDirty,
  isAnalysisRunnable,
  isPreviewCurrent,
  removeSemanticQueryMember,
  renameAnalysisDraft,
  replaceSemanticQueryDimension,
  semanticSinkQueryView,
  setSemanticQueryView,
  setSemanticViewIntent,
  setViewPreferences,
  settlePreview,
  settleSaved,
} from "./analysis_draft";

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
    },
    {
      id: "measure:new_hire_count",
      kind: "measure",
      title: "入职人数",
      description: "所选期间内入职的人数。",
    },
  ],
  dimensions: [
    {
      id: "dimension:organization_name",
      kind: "dimension",
      title: "组织",
      description: "人员所属组织。",
    },
    {
      id: "dimension:department_name",
      kind: "dimension",
      title: "部门",
      description: "人员所属部门。",
    },
  ],
};

const definition: AnalysisDefinition = {
  title: "组织人数",
  views: [
    {
      id: "result",
      measures: ["measure:active_employee_count", "measure:new_hire_count"],
      dimensions: ["dimension:organization_name"],
      time: { window: { kind: "current_month", month: "2026-07" } },
    },
  ],
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
      decl: { type: "table", y: [] },
    },
    presentation: {
      type: "table",
      table_layout: { state: "applied", leafColumns: 2 },
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

    const query = semanticSinkQueryView(draft.analysis)!;
    const analysisChanged = setSemanticQueryView(
      draft,
      query.id,
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

  test("声明的时间列轴不被意图层剔除：输出粒度由引擎按指标契约裁决", () => {
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

  test("空白定义是合法编辑中间态，但没有成员前不可执行", () => {
    const blank = beginAnalysisEdit(
      {
        name: "未命名分析",
        analysis: blankAnalysisDefinition("未命名分析"),
        view: { type: "table" },
      },
      false,
    );
    expect(isAnalysisRunnable(blank)).toBe(false);
    const query = semanticSinkQueryView(blank.analysis)!;
    expect(
      isAnalysisRunnable(
        setSemanticQueryView(
          blank,
          query.id,
          { ...query, measures: ["measure:active_employee_count"] },
          catalog,
        ),
      ),
    ).toBe(true);
  });

  test("派生分析没有唯一可编辑查询收敛点", () => {
    const derived: AnalysisDefinition = {
      views: [
        definition.views[0]!,
        {
          id: "derived",
          view_title: "派生结果",
          from: ["result"],
          columns: [
            {
              source: "result",
              member: "measure:active_employee_count",
              as: "active_employee_count",
            },
          ],
        },
      ],
    };
    expect(semanticSinkQueryView(derived)).toBeNull();
  });
});

describe("查询成员纯转换", () => {
  const query: SemanticQueryView = {
    id: "result",
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
