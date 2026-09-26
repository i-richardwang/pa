import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { applyPin, readoutPosition, subscribeReadout, ViewChartCanvas } from "./echart.js";
import { plotRect, renderOption, type RenderState } from "../chart_render.js";
import { ViewRenderer } from "./view_renderer.js";
import {
  compilePresentationBlock,
  chartMarkerClass,
  PLOT_FRAME,
  PLOT_PADDING,
  PLOT_RADIUS,
  CHART_CHROME,
  CHART_DARK_COLORS,
  SERIES_COLORS,
  SERIES_Z,
  haloZ,
  seriesZ,
  type PresentationBlock,
  type ViewChart,
} from "../../../src/presentation_core/chart_config.js";

function chartOf(presentation: PresentationBlock): ViewChart {
  if (!("chart" in presentation)) throw new Error("测试数据未编译成图表");
  return presentation.chart;
}

const state = (over: Partial<RenderState> = {}): RenderState => ({
  dark: false,
  scene: "card",
  viewport: { width: 0, height: 0 },
  focused: null,
  pinned: null,
  ...over,
});
const seriesOf = (chart: ViewChart, over: Partial<RenderState> = {}) =>
  renderOption(chart, state(over)).series as Record<string, unknown>[];

/**
 * document 存根必须在 import 之后设置：zrender 加载时会检测运行环境，发现不完整的 document 会进入
 * 浏览器分支并访问 `documentElement.style` 而报错。渲染时则需要它，因为 isDarkTheme 要读取主题。
 */
Object.assign(globalThis, {
  document: { documentElement: { dataset: {} } },
  window: { matchMedia: () => ({ matches: false }) },
});

const CHART_VIEW = {
  id: "result",
  columns: ["hr.organization_name", "hr.active_employee_count", "hr.new_hire_count"],
  column_roles: {
    "hr.organization_name": "dimension",
    "hr.active_employee_count": "measure",
    "hr.new_hire_count": "measure",
  },
  rows: [
    ["研发", 120, 12],
    ["市场", 45, 6],
  ],
  row_count: 2,
  query_notes: [],
} as unknown as Parameters<typeof compilePresentationBlock>[0];

const PAYLOAD = {
  title: "各组织在职人数",
  view: CHART_VIEW,
  observation_scopes: ["口径：在职含试用期"],
  data_as_of: "2026-06-30",
  time_context: [],
} as unknown as Parameters<typeof ViewRenderer>[0]["payload"];

const CHART_PRESENTATION = compilePresentationBlock(CHART_VIEW, {
  type: "bar",
  x: "organization_name",
  y: ["active_employee_count", "new_hire_count"],
});
const CHART = chartOf(CHART_PRESENTATION);

test("渲染器按声明渲染图表或表格", () => {
  const chart = renderToStaticMarkup(
    <ViewRenderer actions={{}} payload={PAYLOAD} presentation={CHART_PRESENTATION} scene="page" />,
  );
  expect(chart).toContain(chartMarkerClass());
  expect(chart).not.toContain("<tbody");

  const table = renderToStaticMarkup(
    <ViewRenderer
      actions={{}}
      payload={PAYLOAD}
      presentation={compilePresentationBlock(CHART_VIEW, { type: "table" })}
      scene="page"
    />,
  );
  expect(table).toContain("<tbody");
  expect(table).not.toContain(chartMarkerClass());
});

