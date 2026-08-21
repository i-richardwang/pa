/**
 * 渲染端补全：绘图留白 / plot 框的归属，以及注入的那几个格式化器。
 *
 * 留白与框：编译期给的是紧凑档，宿主换档必须**从 PLOT_PADDING / PLOT_FRAME 取**。
 * 渲染产物必须等于表里那一行——若渲染端另写一组数字，两处各持一份留白，改哪边都只改对
 * 一半，而没有任何东西会报错。故断言落在「渲染产物 === 表里那一行」上，不是落在
 * 「渲染端写了某个数字」上。框的归属同理：整页的框归舞台，瓦片与整页图内关框，
 * 关不掉就是双层框，而双层框在截图上很容易被当成「设计就是这样」。
 *
 * 读数卡的行与版式在 `readout.test.ts` 与 `readout_card.test.tsx`。
 */
import { expect, test } from "bun:test";
import {
  PLOT_FRAME,
  PLOT_PADDING,
  type PaChartExtension,
  type ViewChart,
} from "../../src/presentation_core/chart_config.js";
import {
  applyValueLabelDensity,
  gridRect,
  plotRect,
  plotWidth,
  prepareOption,
} from "./chart_render.js";

function chart(): ViewChart {
  return {
    form: "bar",
    height: 300,
    option: {
      grid: { containLabel: false, ...PLOT_PADDING.compact },
      xAxis: { type: "category", data: ["研发"] },
      yAxis: { type: "value" },
      series: [{ type: "bar", name: "在职人数", data: [120] }],
    },
  };
}

const gridOf = (option: Record<string, unknown>) => option.grid as Record<string, number | boolean>;

test("plot 留白按名取档：缺省紧凑，整页 / 瓦片宿主换到对应行", () => {
  expect(PLOT_PADDING.tile.left).toBeLessThan(PLOT_PADDING.compact.left);
  expect(PLOT_PADDING.tile.bottom).not.toBe(PLOT_PADDING.compact.bottom);

  const base = gridOf(prepareOption(chart(), false));
  expect(base.left).toBe(PLOT_PADDING.compact.left);
  expect(base.top).toBe(PLOT_PADDING.compact.top);

  const page = gridOf(prepareOption(chart(), false, { plot: "page" }));
  expect(page.left).toBe(PLOT_PADDING.page.left);
  expect(page.right).toBe(PLOT_PADDING.page.right);
  expect(page.top).toBe(PLOT_PADDING.page.top);
  expect(page.bottom).toBe(PLOT_PADDING.page.bottom);

  const tile = gridOf(prepareOption(chart(), false, { plot: "tile" }));
  expect(tile.left).toBe(PLOT_PADDING.tile.left);
  expect(tile.bottom).toBe(PLOT_PADDING.tile.bottom);

  // 换档只动留白与框，不碰 grid 的其余声明——含「值轴刻度进框、框缘不随标签浮动」那一位
  expect(page.containLabel).toBe(false);
});

test("形态自己那一栏叠在场景留白之上，grid 与 DOM 那层框读同一道算式", () => {
  const bars = { ...chart(), plot_gutter: { left: 120 } };
  expect(bars.plot_gutter.left).toBeGreaterThan(0);

  for (const plot of ["compact", "tile", "page"] as const) {
    const rect = plotRect(bars, plot);
    expect(rect.left, `${plot} 档的类目栏没叠进绘图区`).toBe(PLOT_PADDING[plot].left + 120);
    expect(gridOf(prepareOption(bars, false, { plot }))).toMatchObject(rect);
    expect(plotRect(chart(), plot).left).toBe(PLOT_PADDING[plot].left);
  }
});

test("值标签的框内余量只缩数据区：grid 加余量、场地框不动", () => {
  const labeled = { ...chart(), plot_inset: { top: 22, right: 48 } };
  for (const plot of ["compact", "tile", "page"] as const) {
    const frame = plotRect(labeled, plot);
    expect(frame.top, `${plot} 档的框不随标签开关移动`).toBe(PLOT_PADDING[plot].top);
    expect(frame.right).toBe(PLOT_PADDING[plot].right);
    const grid = gridRect(labeled, plot);
    expect(grid.top).toBe(frame.top + 22);
    expect(grid.right).toBe(frame.right + 48);
    expect(gridOf(prepareOption(labeled, false, { plot }))).toMatchObject(grid);
  }
});

