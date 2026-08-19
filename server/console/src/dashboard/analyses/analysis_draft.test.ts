import { describe, expect, test } from "bun:test";
import type {
  PublicCatalogMember as CatalogMemberPayload,
  PublicCatalogDocument as CatalogPayload,
} from "@contracts/catalog_contract";
import type { ReportDetail } from "@contracts/report_contract";
import type { ReplayPayload } from "@contracts/replay_contract";
import { SEMANTIC_ANALYSIS_SPEC_INPUT } from "@semantic-analysis";
import {
  beginAnalysisEdit,
  blankAnalysisSpec,
  defaultSemanticChart,
  hasSpecChanges,
  isPreviewCurrent,
  isAnalysisEditDirty,
  isAnalysisRunnable,
  timeCapabilitiesOf,
  settlePreview,
  removeSemanticQueryMember,
  replaceSemanticQueryDimension,
  renameAnalysisDraft,
  semanticSinkQueryView,
  semanticSummaryEnabled,
  setDraftTime,
  setSemanticChart,
  setSemanticQueryView,
  setSemanticSummary,
} from "./analysis_draft";

const JULY_2026 = {
  window: { kind: "current_month" as const, month: "2026-07" },
};
const JAN_TO_JULY_2026 = {
  window: { kind: "range" as const, from: "2026-01", to: "2026-07" },
  display: "month" as const,
};

const baseReport = {
  id: "r1",
  analysis_id: "a1",
  owner: "alice@x",
  name: "组织人数",
  result_view_id: "structure",
  presentation_type: "bar",
  render_shape: "bar",
  revision: 1,
  updated_at: "2026-07-21T00:00:00Z",
} satisfies Omit<ReportDetail, "spec">;

const derivedReport: ReportDetail = {
  ...baseReport,
  spec: {
    version: 2,
    analysis: {
      views: [
        {
          id: "source",
          measures: ["measure:active_employee_count", "measure:new_hire_count"],
          dimensions: ["dimension:organization_name"],
          time: JULY_2026,
        },
        {
          id: "structure",
          view_title: "组织人数",
          from: ["source"],
          columns: [
            { source: "source", member: "dimension:organization_name", as: "organization_name" },
            {
              source: "source",
              member: "measure:active_employee_count",
              as: "active_employee_count",
            },
            { source: "source", member: "measure:new_hire_count", as: "new_hire_count" },
          ],
        },
      ],
    },
    presentation: {
      type: "bar",
      category: "organization_name",
      series: ["active_employee_count"],
    },
  },
};

const replay: ReplayPayload = {
  at: baseReport.updated_at,
  caller: baseReport.owner,
  analysis_id: "a1",
  spec: derivedReport.spec,
  presentation: {
    type: "table",
    table_layout: { state: "applied", leafColumns: 2 },
    table: {
      columns: [
        {
          label: "organization_name",
          formatKey: "organization_name",
          numeric: false,
          headerPath: [{ key: "field:organization_name", label: "organization_name" }],
        },
        {
          label: "active_employee_count",
          formatKey: "active_employee_count",
          numeric: true,
          headerPath: [{ key: "metric:active_employee_count", label: "active_employee_count" }],
        },
        {
          label: "new_hire_count",
          formatKey: "new_hire_count",
          numeric: true,
          headerPath: [{ key: "metric:new_hire_count", label: "new_hire_count" }],
        },
      ],
      rows: [
        ["A", 10, 2],
        ["B", 20, 3],
      ],
    },
  },
  payload: {
    view: {
      id: "structure",
      columns: ["organization_name", "active_employee_count", "new_hire_count"],
      column_roles: {
        organization_name: "dimension",
        active_employee_count: "measure",
        new_hire_count: "measure",
      },
      rows: [
        ["A", 10, 2],
        ["B", 20, 3],
      ],
      row_count: 2,
      query_notes: [],
    },
    default_population_scope: "统计口径",
    data_as_of: "2026-07",
    time_context: [],
  },
};