test("绘图区域按场景设置，图表和表格使用同一个区域", () => {
  const surfaceOf = (html: string) =>
    html.match(/<div[^>]*data-slot="plot-surface"[^>]*>/)?.[0] ?? "";
  const tablePresentation = compilePresentationBlock(CHART_VIEW, { type: "table" });
  const render = (presentation: typeof CHART_PRESENTATION, scene: "card" | "tile" | "page") =>
    renderToStaticMarkup(
      <ViewRenderer actions={{}} payload={PAYLOAD} presentation={presentation} scene={scene} />,
    );

  for (const scene of ["card", "page"] as const) {
    const table = surfaceOf(render(tablePresentation, scene));
    const chart = surfaceOf(render(CHART_PRESENTATION, scene));
    expect(table, `${scene} 场景的表格没有放在绘图区域（PlotSlab）内`).not.toBe("");
    for (const slab of [table, chart]) {
      expect(slab, scene).toContain("border-pa-line");
      expect(slab, scene).toContain(`border-radius:${PLOT_RADIUS}px`);
    }
    expect(table).toContain("p-4");
    expect(table).toContain("my-3");
  }
  const tile = surfaceOf(render(tablePresentation, "tile"));
  expect(tile, "瓦片中的表格没有放在绘图区域（PlotSlab）内").not.toBe("");
  expect(tile).not.toContain("border-pa-line");
  expect(tile).not.toContain("p-4");
  expect(tile).not.toContain("my-3");
});

test("表格声明热力着色时：指标单元格显示色块，文字色随底色变化，仅颜色模式下不显示数值", () => {
  const shaded = compilePresentationBlock(CHART_VIEW, {
    type: "table",
    shading: { palette: SERIES_COLORS[0] },
  });
  const html = renderToStaticMarkup(
    <ViewRenderer actions={{}} payload={PAYLOAD} presentation={shaded} scene="page" />,
  );
  const chips = html.match(/<div[^>]*data-slot="shade-chip"[^>]*>/g) ?? [];
  expect(chips).toHaveLength(4);
  const darkest = chips.find((chip) => chip.includes("1.000"));
  const lightest = chips.find((chip) => chip.includes("0.050"));
  expect(darkest, "最大值应使用最深的底色和白色文字").toContain("text-pa-ink-fg");
  expect(lightest, "最小值应使用浅底色和深色文字").toContain("text-pa-ink");
  expect(html).toContain(">120<");

  const colorsOnly = compilePresentationBlock(CHART_VIEW, {
    type: "table",
    shading: { palette: SERIES_COLORS[0], values: false },
  });
  const hidden = renderToStaticMarkup(
    <ViewRenderer actions={{}} payload={PAYLOAD} presentation={colorsOnly} scene="page" />,
  );
  const hiddenChips = hidden.match(/<div[^>]*data-slot="shade-chip"[^>]*>/g) ?? [];
  expect(hiddenChips).toHaveLength(4);
  for (const chip of hiddenChips) expect(chip).toContain("text-transparent");

  const plain = renderToStaticMarkup(
    <ViewRenderer
      actions={{}}
      payload={PAYLOAD}
      presentation={compilePresentationBlock(CHART_VIEW, { type: "table" })}
      scene="page"
    />,
  );
  expect(plain).not.toContain("shade-chip");
});

const padX = (className: string) =>
  className
    .split(/\s+/)
    .filter((name) => /^(?:px|pl|pr)-/.test(name))
    .sort();

function legendClass(scene: "card" | "tile" | "page"): string {
  const html = renderToStaticMarkup(<ViewChartCanvas chart={CHART!} scene={scene} />);
  return html.match(/<div class="(flex shrink-0 flex-wrap[^"]*)"/)?.[1] ?? "";
}

function padPx(token: string): number {
  const step = Number(token.replace("px-", ""));
  expect(Number.isFinite(step), `无法解析内边距类 ${token}`).toBe(true);
  return step * 4;
}

