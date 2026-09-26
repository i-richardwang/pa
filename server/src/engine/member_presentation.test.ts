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
  test("有 shortTitle 时直接使用 shortTitle", () => {
    expect(memberDisplayTitle(views, "individual_fixture.employee_name", "人员名单 姓名")).toBe(
      "姓名",
    );
  });

  test("没有 shortTitle 时去掉所属 view 的标题前缀", () => {
    expect(memberDisplayTitle(views, "individual_fixture.employee_id", "人员名单 工号")).toBe(
      "工号",
    );
  });
});

describe("showDimensionNote", () => {
  test("维度只在声明 user_note 时展示口径说明", () => {
    expect(showDimensionNote(views[0].dimensions[0])).toBe(false);
    expect(showDimensionNote(views[0].dimensions[2])).toBe(true);
  });
});
