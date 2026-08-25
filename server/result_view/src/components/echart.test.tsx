/**
 * 图表画布单测：守读数条（HTML 图例）的版式判据。
 *
 * 画布本体（echarts 实例、尺寸观察、悬停联动）全在 effect 里，静态渲染一概不触发；
 * 渲染期唯一伸手向宿主要的是一次主题问询，故本文件给一对最小存根，其余不引 DOM。
 */
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
  type ViewChart,
} from "../../../src/presentation_core/chart_config.js";

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
 * 存根落在 import 之后：模块求值期 `document` 必须仍然缺席——zrender 在加载时嗅探
 * 宿主能力，闻到半个 document 会走进浏览器分支去摸 `documentElement.style`。
 * 渲染期则要有它：isDarkTheme 问一次宿主主题。
 */
Object.assign(globalThis, {
  document: { documentElement: { dataset: {} } },
  window: { matchMedia: () => ({ matches: false }) },
});

/** 两个系列的柱图：单系列不出读数条，得有两条才验得到版式。 */
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
const CHART = CHART_PRESENTATION.chart;

test("渲染器忠实呈现声明的图或表", () => {
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

/** 场地是场景的取舍，不是形态的：同一场景里图与表落在同一块场地上、同框或同不框。 */
test("结果面的场地按场景定，图与表同框", () => {
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
    expect(table, `${scene} 的表格没铺在场地上`).not.toBe("");
    for (const slab of [table, chart]) {
      expect(slab, scene).toContain("border-pa-line");
      expect(slab, scene).toContain(`border-radius:${PLOT_RADIUS}px`);
    }
    // 框里的表格再内缩一圈：分隔线与末列的数不贴框缘；框上下留呼吸，不压题名与行数条
    expect(table).toContain("p-4");
    expect(table).toContain("my-3");
  }
  const tile = surfaceOf(render(tablePresentation, "tile"));
  expect(tile, "瓦片里的表格没经过场地").not.toBe("");
  expect(tile).not.toContain("border-pa-line");
  expect(tile).not.toContain("p-4");
  expect(tile).not.toContain("my-3");
});

test("热力着色随 table 声明：指标格铺色片、字色随底色、仅颜色档不印数", () => {
  const shaded = compilePresentationBlock(CHART_VIEW, {
    type: "table",
    shading: { palette: SERIES_COLORS[0] },
  });
  const html = renderToStaticMarkup(
    <ViewRenderer actions={{}} payload={PAYLOAD} presentation={shaded} scene="page" />,
  );
  const chips = html.match(/<div[^>]*data-slot="shade-chip"[^>]*>/g) ?? [];
  // 两行 × 两个指标列 = 四片；维度列不着色
  expect(chips).toHaveLength(4);
  const darkest = chips.find((chip) => chip.includes("1.000"));
  const lightest = chips.find((chip) => chip.includes("0.050"));
  expect(darkest, "极大值该是全浓底色").toContain("text-pa-ink-fg");
  expect(lightest, "极小值该是淡底墨字").toContain("text-pa-ink");
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

/** 元素上的横向衬垫类——比的是「贴哪条左轴」，不是整串类名。 */
const padX = (className: string) =>
  className
    .split(/\s+/)
    .filter((name) => /^(?:px|pl|pr)-/.test(name))
    .sort();

/** 读数条那一行的类名（`flex shrink-0 flex-wrap` 是它的版式签名） */
function legendClass(scene: "card" | "tile" | "page"): string {
  const html = renderToStaticMarkup(<ViewChartCanvas chart={CHART!} scene={scene} />);
  return html.match(/<div class="(flex shrink-0 flex-wrap[^"]*)"/)?.[1] ?? "";
}

/** Tailwind 间距记号还原成 px：`px-4` = 4 档 × 4px */
function padPx(token: string): number {
  const step = Number(token.replace("px-", ""));
  expect(Number.isFinite(step), `衬垫记号 ${token} 认不出来，断言失去着力点`).toBe(true);
  return step * 4;
}

test("读数条、题名与 plot 框左缘同轴", () => {
  expect(CHART, "柱图没编译出来，下面全部落空").not.toBeNull();

  // 答数态：画布出血铺到内容区边缘，故读数条自带题名那一圈衬垫
  const cardTitleBox =
    renderToStaticMarkup(
      <ViewRenderer
        actions={{}}
        payload={PAYLOAD}
        presentation={compilePresentationBlock(CHART_VIEW, { type: "table" })}
        scene="card"
      />,
    ).match(/<div class="((?:px|pt|pb)-[^"]*)">\s*<div class="flex min-w-0/)?.[1] ?? "";
  expect(cardTitleBox, "答数态题名块没找到，断言失去着力点").not.toBe("");
  expect(padX(legendClass("card"))).toEqual(padX(cardTitleBox));

  // 另两档无出血可还（判据同上），读数条因此不叠第二道
  expect(padX(legendClass("page")), "整页档的读数条叠了第二道横向衬垫").toEqual(["px-0"]);
  expect(padX(legendClass("tile")), "瓦片档的读数条叠了第二道横向衬垫").toEqual(["px-0"]);

  // 三档逐一对表：读数条的衬垫就是画布到 plot 框的横向留白，框缘因此钉在题名那条轴上
  for (const scene of ["card", "tile", "page"] as const) {
    const [token, ...extra] = padX(legendClass(scene));
    expect(extra, `${scene} 档的读数条给了不止一个横向衬垫`).toEqual([]);
    expect(padPx(token ?? ""), `${scene} 档的读数条与 plot 框不同轴`).toBe(
      PLOT_PADDING[scene].left,
    );
    expect(PLOT_PADDING[scene].left, "横向留白左右不对称，框会歪").toBe(PLOT_PADDING[scene].right);
  }

  expect(padX(legendClass("card")).length).toBeGreaterThan(0);
  expect(PLOT_PADDING.card.left).toBeGreaterThan(0);
  expect(PLOT_PADDING.tile.left).toBe(0);
});

