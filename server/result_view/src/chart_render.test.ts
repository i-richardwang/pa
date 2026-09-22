import { expect, test } from "bun:test";
import {
  PLOT_FRAME,
  PLOT_PADDING,
  type ChartLegendItem,
  type ChartModel,
  type ViewChart,
} from "../../src/presentation_core/chart_config.js";
import { gridRect, plotRect, plotSize, renderOption, type RenderState } from "./chart_render.js";

const state = (over: Partial<RenderState> = {}): RenderState => ({
  dark: false,
  scene: "card",
  viewport: { width: 0, height: 0 },
  focused: null,
  pinned: null,
  ...over,
});

const item = (
  name: string,
  values: (number | null)[],
  extra: Partial<ChartLegendItem> = {},
): ChartLegendItem => ({ name, color: "#3b6fdb", format: "number", values, axis: 0, ...extra });

function chart(
  series: Record<string, unknown>[] = [{ type: "bar", name: "在职人数", data: [120] }],
  model: Partial<ChartModel> = {},
  form: ViewChart["form"] = "bar",
): ViewChart {
  return {
    form,
    height: 300,
    option: {
      grid: { containLabel: false },
      xAxis: { type: "category", data: ["研发"] },
      yAxis: { type: "value" },
      series,
    },
    model: {
      categories: ["研发"],
      legend: [item("在职人数", [120])],
      axes: {},
      pointer: "axis",
      ...model,
    },
  };
}

const gridOf = (option: Record<string, unknown>) => option.grid as Record<string, number | boolean>;

test("plot 留白按宿主场景取档：结果卡、整页、瓦片各一行", () => {
  expect(PLOT_PADDING.tile.left).toBeLessThan(PLOT_PADDING.card.left);
  expect(PLOT_PADDING.tile.bottom).not.toBe(PLOT_PADDING.card.bottom);

  const base = gridOf(renderOption(chart(), state()));
  expect(base.left).toBe(PLOT_PADDING.card.left);
  expect(base.top).toBe(PLOT_PADDING.card.top);

  const page = gridOf(renderOption(chart(), state({ scene: "page" })));
  expect(page.left).toBe(PLOT_PADDING.page.left);
  expect(page.right).toBe(PLOT_PADDING.page.right);
  expect(page.top).toBe(PLOT_PADDING.page.top);
  expect(page.bottom).toBe(PLOT_PADDING.page.bottom);

  const tile = gridOf(renderOption(chart(), state({ scene: "tile" })));
  expect(tile.left).toBe(PLOT_PADDING.tile.left);
  expect(tile.bottom).toBe(PLOT_PADDING.tile.bottom);

  // 换档只动留白与框，不碰 grid 的其余声明——含「值轴刻度进框、框缘不随标签浮动」那一位
  expect(page.containLabel).toBe(false);
});

test("形态自己那一栏叠在场景留白之上，grid 与 DOM 那层框读同一道算式", () => {
  const bars = { ...chart(), plot_gutter: { left: 120 } };
  for (const scene of ["card", "tile", "page"] as const) {
    const rect = plotRect(bars, scene);
    expect(rect.left, `${scene} 档的类目栏没叠进绘图区`).toBe(PLOT_PADDING[scene].left + 120);
    expect(gridOf(renderOption(bars, state({ scene })))).toMatchObject(rect);
    expect(plotRect(chart(), scene).left).toBe(PLOT_PADDING[scene].left);
  }
});

test("值标签的框内余量只缩数据区：grid 加余量、场地框不动", () => {
  const labeled = { ...chart(), plot_inset: { top: 22, right: 48 } };
  for (const scene of ["card", "tile", "page"] as const) {
    const frame = plotRect(labeled, scene);
    expect(frame.top, `${scene} 档的框不随标签开关移动`).toBe(PLOT_PADDING[scene].top);
    expect(frame.right).toBe(PLOT_PADDING[scene].right);
    const grid = gridRect(labeled, scene);
    expect(grid.top).toBe(frame.top + 22);
    expect(grid.right).toBe(frame.right + 48);
    expect(gridOf(renderOption(labeled, state({ scene })))).toMatchObject(grid);
  }
});

