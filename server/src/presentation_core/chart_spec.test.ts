/** 呈现声明的静态校验；运行时数据守卫在 view_shape/chart_config 测。 */
import { describe, expect, test } from "bun:test";
import { validateChartDecl, type ChartSpecContext } from "./chart_spec.js";

const TREND: ChartSpecContext = {
  measures: ["test_people_metrics.new_hire_count", "test_people_metrics.leave_count"],
  dimensions: [],
};

const CATEGORY: ChartSpecContext = {
  measures: ["test_people_metrics.active_employee_count"],
  dimensions: ["test_people_metrics.organization_name", "test_people_metrics.job_level_band"],
};

describe("归一与缺省补齐", () => {
  test("line：y 缺省补齐为全部度量，输出载荷列短名", () => {
    expect(validateChartDecl({ type: "line" }, TREND)).toEqual({
      type: "line",
      y: ["new_hire_count", "leave_count"],
    });
  });

  test("display：按度量字段归一颜色声明", () => {
    expect(
      validateChartDecl(
        {
          type: "line",
          display: {
            series: {
              "test_people_metrics.new_hire_count": { color: "#123abc" },
            },
          },
        },
        TREND,
      ),
    ).toEqual(expect.objectContaining({ display: { new_hire_count: { color: "#123abc" } } }));
  });

  test("value_labels：line/bar 透传，table 拒绝，main 与 group_by 互斥", () => {
    expect(validateChartDecl({ type: "line", value_labels: "all" }, TREND)).toEqual(
      expect.objectContaining({ valueLabels: "all" }),
    );
    expect(() => validateChartDecl({ type: "table", value_labels: "all" }, TREND)).toThrow(
      /value_labels 仅支持 type=line 或 bar/,
    );
    expect(() =>
      validateChartDecl(
        {
          type: "line",
          y: ["new_hire_count"],
          group_by: "organization_name",
          value_labels: "main",
        },
        {
          measures: ["test_people_metrics.new_hire_count"],
          dimensions: ["test_people_metrics.organization_name"],
        },
      ),
    ).toThrow(/value_labels=main 与 group_by 互斥/);
  });

  test("绑定接受成员全名或列短名，归一为短名", () => {
    expect(
      validateChartDecl(
        { type: "bar", x: "test_people_metrics.organization_name", y: ["active_employee_count"] },
        CATEGORY,
      ),
    ).toMatchObject({ type: "bar", x: "organization_name", y: ["active_employee_count"] });
  });

  test("bar：辅助标注绑定独立于 Y 轴系列", () => {
    expect(
      validateChartDecl(
        {
          type: "bar",
          x: "organization_name",
          y: ["active_employee_count"],
          annotations: ["test_people_metrics.active_employee_share"],
        },
        {
          ...CATEGORY,
          measures: [
            "test_people_metrics.active_employee_count",
            "test_people_metrics.active_employee_share",
          ],
        },
      ),
    ).toMatchObject({
      type: "bar",
      x: "organization_name",
      y: ["active_employee_count"],
      annotations: ["active_employee_share"],
    });
  });

  test("bar：group_by 之外恰剩一个维度时 x 可省略自动补齐", () => {
    expect(
      validateChartDecl({ type: "bar", group_by: "job_level_band", stack: true }, CATEGORY),
    ).toMatchObject({
      type: "bar",
      x: "organization_name",
      y: ["active_employee_count"],
      groupBy: "job_level_band",
      stack: true,
    });
  });

  test("pie：唯一度量 + 唯一维度时全靠缺省", () => {
    expect(
      validateChartDecl(
        { type: "pie" },
        {
          measures: ["test_people_metrics.active_employee_count"],
          dimensions: ["test_people_metrics.organization_name"],
        },
      ),
    ).toMatchObject({ type: "pie", x: "organization_name", y: ["active_employee_count"] });
  });

  test("line：x 引用时间成员是无害确认，归一丢弃（与排序容忍同语义）", () => {
    expect(validateChartDecl({ type: "line", x: "year" }, TREND)).toMatchObject({
      type: "line",
      y: ["new_hire_count", "leave_count"],
    });
    expect(
      validateChartDecl({ type: "line", x: "test_people_metrics.month" }, TREND),
    ).toMatchObject({
      type: "line",
      y: ["new_hire_count", "leave_count"],
    });
  });

  test("table：不声明列轴即不进声明——缺省布局由结果裁决", () => {
    expect(validateChartDecl({ type: "table" }, CATEGORY)).toEqual({ type: "table" });
  });

  test("table：columns 绑定有序列轴并归一为内部布局", () => {
    expect(
      validateChartDecl(
        {
          type: "table",
          columns: ["test_people_metrics.job_level_band"],
        },
        CATEGORY,
      ),
    ).toEqual({
      type: "table",
      tableColumns: [{ kind: "field", column: "job_level_band" }, { kind: "metrics" }],
    });
  });

  test("table：年份与指标可组成两层列轴", () => {
    expect(validateChartDecl({ type: "table", columns: ["time", "metrics"] }, TREND)).toEqual({
      type: "table",
      tableColumns: [{ kind: "time", level: "bucket" }, { kind: "metrics" }],
    });
  });

  test("table：省略 metrics 时指标轴自动补在外层", () => {
    expect(validateChartDecl({ type: "table", columns: ["time"] }, TREND)).toEqual({
      type: "table",
      tableColumns: [{ kind: "metrics" }, { kind: "time", level: "bucket" }],
    });
  });

  test("kpi 只接受无分组的度量结果", () => {
    expect(
      validateChartDecl(
        { type: "kpi" },
        { measures: ["test_people_metrics.active_employee_count"], dimensions: [] },
      ),
    ).toEqual({
      type: "kpi",
    });
    expect(() => validateChartDecl({ type: "kpi" }, CATEGORY)).toThrow(/不接受分组维度/);
  });
});

