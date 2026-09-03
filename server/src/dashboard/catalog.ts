import type { Hono, MiddlewareHandler } from "hono";
import type { DashboardDependencies, DashboardEnv } from "./types.js";
import {
  CREATE_BUSINESS_TERM_BODY,
  UPDATE_BUSINESS_TERM_BODY,
} from "../contracts/business_term_contract.js";
import { InvalidRequestError } from "../application/errors.js";

export function registerCatalogRoutes(
  dashboard: Hono<DashboardEnv>,
  deps: Pick<DashboardDependencies, "catalog" | "businessTerms" | "capabilityMap">,
  requireAdmin: MiddlewareHandler<DashboardEnv>,
): void {
  const { catalog, businessTerms, capabilityMap } = deps;

  dashboard.get("/api/catalog", async (c) => {
    return c.json(await catalog.publicDocument(c.get("principal")));
  });

  dashboard.get("/api/admin/data-capability-map", requireAdmin, (c) => {
    return c.json(capabilityMap);
  });

  dashboard.get("/api/catalog/values", async (c) => {
    const member = c.req.query("member")?.trim() ?? "";
    const rawContains = c.req.query("contains");
    const contains = rawContains?.trim();
    if (!member) throw new InvalidRequestError("member 必填");
    if (rawContains !== undefined && !contains) {
      throw new InvalidRequestError("contains 不能是空字符串");
    }
    return c.json(await catalog.dimensionValues(c.get("principal"), member, contains));
  });

  dashboard.get("/api/catalog/terms", async (c) => {
    return c.json({ rows: await businessTerms.listPublic(c.get("principal")) });
  });

  dashboard.get("/api/admin/business_terms", requireAdmin, async (c) => {
    return c.json({ rows: await businessTerms.listAdmin(c.get("principal")) });
  });

  dashboard.post("/api/admin/business_terms", requireAdmin, async (c) => {
    const parsed = CREATE_BUSINESS_TERM_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new InvalidRequestError(parsed.error.issues[0]?.message ?? "需要规范术语与定义");
    }
    const row = await businessTerms.create(c.get("principal"), parsed.data);
    return c.json(row);
  });

  dashboard.put("/api/admin/business_terms/:id", requireAdmin, async (c) => {
    const parsed = UPDATE_BUSINESS_TERM_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new InvalidRequestError(parsed.error.issues[0]?.message ?? "业务术语输入无效");
    }
    const row = await businessTerms.update(c.get("principal"), c.req.param("id"), parsed.data);
    return c.json(row);
  });

  dashboard.delete("/api/admin/business_terms/:id", requireAdmin, async (c) => {
    await businessTerms.remove(c.get("principal"), c.req.param("id"));
    return c.json({ ok: true });
  });

  dashboard.post("/api/admin/business_terms/:id/restore", requireAdmin, async (c) => {
    return c.json(await businessTerms.restore(c.get("principal"), c.req.param("id")));
  });
}
