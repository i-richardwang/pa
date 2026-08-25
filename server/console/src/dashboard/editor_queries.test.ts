import { expect, test } from "bun:test";
import type { ReplayPayload } from "@contracts/replay_contract";
import type { ReportDetail } from "@contracts/report_contract";
import { reportKeys, revisionsConsistent, runDraft } from "./editor_queries";

test("重放键位不含 revision：含了它就得等详情落地才发得出去，白串一跳", () => {
  expect(reportKeys.detail("r1")).toEqual(["report", "r1"]);
  expect(reportKeys.replay("r1")).toEqual(["report_replay", "r1"]);
  expect(reportKeys.revisions("r1")).toEqual(["report_revisions", "r1"]);
  // 键位只认 id：同一份报告的重放在任何版本下都是同一个键，保存后的换新由 resetQueries 办
  expect(reportKeys.replay("r1")).toHaveLength(2);
  expect(reportKeys.replay("r1")).not.toEqual(reportKeys.replay("r2"));
});

const report = (revision: number) => ({ revision }) as ReportDetail;
const replay = (revision: number | undefined) => ({ revision }) as ReplayPayload;

test("重放版本与报告详情一致时对账通过", () => {
  expect(revisionsConsistent(report(4), replay(4))).toBe(true);
});

test("两次取数跨版本时对账失败，触发拉回最新详情", () => {
  expect(revisionsConsistent(report(4), replay(5))).toBe(false);
});

test("临时预览无 revision，不参与报告版本对账", () => {
  expect(revisionsConsistent(report(4), replay(undefined))).toBe(true);
});

test("预览结果按会话键位存放：换会话即换键，同会话两次预览共用一键", () => {
  expect(reportKeys.draftPreview("report:r1")).toEqual(["draft_preview", "report:r1"]);
  expect(reportKeys.draftPreview("report:r1")).not.toEqual(reportKeys.draftPreview("analysis:a1"));
});

/** 铸新 View 的身份换新有两处（顶层与 payload），必须同改。 */
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

test("沿用基线时只铸新 View：身份两处同时换新，旧的一处都不留", async () => {
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

test("沿用基线时结果行不重取，呈现按新声明重编，上一版的降级说明不跟过来", async () => {
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

test("只改呈现也重算降级说明：结果撑不起新声明时，本地重编同样给出说明", async () => {
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
        note: "查询已成功，但当前结果形态不支持声明的呈现，本次已按表格呈现。",
      },
    ]);
  } finally {
    stub.restore();
  }
});

test("规格已变时走创建 Run 的那条路，不铸 View", async () => {
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
