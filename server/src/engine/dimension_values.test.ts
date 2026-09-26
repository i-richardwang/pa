import { describe, expect, test } from "bun:test";
import {
  DIMENSION_VALUES_CAP,
  DIMENSION_VALUES_SCAN_LIMIT,
  dimensionValuesQuery,
  findSearchableDimension,
} from "./dimension_values.js";
import type { CubeView } from "../ports/cube_gateway.js";

const views: CubeView[] = [
  {
    name: "test_people_metrics",
    title: "人员流动",
    measures: [
      { name: "test_people_metrics.active_employee_count", title: "在职人数", type: "number" },
    ],
    dimensions: [
      {
        name: "test_people_metrics.organization_name",
        title: "组织",
        type: "string",
      },
    ],
  },
  {
    name: "employee_attributes_fixture",
    title: "在职员工信息",
    measures: [],
    dimensions: [
      { name: "employee_attributes_fixture.age", title: "年龄", type: "number" },
      {
        name: "employee_attributes_fixture.assessment_year",
        title: "评定年份",
        type: "number",
        meta: { dimension_kind: "categorical" },
      },
    ],
  },
];

describe("findSearchableDimension", () => {
  test("公开的 string 维度可搜索并返回成员", () => {
    const d = findSearchableDimension(views, "test_people_metrics.organization_name");
    expect(d.title).toBe("组织");
  });

  test("普通数值维度不可搜索，声明 categorical 的数值维度可搜索", () => {
    expect(() => findSearchableDimension(views, "employee_attributes_fixture.age")).toThrow(
      "不是可搜索的分类维度",
    );
    expect(
      findSearchableDimension(views, "employee_attributes_fixture.assessment_year").title,
    ).toBe("评定年份");
  });

  test("度量和未知成员报错，并提示使用语义维度 id", () => {
    expect(() =>
      findSearchableDimension(views, "test_people_metrics.active_employee_count"),
    ).toThrow("语义维度 id");
    expect(() => findSearchableDimension(views, "nope.nope")).toThrow("语义维度 id");
  });
});

describe("dimensionValuesQuery", () => {
  test("查询维度 distinct 值并升序，为 null 和空串多取三行", () => {
    const q = dimensionValuesQuery("test_people_metrics.organization_name");
    expect(q.dimensions).toEqual(["test_people_metrics.organization_name"]);
    expect(q.filters).toBeUndefined();
    expect(q.order).toEqual([["test_people_metrics.organization_name", "asc"]]);
    expect(q.limit).toBe(DIMENSION_VALUES_SCAN_LIMIT);
    expect(q.limit).toBe(DIMENSION_VALUES_CAP + 3);
  });

  test("contains 组装为该维度的子串过滤", () => {
    const q = dimensionValuesQuery("test_people_metrics.organization_name", "网约");
    expect(q.filters).toEqual([
      {
        member: "test_people_metrics.organization_name",
        operator: "contains",
        values: ["网约"],
      },
    ]);
  });
});