test("图例行、结果卡标题与绘图区左边缘对齐", () => {
  expect(CHART, "柱状图未生成").not.toBeNull();

  const cardTitleBox =
    renderToStaticMarkup(
      <ViewRenderer
        actions={{}}
        payload={PAYLOAD}
        presentation={compilePresentationBlock(CHART_VIEW, { type: "table" })}
        scene="card"
      />,
    ).match(/<div class="((?:px|pt|pb)-[^"]*)">\s*<div class="flex min-w-0/)?.[1] ?? "";
  expect(cardTitleBox, "没有找到结果卡的标题区域").not.toBe("");
  expect(padX(legendClass("card"))).toEqual(padX(cardTitleBox));

  expect(padX(legendClass("page")), "page 场景的读数栏不应再加水平内边距").toEqual(["px-0"]);
  expect(padX(legendClass("tile")), "tile 场景的读数栏不应再加水平内边距").toEqual(["px-0"]);

  for (const scene of ["card", "tile", "page"] as const) {
    const [token, ...extra] = padX(legendClass(scene));
    expect(extra, `${scene} 场景的读数栏有多个水平内边距类`).toEqual([]);
    expect(padPx(token ?? ""), `${scene} 场景的读数栏与绘图区左边缘没有对齐`).toBe(
      PLOT_PADDING[scene].left,
    );
    expect(PLOT_PADDING[scene].left, "绘图区左右留白应相等").toBe(PLOT_PADDING[scene].right);
  }

  expect(padX(legendClass("card")).length).toBeGreaterThan(0);
  expect(PLOT_PADDING.card.left).toBeGreaterThan(0);
  expect(PLOT_PADDING.tile.left).toBe(0);
});

const TREND_VIEW = {
  id: "result",
  columns: ["year", "month", "hr.active_employee_count", "hr.new_hire_count"],
  column_roles: {
    year: "time",
    month: "time",
    "hr.active_employee_count": "measure",
    "hr.new_hire_count": "measure",
  },
  rows: [
    [2026, 1, 100, 9],
    [2026, 2, 140, 11],
  ],
  row_count: 2,
  query_notes: [],
} as unknown as Parameters<typeof compilePresentationBlock>[0];

test("触屏设备上图例同时显示最后一个时间桶的名称和数值，桌面端不显示", () => {
  const trend = chartOf(
    compilePresentationBlock(TREND_VIEW, {
      type: "line",
      y: ["active_employee_count", "new_hire_count"],
    }),
  );
  const html = renderToStaticMarkup(<ViewChartCanvas chart={trend} scene="page" />);

  expect(html).toContain("140");
  expect(html).toContain("2026-02");
  for (const marker of ["140", "2026-02"]) {
    const at = html.indexOf(marker);
    expect(html.slice(Math.max(0, at - 220), at)).toContain("pointer-coarse:block");
  }

  const barHtml = renderToStaticMarkup(<ViewChartCanvas chart={CHART!} scene="page" />);
  expect(barHtml).not.toContain("pointer-coarse:block");
});

test("聚焦的系列提到最上层，取消聚焦后按序号恢复各自层级", () => {
  expect(CHART, "柱状图未生成").not.toBeNull();
  const z = (focused: number | null) => seriesOf(CHART!, { focused }).map((s) => s.z);
  expect(z(1).slice(0, 2)).toEqual([seriesZ(0), SERIES_Z.focused]);
  expect(z(null).slice(0, 2)).toEqual([seriesZ(0), seriesZ(1)]);

  expect(seriesZ(1) - seriesZ(0)).toBeGreaterThan(1);
  expect(haloZ(1)).toBeGreaterThan(seriesZ(0));
  expect(haloZ(1)).toBeLessThan(seriesZ(1));
  expect(SERIES_Z.focused).toBeGreaterThan(seriesZ(100));
});

test("聚焦只改变颜色：其他系列改用失焦色，深色模式下使用同一套颜色替换", () => {
  expect(CHART, "柱状图未生成").not.toBeNull();
  const colors = (over: Partial<RenderState>) =>
    seriesOf(CHART!, over)
      .slice(0, 2)
      .map((s) => (s.itemStyle as { color: string }).color);
  expect(colors({ focused: 0 })).toEqual([SERIES_COLORS[0], CHART_CHROME.blurred.light]);
  expect(colors({ focused: null })).toEqual([SERIES_COLORS[0], SERIES_COLORS[1]]);
  expect(colors({ focused: 0, dark: true })).toEqual([
    CHART_DARK_COLORS[SERIES_COLORS[0].toLowerCase()],
    CHART_CHROME.blurred.dark,
  ]);
  const compiled = CHART!.option.series as { emphasis?: Record<string, unknown> }[];
  expect(compiled[0].emphasis).not.toHaveProperty("focus");
  expect(compiled[0]).not.toHaveProperty("blur");
});

