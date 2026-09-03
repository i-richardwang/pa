import { describe, expect, test } from "bun:test";
import { createBusinessTermRepository } from "../storage/business_term_repository.js";
import { createTestAppDatabase } from "../test_support/app_database.js";
import type { Principal } from "../contracts/principal.js";
import type { PublicCatalogDimension } from "../contracts/catalog_contract.js";
import { createBusinessTermRegistry } from "./business_term_registry.js";
import { createBusinessTermService } from "./business_term_service.js";
import { ForbiddenError, InvalidRequestError } from "./errors.js";

const members: PublicCatalogDimension[] = [
  {
    id: "dimension:category_band",
    kind: "dimension",
    title: "分类层级",
    description: "虚构分类层级。",
  },
  {
    id: "dimension:organization_name",
    kind: "dimension",
    title: "组织",
    description: "虚构组织。",
  },
];
const usage = { log: async () => {} };
const admin: Principal = { email: "admin@x", roles: ["admin"], accessScope: { kind: "all" } };
const user: Principal = { email: "user@x", roles: ["user"], accessScope: { kind: "all" } };
const catalog = (visible = members) => ({
  publicDocument: async () => ({
    access_scope: { id: "organization", title: "组织" },
    observation_scopes: ["测试口径"],
    data_as_of: "2026-08-01",
    time_context: [],
    metric_domains: [],
    measures: [],
    dimensions: visible,
  }),
});

describe("business term application boundary", () => {
  test("定义可以独立保存并立即参与解析，成员关联只作可选导航", async () => {
    const db = createTestAppDatabase();
    const registry = createBusinessTermRegistry({
      repository: createBusinessTermRepository(db),
    });
    const service = createBusinessTermService({ registry, catalog: catalog(), usage });
    const created = await service.create(admin, {
      canonical_term: " 大盘 ",
      definition: " 指当前调用者有权数据范围的整体。 ",
      aliases: [],
      related_member_ids: [],
    });
    expect(created.canonical_term).toBe("大盘");
    expect(created.related_members).toEqual([]);
    expect(await registry.resolve(["大盘"], members)).toEqual([
      expect.objectContaining({
        input_term: "大盘",
        status: "resolved",
        matches: [expect.objectContaining({ definition: "指当前调用者有权数据范围的整体。" })],
      }),
    ]);
    db.close();
  });

  test("相关成员只由应用服务从当前 Principal 的授权目录取得", async () => {
    const db = createTestAppDatabase();
    const registry = createBusinessTermRegistry({
      repository: createBusinessTermRepository(db),
    });
    const service = createBusinessTermService({ registry, catalog: catalog(), usage });
    await expect(
      service.create(admin, {
        canonical_term: "Level C+",
        definition: "Level C 及以上的示例分类范围。",
        aliases: [],
        related_member_ids: ["physical.category_level"],
      }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    await service.create(admin, {
      canonical_term: "Level C+",
      definition: "Level C 及以上的示例分类范围。",
      aliases: ["Level C 及以上"],
      related_member_ids: ["dimension:category_band"],
    });
    expect((await service.listPublic(user))[0]?.related_members).toEqual([
      {
        id: "dimension:category_band",
        title: "分类层级",
        kind: "dimension",
        status: "available",
      },
    ]);

    const hidden = createBusinessTermService({ registry, catalog: catalog([]), usage });
    expect((await hidden.listPublic(user))[0]?.related_members).toEqual([]);
    expect((await hidden.listAdmin(admin))[0]?.related_members).toEqual([
      {
        id: "dimension:category_band",
        title: null,
        kind: null,
        status: "missing",
      },
    ]);
    db.close();
  });

  test("管理员授权在 Application 内 fail-closed", async () => {
    const db = createTestAppDatabase();
    const registry = createBusinessTermRegistry({
      repository: createBusinessTermRepository(db),
    });
    const service = createBusinessTermService({ registry, catalog: catalog(), usage });
    await expect(service.listAdmin(user)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.create(user, {
        canonical_term: "大盘",
        definition: "全部范围。",
        aliases: [],
        related_member_ids: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    db.close();
  });

  test("归一后重复的叫法 fail-closed", async () => {
    const db = createTestAppDatabase();
    const registry = createBusinessTermRegistry({
      repository: createBusinessTermRepository(db),
    });
    const service = createBusinessTermService({ registry, catalog: catalog(), usage });
    await expect(
      service.create(admin, {
        canonical_term: "Level C+",
        definition: "Level C 及以上。",
        aliases: ["Ｌｅｖｅｌ Ｃ+"],
        related_member_ids: [],
      }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    db.close();
  });
});
