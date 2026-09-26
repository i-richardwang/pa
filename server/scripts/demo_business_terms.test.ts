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
    id: "measure:voluntary_separation_count",
    kind: "measure" as const,
    title: "主动离职人数",
    description: "所选期间主动离职人数。",
  },
  {
    id: "measure:headcount_plan_attainment_rate",
    kind: "measure" as const,
    title: "编制达成率",
    description: "月末人数除以同月计划编制。",
  },
  {
    id: "measure:q12_average_score",
    kind: "measure" as const,
    title: "Q12平均得分",
    description: "最近一期十二项评分的平均值。",
  },
  {
    id: "measure:q12_favorable_rate",
    kind: "measure" as const,
    title: "Q12正向作答率",
    description: "四分或五分作答项占全部有效作答项的比例。",
  },
  {
    id: "measure:q12_response_rate",
    kind: "measure" as const,
    title: "Q12回复率",
    description: "答卷人数占投放人数的比例。",
  },
];
describe("demo business term seed", () => {
  test("空库时创建全部 Demo 术语，重复执行不会重复创建", async () => {
    const db = createTestAppDatabase();
    const repository = createBusinessTermRepository(db);
    const registry = createBusinessTermRegistry({ repository });

    const first = await seed_demo_business_terms({ registry, members });
    expect(first.created.map((term) => term.canonical_term)).toEqual([
      "组织",
      "主动离职",
      "编制达成率",
      "Q12调研",
    ]);
    expect(first.preserved).toEqual([]);

    const second = await seed_demo_business_terms({ registry, members });
    expect(second.created).toEqual([]);
    expect(second.preserved.map((term) => term.canonical_term)).toEqual([
      "组织",
      "主动离职",
      "编制达成率",
      "Q12调研",
    ]);
    expect(await repository.list()).toHaveLength(4);
    db.close();
  });

  test("已有同名术语时保留管理员的版本，只创建缺少的术语", async () => {
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
    expect(result.created.map((term) => term.canonical_term)).toEqual([
      "组织",
      "编制达成率",
      "Q12调研",
    ]);
    expect(result.preserved[0]?.definition).toBe("管理员确认后的本地定义。");
    expect(
      (await repository.list()).find((term) => term.canonical_term === "主动离职")?.definition,
    ).toBe("管理员确认后的本地定义。");
    db.close();
  });

  test("Demo 术语的叫法已被其他术语使用时报错，且不写入任何术语", async () => {
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
