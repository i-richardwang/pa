import { describe, expect, test } from "bun:test";
import { resolveFilterLineage, sameFilterLineage } from "./filter_lineage.js";

describe("filter lineage", () => {
  test("条件顺序和 equals/notEquals 的值顺序不影响过滤指纹", () => {
    const left = resolveFilterLineage([
      { member: "view.region", operator: "equals", values: ["east", "west"] },
      { member: "view.status", operator: "notEquals", values: ["inactive"] },
    ]);
    const right = resolveFilterLineage([
      { member: "view.status", operator: "notEquals", values: ["inactive"] },
      { member: "view.region", operator: "equals", values: ["west", "east"] },
    ]);
    expect(sameFilterLineage(left, right)).toBe(true);
  });

  test("运算符不同或有序值顺序不同时视为不同过滤", () => {
    const baseline = resolveFilterLineage([
      { member: "view.region", operator: "equals", values: ["east"] },
    ]);
    expect(
      sameFilterLineage(
        baseline,
        resolveFilterLineage([{ member: "view.region", operator: "notEquals", values: ["east"] }]),
      ),
    ).toBe(false);
    expect(
      sameFilterLineage(
        resolveFilterLineage([
          { member: "view.period", operator: "inDateRange", values: ["2026-01", "2026-06"] },
        ]),
        resolveFilterLineage([
          { member: "view.period", operator: "inDateRange", values: ["2026-06", "2026-01"] },
        ]),
      ),
    ).toBe(false);
  });
});
