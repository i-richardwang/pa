import type { Context, Hono, MiddlewareHandler } from "hono";
import type { DashboardDependencies, DashboardEnv } from "./types.js";
import {
  CREATE_BUSINESS_TERM_BODY,
  UPDATE_BUSINESS_TERM_BODY,
} from "../contracts/business_term_contract.js";

export function registerCatalogRoutes(
  dashboard: Hono<DashboardEnv>,
  deps: Pick<DashboardDependencies, "catalog" | "businessTerms" | "capabilityMap">,
  requireAdmin: MiddlewareHandler<DashboardEnv>,
): void {
  const { catalog, businessTerms, capabilityMap } = deps;

  const members = async (c: Context<DashboardEnv>) => {
    const document = await catalog.publicDocument(c.get("principal"));
    return [...document.measures, ...document.dimensions];
  };

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
    if (!member) return c.json({ error: "member 必填" }, 400);
    if (rawContains !== undefined && !contains) {
      return c.json({ error: "contains 不能是空字符串" }, 400);
    }
    return c.json(await catalog.dimensionValues(c.get("principal"), member, contains));
  });

  dashboard.get("/api/catalog/terms", async (c) => {
    return c.json({ rows: await businessTerms.listPublic(await members(c)) });
  });

  dashboard.get("/api/admin/business_terms", requireAdmin, async (c) => {
    return c.json({ rows: await businessTerms.listAdmin(await members(c)) });
  });

  dashboard.post("/api/admin/business_terms", requireAdmin, async (c) => {
    const parsed = CREATE_BUSINESS_TERM_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "需要规范术语与定义" }, 400);
    }
    const row = await businessTerms.create(parsed.data, await members(c), c.get("me").email);
    return c.json(row);
  });

  dashboard.put("/api/admin/business_terms/:id", requireAdmin, async (c) => {
    const parsed = UPDATE_BUSINESS_TERM_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "业务术语输入无效" }, 400);
    }
    const row = await businessTerms.update(
      c.req.param("id"),
      parsed.data,
      await members(c),
      c.get("me").email,
    );
    return c.json(row);
  });

  dashboard.delete("/api/admin/business_terms/:id", requireAdmin, async (c) => {
    await businessTerms.remove(c.req.param("id"), c.get("me").email);
    return c.json({ ok: true });
  });
}
