import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicCatalogDocument as CatalogPayload } from "@contracts/catalog_contract";
import type { ReplayPayload } from "@contracts/replay_contract";
import { AnalysisWorkbench } from "./analysis_workbench";
import {
  beginAnalysisEdit,
  blankAnalysisDefinition,
  setDraftTime,
  type AnalysisEditState,
} from "./analysis_draft";
import { ReportInspector } from "./report_inspector";
import type { RecordProjectionSource } from "../reports/use_record_projection";
import type { AnalysisEditSession } from "./use_analysis_edit_session";

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
      description: "在职人数。",
      query_capabilities: { dimension_ids: ["dimension:organization_name"] },
      time: { value_basis: "bucket_end" as const },
    },
  ],
  dimensions: [
    {
      id: "dimension:organization_name",
      kind: "dimension",
      title: "组织",
      description: "组织。",
      dimension_group: { id: "organization", title: "组织与部门" },
    },
  ],
};

const draftFixture = (): AnalysisEditState =>
  beginAnalysisEdit(
    {
      name: "未命名分析",
      analysis: blankAnalysisDefinition("未命名分析"),
      view: { type: "table" },
    },
    false,
  );

const resultTable = {
  columns: [
    {
      label: "在职人数",
      formatKey: "measure:active_employee_count",
      numeric: true,
      headerPath: [{ key: "metric:active_employee_count", label: "在职人数" }],
    },
  ],
  rows: [[120]],
};

const rawView = {
  id: "result",
  columns: ["measure:active_employee_count"],
  column_roles: { "measure:active_employee_count": "measure" as const },
  rows: [[120]],
  row_count: 1,
  query_notes: [],
};

const tableReplay: ReplayPayload = {
  at: "2026-07-21T00:00:00Z",
  caller: "demo@pa.local",
  analysis_id: "11111111-1111-4111-8111-111111111111",
  view_id: "22222222-2222-4222-8222-222222222222",
  analysis: blankAnalysisDefinition("未命名分析"),
  view: { type: "table" },
  view_preferences: {},
  record_projection_bindings: { views: [] },
  presentation: {
    type: "table",
    table: resultTable,
  },
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
};

/** 折线呈现才会渲染「系列」节；拿表格呈现去验节题重名等于没验。呈现类型取自草稿规格。 */
const lineDraft = (): AnalysisEditState => {
  const draft = draftFixture();
  return {
    ...draft,
    view: { type: "line" },
  };
};

function session(overrides: Partial<AnalysisEditSession>): AnalysisEditSession {
  return {
    draft: draftFixture(),
    setDraft: () => {},
    dirty: false,
    activeReplay: null,
    showingSavedReplay: false,
    resultPending: false,
    presentationNotes: [],
    saving: false,
    previewing: false,
    canSave: false,
    canSaveAs: false,
    leaveOpen: false,
    target: { kind: "create" },
    runPreview: async () => false,
    discard: () => {},
    save: async () => false,
    saveAs: async () => false,
    resolveLeave: () => {},
    ...overrides,
  };
}

const render = (
  overrides: Partial<AnalysisEditSession>,
  error: string | null = null,
  recordSource: RecordProjectionSource = { kind: "none" },
) =>
  renderToStaticMarkup(
    <AnalysisWorkbench
      catalog={catalog}
      crumb={{ href: "#/reports", label: "我的报告" }}
      error={error}
      recordSource={recordSource}
      saveLabel="存为报告"
      session={session(overrides)}
      title="未命名分析"
    />,
  );

test("四个内容态时间栏都在场，且住在结果区内", () => {
  const states: [string, string][] = [
    ["结果", render({ activeReplay: tableReplay })],
    ["预览等待", render({ previewing: true })],
    ["空态", render({})],
    ["错误", render({}, "载入失败")],
  ];
  for (const [name, markup] of states) {
    expect(markup, name).toContain('aria-label="观察时间"');
    expect(markup.indexOf('data-slot="chart-stage-result"'), name).toBeLessThan(
      markup.indexOf('aria-label="观察时间"'),
    );
  }
});

