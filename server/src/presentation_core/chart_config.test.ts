/**
 * 服务端图表配置单测：按形态逐一验证 option 的结构性事实——图型、系列、轴、
 * 项目视觉常量（色板/网格）与 pa 扩展块（格式声明、占比注释）。
 * option 的完整视觉细节不逐键断言（那是 echarts 的输入，渲染端整体消费）。
 */
import { describe, expect, test } from "bun:test";
import {
  buildViewChart,
  compilePresentationBlock,
  isViewChart,
  isPresentationBlock,
  RANK_ROW,
  SERIES_COLORS,
  type PaChartExtension,
} from "./chart_config.js";
import type { ColumnFormat, ViewBlock } from "../semantic_core/query_payload.js";
import type { SeriesDisplay } from "./view_shape.js";

type Cell = string | number | null;

function view(
  columns: string[],
  rows: Cell[][],
  extras: {
    formats?: Record<string, ColumnFormat>;
    shares?: ViewBlock["structure_shares"];
    roles?: ViewBlock["column_roles"];
    decimals?: Record<string, number>;
  } = {},
): ViewBlock {
  const defaultRoles = Object.fromEntries(
    columns.map((column, index) => {
      if (column === "year" || column === "month") return [column, "time"];
      const values = rows.map((row) => row[index]).filter((value) => value !== null);
      return [
        column,
        values.length && values.every((value) => Number.isFinite(Number(value)))
          ? "measure"
          : "dimension",
      ];
    }),
  ) as ViewBlock["column_roles"];
  return {
    id: "result",
    columns,
    column_roles: extras.roles ?? defaultRoles,
    rows,
    row_count: rows.length,
    query_notes: [
      { member: "active_employee_count", title: "在职人数", text: "" },
      { member: "ytd_primary_event_rate", title: "YTD主要事件率", text: "" },
    ],
    ...(extras.formats ? { column_formats: extras.formats } : {}),
    ...(extras.decimals ? { column_decimals: extras.decimals } : {}),
    ...(extras.shares ? { structure_shares: extras.shares } : {}),
  };
}

/** 真系列：折线的垫层追加在它们之后，形态断言只看前几条 */
function realSeries<T>(chart: { option: Record<string, unknown> }): T[] {
  return (chart.option.series as T[]).slice(0, pa(chart).legend?.length ?? 0);
}

function pa(chart: { option: Record<string, unknown> }): PaChartExtension {
  return chart.option.pa as PaChartExtension;
}