test("读数卡显示在光标左侧 24px 处，左侧放不下时显示在右侧，并始终留在绘图区域内", () => {
  const card = { width: 200, height: 100 };
  const bounds = { width: 800, height: 400 };
  expect(readoutPosition({ x: 500, y: 200 }, card, bounds)).toEqual({ left: 276, top: 150 });
  expect(readoutPosition({ x: 100, y: 200 }, card, bounds).left).toBe(124);
  expect(readoutPosition({ x: 500, y: 10 }, card, bounds).top).toBe(10);
  expect(readoutPosition({ x: 500, y: 390 }, card, bounds).top).toBe(290);
  expect(readoutPosition({ x: 60, y: 10 }, card, { width: 150, height: 400 }).left).toBe(10);
});

test("钉住期间指针停在钉住的数据点上，取消钉住后恢复跟随鼠标", () => {
  const calls: unknown[] = [];
  const stub = { dispatchAction: (action: unknown) => void calls.push(action) };

  expect(
    (renderOption(CHART!, state({ pinned: 3 })).tooltip as { triggerOn: string }).triggerOn,
  ).toBe("none");
  applyPin(stub, CHART!, 3);
  expect(calls).toEqual([{ type: "showTip", seriesIndex: 0, dataIndex: 3 }]);

  calls.length = 0;
  expect(
    (renderOption(CHART!, state({ pinned: null })).tooltip as { triggerOn: string }).triggerOn,
  ).toBe("mousemove|click");
  applyPin(stub, CHART!, null);
  expect(calls).toEqual([{ type: "hideTip" }]);

  calls.length = 0;
  applyPin(stub, { model: { ...CHART!.model, pointer: "item" } }, 3);
  expect(calls).toEqual([]);
});

test("绘图区域有圆角，瓦片场景不画边框", () => {
  const slabOf = (scene: "card" | "tile" | "page") =>
    renderToStaticMarkup(<ViewChartCanvas chart={CHART!} scene={scene} />).match(
      /<div[^>]*data-slot="plot-surface"[^>]*>/,
    )?.[0] ?? "";

  const card = slabOf("card");
  expect(card, "结果卡中没有绘图区域").not.toBe("");
  expect(card).toContain("border-pa-line");
  expect(card).not.toContain("bg-pa-");
  expect(card).toContain(`border-radius:${PLOT_RADIUS}px`);
  expect(card).toContain(`inset-inline-start:${plotRect(CHART!, "card").left}px`);
  expect(plotRect(CHART!, "card").left).toBeGreaterThan(PLOT_PADDING.card.left);

  const tile = slabOf("tile");
  expect(tile).not.toContain("border-pa-line");
  expect(tile).not.toContain("border-radius");
  expect(PLOT_FRAME.card).not.toBe(PLOT_FRAME.tile);
  expect(PLOT_RADIUS).toBeGreaterThan(0);
});