test("值标签密度读取数据区宽度，不把轴栏与场景留白算成可用空间", () => {
  const labeled = { ...chart(), plot_gutter: { left: 80 }, plot_inset: { right: 40 } };
  const rect = gridRect(labeled, "page");
  expect(plotWidth(labeled, "page", 500)).toBe(500 - rect.left - rect.right);
});

test("绘图区边框由 DOM 绘制，grid 不重复画框", () => {
  expect(PLOT_FRAME.tile).not.toBe(PLOT_FRAME.page);

  for (const plot of ["compact", "tile", "page"] as const) {
    const grid = gridOf(prepareOption(chart(), false, { plot }));
    expect(grid, `${plot} 档的 grid 又画了一遍框，会与 DOM 那层叠成双框`).not.toHaveProperty(
      "show",
    );
    expect(grid).not.toHaveProperty("backgroundColor");
    expect(grid).not.toHaveProperty("borderColor");
  }
});

function areaLineChart(color: string): ViewChart {
  return {
    form: "line",
    height: 300,
    option: {
      xAxis: { type: "category", data: ["2026-07"] },
      yAxis: { type: "value" },
      series: [{ type: "line", name: "在职人数", data: [120], areaStyle: { color } }],
      pa: { series: { 在职人数: "number" as const }, axes: {} } satisfies PaChartExtension,
    },
  };
}

const areaOf = (chart: ViewChart, dark: boolean) =>
  (prepareOption(chart, dark).series as { areaStyle: Record<string, unknown> }[])[0].areaStyle;

test("面积渐变在渲染端按已翻转的色现拼，自顶 5% 淡出到 70%", () => {
  const light = areaOf(areaLineChart("#3b6fdb"), false);
  expect(light.color).toEqual({
    type: "linear",
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: "rgba(59, 111, 219, 0.05)" },
      { offset: 0.7, color: "rgba(59, 111, 219, 0)" },
    ],
  });
  // 暗色下取的必须是翻转后的系列色——渐变里的 rgba 查不到映射表，先翻转再拼是唯一顺序
  const dark = areaOf(areaLineChart("#3b6fdb"), true).color as {
    colorStops: { color: string }[];
  };
  expect(dark.colorStops[0].color).toBe("rgba(91, 141, 239, 0.05)");
});

test("解析不了的自定义色退成平涂，不留一块实色", () => {
  const area = areaOf(areaLineChart("var(--brand)"), false);
  expect(area.color).toBe("var(--brand)");
  expect(area.opacity).toBe(0.05);
});

test("刻度与值标签都按列声明的小数位报数：整数百分比就是整数", () => {
  const pa: PaChartExtension = {
    series: { 组织推荐指数: "percent" },
    decimals: { 组织推荐指数: 0 },
    axes: { y: ["percent"] },
    axis_decimals: { y: [0] },
    legend: [{ name: "组织推荐指数", color: "#000000" }],
  };
  const chart: ViewChart = {
    form: "bar",
    height: 300,
    option: {
      xAxis: { type: "category", data: ["研发"] },
      yAxis: { type: "value" },
      series: [{ type: "bar", name: "组织推荐指数", data: [0.2349], label: { show: true } }],
      pa,
    },
  };
  const option = prepareOption(chart, false);
  const yAxis = option.yAxis as { axisLabel: { formatter: (value: number) => string } };
  expect(yAxis.axisLabel.formatter(0.225)).toBe("23%");
  const series = (
    option.series as { label: { formatter: (p: { value: unknown }) => string } }[]
  )[0];
  expect(series.label.formatter({ value: 0.2349 })).toBe("23%");

  // 没声明位数就走默认一位
  const plain = prepareOption(
    {
      ...chart,
      option: { ...chart.option, pa: { ...pa, decimals: undefined, axis_decimals: undefined } },
    },
    false,
  );
  expect(
    (plain.yAxis as { axisLabel: { formatter: (value: number) => string } }).axisLabel.formatter(
      0.225,
    ),
  ).toBe("22.5%");
});