describe("趋势折线", () => {
  const chart = buildViewChart(
    view(
      ["year", "month", "active_employee_count"],
      [
        [2026, 1, 100],
        [2026, 2, 120],
        [2026, 3, 140],
      ],
    ),
    { type: "line", y: ["active_employee_count"] },
  );

  test("时间占 x 轴、度量成折线系列，使用项目色板与克制网格", () => {
    if (!chart) throw new Error("应产出折线配置");
    expect(chart.form).toBe("line");
    expect(chart.option.color).toEqual([...SERIES_COLORS]);
    expect(SERIES_COLORS[0]).toBe("#3b6fdb");
    const xAxis = chart.option.xAxis as {
      type: string;
      data: string[];
      axisLabel: Record<string, unknown>;
      axisLine: { show: boolean };
      splitLine: {
        show: boolean;
        showMinLine: boolean;
        showMaxLine: boolean;
        lineStyle: Record<string, unknown>;
      };
    };
    expect(xAxis.type).toBe("category");
    expect(xAxis.data).toEqual(["2026-01", "2026-02", "2026-03"]);
    // 轴不画自己的线：框的边就是轴，直线到了圆角那儿会戳出框外
    expect(xAxis.axisLine).toEqual({ show: false });
    // 类目轴刻度留在框外（下缘），故只有色号、字重、字号与离轴距离
    expect(xAxis.axisLabel).toEqual({
      color: "#aaaaaa",
      fontWeight: 400,
      fontSize: 12,
      margin: 6,
    });
    // 竖线划的是时间桶的边界：比横向那道读数线深一档、细一半
    expect(xAxis.splitLine).toEqual({
      show: true,
      showMinLine: false,
      showMaxLine: false,
      lineStyle: { color: "rgba(0, 0, 0, 0.15)", type: [3, 3], width: 0.5 },
    });
    const yAxis = chart.option.yAxis as {
      splitLine: {
        show: boolean;
        showMinLine: boolean;
        showMaxLine: boolean;
        lineStyle: Record<string, unknown>;
      };
    }[];
    expect(yAxis[0].splitLine).toEqual({
      show: true,
      showMinLine: false,
      showMaxLine: false,
      lineStyle: { color: "#e8e8e8", type: [3, 3], width: 1 },
    });
    expect(yAxis[0].splitLine.lineStyle).not.toEqual(xAxis.splitLine.lineStyle);
    // 首末两条落在框缘上（判据见 ui_spec「图表画布」节），两个方向都不画
    expect([xAxis.splitLine.showMinLine, yAxis[0].splitLine.showMinLine]).toEqual([false, false]);
    // 聚焦换装不做过渡（判据见 ui_spec「图表画布」节的动画契约）
    expect(chart.option.stateAnimation).toEqual({ duration: 0 });
    const series = realSeries<{ type: string; name: string; data: unknown[] }>(chart);
    expect(series).toHaveLength(1);
    expect(series[0].type).toBe("line");
    expect(series[0].name).toBe("在职人数");
    // 末点带自己的实心记号（见「末点」用例），其余是裸值
    expect(series[0].data.slice(0, -1)).toEqual([100, 120]);
    expect(series[0].data.at(-1)).toMatchObject({ value: 140 });
    const grid = chart.option.grid as {
      containLabel: boolean;
      left: number;
      right: number;
      top: number;
      bottom: number;
    };
    // 值轴刻度的摆法（判据见 ui_spec「图表画布」节）；最高那格翻面，免得跑到框外
    const yLabel = (chart.option.yAxis as { axisLabel: Record<string, unknown> }[])[0].axisLabel;
    expect(yLabel).toEqual({
      color: "#aaaaaa",
      fontWeight: 400,
      fontSize: 11,
      margin: 6,
      inside: true,
      align: "left",
      verticalAlign: "bottom",
      verticalAlignMaxLabel: "top",
      padding: [4, 0, 4, 0],
    });
    // 框缘不为轴标签让路，故 containLabel 关；四缘因此在渲染前就算得出来
    expect(grid.containLabel).toBe(false);
    // 框本身不由 grid 画（DOM 那层画，圆角在 canvas 上画不出来）
    expect(grid).not.toHaveProperty("show");
    expect(grid).not.toHaveProperty("backgroundColor");
    expect(chart.plot_gutter).toBeUndefined();
    expect(grid.left).toBe(16);
    expect(grid.right).toBe(16);
    expect(grid.top).toBe(0);
    expect(grid.bottom).toBe(30);
  });

  test("折线语言：空心圆点、激活点变实心、单系列填面积", () => {
    if (!chart) throw new Error("应产出折线配置");
    const series = chart.option.series as {
      itemStyle: { color: string; borderColor: string; borderWidth: number };
      lineStyle: { width: number; color: string };
      areaStyle?: { color: string };
      emphasis: {
        focus: string;
        scale: number;
        lineStyle: { color: string };
        itemStyle: Record<string, unknown>;
      };
      blur: { lineStyle: Record<string, unknown>; itemStyle: Record<string, unknown> };
    }[];
    // 空心圆点 = 承载面色填充 + 系列色描边（边宽 = 线宽）：填充要挡住身下的线
    expect(series[0].itemStyle).toEqual({
      color: "#ffffff",
      borderColor: "#3b6fdb",
      borderWidth: 1.5,
    });
    expect(series[0].lineStyle).toEqual({ width: 1.5, color: "#3b6fdb" });
    // 单系列填面积：编译期只落纯色，渐变由渲染端按翻转后的色现拼
    expect(series[0].areaStyle).toEqual({ color: "#3b6fdb" });
    // 激活点实心：系列色填充 + 底面色描边；opacity 显式抬回 1，否则被圆点密度规则压住
    expect(series[0].emphasis.itemStyle).toEqual({
      color: "#3b6fdb",
      borderColor: "#ffffff",
      borderWidth: 1,
      opacity: 1,
    });
    // 焦点保持本色：不重申一遍，echarts 会自动提亮成第四种颜色
    expect(series[0].emphasis.lineStyle.color).toBe(series[0].lineStyle.color);
    // 单系列聚焦自己；失焦只换色——不透明度显式钉死 1，否则 echarts 默认再乘 0.1，
    // 线淡到看不见、只剩被密度规则抬回来的那串点（判据见 ui_spec「图表画布」节）
    expect(series[0].emphasis.focus).toBe("self");
    expect(series[0].blur.lineStyle).toEqual({ color: "#dedede", opacity: 1 });
    expect(series[0].blur.itemStyle).toEqual({
      color: "#ffffff",
      borderColor: "#dedede",
      opacity: 1,
    });
    expect(series[0].blur.lineStyle.color).not.toBe(series[0].lineStyle.color);
  });

  test("纯折线整列触发，指针是一条竖虚线", () => {
    if (!chart) throw new Error("应产出折线配置");
    const tooltip = chart.option.tooltip as {
      trigger: string;
      axisPointer: { type: string; lineStyle: Record<string, unknown> };
    };
    // 整列触发：折线的命中体只有 6px 圆点、密集时还被藏起来，逐项触发等于读不出数
    expect(tooltip.trigger).toBe("axis");
    expect(tooltip.axisPointer.type).toBe("line");
    expect(tooltip.axisPointer.lineStyle).toEqual({
      color: "#767676",
      type: "dashed",
      width: 1,
    });
  });

  test("图例走 pa.legend（HTML 图例），option 不含 echarts legend 组件", () => {
    if (!chart) throw new Error("应产出折线配置");
    expect(chart.option.legend).toBeUndefined();
    // 末桶读数随图例下发（触屏没有悬停浮层，图例是仅剩的读数位）：值取自铺开的最后一行本身，
    // 不是另算的合计；哪一桶由 legend_latest_label 挑明，两者恒同进同出。
    expect(pa(chart).legend).toEqual([{ name: "在职人数", color: "#3b6fdb", latest: 140 }]);
    expect(pa(chart).legend_latest_label).toBe("2026-03");
    // 末点在数据里带上自己的实心记号，值仍是那一桶的原值
    expect((chart.option.series as { data: unknown[] }[])[0].data.at(-1)).toMatchObject({
      value: 140,
      itemStyle: { color: "#3b6fdb", borderColor: "#ffffff", opacity: 1 },
    });
    expect(pa(chart).series).toEqual({ 在职人数: "number" });
    expect(pa(chart).axes.y).toEqual(["number"]);
  });

  test("图例读数取每条系列都有值的那一桶：当月未完时不落在缺数的末行", () => {
    // 当月存量已有数、流量还空着——最后一行凑不齐一个时间断面
    const ragged = buildViewChart(
      view(
        ["year", "month", "active_employee_count", "new_hire_count"],
        [
          [2026, 7, 100, 9],
          [2026, 8, 140, null],
        ],
      ),
      { type: "line", y: ["active_employee_count", "new_hire_count"] },
    );
    if (!ragged) throw new Error("应产出折线配置");
    expect(pa(ragged).legend_latest_label).toBe("2026-07");
    expect(pa(ragged).legend?.map((item) => item.latest)).toEqual([100, 9]);

    // 一桶都凑不齐时整条不发：宁可没有读数，也不给半行数配一个说不清的桶名
    const empty = buildViewChart(
      view(
        ["year", "month", "active_employee_count", "new_hire_count"],
        [
          [2026, 7, 100, null],
          [2026, 8, null, 9],
        ],
      ),
      { type: "line", y: ["active_employee_count", "new_hire_count"] },
    );
    if (!empty) throw new Error("应产出折线配置");
    expect(pa(empty).legend_latest_label).toBeUndefined();
    expect(pa(empty).legend?.every((item) => item.latest === undefined)).toBe(true);
  });

  test("每个图形点保留原始结果格坐标，供 Web 明细入口确定性回溯", () => {
    if (!chart) throw new Error("应产出折线配置");
    expect(pa(chart).records?.points).toEqual([
      [
        { row: 0, column: "active_employee_count" },
        { row: 1, column: "active_employee_count" },
        { row: 2, column: "active_employee_count" },
      ],
    ]);
  });
});

