import { describe, expect, test } from "bun:test";
import type { CubeView } from "../ports/cube_gateway.js";
import { memberDisplayTitle, showDimensionNote } from "./member_presentation.js";

const views = [
  {
    name: "individual_fixture",
    title: "人员名单",
    measures: [],
    dimensions: [
      {
        name: "individual_fixture.employee_name",
        title: "人员名单 姓名",
        shortTitle: "姓名",
        type: "string",
      },
      { name: "individual_fixture.employee_id", title: "人员名单 工号", type: "string" },
      {
        name: "individual_fixture.special",
        title: "人员名单 特殊口径",
        type: "string",
        meta: { user_note: true },
      },
    ],
  },
] satisfies CubeView[];

describe("memberDisplayTitle", () => {
  test("单个成员也按 shortTitle 去掉 view 前缀", () => {
    expect(memberDisplayTitle(views, "individual_fixture.employee_name", "人员名单 姓名")).toBe(
      "姓名",
    );
  });

  test("shortTitle 缺失时按所属 view 精确去前缀", () => {
    expect(memberDisplayTitle(views, "individual_fixture.employee_id", "人员名单 工号")).toBe(
      "工号",
    );
  });
});

describe("showDimensionNote", () => {
  test("维度默认不进入用户口径，仅显式声明者进入", () => {
    expect(showDimensionNote(views[0].dimensions[0])).toBe(false);
    expect(showDimensionNote(views[0].dimensions[2])).toBe(true);
  });
});
