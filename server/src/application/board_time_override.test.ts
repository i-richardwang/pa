import { describe, expect, test } from "bun:test";
import type { AnalysisDefinition } from "../semantic_core/semantic_analysis.js";
import { applyBoardTimeOverride } from "./board_time_override.js";

const singleView: AnalysisDefinition = {
  query: {
    measures: ["active_employee_count"],
    time: {
      window: { kind: "trailing", count: 6, unit: "month", grain: "month" },
      comparison: { kind: "previous_year" },
    },
  },
};

describe("applyBoardTimeOverride", () => {
  test("单 query view：整体替换 time 并丢弃自身 compare", () => {
    const override = {
      window: {
        kind: "trailing" as const,
        count: 12,
        unit: "month" as const,
        grain: "month" as const,
      },
    };
    const result = applyBoardTimeOverride(singleView, override);
    expect(result.status).toBe("applied");
    expect(result.definition.derived).toBeUndefined();
    expect(result.definition.query.time).toEqual(override);
    expect(result.definition.query.time.comparison).toBeUndefined();
  });

  test("含派生视图：unsupported", () => {
    const derived: AnalysisDefinition = {
      query: {
        view_title: "来源",
        measures: ["active_employee_count"],
        time: { window: { kind: "current_month" } },
      },
      derived: {
        view_title: "组合",
        columns: [
          { member: "active_employee_count", source: "query", as: "active_employee_count" },
        ],
      },
    };
    const result = applyBoardTimeOverride(derived, {
      window: { kind: "trailing", count: 12, unit: "month", grain: "month" },
    });
    expect(result.status).toBe("unsupported");
    expect(result.definition).toBe(derived);
  });
});