describe("柱线组合（量+率混量纲）", () => {
  const chart = buildViewChart(
    view(
      ["year", "turnover_count", "ytd_primary_event_rate"],
      [
        [2024, 80, 0.011],
        [2025, 90, 0.015],
      ],
      { formats: { ytd_primary_event_rate: "percent" } },
    ),
    { type: "line", y: ["turnover_count", "ytd_primary_event_rate"] },
  );

  test("量画柱（主轴）、率画线（副轴），双 y 轴各自成尺", () => {
    if (!chart) throw new Error("应产出组合图配置");
    expect(chart.form).toBe("line");
    const series = realSeries<{ type: string; yAxisIndex: number }>(chart);
    expect(series.map((s) => [s.type, s.yAxisIndex])).toEqual([
      ["bar", 0],
      ["line", 1],
    ]);
    expect(chart.option.yAxis as unknown[]).toHaveLength(2);
    expect(pa(chart).axes.y).toEqual(["number", "percent"]);
  });

  test("有柱就画列高亮带，多系列不填面积", () => {
    if (!chart) throw new Error("应产出组合图配置");
    const tooltip = chart.option.tooltip as {
      trigger: string;
      axisPointer: { type: string; shadowStyle: { color: string } };
    };
    expect(tooltip.trigger).toBe("axis");
    // 柱已经占满高度，指针再叠一条竖线就是第二根轴；带色与控件 hover 同料
    expect(tooltip.axisPointer.type).toBe("shadow");
    expect(tooltip.axisPointer.shadowStyle).toEqual({ color: "rgba(0, 0, 0, 0.04)" });
    // 面积只给单系列（判据见 ui_spec「图表画布」）
    for (const series of chart.option.series as { areaStyle?: unknown }[]) {
      expect(series.areaStyle).toBeUndefined();
    }
    // 有柱就不画竖线：柱已占住整个桶（判据见 ui_spec「图表画布」节）
    expect((chart.option.xAxis as { splitLine: unknown }).splitLine).toEqual({ show: false });
  });
});

describe("分类柱线组合（量+率混量纲）", () => {
  const source = view(
    [
      "organization_name",
      "active_employee_count",
      "ytd_primary_event_rate",
      "period_end_completion_rate",
    ],
    [
      ["研发", 100, 0.08, 0.9],
      ["销售", 80, 0.12, 0.75],
    ],
    {
      formats: {
        ytd_primary_event_rate: "percent",
        period_end_completion_rate: "percent",
      },
    },
  );

  test("分类占横轴，人数画柱、百分比画线，双 y 轴各自成尺", () => {
    const chart = buildViewChart(source, {
      type: "bar",
      x: "organization_name",
      y: ["active_employee_count", "ytd_primary_event_rate", "period_end_completion_rate"],
    });
    if (!chart) throw new Error("应产出分类柱线组合图");
    expect(chart.form).toBe("bar");
    expect((chart.option.xAxis as { data: string[] }).data).toEqual(["研发", "销售"]);
    const series = realSeries<{ type: string; yAxisIndex: number }>(chart);
    expect(series.map((item) => [item.type, item.yAxisIndex])).toEqual([
      ["bar", 0],
      ["line", 1],
      ["line", 1],
    ]);
    expect(chart.option.yAxis as unknown[]).toHaveLength(2);
    expect(pa(chart).axes.y).toEqual(["number", "percent"]);
    expect(pa(chart).records?.points).toEqual([
      [
        { row: 0, column: "active_employee_count" },
        { row: 1, column: "active_employee_count" },
      ],
      [
        { row: 0, column: "ytd_primary_event_rate" },
        { row: 1, column: "ytd_primary_event_rate" },
      ],
      [
        { row: 0, column: "period_end_completion_rate" },
        { row: 1, column: "period_end_completion_rate" },
      ],
    ]);
  });

  test("百分比与百分点不能共用率轴，忠实退回表格", () => {
    const incompatible = {
      ...source,
      column_formats: {
        ...source.column_formats,
        period_end_completion_rate: "percentage_point" as const,
      },
    };
    expect(
      buildViewChart(incompatible, {
        type: "bar",
        x: "organization_name",
        y: ["active_employee_count", "ytd_primary_event_rate", "period_end_completion_rate"],
      }),
    ).toBeNull();
  });

  test("人数结构占比仍随分类行交付给 tooltip", () => {
    const chart = buildViewChart(
      view(
        [
          "organization_name",
          "active_employee_share",
          "active_employee_count",
          "ytd_primary_event_rate",
        ],
        [
          ["研发", 0.6, 100, 0.08],
          ["销售", 0.4, 80, 0.12],
        ],
        {
          formats: { active_employee_share: "percent", ytd_primary_event_rate: "percent" },
          shares: [
            {
              measure: "active_employee_share",
              numerator: "active_employee_count",
            },
          ],
        },
      ),
      {
        type: "bar",
        x: "organization_name",
        y: ["active_employee_count", "ytd_primary_event_rate"],
        annotations: ["active_employee_share"],
      },
    );
    if (!chart) throw new Error("应产出分类柱线组合图");
    expect(pa(chart).share).toEqual({
      title: "占比",
      values: { 研发: 0.6, 销售: 0.4 },
    });
  });
});