test("密度读取数据区尺寸，不把轴栏与场景留白算成可用空间", () => {
  const labeled = { ...chart(), plot_gutter: { left: 80 }, plot_inset: { right: 40 } };
  const rect = gridRect(labeled, "page");
  expect(plotSize(labeled, "page", { width: 500, height: 300 })).toEqual({
    width: 500 - rect.left - rect.right,
    height: 300 - rect.top - rect.bottom,
  });
});

test("绘图区边框由 DOM 绘制，grid 不重复画框", () => {
  expect(PLOT_FRAME.tile).not.toBe(PLOT_FRAME.page);
  for (const scene of ["card", "tile", "page"] as const) {
    const grid = gridOf(renderOption(chart(), state({ scene })));
    expect(grid, `${scene} 档的 grid 又画了一遍框，会与 DOM 那层叠成双框`).not.toHaveProperty(
      "show",
    );
    expect(grid).not.toHaveProperty("backgroundColor");
    expect(grid).not.toHaveProperty("borderColor");
  }
});

test("值轴档数随绘图区尺度走：每 80px 一档、夹在 2–10；尺寸未知时不动编译期那个数", () => {
  const ticks = (viewport: { width: number; height: number }) =>
    (renderOption(chart(), state({ viewport })).yAxis as { splitNumber?: number }).splitNumber;
  expect(ticks({ width: 0, height: 0 })).toBeUndefined();
  const rect = gridRect(chart(), "card");
  expect(ticks({ width: 400, height: 240 + rect.top + rect.bottom })).toBe(3);
  expect(ticks({ width: 400, height: 100 + rect.top + rect.bottom })).toBe(2);
  expect(ticks({ width: 400, height: 2000 })).toBe(10);
});

test("折线圆点密度走 showSymbol：每点摊不到 12px 就藏起来，只在指针命中时现出", () => {
  const line = chart(
    [{ type: "line", name: "在职人数", data: Array(20).fill(1), showSymbol: true }],
    { legend: [item("在职人数", Array(20).fill(1))] },
    "line",
  );
  const symbol = (width: number) =>
    (
      renderOption(line, state({ viewport: { width, height: 300 } })).series as {
        showSymbol: boolean;
      }[]
    )[0].showSymbol;
  const rect = gridRect(line, "card");
  expect(symbol(240 + rect.left + rect.right)).toBe(true);
  expect(symbol(200 + rect.left + rect.right)).toBe(false);
});

function areaLineChart(color: string): ViewChart {
  return chart(
    [{ type: "line", name: "在职人数", data: [120], areaStyle: { color } }],
    { legend: [item("在职人数", [120], { color })] },
    "line",
  );
}

const areaOf = (chart: ViewChart, dark: boolean) =>
  (renderOption(chart, state({ dark })).series as { areaStyle: Record<string, unknown> }[])[0]
    .areaStyle;

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

type Formatter = (params: { value?: unknown; dataIndex?: number }) => string;

test("刻度与值标签都按单元声明的小数位报数：整数百分比就是整数", () => {
  const percent = (decimals?: number) =>
    chart([{ type: "bar", name: "组织推荐指数", data: [0.2349], label: { show: true } }], {
      legend: [
        item("组织推荐指数", [0.2349], {
          format: "percent",
          ...(decimals === undefined ? {} : { decimals }),
        }),
      ],
      axes: { y: ["percent"] },
      ...(decimals === undefined ? {} : { axis_decimals: { y: [decimals] } }),
    });
  const option = renderOption(percent(0), state());
  const yAxis = option.yAxis as { axisLabel: { formatter: (value: number) => string } };
  expect(yAxis.axisLabel.formatter(0.225)).toBe("23%");
  const series = (option.series as { label: { formatter: Formatter } }[])[0];
  expect(series.label.formatter({ value: 0.2349 })).toBe("23%");

  // 没声明位数就走默认一位
  const plain = renderOption(percent(), state());
  expect(
    (plain.yAxis as { axisLabel: { formatter: (value: number) => string } }).axisLabel.formatter(
      0.225,
    ),
  ).toBe("22.5%");
});