const semanticCatalog: CatalogPayload = {
  default_population_scope: "统计口径",
  data_as_of: "2026-07",
  time_context: [],
  metric_domains: [
    {
      id: "metric_domain:workforce_structure",
      title: "人员规模与结构",
      synonyms: [],
      measure_ids: [],
      dimension_ids: [],
    },
  ],
  measures: [
    {
      id: "measure:active_employee_count",
      kind: "measure",
      title: "在职人数",
      description: "在职人数。",
    },
    {
      id: "measure:active_employee_share",
      kind: "measure",
      title: "在职人数占比",
      description: "在职人数占比。",
      relation: { kind: "structure_share", numerator_id: "measure:active_employee_count" },
    },
    {
      id: "measure:new_hire_count",
      kind: "measure",
      title: "入职人数",
      description: "入职人数。",
    },
  ],
  dimensions: [
    {
      id: "dimension:organization_name",
      kind: "dimension",
      title: "组织",
      description: "组织。",
    },
  ],
};

const reportFixture: ReportDetail = {
  ...baseReport,
  spec: {
    version: 2,
    analysis: {
      views: [
        {
          id: "structure",
          measures: ["measure:active_employee_count", "measure:active_employee_share"],
          dimensions: ["dimension:organization_name"],
          time: JAN_TO_JULY_2026,
        },
      ],
    },
    presentation: { type: "table" },
  },
};