describe("分类条形", () => {
  const shares: ViewBlock["structure_shares"] = [
    {
      measure: "active_employee_share",
      numerator: "active_employee_count",
    },
  ];
  const chart = buildViewChart(
    view(
      ["job_level_band", "active_employee_count", "active_employee_share"],
      [
        ["Band C", 60, 0.6],
        ["Band B", 40, 0.4],
      ],
      { formats: { active_employee_share: "percent" }, shares },
    ),
    { type: "bar", x: "job_level_band", y: ["active_employee_count"] },
  );

  test("单系列横排条形走无值轴与网格的排行版式", () => {
    if (!chart) throw new Error("应产出条形配置");
    expect(chart.form).toBe("bar");
    expect(chart.layout).toBe("rank");
    // 排行版式没有绘图区可退让，四列的几何归渲染端；高度按行数一次算定
    expect(chart.plot_gutter).toBeUndefined();
    expect(chart.option.grid).toBeUndefined();
    expect(chart.option.xAxis).toBeUndefined();
    expect(chart.height).toBe(2 * RANK_ROW.height);
    const yAxis = chart.option.yAxis as { type: string; data: string[] };
    expect(yAxis.type).toBe("category");
    expect(yAxis.data).toEqual(["Band C", "Band B"]);
    const series = chart.option.series as { type: string; data: unknown[] }[];
    expect(series).toHaveLength(1);
    expect(series[0].type).toBe("bar");
    expect(series[0].data).toEqual([60, 40]);
    // 占比仍随 pa.share 交付：排行版式把它摆成第四列，读数卡也读同一份
    expect(pa(chart).share).toEqual({
      title: "占比",
      values: { "Band C": 0.6, "Band B": 0.4 },
    });
    expect(pa(chart).axes.x).toEqual(["number"]);
  });

  /** 多系列横排条形仍走画布版式：一行摆得下多条不同系列的柱，排行那四列摆不下 */
  const grouped = buildViewChart(
    view(
      ["job_level_band", "active_employee_count", "new_hire_count"],
      [
        ["Band C", 60, 6],
        ["Band B", 40, 4],
      ],
    ),
    { type: "bar", x: "job_level_band", y: ["active_employee_count", "new_hire_count"] },
  );

  test("类目落左轴时刻度留在框外自占一栏，栏宽由服务端算定", () => {
    const chart = grouped;
    if (!chart) throw new Error("应产出条形配置");
    expect(chart.layout, "多系列不该走排行版式").toBeUndefined();
    // 柱语言：同类目多柱紧贴、类目带留 40% 白（柱占 60%）
    const bars = chart.option.series as { barGap: number; barCategoryGap: string }[];
    expect(bars[0].barGap).toBe(0);
    expect(bars[0].barCategoryGap).toBe("40%");
    // 中文长标签进框就压在条上，只能留在框外；栏宽仍归服务端算定，框才画得出来
    expect((chart.option.grid as { containLabel: boolean }).containLabel).toBe(false);
    const gutter = chart.plot_gutter?.left ?? 0;
    expect(gutter, "类目栏没算出宽度，框会盖住标签").toBeGreaterThan(0);
    expect((chart.option.grid as { left: number }).left).toBe(16 + gutter);
    const yLabel = (chart.option.yAxis as { axisLabel: Record<string, unknown> }).axisLabel;
    expect(yLabel.inside).toBeUndefined();
    // 放不下就截断——不截断的话栏宽是估的、框缘却是定的，两者迟早对不上
    expect(yLabel.overflow).toBe("truncate");
    expect(yLabel.width).toBe(gutter - 8);

    const trend = buildViewChart(
      view(
        ["year", "month", "active_employee_count"],
        [
          [2026, 1, 100],
          [2026, 2, 120],
        ],
      ),
      { type: "line", y: ["active_employee_count"] },
    );
    if (!trend) throw new Error("对照的折线没编译出来");
    const trendY = (trend.option.yAxis as { axisLabel: Record<string, unknown> }[])[0].axisLabel;
    expect(trendY.inside).toBe(true);
    expect((trend.option.grid as { containLabel: boolean }).containLabel).toBe(false);
  });

  test("显式只画结构占比时提升为百分比柱，不受自动辅助角色影响", () => {
    const declared = buildViewChart(
      view(
        ["job_level_band", "active_employee_count", "active_employee_share"],
        [
          ["Band C", 60, 0.6],
          ["Band B", 40, 0.4],
        ],
        { formats: { active_employee_share: "percent" }, shares },
      ),
      { type: "bar", x: "job_level_band", y: ["active_employee_share"] },
    );
    if (!declared) throw new Error("应产出占比柱状图");
    expect(declared.form).toBe("bar");
    expect(declared.option.series).toMatchObject([{ type: "bar", data: [0.6, 0.4] }]);
    expect(pa(declared).axes.x).toEqual(["percent"]);
  });

  test("显式同时选择分子与结构占比时仍画分子，占比走辅助通道", () => {
    const declared = buildViewChart(
      view(
        ["job_level_band", "active_employee_count", "active_employee_share"],
        [
          ["Band C", 60, 0.6],
          ["Band B", 40, 0.4],
        ],
        { formats: { active_employee_share: "percent" }, shares },
      ),
      { type: "bar", x: "job_level_band", y: ["active_employee_count", "active_employee_share"] },
    );
    if (!declared) throw new Error("应产出带占比辅助通道的柱状图");
    expect(declared.option.series).toMatchObject([{ type: "bar", data: [60, 40] }]);
    expect(pa(declared).share).toEqual({
      title: "占比",
      values: { "Band C": 0.6, "Band B": 0.4 },
    });
  });

  test("显式辅助通道控制占比是否进入柱图 tooltip", () => {
    const source = view(
      ["job_level_band", "active_employee_count", "active_employee_share"],
      [
        ["Band C", 60, 0.6],
        ["Band B", 40, 0.4],
      ],
      { formats: { active_employee_share: "percent" }, shares },
    );
    const annotated = buildViewChart(source, {
      type: "bar",
      x: "job_level_band",
      y: ["active_employee_count"],
      annotations: ["active_employee_share"],
    });
    const plain = buildViewChart(source, {
      type: "bar",
      x: "job_level_band",
      y: ["active_employee_count"],
      annotations: [],
    });
    if (!annotated || !plain) throw new Error("应产出柱状图");
    expect(pa(annotated).share?.values).toEqual({ "Band C": 0.6, "Band B": 0.4 });
    expect(pa(plain).share).toBeUndefined();
  });

  test("高度随分类数伸缩（服务端一次算定布局）", () => {
    if (!chart) throw new Error("应产出条形配置");
    expect(chart.height).toBeGreaterThan(80);
  });
});

