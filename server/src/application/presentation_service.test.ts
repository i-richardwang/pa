import { describe, expect, test } from "bun:test";
import type { QueryRunResult } from "./query_pipeline.js";
import type { PresentationSpec } from "../presentation_core/presentation_spec.js";
import type { ViewBlock } from "../semantic_core/query_payload.js";
import { createPresentationService } from "./presentation_service.js";

const flatTableLayout = { rows: [], columns: [] };

const presentation: PresentationSpec = {
  type: "bar",
  x: "organization_name",
  y: ["active_employee_count"],
  tableLayout: flatTableLayout,
};

const tableLayout = {
  rows: [{ kind: "field" as const, column: "organization_name" }],
  columns: [{ kind: "field" as const, column: "degree" }, { kind: "metrics" as const }],
};

const block = (rows: ViewBlock["rows"]): ViewBlock => ({
  id: "result",
  columns: ["organization_name", "active_employee_count"],
  column_roles: { organization_name: "dimension", active_employee_count: "measure" },
  column_formats: { active_employee_count: "number" },
  rows,
  row_count: rows.length,
  query_notes: [
    { member: "v.organization_name", title: "组织", text: "组织口径" },
    { member: "v.active_employee_count", title: "在职人数", text: "在职口径" },
  ],
});

const result = (rows: ViewBlock["rows"]): QueryRunResult => {
  const view = block(rows);
  return {
    payload: {
      observation_scopes: ["统计范围"],
      data_as_of: "2026-07",
      time_context: [],
      view,
    },
    fullRowViewBlock: view,
    decl: {
      type: "bar",
      x: "organization_name",
      y: ["active_employee_count"],
      tableLayout: flatTableLayout,
    },
  };
};

const pivotResult = (rows: ViewBlock["rows"]): QueryRunResult => {
  const view: ViewBlock = {
    ...block(rows),
    columns: ["organization_name", "degree", "active_employee_count"],
    column_roles: {
      organization_name: "dimension",
      degree: "dimension",
      active_employee_count: "measure",
    },
  };
  return {
    payload: {
      observation_scopes: ["统计范围"],
      data_as_of: "2026-07",
      time_context: [],
      view,
    },
    fullRowViewBlock: view,
    decl: { type: "table", y: [], tableLayout },
  };
};

describe("presentation service runtime fallback", () => {
  test("空结果不伪造图表，说明保留图表声明", () => {
    const service = createPresentationService();
    const executed = result([]);
    expect(service.compile(executed)).toMatchObject({ type: "table" });
    expect(service.runtimeFallbacks(executed, presentation)).toEqual([
      {
        result_view_id: "result",
        kind: "empty_result",
        note: expect.stringContaining("结果为空"),
      },
    ]);
  });

  test("非空但形态画不出声明图表时给出降级说明", () => {
    const service = createPresentationService();
    const executed = result([
      ["研发", 10],
      ["研发", 8],
    ]);
    expect(service.compile(executed)).toMatchObject({ type: "table" });
    expect(service.runtimeFallbacks(executed, presentation)).toEqual([
      {
        result_view_id: "result",
        kind: "unsupported_shape",
        note: expect.stringContaining("已按表格呈现"),
      },
    ]);
  });

  test("数据形态满足声明时生成图表且不附降级说明", () => {
    const service = createPresentationService();
    const executed = result([
      ["研发", 10],
      ["销售", 8],
    ]);
    expect(service.compile(executed)).toMatchObject({
      type: "bar",
      chart: { form: "bar" },
    });
    expect(service.runtimeFallbacks(executed, presentation)).toEqual([]);
  });

  test("列轴生效时无降级说明", () => {
    const service = createPresentationService();
    const executed = pivotResult([
      ["研发", "本科", 10],
      ["研发", "硕士", 8],
      ["销售", "本科", 6],
      ["销售", "硕士", 4],
    ]);
    expect(service.compile(executed)).toMatchObject({
      type: "table",
      table_layout: { state: "applied" },
    });
    expect(
      service.runtimeFallbacks(executed, {
        type: "table",
        tableLayout,
        y: [],
      }),
    ).toEqual([]);
  });

  test("列轴坐标重复时明确说明不可用，空结果保留声明", () => {
    const service = createPresentationService();
    const presentation: PresentationSpec = {
      type: "table",
      tableLayout,
      y: [],
    };
    const degraded = pivotResult([
      ["研发", "本科", 10],
      ["研发", "本科", 8],
    ]);
    expect(service.compile(degraded)).toMatchObject({
      type: "table",
      table_layout: { state: "unavailable", reason: "duplicate_coordinate" },
    });
    expect(service.runtimeFallbacks(degraded, presentation)).toEqual([
      {
        result_view_id: "result",
        kind: "unsupported_shape",
        note: expect.stringContaining("表格布局未生效"),
      },
    ]);

    const empty = pivotResult([]);
    expect(service.runtimeFallbacks(empty, presentation)).toEqual([]);
  });
});
