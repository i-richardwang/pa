import { describe, expect, test } from "bun:test";
import { createBusinessTermRepository } from "../storage/business_term_repository.js";
import { createTestAppDatabase } from "../test_support/app_database.js";
import { BusinessTermInputError, createBusinessTermService } from "./business_term_service.js";

const members = [
  { id: "dimension:category_band", kind: "dimension" as const, title: "分类层级" },
  { id: "dimension:organization_name", kind: "dimension" as const, title: "组织" },
];
const usage = { log: async () => {} };

describe("business term service", () => {
  test("定义可以独立保存并立即参与解析，成员关联只作可选导航", async () => {
    const db = createTestAppDatabase();
    const service = createBusinessTermService({
      repository: createBusinessTermRepository(db),
      usage,
    });
    const created = await service.create(
      {
        canonical_term: "大盘",
        definition: "指当前调用者有权数据范围的整体。",
        aliases: [],
        related_member_ids: [],
      },
      members,
      "admin@x",
    );
    expect(created.related_members).toEqual([]);
    expect(await service.resolve(["大盘"], members)).toEqual([
      expect.objectContaining({
        input_term: "大盘",
        status: "resolved",
        matches: [expect.objectContaining({ definition: "指当前调用者有权数据范围的整体。" })],
      }),
    ]);
    db.close();
  });

  test("相关成员必须来自可见语义目录，公共投影不泄漏失效关联", async () => {
    const db = createTestAppDatabase();
    const repository = createBusinessTermRepository(db);
    const service = createBusinessTermService({ repository, usage });
    await expect(
      service.create(
        {
          canonical_term: "Level C+",
          definition: "Level C 及以上的示例分类范围。",
          aliases: [],
          related_member_ids: ["physical.category_level"],
        },
        members,
        "admin@x",
      ),
    ).rejects.toBeInstanceOf(BusinessTermInputError);
    await service.create(
      {
        canonical_term: "Level C+",
        definition: "Level C 及以上的示例分类范围。",
        aliases: ["Level C 及以上"],
        related_member_ids: ["dimension:category_band"],
      },
      members,
      "admin@x",
    );
    expect((await service.resolve(["Level C+"], members))[0]?.matches[0]?.related_members).toEqual([
      {
        id: "dimension:category_band",
        title: "分类层级",
        kind: "dimension",
        status: "available",
      },
    ]);
    expect((await service.resolve(["Level C+"], []))[0]?.matches[0]?.related_members).toEqual([]);
    expect((await service.listAdmin([]))[0]?.related_members).toEqual([
      {
        id: "dimension:category_band",
        title: null,
        kind: null,
        status: "missing",
      },
    ]);
    db.close();
  });

  test("归一后重复的叫法 fail-closed", async () => {
    const db = createTestAppDatabase();
    const service = createBusinessTermService({
      repository: createBusinessTermRepository(db),
      usage,
    });
    await expect(
      service.create(
        {
          canonical_term: "Level C+",
          definition: "Level C 及以上。",
          aliases: ["Ｌｅｖｅｌ Ｃ+"],
          related_member_ids: [],
        },
        members,
        "admin@x",
      ),
    ).rejects.toBeInstanceOf(BusinessTermInputError);
    db.close();
  });
});
