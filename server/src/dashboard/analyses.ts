/** 控制台分析资源：创建 Analysis 会执行 Run；创建 View 只编译和持久化，不执行查询。 */
import type { Hono } from "hono";
import { AuthzError } from "../engine/cube_security.js";
import type { DashboardDependencies, DashboardEnv } from "./types.js";
import {
  CREATE_ANALYSIS_VIEW_BODY,
  PREVIEW_ANALYSIS_BODY,
} from "../contracts/analysis_contract.js";
import type { PresentationSpec } from "../presentation_core/presentation_spec.js";
import { SemanticQueryIncompatibleError } from "../engine/semantic_analysis_compiler.js";
import { AnalysisNotFoundError, AnalysisViewNotFoundError } from "../ports/analysis_repository.js";

export function registerAnalysisRoutes(
  dashboard: Hono<DashboardEnv>,
  deps: Pick<DashboardDependencies, "analyses" | "presentation" | "semanticPlanning">,
): void {
  const { analyses, presentation, semanticPlanning } = deps;

  const replayPayload = (
    executed: Awaited<ReturnType<NonNullable<typeof analyses>["replay"]>>,
    caller: string,
    declaredPresentation: PresentationSpec = executed.presentation,
  ) => {
    const compiledPresentation = presentation?.compile(executed);
    const presentationNotes = presentation?.runtimeFallbacks(executed, declaredPresentation) ?? [];
    return {
      at: new Date().toISOString(),
      caller,
      analysis_id: executed.analysis_id,
      view_id: executed.view_id,
      analysis: executed.definition,
      view: executed.intent,
      view_preferences: executed.preferences,
      payload: executed.payload,
      render_bundle: { view: executed.fullRowViewBlock, decl: executed.decl },
      ...(compiledPresentation ? { presentation: compiledPresentation } : {}),
      ...(presentationNotes.length ? { presentation_notes: presentationNotes } : {}),
    };
  };

  dashboard.post("/api/analyses", async (c) => {
    if (!analyses || !semanticPlanning) return c.json({ error: "未启用分析执行" }, 501);
    const body = PREVIEW_ANALYSIS_BODY.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "分析请求无效" }, 400);
    try {
      const compiled = await semanticPlanning.compile(
        c.get("principal"),
        body.data.analysis,
        body.data.view,
        body.data.view_preferences,
      );
      const executed = await analyses.preview(
        c.get("principal"),
        body.data.analysis,
        body.data.view,
        body.data.view_preferences,
        compiled,
      );
      return c.json(replayPayload(executed, c.get("me").email, compiled.presentation));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof AuthzError) return c.json({ error: message }, 403);
      if (error instanceof SemanticQueryIncompatibleError) {
        return c.json({ error: message, routes: error.routes }, 400);
      }
      return c.json({ error: message }, 400);
    }
  });

  dashboard.post("/api/analysis_views", async (c) => {
    if (!analyses) return c.json({ error: "未启用分析视图" }, 501);
    const body = CREATE_ANALYSIS_VIEW_BODY.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "分析视图请求无效" }, 400);
    try {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof AnalysisNotFoundError) return c.json({ error: message }, 404);
      if (error instanceof AuthzError) return c.json({ error: message }, 403);
      if (error instanceof SemanticQueryIncompatibleError) {
        return c.json({ error: message, routes: error.routes }, 400);
      }
      return c.json({ error: message }, 400);
    }
  });

  dashboard.get("/api/analysis_views/:id/replay", async (c) => {
    if (!analyses) return c.json({ error: "未启用分析重放" }, 501);
    try {
      const executed = await analyses.replay(c.get("principal"), c.req.param("id"));
      return c.json(replayPayload(executed, c.get("me").email));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof AnalysisViewNotFoundError) return c.json({ error: message }, 404);
      if (error instanceof AuthzError) return c.json({ error: message }, 403);
      console.error("[pa] dashboard 分析重放失败:", error);
      return c.json({ error: message }, 502);
    }
  });
}
