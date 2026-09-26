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

describe("绑定与默认值", () => {
  test("line 未声明 y 时使用全部度量，输出载荷列短名", () => {
    expect(bindChartDecl({ type: "line" }, TREND)).toEqual({
      type: "line",
      y: ["new_hire_count", "leave_count"],
    });
  });

  test("y2 绑定为副轴系列，未声明 y 时使用副轴之外的全部度量", () => {
    expect(bindChartDecl({ type: "line", y2: ["test_people_metrics.leave_count"] }, TREND)).toEqual(
      {
        type: "line",
        y: ["new_hire_count"],
        y2: ["leave_count"],
      },
    );
    expect(() =>
      bindChartDecl({ type: "line", y: ["leave_count"], y2: ["leave_count"] }, TREND),
    ).toThrow(/同时在主轴与副轴/);
    expect(() =>
      bindChartDecl(
        { type: "line", y: ["new_hire_count"], y2: ["leave_count"], group_by: "organization_name" },
        SPLIT,
      ),
    ).toThrow(/只能有一个指标/);
    expect(() => bindChartDecl({ type: "line", y2: ["gone"] }, TREND)).toThrow(/副轴指标（y2）/);
  });

  test("绑定接受成员全名或列短名，输出短名", () => {
    expect(
      bindChartDecl(
        { type: "bar", x: "test_people_metrics.organization_name", y: ["active_employee_count"] },
        CATEGORY,
      ),
    ).toEqual({ type: "bar", x: "organization_name", y: ["active_employee_count"] });
  });

  test("display 的度量名换成短名，value_labels 原样保留", () => {
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

  test("bar 的辅助标注与 Y 轴系列分别绑定", () => {
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

  test("bar 除 group_by 外只剩一个维度时可以省略 x", () => {
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

  test("pie 只有一个度量和一个维度时无需声明通道", () => {
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

  test("table 未声明列轴时声明中没有 tableColumns", () => {
    expect(bindChartDecl({ type: "table" }, CATEGORY)).toEqual({ type: "table" });
  });

  test("table 的 columns 按顺序绑定为列轴", () => {
    expect(
      bindChartDecl({ type: "table", columns: ["test_people_metrics.job_level_band"] }, CATEGORY),
    ).toEqual({
      type: "table",
      tableColumns: [{ kind: "field", column: "job_level_band" }, { kind: "metrics" }],
    });
  });

  test("table 省略 metrics 时指标轴自动放在时间轴外层", () => {
    expect(bindChartDecl({ type: "table", columns: ["time"] }, TREND)).toEqual({
      type: "table",
      tableColumns: [{ kind: "metrics" }, { kind: "time", level: "bucket" }],
    });
    expect(bindChartDecl({ type: "table", columns: ["time", "metrics"] }, TREND)).toEqual({
      type: "table",
      tableColumns: [{ kind: "time", level: "bucket" }, { kind: "metrics" }],
    });
  });

  test("table 的热力着色原样写入声明", () => {
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

describe("各图型的通道", () => {
  test("图型不支持的通道在类型检查时报错", () => {
    // @ts-expect-error 指标卡没有任何数据通道
    const kpi: UnboundChart = { type: "kpi", y: ["new_hire_count"] };
    // @ts-expect-error 折线的横轴是时间，没有分类轴通道
    const line: UnboundChart = { type: "line", x: "organization_name" };
    // @ts-expect-error 饼图没有拆分通道
    const pie: UnboundChart = { type: "pie", group_by: "job_level_band" };
    // @ts-expect-error 只有柱状图有堆叠
    const stacked: UnboundChart = { type: "line", stack: true };
    // @ts-expect-error 只有表格有列轴和热力着色
    const table: UnboundChart = { type: "bar", columns: ["metrics"] };
    expect([kpi, line, pie, stacked, table]).toHaveLength(5);
  });
});

describe("绑定错误提示", () => {
  test("值通道引用未查询度量", () => {
    expect(() => bindChartDecl({ type: "line", y: ["active_employee_count"] }, TREND)).toThrow(
      /指标（y）的「active_employee_count」不在这次查询的结果里/,
    );
  });

  test("分类轴引用未查询维度", () => {
    expect(() => bindChartDecl({ type: "bar", x: "degree" }, CATEGORY)).toThrow(
      /分类轴的「degree」不在这次查询的结果里/,
    );
  });

  test("系列设置引用了未查询的指标时报错", () => {
    expect(() =>
      bindChartDecl(
        { type: "line", display: { active_employee_count: { color: "#123abc" } } },
        TREND,
      ),
    ).toThrow(/系列设置（series）的「active_employee_count」/);
  });

  test("分类轴与拆分维度都不能用时间", () => {
    expect(() => bindChartDecl({ type: "bar", x: "year" }, CATEGORY)).toThrow(
      /分类轴不能用时间.*折线/,
    );
    expect(() =>
      bindChartDecl({ type: "line", group_by: "year", y: ["new_hire_count"] }, TREND),
    ).toThrow(/拆分维度不能用时间/);
  });

  test("按维度拆分系列时只能画一个指标", () => {
    expect(() => bindChartDecl({ type: "line", group_by: "organization_name" }, SPLIT)).toThrow(
      /只能有一个指标/,
    );
  });

  test("多个维度时必须声明分类轴，且不能与拆分维度相同", () => {
    expect(() => bindChartDecl({ type: "bar" }, CATEGORY)).toThrow(/需要指定一个分类维度/);
    expect(() =>
      bindChartDecl(
        { type: "bar", x: "organization_name", group_by: "individual_fixture.organization_name" },
        CATEGORY,
      ),
    ).toThrow(/不能是同一个维度/);
  });

  test("pie 有多个度量时必须用 y 选定一个", () => {
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
    // 这里不检查结果是否有时间轴；没有时由呈现层降级并说明。
    expect(bindChartDecl({ type: "table", columns: ["time"] }, CATEGORY)).toMatchObject({
      tableColumns: [{ kind: "metrics" }, { kind: "time", level: "bucket" }],
    });
    expect(() =>
      bindChartDecl({ type: "table", columns: ["metrics", "metrics"] }, CATEGORY),
    ).toThrow(/列轴不能重复/);
    expect(() =>
      bindChartDecl({ type: "table", columns: ["metrics"] }, { measures: [], dimensions: [] }),
    ).toThrow(/列轴包含 metrics 时，查询必须至少包含一个指标/);
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