test("草稿未落地（载入中）不渲染时间栏——没有可编辑的时间意图就不摆控件", () => {
  const markup = render({ draft: null });
  expect(markup).not.toContain('aria-label="观察时间"');
  expect(markup).toContain('data-slot="chart-stage-footer"');
});

test("题名副行只显示观察窗口", () => {
  const timed = setDraftTime(
    draftFixture(),
    {
      window: { kind: "range", from: "2026-01", to: "2026-06", grain: "month" },
      comparison: { kind: "previous_year" },
    },
    catalog,
  );
  const markup = render({ draft: timed });
  const heading = markup.slice(
    markup.indexOf('data-slot="chart-stage-heading"'),
    markup.indexOf('data-slot="chart-stage-result"'),
  );
  expect(heading).toContain("2026年1月—2026年6月");
  expect(markup).toContain("按月");
  expect(heading).not.toContain("按月");
  expect(heading).not.toContain("对比");
});

test("结果加载中不显示空态提示", () => {
  expect(render({ resultPending: true })).not.toContain("还没有结果");
  expect(render({ resultPending: true })).toContain('aria-label="正在载入"');
  expect(render({})).toContain("还没有结果");
});

test("配置栏在草稿落地前就已在场：栏是壳的一列，不是结果的附属物", () => {
  const markup = renderToStaticMarkup(
    <ReportInspector catalog={catalog} onCollapse={() => {}} session={session({ draft: null })} />,
  );
  expect(markup).toContain('data-testid="report-inspector"');
  expect(markup).toContain(">配置</span>");
  const seeded = renderToStaticMarkup(
    <ReportInspector catalog={catalog} onCollapse={() => {}} session={session({})} />,
  );
  expect(markup).toContain('aria-label="正在加载"');
  expect(seeded).not.toContain('aria-label="正在加载"');
});

test("同一栏里没有两个同名节题", () => {
  const markup = renderToStaticMarkup(
    <ReportInspector
      catalog={catalog}
      onCollapse={() => {}}
      session={session({ activeReplay: tableReplay, draft: lineDraft() })}
    />,
  );
  const titles = [...markup.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((match) => match[1]);
  expect(titles).toContain("指标");
  expect(titles).toContain("系列");
  expect([...new Set(titles)]).toHaveLength(titles.length);
});

/** 带明细绑定与 revision 的已保存重放：明细能力的最小成立条件。 */
const projectableReplay = (): ReplayPayload => ({
  ...tableReplay,
  revision: 3,
  record_projection_bindings: {
    views: [
      {
        result_view_id: "result",
        metrics: {
          "measure:active_employee_count": {
            metric_id: "metric:active_employee_count",
            title: "在职人数",
          },
        },
        dimensions: {},
      },
    ],
  },
});

test("明细能力由来源派生：有来源的保存重放态可点开数字，来源 none 与草稿态都不可", () => {
  const saved: Partial<AnalysisEditSession> = {
    activeReplay: projectableReplay(),
    showingSavedReplay: true,
  };
  const boardSource: RecordProjectionSource = {
    kind: "board",
    boardId: "board-1",
    reportId: "report-1",
  };
  expect(render(saved, null, boardSource)).toContain('aria-label="查看明细：在职人数 120"');
  expect(render(saved, null, { kind: "none" })).not.toContain("查看明细");
  expect(
    render({ activeReplay: projectableReplay(), showingSavedReplay: false }, null, boardSource),
  ).not.toContain("查看明细");
});

test("配置栏顶带有名称，图型顺序先图后表且表格在第四槽", () => {
  const markup = renderToStaticMarkup(
    <ReportInspector
      catalog={catalog}
      onCollapse={() => {}}
      session={session({ activeReplay: tableReplay })}
    />,
  );
  expect(markup).toContain(">配置</span>");
  const labels = ["折线图", "柱状图", "指标卡", "表格", "饼图"];
  const positions = labels.map((label) => markup.indexOf(`aria-label="${label}"`));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((left, right) => left - right));
});