/** 两个系列的时间趋势：末桶读数只属于时间轴，非时间图没有「最后一桶」这回事。 */
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

test("触屏上图例兼作读数位：末桶的值与桶名随图例交付，桌面档不占位", () => {
  const trend = compilePresentationBlock(TREND_VIEW, {
    type: "line",
    y: ["active_employee_count", "new_hire_count"],
  }).chart;
  if (!trend) throw new Error("趋势图没编译出来，下面全部落空");
  const html = renderToStaticMarkup(<ViewChartCanvas chart={trend} scene="page" />);

  // 值取自铺开的最后一行本身：140/11 就是画面最右那两个点，不是另算的合计
  expect(html).toContain("140");
  expect(html).toContain("2026-02");
  // 触屏才现形：桌面上这两处恒 hidden，既有版式一格不动
  for (const marker of ["140", "2026-02"]) {
    const at = html.indexOf(marker);
    expect(html.slice(Math.max(0, at - 220), at)).toContain("pointer-coarse:block");
  }

  const barHtml = renderToStaticMarkup(<ViewChartCanvas chart={CHART!} scene="page" />);
  expect(barHtml).not.toContain("pointer-coarse:block");
});

test("聚焦某条系列时它单独抬层，收回时按序号落回各自那一层", () => {
  expect(CHART, "柱图没编译出来，下面全部落空").not.toBeNull();
  const z = (focused: number | null) => seriesOf(CHART!, { focused }).map((s) => s.z);
  expect(z(1).slice(0, 2)).toEqual([seriesZ(0), SERIES_Z.focused]);
  expect(z(null).slice(0, 2)).toEqual([seriesZ(0), seriesZ(1)]);

  expect(seriesZ(1) - seriesZ(0)).toBeGreaterThan(1);
  expect(haloZ(1)).toBeGreaterThan(seriesZ(0));
  expect(haloZ(1)).toBeLessThan(seriesZ(1));
  expect(SERIES_Z.focused).toBeGreaterThan(seriesZ(100));
});

