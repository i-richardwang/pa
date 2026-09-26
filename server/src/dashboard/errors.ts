import type { Context } from "hono";
import { publicApplicationError } from "../application/errors.js";
import type { Logger } from "../ports/logger.js";
import type { DashboardEnv } from "./types.js";

export function dashboardError(c: Context<DashboardEnv>, error: unknown, logger: Logger) {
  const safe = publicApplicationError(error);
  if (safe.internal) logger.error("dashboard 请求失败", error);
  return c.json(
    {
      error: {
        code: safe.code,
        message: safe.message,
        ...(safe.details ? { details: safe.details } : {}),
      },
    },
    safe.status,
  );
}
