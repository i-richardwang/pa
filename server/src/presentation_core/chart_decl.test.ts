import { describe, expect, test } from "bun:test";
import { CHART_DECL_SCHEMA } from "./chart_decl.js";

const table = { type: "table" };

describe("public chart declaration", () => {
  test("解析结果可以无损 JSON 往返", () => {
    const parsed = CHART_DECL_SCHEMA.parse(table);
    expect(CHART_DECL_SCHEMA.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  test("缺少必备通道或使用该图型没有的通道时解析失败", () => {
    const parse = (decl: Record<string, unknown>) => () => CHART_DECL_SCHEMA.parse(decl);
    // 缺少必备通道
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

  test("同一系列不能同时在主轴和副轴，有拆分通道时不能用副轴", () => {
    expect(() =>
      CHART_DECL_SCHEMA.parse({
        type: "bar",
        x: "organization_name",
        y: ["active_employee_count"],
        y2: ["active_employee_count"],
      }),
    ).toThrow("bar 图中同一指标不能同时放在主轴和副轴");
    expect(() =>
      CHART_DECL_SCHEMA.parse({
        type: "line",
        y: ["active_employee_count"],
        y2: ["ytd_primary_event_rate"],
        groupBy: "organization_name",
      }),
    ).toThrow("line 图使用拆分维度时只能有一个指标");
    expect(() =>
      CHART_DECL_SCHEMA.parse({ type: "pie", x: "organization_name", y: ["a"], y2: ["b"] }),
    ).toThrow();
  });

  test("有拆分通道时值通道只能有一个系列", () => {
    expect(() =>
      CHART_DECL_SCHEMA.parse({
        type: "line",
        y: ["active_employee_count", "new_hire_count"],
        groupBy: "organization_name",
      }),
    ).toThrow("line 图使用拆分维度时只能有一个指标");
    expect(
      CHART_DECL_SCHEMA.parse({
        type: "line",
        y: ["active_employee_count"],
        groupBy: "organization_name",
      }),
    ).toEqual({ type: "line", y: ["active_employee_count"], groupBy: "organization_name" });
  });
});