test("焦点只改色不换态：落选换成失焦色，暗色下走与首帧同一道主题翻译", () => {
  expect(CHART, "柱图没编译出来，下面全部落空").not.toBeNull();
  const colors = (over: Partial<RenderState>) =>
    seriesOf(CHART!, over)
      .slice(0, 2)
      .map((s) => (s.itemStyle as { color: string }).color);
  expect(colors({ focused: 0 })).toEqual([SERIES_COLORS[0], CHART_CHROME.blurred.light]);
  expect(colors({ focused: null })).toEqual([SERIES_COLORS[0], SERIES_COLORS[1]]);
  // 暗色：色出自同一张对照表，交互期不另立一套灰
  expect(colors({ focused: 0, dark: true })).toEqual([
    CHART_DARK_COLORS[SERIES_COLORS[0].toLowerCase()],
    CHART_CHROME.blurred.dark,
  ]);
  // 编译期的 option 里没有第二套交互态：置灰全由取色式算出，绘图区内的悬停改不动谁的色
  const compiled = CHART!.option.series as { emphasis?: Record<string, unknown> }[];
  expect(compiled[0].emphasis).not.toHaveProperty("focus");
  expect(compiled[0]).not.toHaveProperty("blur");
});

test("读数卡落在光标左侧 24，左边放不下才翻到右侧，且恒夹在场地内留一道边", () => {
  const card = { width: 200, height: 100 };
  const bounds = { width: 800, height: 400 };
  // 左置：卡的右缘离光标 24
  expect(readoutPosition({ x: 500, y: 200 }, card, bounds)).toEqual({ left: 276, top: 150 });
  // 左边放不下就翻到右侧，同样是 24
  expect(readoutPosition({ x: 100, y: 200 }, card, bounds).left).toBe(124);
  // 纵向随光标居中，但不许越出场地上下缘——越出去的那半张卡等于没印
  expect(readoutPosition({ x: 500, y: 10 }, card, bounds).top).toBe(10);
  expect(readoutPosition({ x: 500, y: 390 }, card, bounds).top).toBe(290);
  // 场地比卡还窄时贴着那道边，不给出负的落点
  expect(readoutPosition({ x: 60, y: 10 }, card, { width: 150, height: 400 }).left).toBe(10);
});

test("钉住期间指针停在被钉的那一格，撤钉即交还给鼠标", () => {
  const calls: unknown[] = [];
  const stub = { dispatchAction: (action: unknown) => void calls.push(action) };

  // option 那一半在派生里：钉住即交出 triggerOn；指针落点由这里点名
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

  // 饼图没有指针可冻：那一路的索引出自逐项事件，钉住只冻卡片自己
  calls.length = 0;
  applyPin(stub, { model: { ...CHART!.model, pointer: "item" } }, 3);
  expect(calls).toEqual([]);
});

test("绘图区那块场地是圆角的，且瓦片档不画框", () => {
  const slabOf = (scene: "card" | "tile" | "page") =>
    renderToStaticMarkup(<ViewChartCanvas chart={CHART!} scene={scene} />).match(
      /<div[^>]*data-slot="plot-surface"[^>]*>/,
    )?.[0] ?? "";

  const card = slabOf("card");
  expect(card, "结果卡没铺出绘图场地").not.toBe("");
  expect(card).toContain("border-pa-line");
  // 场地不铺底色：它就是承载面本身，判据见 ui_spec「图表画布」节
  expect(card).not.toContain("bg-pa-");
  // 圆角是这块场地的形本身——canvas 画不出它，正是框落到 DOM 的理由
  expect(card).toContain(`border-radius:${PLOT_RADIUS}px`);
  // 位置读的是同一道算式，不是另写的数字
  expect(card).toContain(`inset-inline-start:${plotRect(CHART!, "card").left}px`);
  // 这张是横排条形：类目那一栏叠进来了，场地不是纯场景留白
  expect(plotRect(CHART!, "card").left).toBeGreaterThan(PLOT_PADDING.card.left);

  // 瓦片壳自己就是边界，场地在但不画框
  const tile = slabOf("tile");
  expect(tile).not.toContain("border-pa-line");
  expect(tile).not.toContain("border-radius");
  expect(PLOT_FRAME.card).not.toBe(PLOT_FRAME.tile);
  expect(PLOT_RADIUS).toBeGreaterThan(0);
});