describe("report draft", () => {
  test("进入编辑得到独立草稿，名称变更可判脏", () => {
    const draft = beginAnalysisEdit(reportFixture, false);
    expect(isAnalysisEditDirty(draft)).toBe(false);
    const renamed = renameAnalysisDraft(draft, "新名称");
    expect(renamed.name).toBe("新名称");
    expect(isAnalysisEditDirty(renamed)).toBe(true);
    expect(reportFixture.name).toBe("组织人数");
  });

  test("派生报告只编辑逻辑呈现，落成语义图表声明（物理图表由服务端编译）", () => {
    const draft = beginAnalysisEdit(derivedReport, false);
    const chart = defaultSemanticChart(draft, "bar", semanticCatalog);
    const edited = setSemanticChart(
      draft,
      {
        ...chart,
        series: ["new_hire_count"],
        display: { series: { new_hire_count: { color: "#509ee3" } } },
      },
      semanticCatalog,
    );
    // 单语言：草稿只承载语义图表声明，物理图表由服务端在预览载荷里编译，不在浏览器构造
    expect(edited.spec.presentation).toMatchObject({
      type: "bar",
      series: ["new_hire_count"],
      display: { series: { new_hire_count: { color: "#509ee3" } } },
    });
    expect(hasSpecChanges(edited)).toBe(true);
    expect(isAnalysisEditDirty(edited)).toBe(true);
  });

  test("规格变化（含呈现）使预览失效，重新预览后恢复", () => {
    const draft = beginAnalysisEdit(reportFixture, false);
    const view = draft.spec.analysis.views[0];
    if (!view || "from" in view) throw new Error("fixture 必须包含语义查询");
    const groupSort = {
      dimension: "dimension:organization_name",
      by: "measure:active_employee_count",
      direction: "desc" as const,
      max_items: 20,
    };
    const edited = setSemanticQueryView(
      draft,
      view.id,
      { ...view, group_sort: groupSort },
      semanticCatalog,
    );
    expect(hasSpecChanges(edited)).toBe(true);
    expect(isPreviewCurrent(edited)).toBe(false);
    const previewed = settlePreview(edited, {
      ...replay,
      analysis_id: "analysis-2",
      spec: edited.spec,
    });
    expect(isPreviewCurrent(previewed)).toBe(true);
    const changedAgain = setSemanticQueryView(
      previewed,
      view.id,
      { ...view, group_sort: { ...groupSort, max_items: 15 } },
      semanticCatalog,
    );
    expect(isPreviewCurrent(changedAgain)).toBe(false);
  });

  test("总体开关修改唯一结果视图，并使旧预览失效", () => {
    const draft = beginAnalysisEdit(derivedReport, true);
    expect(semanticSummaryEnabled(draft)).toBe(false);
    const enabled = setSemanticSummary(draft, true, semanticCatalog);
    expect(semanticSummaryEnabled(enabled)).toBe(true);
    expect(enabled.spec.analysis.views[1]).toMatchObject({
      id: "structure",
      summary: { mode: "grand_total" },
    });
    expect(isPreviewCurrent(enabled)).toBe(false);
    const disabled = setSemanticSummary(enabled, false, semanticCatalog);
    expect(semanticSummaryEnabled(disabled)).toBe(false);
    expect(disabled.spec.analysis.views[1]).not.toHaveProperty("summary");
  });

  test("总体开启时只清理业务维度列轴，保留指标轴", () => {
    const report: ReportDetail = {
      ...derivedReport,
      spec: {
        ...derivedReport.spec,
        presentation: { type: "table", columns: ["organization_name", "metrics"] },
      },
    };
    const draft = beginAnalysisEdit(report, true);
    const enabled = setSemanticSummary(draft, true, semanticCatalog);
    expect(enabled.spec.presentation).toEqual({ type: "table", columns: ["metrics"] });
    expect(enabled.spec.analysis.views[1]).toMatchObject({
      summary: { mode: "grand_total" },
    });
  });

  test("查询维度或时间前提变化时只清理失效列轴", () => {
    const report: ReportDetail = {
      ...reportFixture,
      spec: {
        ...reportFixture.spec,
        analysis: {
          views: [
            {
              id: "structure",
              measures: ["measure:active_employee_count"],
              dimensions: ["dimension:organization_name", "dimension:category_level"],
              time: JULY_2026,
            },
          ],
        },
        presentation: {
          type: "table",
          columns: ["time", "dimension:category_level", "metrics"],
        },
      },
    };
    const catalog: CatalogPayload = {
      ...semanticCatalog,
      dimensions: [
        ...semanticCatalog.dimensions,
        {
          id: "dimension:category_level",
          kind: "dimension",
          title: "职级",
          description: "职级。",
        },
      ],
    };
    const draft = beginAnalysisEdit(report, false);
    const view = draft.spec.analysis.views[0];
    if (!view || "from" in view) throw new Error("fixture 必须包含语义查询");
    const removed = setSemanticQueryView(
      draft,
      view.id,
      {
        ...view,
        dimensions: ["dimension:organization_name"],
      },
      catalog,
    );
    expect(removed.spec.presentation).toEqual({
      type: "table",
      columns: ["metrics"],
    });

    const ranged = setSemanticQueryView(
      draft,
      view.id,
      {
        ...view,
        time: JAN_TO_JULY_2026,
      },
      catalog,
    );
    expect(ranged.spec.presentation).toEqual({
      type: "table",
      columns: ["time", "dimension:category_level", "metrics"],
    });
  });

  test("进入编辑不让当前数据形态改写已存的不可变 Analysis", () => {
    const draft = beginAnalysisEdit(derivedReport, true);
    expect(draft.spec.presentation).toEqual(derivedReport.spec.presentation);
    expect(isAnalysisEditDirty(draft)).toBe(false);
    expect(hasSpecChanges(draft)).toBe(false);
    expect(isPreviewCurrent(draft)).toBe(true);
  });

  test("进入编辑：空结果保留图表声明，数据到位后自然出图", () => {
    const draft = beginAnalysisEdit(derivedReport, true);
    expect(draft.spec.presentation.type).toBe("bar");
    expect(isAnalysisEditDirty(draft)).toBe(false);
  });

  test("预览返回以新 Analysis 的落定规格为准，保存无需再跑", () => {
    const draft = beginAnalysisEdit(derivedReport, true);
    const settled = settlePreview(draft, {
      ...replay,
      spec: { ...derivedReport.spec, presentation: { type: "table" } },
      presentation_notes: [
        { view_id: "structure", kind: "unsupported_shape", note: "画不出声明的图表" },
      ],
    });
    expect(settled.spec.presentation).toEqual({ type: "table" });
    expect(isPreviewCurrent(settled)).toBe(true);
  });

  test("删除查询成员原子清理依赖分组排序，保留独立筛选", () => {
    const view = {
      id: "structure",
      measures: ["measure:active_employee_count", "measure:new_hire_count"],
      dimensions: ["dimension:organization_name"],
      filters: [
        { member: "dimension:organization_name", relation: "one_of" as const, values: ["A"] },
      ],
      group_sort: {
        dimension: "dimension:organization_name",
        by: "measure:active_employee_count",
        direction: "desc" as const,
      },
      time: JULY_2026,
    };
    expect(
      removeSemanticQueryMember(view, "measure:active_employee_count", "measure"),
    ).toMatchObject({
      measures: ["measure:new_hire_count"],
      filters: view.filters,
      group_sort: undefined,
    });
    expect(
      removeSemanticQueryMember(view, "dimension:organization_name", "dimension"),
    ).toMatchObject({
      dimensions: [],
      filters: view.filters,
      group_sort: undefined,
    });
  });

  test("分组维度就地换绑：位次不动，指着它的排名跟着改指", () => {
    const view = {
      id: "structure",
      measures: ["measure:active_employee_count"],
      dimensions: ["dimension:organization_name", "dimension:category_group"],
      group_sort: {
        dimension: "dimension:organization_name",
        by: "measure:active_employee_count",
        direction: "desc" as const,
        max_items: 5,
      },
      time: JULY_2026,
    };
    // 换的是第一位，排名规格随之改指新维度，配好的方向与数量一个不丢。
    expect(
      replaceSemanticQueryDimension(view, "dimension:organization_name", "dimension:city"),
    ).toMatchObject({
      dimensions: ["dimension:city", "dimension:category_group"],
      group_sort: { ...view.group_sort, dimension: "dimension:city" },
    });
    // 不指着它的排名不受影响。
    expect(
      replaceSemanticQueryDimension(view, "dimension:category_group", "dimension:city"),
    ).toMatchObject({
      dimensions: ["dimension:organization_name", "dimension:city"],
      group_sort: view.group_sort,
    });
    // 换成一个已在查询里的维度即为删除：同一维度不得占两位。
    expect(
      replaceSemanticQueryDimension(
        view,
        "dimension:organization_name",
        "dimension:category_group",
      ),
    ).toMatchObject({ dimensions: ["dimension:category_group"], group_sort: undefined });
  });

  test("时间栏写入收敛点视图并使预览失效；派生规格整体只读", () => {
    expect(semanticSinkQueryView(reportFixture.spec)?.id).toBe("structure");
    expect(semanticSinkQueryView(derivedReport.spec)).toBeNull();

    const draft = beginAnalysisEdit(reportFixture, true);
    expect(isPreviewCurrent(draft)).toBe(true);
    const next = setDraftTime(draft, JULY_2026, semanticCatalog);
    const view = next.spec.analysis.views[0];
    if (!view || "from" in view) throw new Error("fixture 必须包含语义查询");
    expect(view.time).toEqual(JULY_2026);
    expect(next.previewed_spec).toBeNull();

    const derived = beginAnalysisEdit(derivedReport, true);
    expect(setDraftTime(derived, JULY_2026, semanticCatalog)).toBe(derived);
  });

  test("选中指标的时间能力卡按位并集传导给时间控件", () => {
    const view = semanticSinkQueryView(reportFixture.spec);
    if (!view) throw new Error("fixture 必须包含语义查询");
    expect(timeCapabilitiesOf(view, semanticCatalog)).toEqual({});
    const withCard = (constraints: CatalogMemberPayload["time_constraints"]): CatalogPayload => ({
      ...semanticCatalog,
      measures: semanticCatalog.measures.map((member) =>
        member.id === "measure:active_employee_count"
          ? { ...member, time_constraints: constraints }
          : member,
      ),
    });
    expect(timeCapabilitiesOf(view, withCard({ multi_month_display: "month" }))).toEqual({
      multi_month_display: "month",
    });
    expect(timeCapabilitiesOf(view, withCard({ year_scoped: true }))).toEqual({
      year_scoped: true,
    });
    // 未选中的指标不带进能力：卡只反映当前查询的指标集合。
    expect(timeCapabilitiesOf({ ...view, measures: [] }, withCard({ year_scoped: true }))).toEqual(
      {},
    );
  });

  test("柱图把结构占比归入辅助标注，折线图保留为独立系列", () => {
    const draft = beginAnalysisEdit(reportFixture, false);
    const bar = setSemanticChart(
      draft,
      {
        type: "bar",
        category: "dimension:organization_name",
        series: ["measure:active_employee_count", "measure:active_employee_share"],
      },
      semanticCatalog,
    );
    expect(bar.spec.presentation).toEqual({
      type: "bar",
      category: "dimension:organization_name",
      series: ["measure:active_employee_count"],
      annotations: ["measure:active_employee_share"],
    });
    const line = setSemanticChart(
      bar,
      {
        type: "line",
        series: ["measure:active_employee_count", "measure:active_employee_share"],
      },
      semanticCatalog,
    );
    expect(line.spec.presentation).toEqual({
      type: "line",
      series: ["measure:active_employee_count", "measure:active_employee_share"],
    });
  });

  test("删除结构占比分子后由剩余占比接管柱图主系列", () => {
    const draft = beginAnalysisEdit(reportFixture, false);
    const bar = setSemanticChart(
      draft,
      {
        type: "bar",
        category: "dimension:organization_name",
        series: ["measure:active_employee_count", "measure:active_employee_share"],
      },
      semanticCatalog,
    );
    const query = bar.spec.analysis.views[0];
    if (!query || "from" in query) throw new Error("fixture 必须包含语义查询");

    const shareOnly = setSemanticQueryView(
      bar,
      "structure",
      { ...query, measures: ["measure:active_employee_share"] },
      semanticCatalog,
    );

    expect(shareOnly.spec.presentation).toEqual({
      type: "bar",
      category: "dimension:organization_name",
      series: ["measure:active_employee_share"],
    });
  });
});

