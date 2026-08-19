import type { Context, Hono } from "hono";
import {
  ADD_BOARD_ITEM_BODY,
  CREATE_BOARD_BODY,
  UPDATE_BOARD_BODY,
} from "../contracts/board_contract.js";
import { RECORD_PROJECTION_REQUEST_BODY } from "../contracts/record_projection_contract.js";
import { TIME_INTENT_INPUT, type TimeIntent } from "../semantic_core/time_contract.js";
import type { DashboardDependencies, DashboardEnv } from "./types.js";
import { projectReplayPayload } from "../application/replay_projection.js";

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

export function registerBoardRoutes(
  dashboard: Hono<DashboardEnv>,
  deps: Pick<DashboardDependencies, "boardService" | "presentation" | "records">,
): void {
  const { boardService, presentation, records } = deps;

  dashboard.get("/api/boards", async (c) => {
    return c.json({ rows: await boardService.list() });
  });

  dashboard.post("/api/boards", async (c) => {
    const parsed = CREATE_BOARD_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "看板请求无效" }, 400);
    return c.json(await boardService.create(parsed.data.name, c.get("me").email));
  });

  dashboard.get("/api/boards/:id", async (c) => {
    return c.json(await boardService.get(c.req.param("id")));
  });

  dashboard.patch("/api/boards/:id", async (c) => {
    const parsed = UPDATE_BOARD_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "看板修改请求无效" }, 400);
    return c.json(
      await boardService.update(
        c.req.param("id"),
        c.get("me").email,
        { name: parsed.data.name, tiles: parsed.data.tiles },
        parsed.data.if_revision,
      ),
    );
  });

  dashboard.post("/api/boards/:id/items", async (c) => {
    const parsed = ADD_BOARD_ITEM_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "加入看板请求无效" }, 400);
    return c.json(
      await boardService.addReport({
        id: c.req.param("id"),
        owner: c.get("me").email,
        reportId: parsed.data.report_id,
        ifRevision: parsed.data.if_revision,
      }),
    );
  });

  dashboard.delete("/api/boards/:id", async (c) => {
    await boardService.remove(c.req.param("id"), c.get("me").email);
    return c.json({ ok: true });
  });

  dashboard.get("/api/boards/:id/items/:reportId/replay", async (c) => {
    const time = timeOverride(c);
    if (time instanceof Response) return time;
    const { report, executed, time_override } = await boardService.runReport(
      c.get("principal"),
      c.req.param("id"),
      c.req.param("reportId"),
      time,
    );
    return c.json(
      projectReplayPayload(presentation, executed, {
        at: report.updated_at,
        caller: report.owner,
        revision: report.revision,
        ...(time_override ? { time_override } : {}),
      }),
    );
  });

  dashboard.post("/api/boards/:id/items/:reportId/records", async (c) => {
    const parsed = RECORD_PROJECTION_REQUEST_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "明细请求无效，请刷新看板后重试" }, 400);
    const time = timeOverride(c);
    if (time instanceof Response) return time;
    return c.json(
      await records.runBoard(
        c.get("principal"),
        c.req.param("id"),
        c.req.param("reportId"),
        parsed.data,
        time,
      ),
    );
  });
}
