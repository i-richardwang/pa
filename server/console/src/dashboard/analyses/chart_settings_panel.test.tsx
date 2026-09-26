import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { detectRoles, resolveTableLayout } from "@shape";
import type { PublicCatalogDocument as CatalogPayload } from "@contracts/catalog_contract";
import type { ReplayPayload } from "@contracts/replay_contract";
import type { AnalysisDefinition } from "@semantic-analysis";
import { beginAnalysisEdit } from "./analysis_draft";
import { ChartOptionsPanel } from "./chart_settings_panel";

const MEASURE = "measure:active_employee_count";
const MONTHLY_TIME = {
  window: { kind: "range" as const, from: "2026-01", to: "2026-06", grain: "month" as const },
};

const catalog: CatalogPayload = {
  access_scope: { id: "organization", title: "组织" },
  observation_scopes: ["统计口径"],
  data_as_of: "2026-07",
  time_context: [],
  metric_domains: [],
  measures: [
    {
      id: MEASURE,
      kind: "measure",
      title: "在职人数",
      description: "在职人数。",
      query_capabilities: { dimension_ids: [] },
      time: { value_basis: "bucket_end" as const },
    },
  ],
  dimensions: [],
};

const analysis: AnalysisDefinition = {
  title: "月度在职",
  query: { measures: [MEASURE], time: MONTHLY_TIME },
};

const rawView = {
  id: "result",
  columns: ["year", "month", MEASURE],
  column_roles: { year: "time" as const, month: "time" as const, [MEASURE]: "measure" as const },
  rows: [1, 2, 3, 4, 5, 6].map((month) => [2026, month, 120 + month]),
  row_count: 6,
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
    decl: { type: "table" },
  },
};

const textOf = (html: string) => html.replace(/<[^>]+>/g, "|");

test("只有月度时间、没有分类的结果，面板行列与编译器一致：月份在行，年份在列", () => {
  const server = resolveTableLayout(rawView, detectRoles(rawView));
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
