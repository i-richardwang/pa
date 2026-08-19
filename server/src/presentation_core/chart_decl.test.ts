import { describe, expect, test } from "bun:test";
import { CHART_DECL_SCHEMA } from "./chart_decl.js";

const table = {
  type: "table",
  y: [],
  tableLayout: { rows: [], columns: [] },
};

describe("public chart declaration", () => {
  test("接受当前完整合同并可无损 JSON 往返", () => {
    const parsed = CHART_DECL_SCHEMA.parse(table);
    expect(CHART_DECL_SCHEMA.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  test("缺失布局、未知字段和形态错配均 fail-closed", () => {
    expect(() => CHART_DECL_SCHEMA.parse({ type: "table", y: [] })).toThrow();
    expect(() => CHART_DECL_SCHEMA.parse({ ...table, unexpected: true })).toThrow();
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
