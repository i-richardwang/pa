import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { principalFromAttributes, type Principal } from "../contracts/principal.js";
import { registerAnalysisRoutes } from "./analyses.js";
import { registerBoardRoutes } from "./boards.js";
import { registerCatalogRoutes } from "./catalog.js";
import { registerReportRoutes } from "./reports.js";
import type { DashboardDependencies, DashboardEnv, SessionUser } from "./types.js";
import { registerUsageRoutes } from "./usage.js";
import type { MePayload } from "../contracts/session_contract.js";
import { dashboardError } from "./errors.js";
import { registerUserRoutes } from "./users.js";
import { ForbiddenError, UnauthorizedError } from "../application/errors.js";

function toMe(
  user: SessionUser,
  principal: Principal,
  accessScopeDefinition: DashboardDependencies["accessScopeDefinition"],
): MePayload {
  return {
    email: user.email,
    name: user.name,
    role: user.role || "user",
    is_admin: principal.roles.includes("admin"),
    access_scope: { ...principal.accessScope, ...accessScopeDefinition },
  };
}

export function dashboardRoutes(deps: DashboardDependencies) {
  const dashboard = new Hono<DashboardEnv>();

  dashboard.onError((error, c) => dashboardError(c, error, deps.logger));

  dashboard.get("/", async (c) => {
    const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.redirect("/login?redirect=/dashboard");
    // 单文件 SPA：产物每次重发，禁止浏览器缓存。
    c.header("Cache-Control", "no-store");
    return c.html(await deps.html());
  });

  dashboard.use("/api/*", async (c, next) => {
    const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) throw new UnauthorizedError("未登录");
    const principal = principalFromAttributes(session.user, deps.accessScopeDefinition);
    c.set("me", toMe(session.user, principal, deps.accessScopeDefinition));
    c.set("principal", principal);
    return next();
  });

  const requireAdmin = createMiddleware<DashboardEnv>(async (c, next) => {
    if (!c.get("me").is_admin) throw new ForbiddenError("需要管理员权限");
    return next();
  });

  dashboard.get("/api/me", (c) => c.json(c.get("me")));
  registerCatalogRoutes(dashboard, deps, requireAdmin);
  registerAnalysisRoutes(dashboard, deps);
  registerReportRoutes(dashboard, deps);
  registerBoardRoutes(dashboard, deps);
  registerUsageRoutes(dashboard, deps, requireAdmin);
  registerUserRoutes(dashboard, deps, requireAdmin);

  return dashboard;
}
