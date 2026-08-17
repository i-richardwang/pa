/**
 * /dashboard/api/analyses：控制台编辑器的即席分析——按语义规格现编译现执行，
 * 产出不可变 Analysis 与报告重放同构载荷供画布回显。它不绑定报告版本，
 * 与 reports 的「已存报告重放」是两条独立资源。
 */
import type { Hono } from "hono";
import { AuthzError } from "../engine/cube_security.js";
import type { DashboardDependencies, DashboardEnv } from "./types.js";
import { PREVIEW_REPORT_BODY } from "../contracts/dashboard_contract.js";
import type { PresentationSpec } from "../presentation_core/presentation_spec.js";
import { SemanticQueryIncompatibleError } from "../engine/semantic_analysis_compiler.js";
import { AnalysisNotFoundError } from "../ports/analysis_repository.js";

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
      spec: executed.spec,
      payload: executed.payload,
      ...(compiledPresentation ? { presentation: compiledPresentation } : {}),
      ...(presentationNotes.length ? { presentation_notes: presentationNotes } : {}),
    };
  };

  dashboard.post("/api/analyses", async (c) => {
    if (!analyses) return c.json({ error: "未启用分析执行" }, 501);
    const body = PREVIEW_REPORT_BODY.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "分析请求无效" }, 400);
    try {
      if (!semanticPlanning) return c.json({ error: "未启用语义查询规划" }, 501);
      const compiled = await semanticPlanning.compile(c.get("principal"), body.data.spec);
      // 预览直接消费编译产物（语义规格 + compiled，不重复编译），并落不可变 Analysis 供保存时换指针。
      const executed = await analyses.preview(c.get("principal"), body.data.spec, compiled);
      return c.json({
        ...replayPayload(executed, c.get("me").email, compiled.presentation),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof AuthzError) return c.json({ error: message }, 403);
      if (error instanceof SemanticQueryIncompatibleError) {
        return c.json({ error: message, routes: error.routes }, 400);
      }
      return c.json({ error: message }, 400);
    }
  });

  dashboard.get("/api/analyses/:id/replay", async (c) => {
    if (!analyses) return c.json({ error: "未启用分析重放" }, 501);
    try {
      const executed = await analyses.replay(c.get("principal"), c.req.param("id"));
      return c.json(replayPayload(executed, c.get("me").email));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof AnalysisNotFoundError) return c.json({ error: message }, 404);
      if (error instanceof AuthzError) return c.json({ error: message }, 403);
      console.error("[pa] dashboard 分析重放失败:", error);
      return c.json({ error: message }, 502);
    }
  });
}
