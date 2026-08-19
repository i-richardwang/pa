import type { Context, Hono } from "hono";
import { RecordProjectionRequestError } from "../application/record_projection_service.js";
import { AuthzError } from "../engine/cube_security.js";
import type { DashboardDependencies, DashboardEnv } from "./types.js";
import {
  CREATE_REPORT_BODY,
  type ReportDetail,
  type ReportRevisionsPayload,
  type ReportRow,
  UPDATE_REPORT_BODY,
} from "../contracts/report_contract.js";
import { RECORD_PROJECTION_REQUEST_BODY } from "../contracts/record_projection_contract.js";
import { AnalysisNotFoundError } from "../ports/analysis_repository.js";
import { ReportConflictError, ReportNotFoundError } from "../ports/report_repository.js";
import type { ReportDocument } from "../application/report_service.js";

function executionError(c: Context<DashboardEnv>, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof AnalysisNotFoundError || error instanceof ReportNotFoundError) {
    return c.json({ error: message }, 404);
  }
  if (error instanceof ReportConflictError) return c.json({ error: message }, 409);
  if (error instanceof AuthzError) return c.json({ error: message }, 403);
  console.error("[pa] dashboard 执行失败:", error);
  return c.json({ error: message }, 502);
}

export function registerReportRoutes(
  dashboard: Hono<DashboardEnv>,
  deps: Pick<DashboardDependencies, "reportService" | "presentation" | "records">,
): void {
  const { reportService, presentation, records } = deps;

  const reportRow = (row: ReportDocument): ReportRow => {
    if (!reportService) throw new Error("报告服务未启用");
    return {
      ...reportService.summary(row),
      render_shape: row.render_shape,
    };
  };

  const reportDetail = (row: ReportDocument): ReportDetail => {
    return { ...reportRow(row), owner: row.owner, spec: row.spec };
  };

  dashboard.get("/api/reports", async (c) => {
    if (!reportService) return c.json({ error: "未启用我的报告" }, 501);
    try {
      const rows = (await reportService.listOwned(c.get("me").email, c.req.query("query"))).map(
        reportRow,
      );
      return c.json({ rows, total: rows.length });
    } catch (error) {
      return executionError(c, error);
    }
  });

  dashboard.get("/api/reports/:id", async (c) => {
    if (!reportService) return c.json({ error: "未启用我的报告" }, 501);
    try {
      return c.json(
        reportDetail(await reportService.resolveOwned(c.req.param("id"), c.get("me").email)),
      );
    } catch (error) {
      return executionError(c, error);
    }
  });

  dashboard.get("/api/reports/:id/revisions", async (c) => {
    if (!reportService) return c.json({ error: "未启用我的报告" }, 501);
    try {
      const revisions = await reportService.listRevisions(c.req.param("id"), c.get("me").email);
      const payload: ReportRevisionsPayload = {
        rows: revisions.map((revision) => ({
          revision: revision.revision,
          name: revision.name,
          saved_by: revision.saved_by,
          saved_at: revision.saved_at,
        })),
      };
      return c.json(payload);
    } catch (error) {
      return executionError(c, error);
    }
  });

  dashboard.post("/api/reports/:id/records", async (c) => {
    if (!records) return c.json({ error: "未启用人员明细" }, 501);
    const parsed = RECORD_PROJECTION_REQUEST_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "明细请求无效，请刷新报告后重试" }, 400);
    try {
      return c.json(await records.runReport(c.get("principal"), c.req.param("id"), parsed.data));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ReportConflictError) return c.json({ error: message }, 409);
      if (error instanceof ReportNotFoundError) return c.json({ error: message }, 404);
      if (error instanceof AuthzError) return c.json({ error: message }, 403);
      if (error instanceof RecordProjectionRequestError) return c.json({ error: message }, 400);
      return c.json({ error: "人员明细暂时无法加载，请稍后重试" }, 500);
    }
  });

  dashboard.post("/api/reports", async (c) => {
    if (!reportService) return c.json({ error: "未启用我的报告" }, 501);
    const parsed = CREATE_REPORT_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "缺少 analysis_id 或 name" }, 400);
    const body = parsed.data;
    try {
      const row = await reportService.save({
        principal: c.get("principal"),
        analysisId: body.analysis_id,
        name: body.name,
      });
      return c.json(reportRow(row), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  dashboard.patch("/api/reports/:id", async (c) => {
    if (!reportService) return c.json({ error: "未启用我的报告" }, 501);
    const parsed = UPDATE_REPORT_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        {
          error: `报告修改无效：${parsed.error.issues.map((issue) => issue.message).join("；")}`,
        },
        400,
      );
    }
    try {
      const row = await reportService.update(
        c.get("principal"),
        c.req.param("id"),
        parsed.data.action,
        parsed.data.if_revision,
      );
      return c.json(reportDetail(row));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ReportConflictError) return c.json({ error: message }, 409);
      if (error instanceof ReportNotFoundError) return c.json({ error: message }, 404);
      return c.json({ error: message }, 400);
    }
  });

  dashboard.get("/api/reports/:id/replay", async (c) => {
    if (!reportService) return c.json({ error: "未启用报告重放" }, 501);
    try {
      const {
        report: row,
        executed,
        presentation: compiledPresentation,
        recordProjectionBindings,
      } = await reportService.runOwned(c.get("principal"), c.req.param("id"));
      const renderedPresentation = presentation?.compile(executed);
      const presentationNotes =
        presentation?.runtimeFallbacks(executed, compiledPresentation) ?? [];
      return c.json({
        at: row.updated_at,
        caller: row.owner,
        analysis_id: executed.analysis_id,
        revision: row.revision,
        spec: row.spec,
        record_projection_bindings: recordProjectionBindings,
        payload: executed.payload,
        ...(renderedPresentation ? { presentation: renderedPresentation } : {}),
        ...(presentationNotes.length ? { presentation_notes: presentationNotes } : {}),
      });
    } catch (error) {
      return executionError(c, error);
    }
  });
}