test("焦点现出的那条也带格式化器：此刻不印数的系列同样配齐格式与步距", () => {
  const two = chart(
    [
      { type: "line", name: "在职人数", data: [10, 20], label: { show: true } },
      // 「仅主指标」档：形制配齐、此刻不印；焦点落在它身上才现出来
      { type: "line", name: "离职率", data: [0.0234, 0.0312], label: { show: false } },
    ],
    {
      categories: ["1月", "2月"],
      legend: [
        item("在职人数", [10, 20]),
        item("离职率", [0.0234, 0.0312], { format: "percent", decimals: 0 }),
      ],
    },
    "line",
  );
  const hidden = (renderOption(two, state()).series as { label: { formatter: Formatter } }[])[1];
  expect(hidden.label.formatter({ value: 0.0234 })).toBe("2%");
  const focused = (
    renderOption(two, state({ focused: 1 })).series as {
      label: { show: boolean; formatter: Formatter };
    }[]
  )[1];
  expect(focused.label.show).toBe(true);
  expect(focused.label.formatter({ value: 0.0312, dataIndex: 1 })).toBe("3%");
});

test("值标签密度守卫：局促时按步距挑桶印数且恒印末点，充裕时逐点印", () => {
  const three = (type: "line" | "bar") =>
    chart([{ type, name: "在职人数", data: [10, 20, 30], label: { show: true } }], {
      categories: ["1月", "2月", "3月"],
      legend: [item("在职人数", [10, 20, 30])],
    });
  const rect = gridRect(three("line"), "card");
  const run = (c: ViewChart, plotWidth: number) =>
    (
      renderOption(c, state({ viewport: { width: plotWidth + rect.left + rect.right, height: 0 } }))
        .series as { label: { formatter: Formatter } }[]
    )[0].label.formatter;
  // 3 点：120px 充裕（每点 40 > 37.33，逐点）；90px 局促（每点 30，步距 ceil(50/30)=2 → 0、末点）
  const wide = run(three("line"), 120);
  expect(wide({ value: 20, dataIndex: 1 })).toBe("20");
  const sparse = run(three("line"), 90);
  expect(sparse({ value: 10, dataIndex: 0 })).toBe("10");
  expect(sparse({ value: 20, dataIndex: 1 })).toBe("");
  expect(sparse({ value: 30, dataIndex: 2 })).toBe("30");
  // 柱按底片宽定步距：底片 26+4=30 > 每列 20 → 步距 2
  const barSparse = run(three("bar"), 60);
  expect(barSparse({ value: 20, dataIndex: 1 })).toBe("");
  expect(barSparse({ value: 30, dataIndex: 2 })).toBe("30");
  // 横排（y 轴类目）一行一格不会横向挤：逐格印
  const horizontal: ViewChart = {
    ...three("bar"),
    option: {
      ...three("bar").option,
      xAxis: { type: "value" },
      yAxis: { type: "category", data: ["A", "B", "C"] },
    },
  };
  expect(run(horizontal, 60)({ value: 20, dataIndex: 1 })).toBe("20");
  const unlabeled = renderOption(
    chart([{ type: "line", name: "在职人数", data: [10, 20, 30] }], {}, "line"),
    state(),
  );
  expect((unlabeled.series as { label?: unknown }[])[0].label).toBeUndefined();
});

test("钉住期间指针交出鼠标驱动；饼图没有指针可交", () => {
  const tooltip = (c: ViewChart, pinned: number | null) =>
    renderOption(c, state({ pinned })).tooltip as { triggerOn?: string } | undefined;
  expect(tooltip(chart(), null)?.triggerOn).toBe("mousemove|click");
  expect(tooltip(chart(), 0)?.triggerOn).toBe("none");
  const pie: ViewChart = {
    form: "pie",
    height: 300,
    option: { series: [{ type: "pie", data: [{ name: "A", value: 1 }] }] },
    model: { categories: ["x"], legend: [item("A", [1])], axes: {}, pointer: "item" },
  };
  expect(tooltip(pie, 0)).toBeUndefined();
});
