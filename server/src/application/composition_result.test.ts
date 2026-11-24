import { expect, test } from "bun:test";
import type { EngineViewBlock } from "../engine/transform.js";
import type { CompositionExecution } from "../semantic_core/execution_plan.js";
import { composeColumnResults } from "./composition_result.js";

const composition: CompositionExecution = {
  group: {
    id: "dimension:department_id",
    title: "部门编码",
    label: { id: "dimension:department_name", title: "部门" },
  },
  columns: [
    {
      id: "current",
      source: { query: "column_1", labels: "label_1" },
      member: "measure:headcount",
      title: "在职人数",
      time: { window: { kind: "current_month", month: "2026-06" } },
    },
    {
      id: "previous",
      source: { query: "column_2", labels: "label_2" },
      member: "measure:headcount",
      title: "在职人数",
      time: { window: { kind: "current_month", month: "2026-05" } },
    },
    {
      id: "plan",
      member: "measure:plan",
      title: "编制",
      time: { window: { kind: "current_month", month: "2026-12" } },
    },
  ],
};

function result(
  id: string,
  column: string,
  role: "dimension" | "measure",
  rows: EngineViewBlock["rows"],
): EngineViewBlock {
  return {
    id,
    columns: ["department_id", column],
    column_roles: { department_id: "dimension", [column]: role },
    rows,
    row_count: rows.length,
    query_notes: [],
  };
}

const results = new Map<string, EngineViewBlock>([
  [
    "column_1",
    result("column_1", "headcount", "measure", [
      ["first", 10],
      ["second", 0],
      [null, 99],
    ]),
  ],
  [
    "column_2",
    result("column_2", "headcount", "measure", [
      ["first", 8],
      ["third", 3],
    ]),
  ],
  [
    "label_1",
    result("label_1", "department_name", "dimension", [
      ["first", "同名"],
      ["second", "同名"],
    ]),
  ],
  [
    "label_2",
    result("label_2", "department_name", "dimension", [
      ["first", "旧名"],
      ["third", "其他"],
    ]),
  ],
]);

test("组合列以实体键对齐，区分同名与缺值，保留真实零", () => {
  const combined = composeColumnResults("result", composition, results);
  expect(combined.rows).toEqual([
    ["first", "同名", 10, 8, null],
    ["second", "同名", 0, null, null],
    ["third", "其他", null, 3, null],
  ]);
  expect(combined.column_periods?.plan?.status).toBe("unsupported_grain");
  expect(combined.query_notes).toContainEqual(expect.objectContaining({ title: "缺少实体标识" }));
  const baseline = composeColumnResults(
    "result",
    { ...composition, baseline: "previous" },
    results,
  );
  expect(baseline.rows).toEqual([
    ["first", "旧名", 10, 8, null],
    ["third", "其他", null, 3, null],
  ]);
});

test("单列中同一实体键重复出现时拒绝组合", () => {
  const duplicate = new Map(results);
  duplicate.set(
    "column_1",
    result("column_1", "headcount", "measure", [
      ["first", 10],
      ["first", 8],
    ]),
  );
  expect(() => composeColumnResults("result", composition, duplicate)).toThrow("重复实体键");
});

test("声明了指标或标签来源的组合列必须收到对应结果", () => {
  for (const id of ["column_1", "label_1"]) {
    const partial = new Map(results);
    partial.delete(id);
    expect(() => composeColumnResults("result", composition, partial)).toThrow(
      `组合表缺少查询结果 ${id}`,
    );
  }
});

test("实体粒度不可用时保留列选择的相对窗口", () => {
  const combined = composeColumnResults(
    "result",
    {
      ...composition,
      columns: composition.columns.map((column) =>
        column.id === "plan" ? { ...column, time: { window: { kind: "year_to_date" } } } : column,
      ),
    },
    results,
  );
  expect(combined.column_periods?.plan).toEqual({
    metric_id: "measure:plan",
    status: "unsupported_grain",
  });
  expect(combined.query_notes.find((note) => note.member === "plan")?.title).toContain("今年至今");
});

test("名称来源的投影必须包含登记的名称维度", () => {
  const blocks = new Map(results);
  blocks.set("label_1", result("label_1", "another_dimension", "dimension", []));
  expect(() => composeColumnResults("result", composition, blocks)).toThrow("缺少实体键或名称");
});