describe("堆叠条形（双分类构成）", () => {
  const chart = buildViewChart(
    view(
      ["organization_name", "degree", "active_employee_count"],
      [
        ["A", "本科", 10],
        ["A", "硕士", 5],
        ["B", "本科", 20],
        ["B", "硕士", 8],
      ],
    ),
    {
      type: "bar",
      x: "organization_name",
      y: ["active_employee_count"],
      groupBy: "degree",
      stack: true,
    },
  );

  test("系列堆叠在同一条上", () => {
    if (!chart) throw new Error("应产出堆叠条形配置");
    expect(chart.form).toBe("bar");
    const series = chart.option.series as { stack?: string; name: string }[];
    expect(series.map((s) => s.name)).toEqual(["本科", "硕士"]);
    expect(series.every((s) => s.stack === "total")).toBe(true);
  });
});

describe("无图形态与回答级块", () => {
  test("指标卡 / 空结果 → null", () => {
    expect(
      buildViewChart(view(["active_employee_count"], [[12345]]), { type: "kpi", y: [] }),
    ).toBeNull();
    expect(
      buildViewChart(view(["organization_name", "active_employee_count"], []), {
        type: "bar",
        x: "organization_name",
        y: ["active_employee_count"],
      }),
    ).toBeNull();
  });

  test("完整呈现块始终带表格，图表只在声明成立时出现", () => {
    const kpi = compilePresentationBlock(view(["active_employee_count"], [[1]]), {
      type: "kpi",
      y: [],
    });
    expect(kpi).toMatchObject({ type: "kpi", table: { rows: [[1]] } });
    const block = compilePresentationBlock(
      view(
        ["year", "active_employee_count"],
        [
          [2025, 1],
          [2026, 2],
        ],
      ),
      { type: "line", y: ["active_employee_count"] },
    );
    expect(block).toMatchObject({ type: "line", chart: { form: "line" } });
    expect(isPresentationBlock(block)).toBe(true);
  });

  test("显式 table 布局把生效与不可用状态写入呈现块", () => {
    const applied = compilePresentationBlock(
      view(
        ["organization_name", "degree", "active_employee_count"],
        [
          ["A", "本科", 10],
          ["A", "硕士", 5],
          ["B", "本科", 20],
          ["B", "硕士", 8],
        ],
      ),
      {
        type: "table",
        y: [],
        tableLayout: {
          rows: [{ kind: "field", column: "organization_name" }],
          columns: [{ kind: "field", column: "degree" }, { kind: "metrics" }],
        },
      },
    );
    expect(applied).toMatchObject({
      type: "table",
      table_layout: { state: "applied", leafColumns: 2 },
      table: {
        columns: [
          { headerPath: [{ label: "organization_name" }] },
          { headerPath: [{ label: "本科" }, { label: "在职人数" }] },
          { headerPath: [{ label: "硕士" }, { label: "在职人数" }] },
        ],
      },
    });

    const unavailable = compilePresentationBlock(
      view(
        ["organization_name", "degree", "active_employee_count"],
        [
          ["A", "本科", 10],
          ["A", "本科", 20],
        ],
      ),
      {
        type: "table",
        y: [],
        tableLayout: {
          rows: [{ kind: "field", column: "organization_name" }],
          columns: [{ kind: "field", column: "degree" }, { kind: "metrics" }],
        },
      },
    );
    expect(unavailable.table_layout).toMatchObject({
      state: "unavailable",
      reason: "duplicate_coordinate",
    });
  });

  test("isViewChart 边界校验", () => {
    expect(isViewChart({ form: "line", height: 300, option: {} })).toBe(true);
    expect(isViewChart({ form: "pie", height: 300, option: {} })).toBe(true);
    expect(isViewChart({ form: "donut", height: 300, option: {} })).toBe(false);
    expect(isViewChart({ form: "line", height: 0, option: {} })).toBe(false);
    expect(isViewChart(null)).toBe(false);
  });

  test("完整呈现块的声明类型必须与编译图表一致", () => {
    const table = compilePresentationBlock(view(["active_employee_count"], [[10]]), {
      type: "table",
      y: [],
    }).table;
    expect(
      isPresentationBlock({
        type: "line",
        table,
        table_layout: { state: "applied", leafColumns: 1 },
        chart: { form: "bar", height: 300, option: {} },
      }),
    ).toBe(false);
  });

  test("table_layout 只接受完整的 applied/unavailable 状态", () => {
    const table = compilePresentationBlock(view(["active_employee_count"], [[10]]), {
      type: "table",
      y: [],
    }).table;
    expect(
      isPresentationBlock({
        type: "table",
        table,
        table_layout: { state: "applied", leafColumns: 1 },
      }),
    ).toBe(true);
    expect(
      isPresentationBlock({
        type: "table",
        table,
        table_layout: { state: "unknown", leafColumns: 1 },
      }),
    ).toBe(false);
    expect(
      isPresentationBlock({
        type: "table",
        table,
        table_layout: {
          state: "unavailable",
          leafColumns: 2,
          reason: "duplicate_coordinate",
          message: "坐标重复",
        },
      }),
    ).toBe(true);
  });
});