describe("空白新建分析", () => {
  test("空白种子是干净草稿：可编辑、未脏、尚不可执行", () => {
    const draft = beginAnalysisEdit(
      { name: "未命名分析", spec: blankAnalysisSpec("未命名分析") },
      false,
    );
    expect(isAnalysisEditDirty(draft)).toBe(false);
    expect(hasSpecChanges(draft)).toBe(false);
    expect(isAnalysisRunnable(draft)).toBe(false);
    expect(draft.spec.presentation).toEqual({ type: "table" });
  });

  test("加成员即可执行，删空即回落——护栏对空白起点与既有报告同一套", () => {
    const draft = beginAnalysisEdit({ name: "新分析", spec: blankAnalysisSpec("新分析") }, false);
    const view = draft.spec.analysis.views[0];
    if (!view || "from" in view) throw new Error("空白种子必须是语义查询视图");

    const withMeasure = setSemanticQueryView(
      draft,
      view.id,
      { ...view, measures: ["measure:active_employee_count"] },
      semanticCatalog,
    );
    expect(isAnalysisRunnable(withMeasure)).toBe(true);
    expect(isAnalysisEditDirty(withMeasure)).toBe(true);

    const emptied = setSemanticQueryView(
      withMeasure,
      view.id,
      removeSemanticQueryMember(
        { ...view, measures: ["measure:active_employee_count"] },
        "measure:active_employee_count",
        "measure",
      ),
      semanticCatalog,
    );
    expect(isAnalysisRunnable(emptied)).toBe(false);
  });

  test("派生分析恒可执行：其成员由 Agent 维护，不经查询栏增删", () => {
    expect(isAnalysisRunnable(beginAnalysisEdit(derivedReport, false))).toBe(true);
  });

  /**
   * 门禁自检：客户端的可执行判定必须与服务端契约同侧——
   * 空白规格确实过不了服务端校验（所以必须拦），补一个成员后确实能过（所以不能多拦）。
   */
  test("可执行判定与服务端规格契约对齐", () => {
    const blank = blankAnalysisSpec("未命名分析");
    expect(SEMANTIC_ANALYSIS_SPEC_INPUT.safeParse(blank).success).toBe(false);

    const view = blank.analysis.views[0];
    if (!view || "from" in view) throw new Error("空白种子必须是语义查询视图");
    const runnable = {
      ...blank,
      analysis: {
        ...blank.analysis,
        views: [{ ...view, measures: ["measure:active_employee_count"] }],
      },
    };
    expect(SEMANTIC_ANALYSIS_SPEC_INPUT.safeParse(runnable).success).toBe(true);
  });
});
