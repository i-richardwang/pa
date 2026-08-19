import type { Context, Hono } from "hono";
import {
  BoardForbiddenError,
  BoardNotFoundError,
  BoardRequestError,
  BoardRevisionConflictError,
} from "../application/board_service.js";
import { RecordProjectionRequestError } from "../application/record_projection_service.js";
import { AuthzError } from "../engine/cube_security.js";
import { ReportConflictError, ReportNotFoundError } from "../ports/report_repository.js";
import {
  ADD_BOARD_ITEM_BODY,
  CREATE_BOARD_BODY,
  UPDATE_BOARD_BODY,
} from "../contracts/board_contract.js";
import { RECORD_PROJECTION_REQUEST_BODY } from "../contracts/record_projection_contract.js";
import { TIME_INTENT_INPUT, type TimeIntent } from "../semantic_core/time_contract.js";
import type { DashboardDependencies, DashboardEnv } from "./types.js";

function timeOverride(c: Context<DashboardEnv>): TimeIntent | undefined | Response {
  const raw = c.req.query("time");
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return c.json({ error: "时间覆盖参数无效" }, 400);
  }
  const checked = TIME_INTENT_INPUT.safeParse(parsed);
  return checked.success ? checked.data : c.json({ error: "时间覆盖参数无效" }, 400);
}

function boardMutationError(c: Context<DashboardEnv>, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof BoardRevisionConflictError) return c.json({ error: message }, 409);
  if (error instanceof BoardForbiddenError) return c.json({ error: message }, 403);
  if (error instanceof BoardNotFoundError) return c.json({ error: message }, 404);
  return c.json({ error: message }, 400);
}

export function registerBoardRoutes(
  dashboard: Hono<DashboardEnv>,
  deps: Pick<DashboardDependencies, "boardService" | "presentation" | "records">,
): void {
  const { boardService, presentation, records } = deps;

  dashboard.get("/api/boards", async (c) => {
    if (!boardService) return c.json({ error: "未启用看板" }, 501);
    return c.json({ rows: await boardService.list() });
  });

  dashboard.post("/api/boards", async (c) => {
    if (!boardService) return c.json({ error: "未启用看板" }, 501);
    const parsed = CREATE_BOARD_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "看板请求无效" }, 400);
    try {
      return c.json(await boardService.create(parsed.data.name, c.get("me").email));
    } catch (error) {
      return boardMutationError(c, error);
    }
  });

  dashboard.get("/api/boards/:id", async (c) => {
    if (!boardService) return c.json({ error: "未启用看板" }, 501);
    try {
      return c.json(await boardService.get(c.req.param("id")));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof BoardRequestError) return c.json({ error: message }, 400);
      if (error instanceof BoardNotFoundError) return c.json({ error: message }, 404);
      return c.json({ error: message }, 500);
    }
  });

  dashboard.patch("/api/boards/:id", async (c) => {
    if (!boardService) return c.json({ error: "未启用看板" }, 501);
    const parsed = UPDATE_BOARD_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "看板修改请求无效" }, 400);
    try {
      return c.json(
        await boardService.update(
          c.req.param("id"),
          c.get("me").email,
          { name: parsed.data.name, tiles: parsed.data.tiles },
          parsed.data.if_revision,
        ),
      );
    } catch (error) {
      return boardMutationError(c, error);
    }
  });

  dashboard.post("/api/boards/:id/items", async (c) => {
    if (!boardService) return c.json({ error: "未启用看板" }, 501);
    const parsed = ADD_BOARD_ITEM_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "加入看板请求无效" }, 400);
    try {
      return c.json(
        await boardService.addReport({
          id: c.req.param("id"),
          owner: c.get("me").email,
          reportId: parsed.data.report_id,
          ifRevision: parsed.data.if_revision,
        }),
      );
    } catch (error) {
      return boardMutationError(c, error);
    }
  });

  dashboard.delete("/api/boards/:id", async (c) => {
    if (!boardService) return c.json({ error: "未启用看板" }, 501);
    try {
      await boardService.remove(c.req.param("id"), c.get("me").email);
      return c.json({ ok: true });
    } catch (error) {
      return boardMutationError(c, error);
    }
  });

  dashboard.get("/api/boards/:id/items/:reportId/replay", async (c) => {
    if (!boardService) return c.json({ error: "未启用看板重放" }, 501);
    const time = timeOverride(c);
    if (time instanceof Response) return time;
    try {
      const { report, executed, recordProjectionBindings, time_override } =
        await boardService.runReport(
          c.get("principal"),
          c.req.param("id"),
          c.req.param("reportId"),
          time,
        );
      const renderedPresentation = presentation?.compile(executed);
      return c.json({
        at: report.updated_at,
        caller: report.owner,
        analysis_id: executed.analysis_id,
        view_id: executed.view_id,
        revision: report.revision,
        analysis: report.definition,
        view: report.intent,
        view_preferences: report.view_preferences,
        record_projection_bindings: recordProjectionBindings,
        payload: executed.payload,
        render_bundle: { view: executed.fullRowViewBlock, decl: executed.decl },
        ...(renderedPresentation ? { presentation: renderedPresentation } : {}),
        ...(time_override ? { time_override } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof BoardNotFoundError || error instanceof ReportNotFoundError) {
        return c.json({ error: message }, 404);
      }
      console.error("[pa] dashboard 看板报告执行失败:", error);
      return c.json({ error: message }, 502);
    }
  });

  dashboard.post("/api/boards/:id/items/:reportId/records", async (c) => {
    if (!records) return c.json({ error: "未启用人员明细" }, 501);
    const parsed = RECORD_PROJECTION_REQUEST_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "明细请求无效，请刷新看板后重试" }, 400);
    const time = timeOverride(c);
    if (time instanceof Response) return time;
    try {
      return c.json(
        await records.runBoard(
          c.get("principal"),
          c.req.param("id"),
          c.req.param("reportId"),
          parsed.data,
          time,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ReportConflictError) return c.json({ error: message }, 409);
      if (error instanceof ReportNotFoundError) return c.json({ error: message }, 404);
      if (error instanceof AuthzError) return c.json({ error: message }, 403);
      if (error instanceof RecordProjectionRequestError) return c.json({ error: message }, 400);
      return c.json({ error: "人员明细暂时无法加载，请稍后重试" }, 500);
    }
  });
}
