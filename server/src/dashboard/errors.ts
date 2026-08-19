import type { Context } from "hono";
import { publicApplicationError } from "../application/errors.js";
import type { DashboardEnv } from "./types.js";

export function dashboardError(c: Context<DashboardEnv>, error: unknown) {
  const safe = publicApplicationError(error);
  if (safe.internal) console.error("[pa] dashboard 请求失败:", error);
  return c.json(
    {
      error: safe.message,
      code: safe.code,
      ...(safe.details ?? {}),
    },
    safe.status,
  );
}
