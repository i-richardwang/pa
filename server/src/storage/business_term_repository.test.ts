import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { createTestAppDatabase } from "../test_support/app_database.js";
import { createBusinessTermRepository } from "./business_term_repository.js";
import { BusinessTermNotFoundError } from "../ports/business_term_repository.js";

describe("business term repository", () => {
  test("定义、别名与关联成员作为一个术语保存后立即可读", async () => {
    const db = createTestAppDatabase();
    const repository = createBusinessTermRepository(db);
    const created = await repository.create({
      canonical_term: "Band C+",
      definition: "Band C及以上的示例职级范围。",
      aliases: ["C+ Band", "Band C及以上"],
      related_member_ids: ["dimension:job_level_band"],
    });

    expect(created.aliases).toEqual(["C+ Band", "Band C及以上"]);
    expect(await repository.list()).toEqual([
      {
        id: created.id,
        archived_at: null,
        canonical_term: "Band C+",
        definition: "Band C及以上的示例职级范围。",
        context: null,
        aliases: ["C+ Band", "Band C及以上"],
        related_member_ids: ["dimension:job_level_band"],
      },
    ]);
    db.close();
  });

  test("内容替换会完整覆盖定义与两个集合", async () => {
    const db = createTestAppDatabase();
    const repository = createBusinessTermRepository(db);
    const created = await repository.create({
      canonical_term: "组织",
      definition: "默认指公司一级组织。",
      aliases: ["老叫法"],
      related_member_ids: [],
    });
    const updated = await repository.replace(created.id, {
      canonical_term: "组织",
      definition: "默认指公司一级组织，与部门树不同。",
      context: "组织分析",
      aliases: ["组织名称"],
      related_member_ids: ["dimension:organization_name"],
    });

    expect(updated).toEqual({
      id: created.id,
      archived_at: null,
      canonical_term: "组织",
      definition: "默认指公司一级组织，与部门树不同。",
      context: "组织分析",
      aliases: ["组织名称"],
      related_member_ids: ["dimension:organization_name"],
    });
    expect(await repository.get(created.id)).toEqual(updated);
    db.close();
  });

  test("删除术语只是归档，记录保留且可恢复", async () => {
    const db = createTestAppDatabase();
    const repository = createBusinessTermRepository(db);
    const created = await repository.create({
      canonical_term: "大盘",
      definition: "指当前有权数据范围的整体。",
      aliases: ["整体"],
      related_member_ids: ["dimension:organization_name"],
    });

    const archived = await repository.archive(created.id);
    expect(archived.archived_at).not.toBeNull();
    expect(await repository.list()).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM business_term").get()).toEqual({ n: 1 });

    expect(await repository.restore(created.id)).toEqual(created);
    expect(await repository.list()).toEqual([created]);
    await expect(repository.archive(randomUUID())).rejects.toBeInstanceOf(
      BusinessTermNotFoundError,
    );
    db.close();
  });
});
