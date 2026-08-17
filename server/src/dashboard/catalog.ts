import type { Context, Hono, MiddlewareHandler } from "hono";
import { CatalogInputError } from "../application/catalog_service.js";
import { AuthzError } from "../engine/cube_security.js";
import type { DashboardDependencies, DashboardEnv } from "./types.js";
import {
  CREATE_BUSINESS_TERM_BODY,
  UPDATE_BUSINESS_TERM_BODY,
} from "../contracts/business_term_contract.js";
import { BusinessTermInputError } from "../application/business_term_service.js";
import { BusinessTermNotFoundError } from "../ports/business_term_repository.js";

const CATALOG_SERVICE_ERROR = "指标字典服务暂时不可用，请稍后重试";
const BUSINESS_TERM_SERVICE_ERROR = "业务术语服务暂时不可用，请稍后重试";

function knownError(c: Context<DashboardEnv>, error: unknown) {
  if (error instanceof AuthzError) return c.json({ error: error.message }, 403);
  if (error instanceof CatalogInputError || error instanceof BusinessTermInputError)
    return c.json({ error: error.message }, 400);
  if (error instanceof BusinessTermNotFoundError) return c.json({ error: error.message }, 404);
  return null;
}

function catalogError(c: Context<DashboardEnv>, error: unknown) {
  const known = knownError(c, error);
  if (known) return known;
  console.error("[pa] dashboard catalog 读取失败:", error);
  return c.json({ error: CATALOG_SERVICE_ERROR }, 502);
}

function businessTermError(c: Context<DashboardEnv>, error: unknown) {
  const known = knownError(c, error);
  if (known) return known;
  console.error("[pa] dashboard business term 读取失败:", error);
  return c.json({ error: BUSINESS_TERM_SERVICE_ERROR }, 502);
}

export function registerCatalogRoutes(
  dashboard: Hono<DashboardEnv>,
  deps: Pick<DashboardDependencies, "catalog" | "businessTerms" | "capabilityMap">,
  requireAdmin: MiddlewareHandler<DashboardEnv>,
): void {
  const { catalog, businessTerms, capabilityMap } = deps;

  const members = async (c: Context<DashboardEnv>) => {
    if (!catalog) throw new CatalogInputError("未启用指标字典");
    const document = await catalog.publicDocument(c.get("principal"));
    return [...document.measures, ...document.dimensions];
  };

  dashboard.get("/api/catalog", async (c) => {
    if (!catalog) return c.json({ error: "未启用指标字典" }, 501);
    try {
      return c.json(await catalog.publicDocument(c.get("principal")));
    } catch (error) {
      return catalogError(c, error);
    }
  });

  dashboard.get("/api/admin/data-capability-map", requireAdmin, (c) => {
    if (!capabilityMap) return c.json({ error: "未启用数据能力地图" }, 501);
    return c.json(capabilityMap);
  });

  dashboard.get("/api/catalog/values", async (c) => {
    if (!catalog) return c.json({ error: "未启用指标字典" }, 501);
    const member = c.req.query("member")?.trim() ?? "";
    const rawContains = c.req.query("contains");
    const contains = rawContains?.trim();
    if (!member) return c.json({ error: "member 必填" }, 400);
    if (rawContains !== undefined && !contains) {
      return c.json({ error: "contains 不能是空字符串" }, 400);
    }
    try {
      return c.json(await catalog.dimensionValues(c.get("principal"), member, contains));
    } catch (error) {
      return catalogError(c, error);
    }
  });

  dashboard.get("/api/catalog/terms", async (c) => {
    if (!businessTerms || !catalog) return c.json({ error: "未启用业务术语" }, 501);
    try {
      return c.json({ rows: await businessTerms.listPublic(await members(c)) });
    } catch (error) {
      return businessTermError(c, error);
    }
  });

  dashboard.get("/api/admin/business_terms", requireAdmin, async (c) => {
    if (!businessTerms || !catalog) return c.json({ error: "未启用业务术语" }, 501);
    try {
      return c.json({ rows: await businessTerms.listAdmin(await members(c)) });
    } catch (error) {
      return businessTermError(c, error);
    }
  });

  dashboard.post("/api/admin/business_terms", requireAdmin, async (c) => {
    if (!businessTerms || !catalog) return c.json({ error: "未启用业务术语" }, 501);
    const parsed = CREATE_BUSINESS_TERM_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "需要规范术语与定义" }, 400);
    }
    try {
      const row = await businessTerms.create(parsed.data, await members(c), c.get("me").email);
      return c.json(row);
    } catch (error) {
      return businessTermError(c, error);
    }
  });

  dashboard.put("/api/admin/business_terms/:id", requireAdmin, async (c) => {
    if (!businessTerms || !catalog) return c.json({ error: "未启用业务术语" }, 501);
    const parsed = UPDATE_BUSINESS_TERM_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "业务术语输入无效" }, 400);
    }
    try {
      const row = await businessTerms.update(
        c.req.param("id"),
        parsed.data,
        await members(c),
        c.get("me").email,
      );
      return c.json(row);
    } catch (error) {
      return businessTermError(c, error);
    }
  });

  dashboard.delete("/api/admin/business_terms/:id", requireAdmin, async (c) => {
    if (!businessTerms) return c.json({ error: "未启用业务术语" }, 501);
    try {
      await businessTerms.remove(c.req.param("id"), c.get("me").email);
      return c.json({ ok: true });
    } catch (error) {
      return businessTermError(c, error);
    }
  });
}
