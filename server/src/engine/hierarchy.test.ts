import { describe, expect, test } from "bun:test";
import { completeWithChains } from "./hierarchy.js";
type CubeQuery = import("../ports/cube_gateway.js").CubeQuery;

const ROOT = "test_people_metrics.organization_name";
const DEPARTMENT = "test_people_metrics.department_name";
const O1 = "test_people_metrics.org_1";
const O2 = "test_people_metrics.org_2";
const O3 = "test_people_metrics.org_3";
const HC = "test_people_metrics.active_employee_count";
const CHAINS = [
  [ROOT, DEPARTMENT],
  [O1, O2, O3],
];

const q = (partial: Partial<CubeQuery>): CubeQuery => ({ measures: [HC], ...partial });

describe("completeWithChains：无需补全", () => {
  test("未引用层级维度", () => {
    const r = completeWithChains(
      q({
        filters: [{ member: "test_people_metrics.year", operator: "equals", values: ["2026"] }],
      }),
      CHAINS,
    );
    expect(r.added).toEqual([]);
  });
  test("上级已在分组维度", () => {
    const r = completeWithChains(q({ dimensions: [O1, O2] }), CHAINS);
    expect(r.added).toEqual([]);
  });
  test("上级有单值 equals 过滤（歧义已消除）", () => {
    const r = completeWithChains(
      q({
        dimensions: [O2],
        filters: [{ member: O1, operator: "equals", values: ["Aurora Labs"] }],
      }),
      CHAINS,
    );
    expect(r.added).toEqual([]);
  });
  test("只引用链的最粗一级", () => {
    const r = completeWithChains(q({ dimensions: [ROOT] }), CHAINS);
    expect(r.added).toEqual([]);
  });
});

describe("completeWithChains：补全上级", () => {
  test("按下级分组而上级未约束：上级依层级序补进分组维度前部", () => {
    const r = completeWithChains(q({ dimensions: [O3] }), CHAINS);
    expect(r.added).toEqual([
      { member: O1, children: [O2] },
      { member: O2, children: [O3] },
    ]);
    expect(r.query.dimensions).toEqual([O1, O2, O3]);
  });
  test("只按下级过滤（无分组）：同样补全，拆行呈现歧义", () => {
    const r = completeWithChains(
      q({ filters: [{ member: O2, operator: "equals", values: ["Marketplace"] }] }),
      CHAINS,
    );
    expect(r.added).toEqual([{ member: O1, children: [O2] }]);
    expect(r.query.dimensions).toEqual([O1]);
  });
  test("上级 equals 多值仍算未约束（跨上级歧义未消除）", () => {
    const r = completeWithChains(
      q({
        dimensions: [DEPARTMENT],
        filters: [{ member: ROOT, operator: "equals", values: ["CEO", "CTO"] }],
      }),
      CHAINS,
    );
    expect(r.added).toEqual([{ member: ROOT, children: [DEPARTMENT] }]);
  });
  test("两条链各自独立补全", () => {
    const r = completeWithChains(q({ dimensions: [DEPARTMENT, O3] }), CHAINS);
    expect(r.added).toEqual([
      { member: ROOT, children: [DEPARTMENT] },
      { member: O1, children: [O2] },
      { member: O2, children: [O3] },
    ]);
    expect(r.query.dimensions).toEqual([ROOT, O1, O2, DEPARTMENT, O3]);
  });
  test("中间级被约束不减免更上级：只要被引用级之上有未约束者皆补", () => {
    const r = completeWithChains(
      q({
        dimensions: [O3],
        filters: [{ member: O2, operator: "equals", values: ["体验管理"] }],
      }),
      CHAINS,
    );
    // O2 同名可挂不同 O1：O2 被单值约束但 O1 仍未约束，须补出 O1 消歧
    expect(r.added).toEqual([{ member: O1, children: [O2] }]);
  });

  test("共享上级的多条层级链保留各自直接下级来源", () => {
    const channel = "test_people_metrics.channel";
    const r = completeWithChains(q({ dimensions: [DEPARTMENT, channel] }), [
      [ROOT, DEPARTMENT],
      [ROOT, channel],
    ]);
    expect(r.added).toEqual([{ member: ROOT, children: [DEPARTMENT, channel] }]);
    expect(r.query.dimensions).toEqual([ROOT, DEPARTMENT, channel]);
  });
});

describe("completeWithChains：grouping set 模式", () => {
  test("筛选只约束层级，不把空分组提升为业务分组", () => {
    const r = completeWithChains(
      q({ filters: [{ member: O2, operator: "equals", values: ["Marketplace"] }] }),
      CHAINS,
      { filtersReferenceHierarchy: false },
    );
    expect(r.added).toEqual([]);
    expect(r.query.dimensions).toBeUndefined();
  });

  test("仍按显式分组补全未被单值筛选约束的上级", () => {
    const r = completeWithChains(
      q({
        dimensions: [O3],
        filters: [{ member: O2, operator: "equals", values: ["Experience"] }],
      }),
      CHAINS,
      { filtersReferenceHierarchy: false },
    );
    expect(r.added).toEqual([{ member: O1, children: [O2] }]);
    expect(r.query.dimensions).toEqual([O1, O3]);
  });
});
