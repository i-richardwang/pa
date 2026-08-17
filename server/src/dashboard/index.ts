/**
 * /dashboard 浏览器面总装：只负责页面入口、会话身份与资源路由注册。
 * 各资源的输入校验和业务错误映射归本目录下对应的资源路由模块。
 */
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { principalFromAttributes, type Principal } from "../engine/cube_security.js";
import { registerAnalysisRoutes } from "./analyses.js";
import { registerBoardRoutes } from "./boards.js";
import { registerCatalogRoutes } from "./catalog.js";
import { registerReportRoutes } from "./reports.js";
import type { DashboardDependencies, DashboardEnv, SessionUser } from "./types.js";
import { registerUsageRoutes } from "./usage.js";
import type { MePayload } from "../contracts/dashboard_contract.js";

function toMe(user: SessionUser, principal: Principal): MePayload {
  return {
    email: user.email,
    name: user.name,
    role: user.role || "user",
    is_admin: principal.roles.includes("admin"),
    org_scope: user.org_scope ?? "",
  };
}

export function dashboardRoutes(deps: DashboardDependencies) {
  const dashboard = new Hono<DashboardEnv>();

  dashboard.get("/", async (c) => {
    const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.redirect("/login?redirect=/dashboard");
    // 单文件 SPA：禁止浏览器长缓存，否则 docker cp 新产物后界面仍像「没变化」
    c.header("Cache-Control", "no-store");
    return c.html(await deps.html());
  });

  dashboard.use("/api/*", async (c, next) => {
    const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "未登录" }, 401);
    const principal = principalFromAttributes(session.user);
    c.set("me", toMe(session.user, principal));
    c.set("principal", principal);
    return next();
  });

  const requireAdmin = createMiddleware<DashboardEnv>(async (c, next) => {
    if (!c.get("me").is_admin) return c.json({ error: "需要管理员权限" }, 403);
    return next();
  });

  dashboard.get("/api/me", (c) => c.json(c.get("me")));
  registerCatalogRoutes(dashboard, deps, requireAdmin);
  registerAnalysisRoutes(dashboard, deps);
  registerReportRoutes(dashboard, deps);
  registerBoardRoutes(dashboard, deps);
  registerUsageRoutes(dashboard, deps, requireAdmin);

  return dashboard;
}
