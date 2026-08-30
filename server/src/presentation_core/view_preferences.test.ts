import { describe, expect, test } from "bun:test";
import { validateViewPreferences } from "./view_preferences.js";

describe("view preferences", () => {
  test("line/bar 接受人类系列样式与数值标签", () => {
    expect(
      validateViewPreferences(
        { type: "line", series: ["measure:active_employee_count"] },
        {
          series: {
            "measure:active_employee_count": {
              color: "#509ee3",
              mark: "bar",
            },
          },
          value_labels: "all",
        },
      ),
    ).toEqual({
      series: {
        "measure:active_employee_count": {
          color: "#509ee3",
          mark: "bar",
        },
      },
      value_labels: "all",
    });
  });

  test("动态拆分系列拒绝固定系列样式，main 标签也因没有主系列而拒绝", () => {
    const intent = {
      type: "bar" as const,
      category: "dimension:organization_name",
      series: ["measure:active_employee_count"],
      group_by: "dimension:job_level_band",
    };
    expect(() =>
      validateViewPreferences(intent, {
        series: { "measure:active_employee_count": { color: "#509ee3" } },
      }),
    ).toThrow(/不能声明固定指标系列偏好/);
    expect(() => validateViewPreferences(intent, { value_labels: "main" })).toThrow(/没有主系列/);
    expect(validateViewPreferences(intent, { value_labels: "all" })).toEqual({
      value_labels: "all",
    });
  });

  test("表格只接受热力样式，图形拒绝表格色阶", () => {
    const tableStyle = { table_shading: { palette: "red_blue" as const, flipped: true } };
    expect(validateViewPreferences({ type: "table" }, tableStyle)).toEqual(tableStyle);
    expect(() => validateViewPreferences({ type: "bar" }, tableStyle)).toThrow(/只支持 table/);
    expect(() => validateViewPreferences({ type: "table" }, { value_labels: "all" })).toThrow(
      /不接受系列样式或数值标签/,
    );
  });
});
