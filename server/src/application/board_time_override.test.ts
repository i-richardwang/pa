import { describe, expect, test } from "bun:test";
import type { AnalysisDefinition } from "../semantic_core/semantic_analysis.js";
import { applyBoardTimeOverride } from "./board_time_override.js";

const singleView: AnalysisDefinition = {
  queries: [
    {
      id: "result",
      measures: ["active_employee_count"],
      time: {
        window: { kind: "trailing", count: 6, unit: "month", grain: "month" },
        comparison: { kind: "previous_year" },
      },
    },
  ],
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
    const view = result.definition.queries[0];
    expect(result.definition.derived).toBeUndefined();
    expect(view.time).toEqual(override);
    expect(view.time.comparison).toBeUndefined();
  });

  test("多 query view：unsupported，规格原样", () => {
    const multi: AnalysisDefinition = {
      queries: [
        {
          id: "a",
          measures: ["active_employee_count"],
          time: { window: { kind: "current_month" } },
        },
        {
          id: "b",
          measures: ["active_employee_count"],
          time: {
            window: { kind: "trailing", count: 3, unit: "month", grain: "month" },
          },
        },
      ],
    };
    const override = {
      window: {
        kind: "trailing" as const,
        count: 3,
        unit: "year" as const,
        grain: "year" as const,
      },
    };
    const result = applyBoardTimeOverride(multi, override);
    expect(result.status).toBe("unsupported");
    expect(result.definition).toBe(multi);
  });

  test("含派生视图：unsupported", () => {
    const derived: AnalysisDefinition = {
      queries: [
        {
          id: "a",
          view_title: "来源",
          measures: ["active_employee_count"],
          time: { window: { kind: "current_month" } },
        },
      ],
      derived: {
        view_title: "组合",
        columns: [{ member: "active_employee_count", source: "a", as: "active_employee_count" }],
      },
    };
    const result = applyBoardTimeOverride(derived, {
      window: { kind: "trailing", count: 12, unit: "month", grain: "month" },
    });
    expect(result.status).toBe("unsupported");
    expect(result.definition).toBe(derived);
  });
});