test("排行版式逐行陈述：条长按本屏最大值归一，且不落 echarts 容器", () => {
  const rank = compilePresentationBlock(
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
  ).chart;
  expect(rank?.layout, "单系列横排条形没走排行版式").toBe("rank");

  const html = renderToStaticMarkup(<ViewChartCanvas chart={rank!} scene="card" />);
  // 类目名与值都是文字，不是画出来的
  for (const text of ["研发", "市场", "120", "30"]) expect(html).toContain(text);
  // 条长之比 = 值之比（30/120 = 25%），最长那条铺满
  expect(html).toContain("width:100%");
  expect(html).toContain("width:25%");
  // 排行版式没有画布：框仍在（同一块场地），但不该有给 echarts 的那个空盒
  expect(html).toContain('data-slot="plot-surface"');
  expect(html.match(/<div/g)?.length ?? 0).toBeLessThan(20);

  expect(CHART!.layout, "多系列被误判成排行版式").toBeUndefined();
});

/** 折线：值轴在纵向——与上面那张横排条形（值轴在横向）恰好互为对照。 */
const LINE_CHART = compilePresentationBlock(TREND_VIEW, {
  type: "line",
  y: ["active_employee_count", "new_hire_count"],
}).chart;

test("值轴档数随绘图区尺度走，不是编译期那个定数", () => {
  type Axes = { xAxis: { splitNumber?: number }; yAxis: { splitNumber?: number }[] };
  const axes = (chart: typeof CHART, width: number, height: number) =>
    renderOption(chart!, state({ viewport: { width, height } })) as unknown as Axes;

  // 值轴在纵向的折线：整页那么高刻得细，卡片那么矮刻得粗——同一张图，档数不同
  const tall = axes(LINE_CHART, 900, 700).yAxis[0]?.splitNumber ?? 0;
  const short = axes(LINE_CHART, 900, 200).yAxis[0]?.splitNumber ?? 0;
  expect(tall).toBeGreaterThan(short);
  expect(short).toBeGreaterThanOrEqual(2);
  expect(tall).toBeLessThanOrEqual(10);
  expect(axes(LINE_CHART, 900, 10).yAxis[0]?.splitNumber).toBeGreaterThanOrEqual(2);
  // 类目轴没有档数可言
  expect(axes(LINE_CHART, 900, 700).xAxis.splitNumber).toBeUndefined();
  const wide = axes(CHART, 900, 300).xAxis.splitNumber ?? 0;
  const narrow = axes(CHART, 260, 300).xAxis.splitNumber ?? 0;
  expect(wide, "横排条形的值轴没跟着宽走").toBeGreaterThan(narrow);
});

/** 拆卸时实例已 dispose：`getZr()` 改口返回 null，回头再要手柄就是在清理里抛错。 */
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

test("读数订阅的清理只碰订阅时那两个手柄，实例散场后照样退得干净", () => {
  const pie = disposableSource();
  const release = subscribeReadout(
    pie.source,
    { model: { ...CHART!.model, pointer: "item" } },
    () => {},
  );
  expect(pie.events).toEqual(["on:mouseover", "on:mouseout", "zr.on:globalout"]);
  // 实例先散场（建实例那道 effect 的清理声明在前，拆卸时先跑）
  pie.dispose();
  release?.();
  expect(pie.events.slice(3)).toEqual([
    "off:mouseover",
    "off:mouseout",
    "off:updateAxisPointer",
    "zr.off:globalout",
  ]);

  // 整列触发的图订的是另一件事，退订同样不回头要手柄
  const axis = disposableSource();
  const releaseAxis = subscribeReadout(axis.source, CHART!, () => {});
  expect(axis.events).toEqual(["on:updateAxisPointer", "zr.on:globalout"]);
  axis.dispose();
  expect(() => releaseAxis?.()).not.toThrow();
});