describe("可行动报错", () => {
  test("shading 只随 table：图型带它就报错，table 带它原样进声明", () => {
    expect(() =>
      validateChartDecl({ type: "bar", shading: { palette: "#3b6fdb" } }, CATEGORY),
    ).toThrow(/presentation\.shading 仅支持 type=table/);
    expect(
      validateChartDecl(
        { type: "table", shading: { palette: "red_blue", flipped: true, values: false } },
        CATEGORY,
      ),
    ).toEqual(
      expect.objectContaining({ shading: { palette: "red_blue", flipped: true, values: false } }),
    );
  });

  test("y 引用未查询度量", () => {
    expect(() => validateChartDecl({ type: "line", y: ["active_employee_count"] }, TREND)).toThrow(
      /presentation\.y 的「active_employee_count」不在本视图 measures 中/,
    );
  });

  test("x 引用未查询维度", () => {
    expect(() => validateChartDecl({ type: "bar", x: "degree" }, CATEGORY)).toThrow(
      /presentation\.x 的「degree」不在本视图 dimensions 中/,
    );
  });

  test("line 的 x 引用分类维度是真歧义；指向 group_by", () => {
    expect(() =>
      validateChartDecl(
        { type: "line", x: "organization_name" },
        { ...TREND, dimensions: ["test_people_metrics.organization_name"] },
      ),
    ).toThrow(/横轴恒为时间.*group_by/);
  });

  test("bar/pie 的 x 引用时间成员：指回 line", () => {
    expect(() => validateChartDecl({ type: "bar", x: "year" }, CATEGORY)).toThrow(
      /时间轴只在 line 中呈现.*type:"line"/,
    );
  });

  test("group_by 引用时间成员：指向分类维度", () => {
    expect(() =>
      validateChartDecl({ type: "line", group_by: "year", y: ["new_hire_count"] }, TREND),
    ).toThrow(/group_by 不能引用时间成员/);
  });

  test("group_by 与多度量互斥", () => {
    expect(() =>
      validateChartDecl(
        { type: "line", group_by: "organization_name" },
        { ...TREND, dimensions: ["test_people_metrics.organization_name"] },
      ),
    ).toThrow(/只支持单一度量/);
  });

  test("stack 仅用于 bar 且需 group_by", () => {
    expect(() => validateChartDecl({ type: "bar", stack: true }, CATEGORY)).toThrow(
      /stack 仅用于 bar 且需同时声明 group_by/,
    );
    expect(() => validateChartDecl({ type: "line", stack: true }, TREND)).toThrow(
      /stack 仅用于 bar/,
    );
  });

  test("bar 多维度时 x 不可省略", () => {
    expect(() => validateChartDecl({ type: "bar" }, CATEGORY)).toThrow(/无法确定分类轴.*x 指定/);
  });

  test("x 与 group_by 不能同维度", () => {
    expect(() =>
      validateChartDecl(
        { type: "bar", x: "organization_name", group_by: "individual_fixture.organization_name" },
        CATEGORY,
      ),
    ).toThrow(/不能是同一维度/);
  });

  test("pie：多度量必须用 y 收窄；不接受 group_by", () => {
    expect(() =>
      validateChartDecl(
        { type: "pie", x: "organization_name" },
        { ...CATEGORY, measures: TREND.measures },
      ),
    ).toThrow(/需要唯一度量/);
    expect(() =>
      validateChartDecl(
        { type: "pie", x: "organization_name", group_by: "job_level_band" },
        CATEGORY,
      ),
    ).toThrow(/不接受 group_by/);
  });

  test("table 只接受 columns，不接受图形通道", () => {
    expect(() =>
      validateChartDecl({ type: "table", y: ["active_employee_count"] }, CATEGORY),
    ).toThrow(/不接受 x\/y\/annotations\/group_by\/stack/);
  });

  test("columns 仅用于 table", () => {
    expect(() =>
      validateChartDecl(
        { type: "bar", columns: ["job_level_band"], x: "organization_name" },
        CATEGORY,
      ),
    ).toThrow(/columns 仅支持 type=table/);
  });

  test("columns 只接受保留字或已查询维度，且不可重复", () => {
    expect(() => validateChartDecl({ type: "table", columns: ["degree"] }, CATEGORY)).toThrow(
      /columns 的「degree」不是 time、metrics 或本视图 dimensions 中的成员/,
    );
    // 时间轴不在此裁决：输出粒度出自引擎，结果没有时间轴时由呈现层降级说明。
    expect(validateChartDecl({ type: "table", columns: ["time"] }, CATEGORY)).toMatchObject({
      tableColumns: [{ kind: "metrics" }, { kind: "time", level: "bucket" }],
    });
    expect(() =>
      validateChartDecl({ type: "table", columns: ["metrics", "metrics"] }, CATEGORY),
    ).toThrow(/不能包含重复列轴/);
  });

  test("pie 带 display 拒绝", () => {
    expect(() =>
      validateChartDecl(
        { type: "pie", display: { series: { active_employee_count: { color: "#123abc" } } } },
        CATEGORY,
      ),
    ).toThrow(/display 仅支持 type=line 或 bar/);
  });

  test("table 带 display 拒绝", () => {
    expect(() =>
      validateChartDecl(
        { type: "table", display: { series: { active_employee_count: { color: "#123abc" } } } },
        CATEGORY,
      ),
    ).toThrow(/display 仅支持 type=line 或 bar/);
  });

  test("display 与 group_by 互斥", () => {
    expect(() =>
      validateChartDecl(
        {
          type: "line",
          y: ["new_hire_count"],
          group_by: "organization_name",
          display: { series: { new_hire_count: { color: "#123abc" } } },
        },
        { ...TREND, dimensions: ["test_people_metrics.organization_name"] },
      ),
    ).toThrow(/display 与 group_by 互斥/);
  });

  test("display key 必须引用本视图已查询度量", () => {
    expect(() =>
      validateChartDecl(
        { type: "line", display: { series: { active_employee_count: { color: "#123abc" } } } },
        TREND,
      ),
    ).toThrow(/display\.series 的「active_employee_count」不在本视图 measures 中/);
  });

  test("辅助标注不能占用 Y 系列，且只用于 bar", () => {
    const context = {
      ...CATEGORY,
      measures: [
        "test_people_metrics.active_employee_count",
        "test_people_metrics.active_employee_share",
      ],
    };
    expect(() =>
      validateChartDecl(
        {
          type: "bar",
          x: "organization_name",
          y: ["active_employee_count"],
          annotations: ["active_employee_count"],
        },
        context,
      ),
    ).toThrow(/不能同时进入 presentation\.y 与 presentation\.annotations/);
    expect(() =>
      validateChartDecl(
        {
          type: "line",
          y: ["active_employee_count"],
          annotations: ["active_employee_share"],
        },
        context,
      ),
    ).toThrow(/annotations 仅支持 type=bar/);
  });
});