describe("服务端物理呈现声明", () => {
  const trendView = view(
    ["year", "month", "new_hire_count", "leave_count"],
    [
      [2026, 1, 30, 10],
      [2026, 2, 40, 15],
      [2026, 3, 35, 12],
    ],
  );

  test("声明 y 子集：折线只画声明的度量", () => {
    const chart = buildViewChart(trendView, {
      type: "line",
      y: ["new_hire_count"],
    });
    if (!chart) throw new Error("应产出折线配置");
    expect(chart.form).toBe("line");
    expect(realSeries(chart)).toHaveLength(1);
  });

  test("display 覆盖颜色、型别，value_labels 印数，并为右轴补 option 与 pa 格式", () => {
    const chart = buildViewChart(trendView, {
      type: "line",
      y: ["new_hire_count", "leave_count"],
      display: {
        new_hire_count: { color: "#123abc", type: "bar" },
        leave_count: { yAxis: "right" },
      },
      valueLabels: "main",
    });
    if (!chart) throw new Error("应产出带视觉覆盖的折线配置");
    const series = chart.option.series as {
      type: string;
      yAxisIndex: number;
      itemStyle?: { color?: string; borderRadius?: number[] };
      label?: {
        show: boolean;
        color?: string;
        fontSize?: number;
        backgroundColor?: string;
        borderColor?: string;
      };
    }[];
    // 值标签：浅灰底片上的 14px 系列色数字——颜色覆盖后标签跟着换色（同源 pa.legend）
    expect(series[0]).toMatchObject({
      type: "bar",
      itemStyle: { color: "#123abc" },
      label: {
        show: true,
        color: "#123abc",
        fontSize: 14,
        backgroundColor: "#f7f7f8",
        borderColor: "#ffffff",
      },
    });
    // 视觉覆盖必须同步到 HTML 图例的标记色
    expect(pa(chart).legend?.[0]?.color).toBe("#123abc");
    expect(series[1].yAxisIndex).toBe(1);
    expect(chart.option.yAxis as unknown[]).toHaveLength(2);
    expect(pa(chart).axes.y).toEqual(["number", "number"]);
  });

  test("display 换型后指针形跟着重算：多出一根柱就改画列高亮带", () => {
    const decl = { type: "line" as const, y: ["new_hire_count"] };
    const build = (display?: Record<string, SeriesDisplay>) => {
      const chart = buildViewChart(trendView, display ? { ...decl, display } : decl);
      if (!chart) throw new Error("应产出折线配置");
      return {
        pointer: (chart.option.tooltip as { axisPointer: { type: string } }).axisPointer.type,
        series: chart.option.series as { areaStyle?: unknown }[],
      };
    };
    const plain = build();
    expect(plain.pointer).toBe("line");
    expect(plain.series[0].areaStyle).toBeDefined();
    // 系列改成柱，图里就有了柱，指针改画整条列高亮带
    const withBar = build({ new_hire_count: { type: "bar" } });
    expect(withBar.pointer).toBe("shadow");
    expect(withBar.series[0].areaStyle).toBeUndefined();
  });

  test("空 display 不改变 P2 option", () => {
    const decl = { type: "line" as const, y: ["new_hire_count", "leave_count"] };
    expect(JSON.stringify(buildViewChart(trendView, { ...decl, display: {} }))).toBe(
      JSON.stringify(buildViewChart(trendView, decl)),
    );
  });

  test("value_labels：main 只给第一主系列印数，all 全部系列印数", () => {
    const decl = { type: "line" as const, y: ["new_hire_count", "leave_count"] };
    const labelShown = (valueLabels?: "main" | "all") => {
      const chart = buildViewChart(trendView, valueLabels ? { ...decl, valueLabels } : decl);
      if (!chart) throw new Error("应产出折线配置");
      return realSeries(chart).map(
        (series) => (series as { label?: { show?: boolean } }).label?.show ?? false,
      );
    };
    expect(labelShown()).toEqual([false, false]);
    expect(labelShown("main")).toEqual([true, false]);
    expect(labelShown("all")).toEqual([true, true]);
    // 贴上限的标签朝上画：余量留在框内（grid 缩进），场地框不因标签开关移动
    const labeled = buildViewChart(trendView, { ...decl, valueLabels: "all" });
    if (!labeled) throw new Error("应产出带标签的折线配置");
    expect(labeled.plot_inset?.top).toBe(30);
    expect((labeled.option.grid as { top: number }).top).toBe(30);
    // 标签形制：浅灰底片 + 承载面色描边 + 14px 系列色数字
    const pill = (realSeries(labeled)[0] as { label?: Record<string, unknown> }).label;
    expect(pill?.backgroundColor).toBe("#f7f7f8");
    expect(pill?.borderColor).toBe("#ffffff");
    expect(pill?.borderRadius).toBe(4);
    expect(pill?.fontSize).toBe(14);
    expect(pill?.color).toBe(SERIES_COLORS[0]);
    expect(labeled.plot_gutter).toBeUndefined();
    expect(buildViewChart(trendView, decl)?.plot_inset).toBeUndefined();
  });

  test("value_labels：横排条按最宽格式化标签在框内留右栏，堆叠段标签进段内不占余量", () => {
    const rows: [string, string, number][] = [
      ["A", "本科", 10],
      ["A", "硕士", 5],
      ["B", "本科", 1234],
      ["B", "硕士", 8],
    ];
    const decl = {
      type: "bar" as const,
      x: "organization_name",
      y: ["active_employee_count"],
      groupBy: "degree",
      valueLabels: "all" as const,
    };
    const barView = view(["organization_name", "degree", "active_employee_count"], rows);
    const flat = buildViewChart(barView, { ...decl, stack: false });
    if (!flat) throw new Error("应产出条形配置");
    const flatSeries = flat.option.series as { label?: { position?: string } }[];
    expect(flatSeries.every((s) => s.label?.position === "right")).toBe(true);
    // 最宽标签是「1,234」：右栏 = 实测底片宽 + 号距，框外栏（左类目栏）保持不动
    const right = flat.plot_inset?.right ?? 0;
    expect(right).toBeGreaterThan(30);
    expect((flat.option.grid as { right: number }).right).toBe(16 + right);
    expect(flat.plot_gutter?.left).toBeGreaterThan(0);
    expect(flat.plot_inset?.top).toBeUndefined();

    const stacked = buildViewChart(barView, { ...decl, stack: true });
    if (!stacked) throw new Error("应产出堆叠条形配置");
    const stackedSeries = stacked.option.series as { label?: { position?: string } }[];
    expect(stackedSeries.every((s) => s.label?.position === "inside")).toBe(true);
    expect(stacked.plot_inset).toBeUndefined();
  });

  test("声明 table：显式只出表格（压掉自动出图）", () => {
    expect(buildViewChart(trendView, { type: "table", y: [] })).toBeNull();
  });

  test("声明 pie：环形图不出外标和引线，身份进 pa.legend，环比 48/80", () => {
    const chart = buildViewChart(
      view(
        ["organization_name", "active_employee_count"],
        [
          ["A", 60],
          ["B", 40],
        ],
      ),
      { type: "pie", x: "organization_name", y: ["active_employee_count"] },
    );
    if (!chart) throw new Error("应产出饼图配置");
    expect(chart.form).toBe("pie");
    const series = chart.option.series as {
      type: string;
      radius: [string, string];
      label: { show: boolean };
      labelLine: { show: boolean };
      data: { name: string; value: unknown; itemStyle: { color: string } }[];
    }[];
    expect(series[0].type).toBe("pie");
    expect(series[0].radius).toEqual(["48%", "80%"]);
    // 占比进图例，总计进环心；切片不出外部标签和引线。
    expect(series[0].label.show).toBe(false);
    expect(series[0].labelLine.show).toBe(false);
    expect(series[0].data.map((d) => d.name)).toEqual(["A", "B"]);
    expect(series[0].data.map((d) => d.itemStyle.color)).toEqual(["#3b6fdb", "#e0857a"]);
    // 饼图没有类目轴，逐项触发且无指针（整列触发在这里无所依附）
    const tooltip = chart.option.tooltip as { trigger: string; axisPointer?: unknown };
    expect(tooltip.trigger).toBe("item");
    expect(tooltip.axisPointer).toBeUndefined();
    expect(chart.option.legend).toBeUndefined();
    expect(pa(chart).legend).toEqual([
      { name: "A", color: "#3b6fdb" },
      { name: "B", color: "#e0857a" },
    ]);
    // 绘图底只属直角坐标系：饼图无 grid，不铺底也不出发丝框
    expect(chart.option.grid).toBeUndefined();
  });

  test("数据守卫：率不做饼图切片，图退空（表忠实呈现）", () => {
    expect(
      buildViewChart(
        view(
          ["organization_name", "ytd_primary_event_rate"],
          [
            ["A", 0.01],
            ["B", 0.02],
          ],
          { formats: { ytd_primary_event_rate: "percent" } },
        ),
        { type: "pie", x: "organization_name", y: ["ytd_primary_event_rate"] },
      ),
    ).toBeNull();
  });

  test("声明 bar + group_by 并列分组：分类值各成系列不堆叠", () => {
    const chart = buildViewChart(
      view(
        ["organization_name", "degree", "active_employee_count"],
        [
          ["A", "本科", 10],
          ["A", "硕士", 5],
          ["B", "本科", 20],
          ["B", "硕士", 8],
        ],
      ),
      {
        type: "bar",
        x: "organization_name",
        y: ["active_employee_count"],
        groupBy: "degree",
        stack: false,
      },
    );
    if (!chart) throw new Error("应产出条形配置");
    const series = chart.option.series as { stack?: string; name: string }[];
    expect(series.map((s) => s.name)).toEqual(["本科", "硕士"]);
    expect(series.every((s) => s.stack === undefined)).toBe(true);
  });

  test("数据守卫：声明 line 但同刻多行不成序列，图退空", () => {
    expect(
      buildViewChart(
        view(
          ["year", "organization_name", "active_employee_count"],
          [
            [2025, "A", 10],
            [2025, "B", 20],
            [2026, "A", 12],
            [2026, "B", 22],
          ],
        ),
        { type: "line", y: ["active_employee_count"] },
      ),
    ).toBeNull();
  });

  test("compilePresentationBlock 使用唯一结果的呈现声明", () => {
    expect(compilePresentationBlock(trendView, { type: "table", y: [] })).toMatchObject({
      type: "table",
    });
    expect(
      compilePresentationBlock(trendView, {
        type: "line",
        y: ["new_hire_count", "leave_count"],
      }),
    ).toMatchObject({ type: "line", chart: { form: "line" } });
  });
});

