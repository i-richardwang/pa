import { describe, expect, test } from "bun:test";
import { resolveFilterLineage, sameFilterLineage } from "./filter_lineage.js";

describe("filter lineage", () => {
  test("交换可交换条件和值顺序仍是同一血缘", () => {
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

  test("不同谓词或有序值不合并", () => {
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
