/**
 * 表格布局面板与服务端同一条默认规则：未声明列轴时，面板印出的行列归属就是编译器会生成的布局。
 * headless 直渲（renderToStaticMarkup），浮层内容不在断言范围。
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultTableLayout } from "@chart-spec";
import type { PublicCatalogDocument as CatalogPayload } from "@contracts/catalog_contract";
import type { ReplayPayload } from "@contracts/replay_contract";
import type { AnalysisDefinition } from "@semantic-analysis";
import { compileTimeIntent } from "@time";
import { beginAnalysisEdit } from "./analysis_draft";
import { ChartOptionsPanel } from "./chart_settings_panel";

const MEASURE = "measure:active_employee_count";
const MONTHLY_TIME = { window: { kind: "range" as const, from: "2026-01", to: "2026-06" } };

const catalog: CatalogPayload = {
  access_scope: { id: "organization", title: "组织" },
  observation_scopes: ["统计口径"],
  data_as_of: "2026-07",
  time_context: [],
  metric_domains: [],
  measures: [{ id: MEASURE, kind: "measure", title: "在职人数", description: "在职人数。" }],
  dimensions: [],
};

const analysis: AnalysisDefinition = {
  title: "月度在职",
  views: [{ id: "result", measures: [MEASURE], time: MONTHLY_TIME }],
};

const rawView = {
  id: "result",
  columns: ["month", MEASURE],
  column_roles: { month: "time" as const, [MEASURE]: "measure" as const },
  rows: [["2026-01", 120]],
  row_count: 1,
  query_notes: [],
};

const replay: ReplayPayload = {
  at: "2026-07-21T00:00:00Z",
  caller: "demo@pa.local",
  analysis_id: "11111111-1111-4111-8111-111111111111",
  view_id: "22222222-2222-4222-8222-222222222222",
  analysis,
  view: { type: "table" },
  view_preferences: {},
  record_projection_bindings: { views: [] },
  presentation: {
    type: "table",
    table_layout: { state: "applied", leafColumns: 1 },
    table: {
      columns: [
        {
          label: "在职人数",
          formatKey: MEASURE,
          numeric: true,
          headerPath: [{ key: "metric:active_employee_count", label: "在职人数" }],
        },
      ],
      rows: [[120]],
    },
  },
  payload: {
    view: rawView,
    observation_scopes: ["统计口径"],
    data_as_of: "2026-07",
    time_context: [],
  },
  render_bundle: {
    view: rawView,
    decl: { type: "table", y: [], tableLayout: { rows: [], columns: [] } },
  },
};

const textOf = (html: string) => html.replace(/<[^>]+>/g, "|");

test("纯月度无分类结果：面板默认行列与服务端 defaultTableLayout 一致（月份在行、年份在列）", () => {
  const server = defaultTableLayout({
    measures: [MEASURE],
    dimensions: [],
    time: compileTimeIntent(MONTHLY_TIME),
  });
  expect(server).toEqual({
    rows: [{ kind: "time", level: "month" }],
    columns: [{ kind: "metrics" }, { kind: "time", level: "year" }],
  });

  const draft = beginAnalysisEdit({ name: "月度在职", analysis, view: { type: "table" } }, true);
  const html = textOf(
    renderToStaticMarkup(
      <ChartOptionsPanel catalog={catalog} draft={draft} onChange={() => {}} replay={replay} />,
    ),
  );
  expect(html).toContain("|月份|");
  expect(html).toContain("|指标 · 年份|");
});
