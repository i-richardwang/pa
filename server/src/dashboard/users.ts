import type { Hono, MiddlewareHandler } from "hono";
import {
  CREATE_ADMIN_USER_BODY,
  RESET_USER_PASSWORD_BODY,
  UPDATE_USER_AUTHORIZATION_BODY,
} from "../contracts/user_administration_contract.js";
import type { DashboardDependencies, DashboardEnv } from "./types.js";

export function registerUserRoutes(
  dashboard: Hono<DashboardEnv>,
  deps: Pick<DashboardDependencies, "userAdministration">,
  requireAdmin: MiddlewareHandler<DashboardEnv>,
): void {
  dashboard.get("/api/users", requireAdmin, async (c) =>
    c.json(await deps.userAdministration(c.req.raw.headers).list(c.get("principal"))),
  );

  dashboard.post("/api/users", requireAdmin, async (c) => {
    const parsed = CREATE_ADMIN_USER_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "用户信息不完整或格式无效" }, 400);
    return c.json(
      await deps.userAdministration(c.req.raw.headers).create(c.get("principal"), parsed.data),
    );
  });

  dashboard.put("/api/users/:user_id/authorization", requireAdmin, async (c) => {
    const parsed = UPDATE_USER_AUTHORIZATION_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "用户权限格式无效" }, 400);
    return c.json(
      await deps
        .userAdministration(c.req.raw.headers)
        .updateAuthorization(c.get("principal"), c.req.param("user_id"), parsed.data),
    );
  });

  dashboard.post("/api/users/:user_id/password", requireAdmin, async (c) => {
    const parsed = RESET_USER_PASSWORD_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "密码至少需要 8 位" }, 400);
    await deps
      .userAdministration(c.req.raw.headers)
      .resetPassword(c.get("principal"), c.req.param("user_id"), parsed.data);
    return c.json({ ok: true as const });
  });
}
