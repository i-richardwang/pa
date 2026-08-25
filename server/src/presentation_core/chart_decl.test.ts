import { describe, expect, test } from "bun:test";
import { CHART_DECL_SCHEMA } from "./chart_decl.js";

const table = { type: "table" };

describe("public chart declaration", () => {
  test("接受当前完整合同并可无损 JSON 往返", () => {
    const parsed = CHART_DECL_SCHEMA.parse(table);
    expect(CHART_DECL_SCHEMA.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  test("通道只属于声明了它的图型：形状本身即校验", () => {
    const parse = (decl: Record<string, unknown>) => () => CHART_DECL_SCHEMA.parse(decl);
    // 必备通道缺席
    expect(parse({ type: "bar", y: ["active_employee_count"] })).toThrow();
    expect(parse({ type: "pie", y: ["active_employee_count"] })).toThrow();
    expect(parse({ type: "line", y: [] })).toThrow();
    // 该图型没有的通道
    expect(parse({ type: "line", x: "organization_name", y: ["active_employee_count"] })).toThrow();
    expect(
      parse({ type: "pie", x: "org", y: ["active_employee_count"], groupBy: "job_level" }),
    ).toThrow();
    expect(parse({ type: "table", y: ["active_employee_count"] })).toThrow();
    expect(parse({ type: "kpi", tableColumns: [{ kind: "metrics" }] })).toThrow();
    expect(
      parse({
        type: "bar",
        x: "org",
        y: ["active_employee_count"],
        shading: { palette: "#3b6fdb" },
      }),
    ).toThrow();
    expect(parse({ ...table, unexpected: true })).toThrow();
  });

  test("拆分通道占掉系列来源时值通道只剩一个位置", () => {
    expect(() =>
      CHART_DECL_SCHEMA.parse({
        type: "line",
        y: ["active_employee_count", "new_hire_count"],
        groupBy: "organization_name",
      }),
    ).toThrow("line 呈现声明拆分通道时值通道只容一个系列");
    expect(
      CHART_DECL_SCHEMA.parse({
        type: "line",
        y: ["active_employee_count"],
        groupBy: "organization_name",
      }),
    ).toEqual({ type: "line", y: ["active_employee_count"], groupBy: "organization_name" });
  });
});
