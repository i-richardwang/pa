import { describe, expect, test } from "bun:test";
import type { SemanticAnalysisSpec } from "../semantic_core/semantic_analysis.js";
import { applyBoardTimeOverride } from "./board_time_override.js";

const singleView: SemanticAnalysisSpec = {
  version: 2,
  analysis: {
    views: [
      {
        id: "result",
        measures: ["active_employee_count"],
        time: {
          window: { kind: "trailing", count: 6, unit: "month" },
          display: "month",
          comparison: { kind: "previous_year" },
        },
      },
    ],
  },
  presentation: { type: "table" },
};

describe("applyBoardTimeOverride", () => {
  test("单 query view：整体替换 time 并丢弃自身 compare", () => {
    const override = {
      window: { kind: "trailing" as const, count: 12, unit: "month" as const },
      display: "month" as const,
    };
    const result = applyBoardTimeOverride(singleView, override);
    expect(result.status).toBe("applied");
    const view = result.spec.analysis.views[0];
    expect("from" in view).toBe(false);
    if ("from" in view) return;
    expect(view.time).toEqual(override);
    expect(view.time.comparison).toBeUndefined();
  });

  test("多 query view：unsupported，规格原样", () => {
    const multi: SemanticAnalysisSpec = {
      version: 2,
      analysis: {
        views: [
          {
            id: "a",
            measures: ["active_employee_count"],
            time: { window: { kind: "current_month" } },
          },
          {
            id: "b",
            measures: ["active_employee_count"],
            time: {
              window: { kind: "trailing", count: 3, unit: "month" },
              display: "month",
            },
          },
        ],
      },
      presentation: { type: "table" },
    };
    const override = {
      window: { kind: "trailing" as const, count: 3, unit: "year" as const },
      display: "year" as const,
    };
    const result = applyBoardTimeOverride(multi, override);
    expect(result.status).toBe("unsupported");
    expect(result.spec).toBe(multi);
  });

  test("含派生视图：unsupported", () => {
    const derived: SemanticAnalysisSpec = {
      version: 2,
      analysis: {
        views: [
          {
            id: "joined",
            view_title: "组合",
            from: ["a"],
            columns: [
              { member: "active_employee_count", source: "a", as: "active_employee_count" },
            ],
          },
        ],
      },
      presentation: { type: "table" },
    };
    const result = applyBoardTimeOverride(derived, {
      window: { kind: "trailing", count: 12, unit: "month" },
      display: "month",
    });
    expect(result.status).toBe("unsupported");
    expect(result.spec).toBe(derived);
  });
});