test("排行样式逐行显示，条形长度按最大值归一化，不使用 echarts 容器", () => {
  const rank = chartOf(
    compilePresentationBlock(
      {
        id: "result",
        columns: ["hr.organization_name", "hr.active_employee_count"],
        column_roles: {
          "hr.organization_name": "dimension",
          "hr.active_employee_count": "measure",
        },
        rows: [
          ["研发", 120],
          ["市场", 30],
        ],
        row_count: 2,
        query_notes: [],
      } as unknown as Parameters<typeof compilePresentationBlock>[0],
      {
        type: "bar",
        x: "organization_name",
        y: ["active_employee_count"],
      },
    ),
  );
  expect(rank?.layout, "单系列横向条形图应使用排行样式").toBe("rank");

  const html = renderToStaticMarkup(<ViewChartCanvas chart={rank!} scene="card" />);
  for (const text of ["研发", "市场", "120", "30"]) expect(html).toContain(text);
  expect(html).toContain("width:100%");
  expect(html).toContain("width:25%");
  expect(html).toContain('data-slot="plot-surface"');
  expect(html.match(/<div/g)?.length ?? 0).toBeLessThan(20);

  expect(CHART!.layout, "多系列条形图不应使用排行样式").toBeUndefined();
});

const LINE_CHART = chartOf(
  compilePresentationBlock(TREND_VIEW, {
    type: "line",
    y: ["active_employee_count", "new_hire_count"],
  }),
);

test("数值轴刻度数随绘图区尺寸变化，不固定为编译时的值", () => {
  type Axes = { xAxis: { splitNumber?: number }; yAxis: { splitNumber?: number }[] };
  const axes = (chart: typeof CHART, width: number, height: number) =>
    renderOption(chart!, state({ viewport: { width, height } })) as unknown as Axes;

  const tall = axes(LINE_CHART, 900, 700).yAxis[0]?.splitNumber ?? 0;
  const short = axes(LINE_CHART, 900, 200).yAxis[0]?.splitNumber ?? 0;
  expect(tall).toBeGreaterThan(short);
  expect(short).toBeGreaterThanOrEqual(2);
  expect(tall).toBeLessThanOrEqual(10);
  expect(axes(LINE_CHART, 900, 10).yAxis[0]?.splitNumber).toBeGreaterThanOrEqual(2);
  expect(axes(LINE_CHART, 900, 700).xAxis.splitNumber).toBeUndefined();
  const wide = axes(CHART, 900, 300).xAxis.splitNumber ?? 0;
  const narrow = axes(CHART, 260, 300).xAxis.splitNumber ?? 0;
  expect(wide, "横向条形图的数值轴应随容器宽度变长").toBeGreaterThan(narrow);
});

/** 模拟卸载时实例已 dispose 的情况：此时调用 `getZr()` 会抛错。 */
function disposableSource() {
  const events: string[] = [];
  const zr = {
    on: (event: string) => events.push(`zr.on:${event}`),
    off: (event: string) => events.push(`zr.off:${event}`),
  };
  let alive = true;
  return {
    events,
    dispose: () => {
      alive = false;
    },
    source: {
      on: (event: string) => events.push(`on:${event}`),
      off: (event: string) => events.push(`off:${event}`),
      getZr: () => {
        if (!alive) throw new Error("getZr after dispose");
        return zr;
      },
    },
  };
}

test("读数订阅的清理只使用订阅时拿到的引用，实例 dispose 后也能正常退订", () => {
  const pie = disposableSource();
  const release = subscribeReadout(
    pie.source,
    { model: { ...CHART!.model, pointer: "item" } },
    () => {},
  );
  expect(pie.events).toEqual(["on:mouseover", "on:mouseout", "zr.on:globalout"]);
  // 实例先 dispose（创建实例的 effect 声明在前，卸载时先执行清理）
  pie.dispose();
  release?.();
  expect(pie.events.slice(3)).toEqual([
    "off:mouseover",
    "off:mouseout",
    "off:updateAxisPointer",
    "zr.off:globalout",
  ]);

  // 轴指针图订阅的是另一个事件，退订时同样不再调用 getZr
  const axis = disposableSource();
  const releaseAxis = subscribeReadout(axis.source, CHART!, () => {});
  expect(axis.events).toEqual(["on:updateAxisPointer", "zr.on:globalout"]);
  axis.dispose();
  expect(() => releaseAxis?.()).not.toThrow();
});
