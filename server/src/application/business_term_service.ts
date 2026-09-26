import type { BusinessTermContentInput } from "../contracts/business_term_contract.js";
import type { Principal } from "../contracts/principal.js";
import type { BusinessTermRegistry } from "./business_term_registry.js";
import type { CatalogService } from "./catalog_service.js";
import { ForbiddenError } from "./errors.js";
import type { UsageService } from "./usage_service.js";

export type BusinessTermService = ReturnType<typeof createBusinessTermService>;

export function createBusinessTermService(deps: {
  registry: BusinessTermRegistry;
  catalog: Pick<CatalogService, "publicDocument">;
  usage: Pick<UsageService, "log">;
}) {
  const members = async (principal: Principal) => {
    const document = await deps.catalog.publicDocument(principal);
    return [...document.measures, ...document.dimensions];
  };

  const assertAdmin = (principal: Principal) => {
    if (!principal.roles.includes("admin")) throw new ForbiddenError("需要管理员权限");
  };

  async function listPublic(principal: Principal) {
    return deps.registry.listPublic(await members(principal));
  }

  async function listAdmin(principal: Principal) {
    assertAdmin(principal);
    return deps.registry.listAdmin(await members(principal));
  }

  async function create(principal: Principal, input: BusinessTermContentInput) {
    assertAdmin(principal);
    const row = await deps.registry.create(input, await members(principal));
    await deps.usage.log({
      caller: principal.email,
      tool: "business_term_admin",
      title: `新建业务术语：「${row.canonical_term}」`,
      outcome: "ok",
      duration_ms: 0,
    });
    return row;
  }

  async function update(principal: Principal, id: string, input: BusinessTermContentInput) {
    assertAdmin(principal);
    const row = await deps.registry.update(id, input, await members(principal));
    await deps.usage.log({
      caller: principal.email,
      tool: "business_term_admin",
      title: `更新业务术语：「${row.canonical_term}」`,
      outcome: "ok",
      duration_ms: 0,
    });
    return row;
  }

  async function remove(principal: Principal, id: string) {
    assertAdmin(principal);
    const row = await deps.registry.archive(id);
    await deps.usage.log({
      caller: principal.email,
      tool: "business_term_admin",
      title: `删除业务术语：「${row.canonical_term}」`,
      outcome: "ok",
      duration_ms: 0,
    });
    return row;
  }

  async function restore(principal: Principal, id: string) {
    assertAdmin(principal);
    const row = await deps.registry.restore(id);
    await deps.usage.log({
      caller: principal.email,
      tool: "business_term_admin",
      title: `恢复业务术语：「${row.canonical_term}」`,
      outcome: "ok",
      duration_ms: 0,
    });
    return row;
  }

  return { listPublic, listAdmin, create, update, remove, restore };
}
