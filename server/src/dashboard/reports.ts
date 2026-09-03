import type { Hono } from "hono";
import type { DashboardDependencies, DashboardEnv } from "./types.js";
import {
  CREATE_REPORT_BODY,
  type ReportDetail,
  type ReportRevisionsPayload,
  type ReportRow,
  UPDATE_REPORT_BODY,
} from "../contracts/report_contract.js";
import { RECORD_PROJECTION_REQUEST_BODY } from "../contracts/record_projection_contract.js";
import type { ReportDocument } from "../application/report_service.js";
import { projectReplayPayload } from "../application/replay_projection.js";
import { InvalidRequestError } from "../application/errors.js";

export function registerReportRoutes(
  dashboard: Hono<DashboardEnv>,
  deps: Pick<DashboardDependencies, "reportService" | "presentation" | "records">,
): void {
  const { reportService, presentation, records } = deps;

  const reportRow = (row: ReportDocument): ReportRow => {
    return {
      ...reportService.summary(row),
      render_shape: row.render_shape,
    };
  };

  const reportDetail = (row: ReportDocument): ReportDetail => {
    return {
      ...reportRow(row),
      owner: row.owner,
      analysis: row.definition,
      view: row.intent,
      view_preferences: row.view_preferences,
    };
  };

  dashboard.get("/api/reports", async (c) => {
    const scope = c.req.query("archived") === "1" ? "archived" : "active";
    const rows = (
      await reportService.listOwned(c.get("principal"), c.req.query("query"), scope)
    ).map(reportRow);
    return c.json({ rows, total: rows.length });
  });

  dashboard.get("/api/reports/:id", async (c) => {
    return c.json(
      reportDetail(await reportService.resolveOwned(c.get("principal"), c.req.param("id"))),
    );
  });

  dashboard.get("/api/reports/:id/revisions", async (c) => {
    const revisions = await reportService.listRevisions(c.get("principal"), c.req.param("id"));
    const payload: ReportRevisionsPayload = {
      rows: revisions.map((revision) => ({
        revision: revision.revision,
        name: revision.name,
        saved_by: revision.saved_by,
        saved_at: revision.saved_at,
      })),
    };
    return c.json(payload);
  });

  dashboard.post("/api/reports/:id/records", async (c) => {
    const parsed = RECORD_PROJECTION_REQUEST_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new InvalidRequestError("明细请求无效，请刷新报告后重试");
    return c.json(await records.runReport(c.get("principal"), c.req.param("id"), parsed.data));
  });

  dashboard.post("/api/reports", async (c) => {
    const parsed = CREATE_REPORT_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new InvalidRequestError("缺少 view_id 或 name");
    const body = parsed.data;
    const row = await reportService.save({
      principal: c.get("principal"),
      viewId: body.view_id,
      name: body.name,
    });
    return c.json(reportRow(row), 201);
  });

  dashboard.patch("/api/reports/:id", async (c) => {
    const parsed = UPDATE_REPORT_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new InvalidRequestError(
        `报告修改无效：${parsed.error.issues.map((issue) => issue.message).join("；")}`,
      );
    }
    const row = await reportService.update(
      c.get("principal"),
      c.req.param("id"),
      parsed.data.action,
      parsed.data.if_revision,
    );
    return c.json(reportDetail(row));
  });

  dashboard.get("/api/reports/:id/replay", async (c) => {
    const { report: row, executed } = await reportService.runOwned(
      c.get("principal"),
      c.req.param("id"),
    );
    return c.json(
      projectReplayPayload(presentation, executed, {
        at: row.updated_at,
        caller: row.owner,
        revision: row.revision,
      }),
    );
  });
}