/**
 * 对照叠加折线的完整呈现编译：期间系列必须一路走到 ECharts 选项与下钻点位。
 * 这是服务端交付形态的端到端形状检查——浏览器不做二次编译，选项错了就是屏上错。
 */
describe("对照叠加折线的交付形态", () => {
  const months = [1, 2, 3, 4, 5, 6, 7, 8];
  const comparisonView: ViewBlock = {
    ...view(
      ["year", "month", "ytd_primary_event_rate"],
      [
        ...months.map((month): Cell[] => [2025, month, month / 100]),
        ...months.map((month): Cell[] => [2026, month, month / 50]),
      ],
      { formats: { ytd_primary_event_rate: "percent" } },
    ),
    time: {
      grain: "month",
      coordinates: [
        { role: "primary", from: "2026-01", to: "2026-08" },
        { role: "comparison", from: "2025-01", to: "2025-08" },
      ],
      buckets: [2026, 2025].flatMap((year) =>
        months.map((month) => {
          const at = `${year}-${String(month).padStart(2, "0")}`;
          return { key: { year, month }, from: at, to: at };
        }),
      ),
    },
  };

  test("两个期间成两条系列，横轴八个位置，下钻点位逐系列回指原行", () => {
    const block = compilePresentationBlock(comparisonView, {
      type: "line",
      y: ["ytd_primary_event_rate"],
    });
    expect(block.type).toBe("line");
    const option = block.chart?.option as {
      series: { name: string; data: (number | null | { value: number | null })[] }[];
      xAxis: { data: string[] };
    };
    expect(option.series.map((item) => item.name)).toEqual(["2026年", "2025年"]);
    expect(option.xAxis.data).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
    // 同位对照：主期 8 月 = 8/50，对照期同位 = 8/100。末点带实心记号，值在 `value` 上。
    const lastValue = (series: (typeof option.series)[number]) => {
      const cell = series.data.at(-1);
      return typeof cell === "object" && cell !== null ? cell.value : cell;
    };
    expect(lastValue(option.series[0])).toBeCloseTo(0.16, 10);
    expect(lastValue(option.series[1])).toBeCloseTo(0.08, 10);
    // 身份链：对照系列末点回指结果中的 2025-08 行（前 8 行是 2025）。
    const points = pa(block.chart!).records?.points;
    expect(points?.[0]?.[7]?.row).toBe(15);
    expect(points?.[1]?.[7]?.row).toBe(7);
  });

  test("同一结果的月度交叉表在对照列旁给出差值列", () => {
    const block = compilePresentationBlock(comparisonView, {
      type: "table",
      y: [],
      tableLayout: {
        rows: [{ kind: "time", level: "month" }],
        columns: [{ kind: "metrics" }, { kind: "time", level: "year" }],
      },
    });
    expect(block.table.rows).toHaveLength(8);
    expect(block.table.columns.map((column) => column.label)).toEqual([
      "month",
      "2025",
      "2026",
      "较2025年",
    ]);
  });
});

