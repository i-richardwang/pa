import { describe, expect, test } from "bun:test";
import { createBusinessTermRegistry } from "../src/application/business_term_registry.js";
import { createBusinessTermRepository } from "../src/storage/business_term_repository.js";
import { createTestAppDatabase } from "../src/test_support/app_database.js";
import { seed_demo_business_terms } from "./demo_business_terms.js";

const members = [
  {
    id: "dimension:organization_name",
    kind: "dimension" as const,
    title: "组织",
    description: "员工所属的一级组织。",
  },
  {
    id: "dimension:leave_type",
    kind: "dimension" as const,
    title: "离职性质",
    description: "离职事件的性质。",
  },
  {
    id: "measure:voluntary_turnover_count",
    kind: "measure" as const,
    title: "主动离职人数",
    description: "所选期间主动离职人数。",
  },
  {
    id: "measure:current_month_fulfillment_rate",
    kind: "measure" as const,
    title: "当月编制完成率",
    description: "月末人数除以同月编制目标。",
  },
];
describe("demo business term seed", () => {
  test("空库创建全局术语，重复执行保持幂等", async () => {
    const db = createTestAppDatabase();
    const repository = createBusinessTermRepository(db);
    const registry = createBusinessTermRegistry({ repository });

    const first = await seed_demo_business_terms({ registry, members });
    expect(first.created.map((term) => term.canonical_term)).toEqual([
      "组织",
      "主动离职",
      "编制完成率",
    ]);
    expect(first.preserved).toEqual([]);

    const second = await seed_demo_business_terms({ registry, members });
    expect(second.created).toEqual([]);
    expect(second.preserved.map((term) => term.canonical_term)).toEqual([
      "组织",
      "主动离职",
      "编制完成率",
    ]);
    expect(await repository.list()).toHaveLength(3);
    db.close();
  });

  test("同规范词保留管理员内容，只补齐缺失术语", async () => {
    const db = createTestAppDatabase();
    const repository = createBusinessTermRepository(db);
    const registry = createBusinessTermRegistry({ repository });
    await registry.create(
      {
        canonical_term: "主动离职",
        definition: "管理员确认后的本地定义。",
        aliases: [],
        related_member_ids: [],
      },
      members,
    );

    const result = await seed_demo_business_terms({ registry, members });
    expect(result.created.map((term) => term.canonical_term)).toEqual(["组织", "编制完成率"]);
    expect(result.preserved[0]?.definition).toBe("管理员确认后的本地定义。");
    expect(
      (await repository.list()).find((term) => term.canonical_term === "主动离职")?.definition,
    ).toBe("管理员确认后的本地定义。");
    db.close();
  });

  test("既有其他术语占用 Demo 叫法时先失败且不写入", async () => {
    const db = createTestAppDatabase();
    const repository = createBusinessTermRepository(db);
    const registry = createBusinessTermRegistry({ repository });
    await registry.create(
      {
        canonical_term: "公司一级部门",
        definition: "已有的本地业务定义。",
        aliases: ["一级组织"],
        related_member_ids: [],
      },
      members,
    );

    await expect(seed_demo_business_terms({ registry, members })).rejects.toThrow(
      "叫法“一级组织”已属于“公司一级部门”",
    );
    expect((await repository.list()).map((term) => term.canonical_term)).toEqual(["公司一级部门"]);
    db.close();
  });
});
