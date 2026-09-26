import { describe, expect, test } from "bun:test";
import type { CubeMember } from "../ports/cube_gateway.js";
import { structureSharesOf } from "./measure_relations.js";

const members: CubeMember[] = [
  { name: "v.hires", title: "入职人数", type: "number" },
  { name: "v.leavers", title: "离职人数", type: "number" },
  {
    name: "v.hire_mix",
    title: "入职人数占比",
    type: "number",
    meta: {
      calculation_role: "structure_share",
      components: { numerator: "hires", denominator: "hire_scope" },
    },
  },
  {
    name: "v.leave_mix",
    title: "离职人数占比",
    type: "number",
    meta: {
      calculation_role: "structure_share",
      components: { numerator: "v.leavers", denominator: "v.leave_scope" },
    },
  },
];

describe("结构占比指标关系映射", () => {
  test("同一视图可有多组占比关系，组件可写短名或全名", () => {
    expect(
      structureSharesOf(
        ["v.level", "v.hires", "v.hire_mix", "v.leavers", "v.leave_mix"],
        ["level", "hires", "hire_mix", "leavers", "leave_mix"],
        members,
      ),
    ).toEqual([
      { measure: "hire_mix", numerator: "hires" },
      { measure: "leave_mix", numerator: "leavers" },
    ]);
  });

  test("分子不在同一查询中或未声明 structure_share 时不生成关系", () => {
    expect(structureSharesOf(["v.hire_mix"], ["hire_mix"], members)).toEqual([]);
    expect(structureSharesOf(["v.hires"], ["hires"], members)).toEqual([]);
  });
});