describe("整窗读数进呈现块", () => {
  const seriesView = (): ViewBlock => ({
    ...view(
      ["year", "month", "turnover_count"],
      [
        [2026, 1, 10],
        [2026, 2, 12],
      ],
    ),
    time: {
      grain: "month",
      coordinates: [{ role: "primary", from: "2026-01", to: "2026-02" }],
      buckets: [
        { key: { year: 2026, month: 1 }, from: "2026-01", to: "2026-01" },
        { key: { year: 2026, month: 2 }, from: "2026-02", to: "2026-02" },
      ],
    },
    totals: {
      metrics: [
        {
          column: "turnover_count",
          periods: [{ from: "2026-01", to: "2026-02", value: 22, coverage: "window" }],
        },
      ],
    },
  });

  test("整窗读数只随指标卡下发：图与表之上不摆第二个口径的读数", () => {
    const kpi = compilePresentationBlock(seriesView(), { type: "kpi", y: [] });
    expect(kpi.type).toBe("kpi");
    expect(kpi.totals?.metrics[0]).toMatchObject({
      value: 22,
      period: { label: "2026年1—2月", from: "2026-01", to: "2026-02" },
    });
    const line = compilePresentationBlock(seriesView(), { type: "line", y: ["turnover_count"] });
    expect(line.type).toBe("line");
    expect(line.totals).toBeUndefined();
    const table = compilePresentationBlock(seriesView(), { type: "table", y: [] });
    expect(table.totals).toBeUndefined();
    expect(isPresentationBlock(line)).toBe(true);
    expect(isPresentationBlock(kpi)).toBe(true);
  });

  test("宿主边界拒收残缺整窗读数，也拒收没有数可读的指标卡", () => {
    const block = compilePresentationBlock(seriesView(), { type: "kpi", y: [] });
    expect(isPresentationBlock({ ...block, totals: undefined })).toBe(false);
    expect(
      isPresentationBlock({
        ...block,
        totals: { metrics: [{ column: "turnover_count", value: 22, comparisons: [] }] },
      }),
    ).toBe(false);
    expect(
      isPresentationBlock({
        ...block,
        totals: {
          metrics: [
            {
              ...block.totals!.metrics[0],
              comparisons: [{ label: "较2025年", value: 0.1, format: "ratio" }],
            },
          ],
        },
      }),
    ).toBe(false);
  });
});

describe("小数位随系列进 pa 扩展块", () => {
  test("声明过位数的系列列进 pa.decimals，其所在值轴给 axis_decimals；未声明的不出现", () => {
    const chart = buildViewChart(
      view(
        ["year", "month", "survey_score", "active_employee_count"],
        [
          [2026, 1, 0.21, 100],
          [2026, 2, 0.2349, 120],
        ],
        { formats: { survey_score: "percent" }, decimals: { survey_score: 0 } },
      ),
      { type: "line", y: ["survey_score", "active_employee_count"] },
    );
    if (!chart) throw new Error("应产出折线配置");
    expect(pa(chart).decimals).toEqual({ survey_score: 0 });
    // 量在主轴、率在副轴：只有率轴拿到位数
    expect(pa(chart).axis_decimals).toEqual({ y: [null, 0] });

    const plain = buildViewChart(
      view(
        ["year", "month", "active_employee_count"],
        [
          [2026, 1, 100],
          [2026, 2, 120],
        ],
      ),
      { type: "line", y: ["active_employee_count"] },
    );
    if (!plain) throw new Error("应产出折线配置");
    expect(pa(plain).decimals).toBeUndefined();
    expect(pa(plain).axis_decimals).toBeUndefined();
  });
});
