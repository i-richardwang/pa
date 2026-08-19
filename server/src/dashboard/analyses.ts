/** 控制台分析资源：创建 Analysis 会执行 Run；创建 View 只编译和持久化，不执行查询。 */
import type { Hono } from "hono";
import type { DashboardDependencies, DashboardEnv } from "./types.js";
import {
  CREATE_ANALYSIS_VIEW_BODY,
  PREVIEW_ANALYSIS_BODY,
} from "../contracts/analysis_contract.js";
import { projectReplayPayload } from "../application/replay_projection.js";

export function registerAnalysisRoutes(
  dashboard: Hono<DashboardEnv>,
  deps: Pick<DashboardDependencies, "analyses" | "presentation">,
): void {
  const { analyses, presentation } = deps;

  dashboard.post("/api/analyses", async (c) => {
    const body = PREVIEW_ANALYSIS_BODY.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "分析请求无效" }, 400);
    const executed = await analyses.preview(
      c.get("principal"),
      body.data.analysis,
      body.data.view,
      body.data.view_preferences,
    );
    return c.json(
      projectReplayPayload(presentation, executed, {
        at: new Date().toISOString(),
        caller: c.get("me").email,
      }),
    );
  });

  dashboard.post("/api/analysis_views", async (c) => {
    const body = CREATE_ANALYSIS_VIEW_BODY.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "分析视图请求无效" }, 400);
    const materialized = await analyses.materializeView(
      c.get("principal"),
      body.data.analysis_id,
      body.data.view,
      body.data.view_preferences,
    );
    return c.json({
      analysis_id: materialized.analysis.id,
      view_id: materialized.view.id,
      view: materialized.view.intent,
      view_preferences: materialized.view.preferences,
      render_decl: materialized.render_decl,
      record_projection_bindings: materialized.record_projection_bindings,
    });
  });

  dashboard.get("/api/analysis_views/:id/replay", async (c) => {
    const executed = await analyses.replay(c.get("principal"), c.req.param("id"));
    return c.json(
      projectReplayPayload(presentation, executed, {
        at: new Date().toISOString(),
        caller: c.get("me").email,
      }),
    );
  });
}
