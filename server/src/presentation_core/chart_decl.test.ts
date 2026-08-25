import { describe, expect, test } from "bun:test";
import { CHART_DECL_SCHEMA } from "./chart_decl.js";

const table = {
  type: "table",
  y: [],
};

describe("public chart declaration", () => {
  test("接受当前完整合同并可无损 JSON 往返", () => {
    const parsed = CHART_DECL_SCHEMA.parse(table);
    expect(CHART_DECL_SCHEMA.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  test("通道容量是校验判据：该出现的必须在，没有的通道不许声明", () => {
    const parse = (decl: Record<string, unknown>) => () => CHART_DECL_SCHEMA.parse(decl);
    expect(parse({ type: "bar", y: ["active_employee_count"] })).toThrow("bar 呈现缺少分类轴 x");
    expect(parse({ type: "line", x: "organization_name", y: ["active_employee_count"] })).toThrow(
      "line 呈现的时间横轴无需声明 x",
    );
    expect(
      parse({
        type: "pie",
        x: "organization_name",
        y: ["active_employee_count"],
        groupBy: "job_level",
      }),
    ).toThrow("pie 呈现没有拆分通道");
    expect(
      parse({
        type: "line",
        y: ["active_employee_count", "new_hire_count"],
        groupBy: "organization_name",
      }),
    ).toThrow("line 呈现的值通道只容一个系列");
    // 装得下的声明照常通过
    expect(
      CHART_DECL_SCHEMA.parse({
        type: "line",
        y: ["active_employee_count"],
        groupBy: "organization_name",
      }).groupBy,
    ).toBe("organization_name");
  });

  test("未知字段与形态错配均 fail-closed", () => {
    expect(() => CHART_DECL_SCHEMA.parse({ ...table, unexpected: true })).toThrow();
    expect(() =>
      CHART_DECL_SCHEMA.parse({ ...table, type: "kpi", tableColumns: [{ kind: "metrics" }] }),
    ).toThrow("kpi 呈现不能包含表格列轴");
    expect(() =>
      CHART_DECL_SCHEMA.parse({
        ...table,
        type: "bar",
        x: "organization_name",
        y: ["active_employee_count"],
        tableColumns: [{ kind: "metrics" }],
      }),
    ).toThrow("bar 呈现不能包含表格列轴");
    expect(() =>
      CHART_DECL_SCHEMA.parse({
        ...table,
        type: "bar",
        x: "organization_name",
        y: ["active_employee_count"],
        shading: { palette: "#3b6fdb" },
      }),
    ).toThrow("bar 呈现不能包含表格着色");
  });
});
