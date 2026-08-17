import { describe, expect, test } from "bun:test";
import type { AnalysisSpec } from "../semantic_core/analysis_spec.js";
import { exportableOutput, planExecution } from "../semantic_core/execution_plan.js";

const query = (id: string) => ({
  id,
  view_title: `查询结果 ${id}`,
  measures: ["test_people_metrics.active_employee_count"],
  time: {},
});

describe("export capability", () => {
  test("唯一结果是直查节点时可导出", () => {
    expect(exportableOutput(planExecution({ views: [query("only")] }))?.id).toBe("only");
  });

  test("唯一结果是派生节点时不可回退导出内部执行腿", () => {
    const spec: AnalysisSpec = {
      views: [
        query("source"),
        {
          id: "derived",
          view_title: "派生",
          from: ["source"],
          columns: [{ col: "active_employee_count", source: "source" }],
        },
      ],
    };
    const plan = planExecution(spec);
    expect(plan.output.id).toBe("derived");
    expect(exportableOutput(plan)).toBeUndefined();
  });

  test("多个独立终点不是合法分析", () => {
    expect(() => planExecution({ views: [query("first"), query("second")] })).toThrow(
      /一次分析只能回答一个问题/,
    );
  });
});