test("焦点现出的那条也带格式化器：此刻不印数的系列同样配齐格式与步距", () => {
  const pa: PaChartExtension = {
    series: { 在职人数: "number", 离职率: "percent" },
    decimals: { 离职率: 0 },
    axes: { y: ["number"] },
    legend: [
      { name: "在职人数", color: "#000000" },
      { name: "离职率", color: "#111111" },
    ],
  };
  const chart: ViewChart = {
    form: "line",
    height: 300,
    option: {
      xAxis: { type: "category", data: ["1月", "2月"] },
      yAxis: { type: "value" },
      series: [
        { type: "line", name: "在职人数", data: [10, 20], label: { show: true } },
        // 「仅主指标」档：形制配齐、此刻不印；焦点落在它身上才现出来
        { type: "line", name: "离职率", data: [0.0234, 0.0312], label: { show: false } },
      ],
      pa,
    },
  };
  type Formatter = (params: { value?: unknown; dataIndex?: number }) => string;
  const prepared = prepareOption(chart, false);
  const hidden = (prepared.series as { label: { formatter: Formatter } }[])[1];
  expect(hidden.label.formatter({ value: 0.0234 })).toBe("2%");

  let patch: { series?: { label?: { formatter?: Formatter } }[] } = {};
  applyValueLabelDensity({ setOption: (option) => (patch = option as typeof patch) }, chart, 200);
  expect(patch.series?.[1]?.label?.formatter?.({ value: 0.0312, dataIndex: 1 })).toBe("3%");
});

test("值标签密度守卫：局促时按步距挑桶印数且恒印末点，充裕时逐点印", () => {
  const pa: PaChartExtension = {
    series: { 在职人数: "number" },
    axes: { y: ["number"] },
    legend: [{ name: "在职人数", color: "#000000" }],
  };
  const chart: ViewChart = {
    form: "line",
    height: 300,
    option: {
      xAxis: { type: "category", data: ["1月", "2月", "3月"] },
      yAxis: { type: "value" },
      series: [{ type: "line", name: "在职人数", data: [10, 20, 30], label: { show: true } }],
      pa,
    },
  };
  type Formatter = (params: { value?: unknown; dataIndex?: number }) => string;
  const run = (width: number) => {
    let patch: { series?: { label?: { formatter?: Formatter } }[] } = {};
    applyValueLabelDensity(
      { setOption: (option) => (patch = option as typeof patch) },
      chart,
      width,
    );
    return patch.series?.[0]?.label?.formatter;
  };
  // 3 点：120px 充裕（每点 40 > 37.33，逐点）；90px 局促（每点 30，步距 ceil(50/30)=2 → 0、末点）
  const wide = run(120);
  expect(wide?.({ value: 20, dataIndex: 1 })).toBe("20");
  const sparse = run(90);
  expect(sparse?.({ value: 10, dataIndex: 0 })).toBe("10");
  expect(sparse?.({ value: 20, dataIndex: 1 })).toBe("");
  expect(sparse?.({ value: 30, dataIndex: 2 })).toBe("30");
  // 柱按底片宽定步距：底片 26+4=30 > 每列 20 → 步距 2；横排（y 轴类目）不受触碰
  const barChart: ViewChart = {
    ...chart,
    option: {
      ...chart.option,
      series: [{ type: "bar", name: "在职人数", data: [10, 20, 30], label: { show: true } }],
    },
  };
  let barPatch: { series?: { label?: { formatter?: Formatter } }[] } = {};
  applyValueLabelDensity(
    { setOption: (option) => (barPatch = option as typeof barPatch) },
    barChart,
    60,
  );
  const barSparse = barPatch.series?.[0]?.label?.formatter;
  expect(barSparse?.({ value: 20, dataIndex: 1 })).toBe("");
  expect(barSparse?.({ value: 30, dataIndex: 2 })).toBe("30");
  let horizontalTouched = false;
  applyValueLabelDensity(
    { setOption: () => (horizontalTouched = true) },
    {
      ...barChart,
      option: {
        ...barChart.option,
        xAxis: { type: "value" },
        yAxis: { type: "category", data: ["A", "B", "C"] },
      },
    },
    60,
  );
  expect(horizontalTouched).toBe(false);
  // 没开标签的系列不受触碰
  let touched = false;
  applyValueLabelDensity(
    { setOption: () => (touched = true) },
    {
      ...chart,
      option: {
        ...chart.option,
        series: [{ type: "line", name: "在职人数", data: [10, 20, 30] }],
      },
    },
    90,
  );
  expect(touched).toBe(false);
});
