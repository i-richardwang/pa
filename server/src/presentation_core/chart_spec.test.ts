/** 声明与结果的绑定；运行时数据守卫在 view_shape/chart_config 测。 */
import { describe, expect, test } from "bun:test";
import { bindChartDecl, type ChartSpecContext, type UnboundChart } from "./chart_spec.js";

const TREND: ChartSpecContext = {
  measures: ["test_people_metrics.new_hire_count", "test_people_metrics.leave_count"],
  dimensions: [],
};

const CATEGORY: ChartSpecContext = {
  measures: ["test_people_metrics.active_employee_count"],
  dimensions: ["test_people_metrics.organization_name", "test_people_metrics.job_level_band"],
};

const SPLIT: ChartSpecContext = {
  ...TREND,
  dimensions: ["test_people_metrics.organization_name"],
};

describe("绑定与缺省补齐", () => {
  test("line：y 缺省补齐为全部度量，输出载荷列短名", () => {
    expect(bindChartDecl({ type: "line" }, TREND)).toEqual({
      type: "line",
      y: ["new_hire_count", "leave_count"],
    });
  });

  test("绑定接受成员全名或列短名，归一为短名", () => {
    expect(
      bindChartDecl(
        { type: "bar", x: "test_people_metrics.organization_name", y: ["active_employee_count"] },
        CATEGORY,
      ),
    ).toEqual({ type: "bar", x: "organization_name", y: ["active_employee_count"] });
  });

  test("display 与 value_labels 按度量归一后透传", () => {
    expect(
      bindChartDecl(
        {
          type: "line",
          display: { "test_people_metrics.new_hire_count": { color: "#123abc" } },
          value_labels: "all",
        },
        TREND,
      ),
    ).toEqual(
      expect.objectContaining({
        display: { new_hire_count: { color: "#123abc" } },
        valueLabels: "all",
      }),
    );
  });

  test("bar：辅助标注绑定独立于 Y 轴系列", () => {
    expect(
      bindChartDecl(
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
      bindChartDecl({ type: "bar", group_by: "job_level_band", stack: true }, CATEGORY),
    ).toEqual({
      type: "bar",
      x: "organization_name",
      y: ["active_employee_count"],
      groupBy: "job_level_band",
      stack: true,
    });
  });

  test("pie：唯一度量 + 唯一维度时全靠缺省", () => {
    expect(
      bindChartDecl(
        { type: "pie" },
        {
          measures: ["test_people_metrics.active_employee_count"],
          dimensions: ["test_people_metrics.organization_name"],
        },
      ),
    ).toEqual({ type: "pie", x: "organization_name", y: ["active_employee_count"] });
  });

  test("table：不声明列轴即不进声明——缺省布局由结果裁决", () => {
    expect(bindChartDecl({ type: "table" }, CATEGORY)).toEqual({ type: "table" });
  });

  test("table：columns 绑定有序列轴并归一为内部布局", () => {
    expect(
      bindChartDecl({ type: "table", columns: ["test_people_metrics.job_level_band"] }, CATEGORY),
    ).toEqual({
      type: "table",
      tableColumns: [{ kind: "field", column: "job_level_band" }, { kind: "metrics" }],
    });
  });

  test("table：省略 metrics 时指标轴自动补在时间轴外层", () => {
    expect(bindChartDecl({ type: "table", columns: ["time"] }, TREND)).toEqual({
      type: "table",
      tableColumns: [{ kind: "metrics" }, { kind: "time", level: "bucket" }],
    });
    expect(bindChartDecl({ type: "table", columns: ["time", "metrics"] }, TREND)).toEqual({
      type: "table",
      tableColumns: [{ kind: "time", level: "bucket" }, { kind: "metrics" }],
    });
  });

  test("table：热力着色原样进声明", () => {
    expect(
      bindChartDecl(
        { type: "table", shading: { palette: "red_blue", flipped: true, values: false } },
        CATEGORY,
      ),
    ).toEqual(
      expect.objectContaining({ shading: { palette: "red_blue", flipped: true, values: false } }),
    );
  });

  test("kpi 只接受无分组的度量结果", () => {
    expect(bindChartDecl({ type: "kpi" }, { measures: TREND.measures, dimensions: [] })).toEqual({
      type: "kpi",
    });
    expect(() => bindChartDecl({ type: "kpi" }, CATEGORY)).toThrow(/不接受分组维度/);
    expect(() => bindChartDecl({ type: "kpi" }, { measures: [], dimensions: [] })).toThrow(
      /需要至少一个指标/,
    );
  });
});

describe("通道只属于声明了它的图型", () => {
  test("形状本身即校验：装不下的通道写不出来", () => {
    // @ts-expect-error 指标卡没有任何数据通道
    const kpi: UnboundChart = { type: "kpi", y: ["new_hire_count"] };
    // @ts-expect-error 折线的横轴恒为时间，没有分类轴通道
    const line: UnboundChart = { type: "line", x: "organization_name" };
    // @ts-expect-error 饼图不拆系列，也没有视觉覆盖通道
    const pie: UnboundChart = { type: "pie", group_by: "job_level_band" };
    // @ts-expect-error 堆叠只属于柱状
    const stacked: UnboundChart = { type: "line", stack: true };
    // @ts-expect-error 列轴与热力着色只属于表格
    const table: UnboundChart = { type: "bar", columns: ["metrics"] };
    expect([kpi, line, pie, stacked, table]).toHaveLength(5);
  });
});

describe("可行动报错", () => {
  test("值通道引用未查询度量", () => {
    expect(() => bindChartDecl({ type: "line", y: ["active_employee_count"] }, TREND)).toThrow(
      /值通道的「active_employee_count」不在这次查询的结果里/,
    );
  });

  test("分类轴引用未查询维度", () => {
    expect(() => bindChartDecl({ type: "bar", x: "degree" }, CATEGORY)).toThrow(
      /分类轴的「degree」不在这次查询的结果里/,
    );
  });

  test("系列视觉设置引用未查询度量", () => {
    expect(() =>
      bindChartDecl(
        { type: "line", display: { active_employee_count: { color: "#123abc" } } },
        TREND,
      ),
    ).toThrow(/系列视觉设置的「active_employee_count」/);
  });

  test("分类轴与拆分维度都不能用时间", () => {
    expect(() => bindChartDecl({ type: "bar", x: "year" }, CATEGORY)).toThrow(
      /分类轴不能用时间.*折线/,
    );
    expect(() =>
      bindChartDecl({ type: "line", group_by: "year", y: ["new_hire_count"] }, TREND),
    ).toThrow(/拆分维度不能用时间/);
  });

  test("拆系列时只能画一个指标", () => {
    expect(() => bindChartDecl({ type: "line", group_by: "organization_name" }, SPLIT)).toThrow(
      /只能画一个指标/,
    );
  });

  test("多维度时分类轴不可省略，且不能与拆分维度同源", () => {
    expect(() => bindChartDecl({ type: "bar" }, CATEGORY)).toThrow(/需要指定一个分类维度/);
    expect(() =>
      bindChartDecl(
        { type: "bar", x: "organization_name", group_by: "individual_fixture.organization_name" },
        CATEGORY,
      ),
    ).toThrow(/不能是同一个维度/);
  });

  test("pie：多度量必须用 y 收窄", () => {
    expect(() =>
      bindChartDecl(
        { type: "pie", x: "organization_name" },
        { ...CATEGORY, measures: TREND.measures },
      ),
    ).toThrow(/饼图只能画一个指标/);
  });

  test("columns 只接受保留字或已查询维度，且不可重复", () => {
    expect(() => bindChartDecl({ type: "table", columns: ["degree"] }, CATEGORY)).toThrow(
      /列轴的「degree」不是时间、指标，也不是这次查询的维度/,
    );
    // 时间轴不在此裁决：输出粒度出自引擎，结果没有时间轴时由呈现层降级说明。
    expect(bindChartDecl({ type: "table", columns: ["time"] }, CATEGORY)).toMatchObject({
      tableColumns: [{ kind: "metrics" }, { kind: "time", level: "bucket" }],
    });
    expect(() =>
      bindChartDecl({ type: "table", columns: ["metrics", "metrics"] }, CATEGORY),
    ).toThrow(/列轴不能重复/);
    expect(() =>
      bindChartDecl({ type: "table", columns: ["metrics"] }, { measures: [], dimensions: [] }),
    ).toThrow(/列轴放指标时这次查询必须查了指标/);
  });

  test("辅助标注不能占用 Y 系列", () => {
    expect(() =>
      bindChartDecl(
        {
          type: "bar",
          x: "organization_name",
          y: ["active_employee_count"],
          annotations: ["active_employee_count"],
        },
        CATEGORY,
      ),
    ).toThrow(/不能同时是主系列和辅助标注/);
  });
});
