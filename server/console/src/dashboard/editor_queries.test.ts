import { expect, test } from "bun:test";
import type { ReplayPayload } from "@contracts/replay_contract";
import type { ReportDetail } from "@contracts/report_contract";
import { reportKeys, revisionsConsistent, runDraft } from "./editor_queries";

test("重放的查询键只含报告 id，不含 revision", () => {
  expect(reportKeys.detail("r1")).toEqual(["report", "r1"]);
  expect(reportKeys.replay("r1")).toEqual(["report_replay", "r1"]);
  expect(reportKeys.revisions("r1")).toEqual(["report_revisions", "r1"]);
  // 同一份报告各版本共用一个键，保存后由 useUpdateReport 的 resetQueries 刷新
  expect(reportKeys.replay("r1")).toHaveLength(2);
  expect(reportKeys.replay("r1")).not.toEqual(reportKeys.replay("r2"));
});

const report = (revision: number) => ({ revision }) as ReportDetail;
const replay = (revision: number | undefined) => ({ revision }) as ReplayPayload;

test("重放与报告详情 revision 一致时校验通过", () => {
  expect(revisionsConsistent(report(4), replay(4))).toBe(true);
});

test("重放与报告详情 revision 不一致时校验失败", () => {
  expect(revisionsConsistent(report(4), replay(5))).toBe(false);
});

test("临时预览没有 revision，校验视为通过", () => {
  expect(revisionsConsistent(report(4), replay(undefined))).toBe(true);
});

test("预览结果的查询键按会话区分", () => {
  expect(reportKeys.draftPreview("report:r1")).toEqual(["draft_preview", "report:r1"]);
  expect(reportKeys.draftPreview("report:r1")).not.toEqual(reportKeys.draftPreview("analysis:a1"));
});

/** 新建 View 时顶层和 payload 两处 id 都要更新。 */
const BASE_IDS = { analysis: "a0000000-0000-4000-8000-000000000000", view: "v0000000" };
const NEXT_IDS = {
  analysis: "11111111-1111-4111-8111-111111111111",
  view: "22222222-2222-4222-8222-222222222222",
};

const VIEW_BLOCK = {
  id: "result",
  columns: ["month", "active_employee_count"],
  column_roles: { month: "time", active_employee_count: "measure" },
  rows: [["2026-01", 100]],
  row_count: 1,
  query_notes: [],
} as unknown as ReplayPayload["render_bundle"]["view"];

const TABLE_DECL = { type: "table" };

const baseReplay = () =>
  ({
    at: "2026-08-01T00:00:00.000Z",
    caller: "console",
    analysis_id: BASE_IDS.analysis,
    view_id: BASE_IDS.view,
    view: { type: "table" },
    view_preferences: {},
    record_projection_bindings: { views: [] },
    payload: { analysis_id: BASE_IDS.analysis, view_id: BASE_IDS.view, views: [] },
    render_bundle: { view: VIEW_BLOCK, decl: TABLE_DECL },
    presentation: { type: "table" },
    presentation_notes: [
      { result_view_id: "result", kind: "empty_result", note: "上一版的降级说明" },
    ],
  }) as unknown as ReplayPayload;

function stubMaterialize(renderDecl: unknown = TABLE_DECL): {
  calls: { path: string; body: unknown }[];
  restore: () => void;
} {
  const calls: { path: string; body: unknown }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (path: string, init?: RequestInit) => {
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path === "/dashboard/api/analyses") return new Response("{}", { status: 503 });
    return new Response(
      JSON.stringify({
        analysis_id: NEXT_IDS.analysis,
        view_id: NEXT_IDS.view,
        view: { type: "table" },
        view_preferences: {},
        render_decl: renderDecl,
        record_projection_bindings: { views: [] },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  function restore() {
    globalThis.fetch = original;
  }
  return { calls, restore };
}

test("沿用基线时只新建 View，顶层和 payload 的 id 都换成新的", async () => {
  const stub = stubMaterialize();
  try {
    const base = baseReplay();
    const next = await runDraft({
      analysis: base.analysis,
      view: base.view,
      view_preferences: base.view_preferences,
      base,
    });
    expect(stub.calls.map((call) => call.path)).toEqual(["/dashboard/api/analysis_views"]);
    expect(next.analysis_id).toBe(NEXT_IDS.analysis);
    expect(next.view_id).toBe(NEXT_IDS.view);
    expect(next.payload.analysis_id).toBe(NEXT_IDS.analysis);
    expect(next.payload.view_id).toBe(NEXT_IDS.view);
    expect(JSON.stringify(next)).not.toContain(BASE_IDS.view);
  } finally {
    stub.restore();
  }
});

test("沿用基线时不重新取结果行，呈现按新声明重新编译，不保留上一版的降级说明", async () => {
  const stub = stubMaterialize();
  try {
    const base = baseReplay();
    const next = await runDraft({
      analysis: base.analysis,
      view: base.view,
      view_preferences: base.view_preferences,
      base,
    });
    expect(stub.calls[0]?.body).toEqual({
      analysis_id: BASE_IDS.analysis,
      view: { type: "table" },
      view_preferences: {},
    });
    expect(next.render_bundle.view).toBe(base.render_bundle.view);
    expect(next.presentation_notes).toBeUndefined();
    expect(next.presentation.type).toBe("table");
  } finally {
    stub.restore();
  }
});

test("只改呈现且结果不支持新声明时，在本地生成降级说明", async () => {
  const stub = stubMaterialize({ type: "line", y: ["active_employee_count"] });
  try {
    const base = baseReplay();
    const next = await runDraft({
      analysis: base.analysis,
      view: { type: "line" },
      view_preferences: {},
      base,
    });
    expect(next.presentation.type).toBe("table");
    expect(next.presentation_notes).toEqual([
      {
        result_view_id: "result",
        kind: "unsupported_shape",
        note: "查询成功，但当前结果无法用设定的图表显示，已改用表格显示。",
      },
    ]);
  } finally {
    stub.restore();
  }
});

test("规格已变时创建新 Run，不单独新建 View", async () => {
  const stub = stubMaterialize();
  try {
    await expect(
      runDraft({
        analysis: baseReplay().analysis,
        view: { type: "table" },
        view_preferences: {},
        base: null,
      }),
    ).rejects.toThrow();
    expect(stub.calls.map((call) => call.path)).toEqual(["/dashboard/api/analyses"]);
  } finally {
    stub.restore();
  }
});
