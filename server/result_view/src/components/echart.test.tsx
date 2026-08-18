/**
 * 图表画布单测：守读数条（HTML 图例）的版式判据。
 *
 * 画布本体（echarts 实例、尺寸观察、悬停联动）全在 effect 里，静态渲染一概不触发；
 * 渲染期唯一伸手向宿主要的是一次主题问询，故本文件给一对最小存根，其余不引 DOM。
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  applyValueTickDensity,
  focusActions,
  focusTarget,
  raiseSeries,
  ViewChartCanvas,
} from "./echart.js";
import { plotRect } from "../chart_render.js";
import { ViewRenderer } from "./view_renderer.js";
import {
  compilePresentationBlock,
  LEGEND_MARKER_CLASS,
  PLOT_FRAME,
  PLOT_PADDING,
  PLOT_RADIUS,
  SERIES_COLORS,
  SERIES_Z,
  haloZ,
  seriesZ,
} from "../../../src/presentation_core/chart_config.js";

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
  default_population_scope: "口径：在职含试用期",
  data_as_of: "2026-06-30",
  time_context: [],
} as unknown as Parameters<typeof ViewRenderer>[0]["payload"];

const CHART_PRESENTATION = compilePresentationBlock(CHART_VIEW, {
  type: "bar",
  x: "organization_name",
  y: ["active_employee_count", "new_hire_count"],
} as never);
const CHART = CHART_PRESENTATION.chart;

test("渲染器忠实呈现声明的图或表", () => {
  const chart = renderToStaticMarkup(
    <ViewRenderer
      actions={{}}
      payload={PAYLOAD}
      presentation={CHART_PRESENTATION}
      scene="page"
    />,
  );
  expect(chart).toContain(LEGEND_MARKER_CLASS);
  expect(chart).not.toContain("<tbody");

  const table = renderToStaticMarkup(
    <ViewRenderer
      actions={{}}
      payload={PAYLOAD}
      presentation={compilePresentationBlock(CHART_VIEW, { type: "table", y: [] } as never)}
      scene="page"
    />,
  );
  expect(table).toContain("<tbody");
  expect(table).not.toContain(LEGEND_MARKER_CLASS);
});

/** 场地是场景的取舍，不是形态的：同一场景里图与表落在同一块场地上、同框或同不框。 */
test("结果面的场地按场景定，图与表同框", () => {
  const surfaceOf = (html: string) =>
    html.match(/<div[^>]*data-slot="plot-surface"[^>]*>/)?.[0] ?? "";
  const tablePresentation = compilePresentationBlock(CHART_VIEW, {
    type: "table",
    y: [],
  } as never);
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
    y: [],
    shading: { palette: SERIES_COLORS[0] },
  } as never);
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
    y: [],
    shading: { palette: SERIES_COLORS[0], values: false },
  } as never);
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
      presentation={compilePresentationBlock(CHART_VIEW, { type: "table", y: [] } as never)}
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
function legendClass(plot: "compact" | "tile" | "page"): string {
  const html = renderToStaticMarkup(
    <ViewChartCanvas chart={CHART!} plot={plot} />,
  );
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
        presentation={compilePresentationBlock(CHART_VIEW, { type: "table", y: [] } as never)}
        scene="card"
      />,
    ).match(/<div class="((?:px|pt|pb)-[^"]*)">\s*<div class="flex min-w-0/)?.[1] ?? "";
  expect(cardTitleBox, "答数态题名块没找到，断言失去着力点").not.toBe("");
  expect(padX(legendClass("compact"))).toEqual(padX(cardTitleBox));

  // 另两档无出血可还（判据同上），读数条因此不叠第二道
  expect(padX(legendClass("page")), "整页档的读数条叠了第二道横向衬垫").toEqual(["px-0"]);
  expect(padX(legendClass("tile")), "瓦片档的读数条叠了第二道横向衬垫").toEqual(["px-0"]);

  // 三档逐一对表：读数条的衬垫就是画布到 plot 框的横向留白，框缘因此钉在题名那条轴上
  for (const plot of ["compact", "tile", "page"] as const) {
    const [token, ...extra] = padX(legendClass(plot));
    expect(extra, `${plot} 档的读数条给了不止一个横向衬垫`).toEqual([]);
    expect(padPx(token ?? ""), `${plot} 档的读数条与 plot 框不同轴`).toBe(PLOT_PADDING[plot].left);
    expect(PLOT_PADDING[plot].left, "横向留白左右不对称，框会歪").toBe(PLOT_PADDING[plot].right);
  }

  expect(padX(legendClass("compact")).length).toBeGreaterThan(0);
  expect(PLOT_PADDING.compact.left).toBeGreaterThan(0);
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
  } as never).chart;
  if (!trend) throw new Error("趋势图没编译出来，下面全部落空");
  const html = renderToStaticMarkup(<ViewChartCanvas chart={trend} plot="page" />);

  // 值取自铺开的最后一行本身：140/11 就是画面最右那两个点，不是另算的合计
  expect(html).toContain("140");
  expect(html).toContain("2026-02");
  // 触屏才现形：桌面上这两处恒 hidden，既有版式一格不动
  for (const marker of ["140", "2026-02"]) {
    const at = html.indexOf(marker);
    expect(html.slice(Math.max(0, at - 220), at)).toContain("pointer-coarse:block");
  }

  const barHtml = renderToStaticMarkup(<ViewChartCanvas chart={CHART!} plot="page" />);
  expect(barHtml).not.toContain("pointer-coarse:block");
});

test("聚焦某条系列时它单独抬层，收回时按序号落回各自那一层", () => {
  expect(CHART, "柱图没编译出来，下面全部落空").not.toBeNull();
  const patches: unknown[] = [];
  const stub = { setOption: (option: unknown) => void patches.push(option) };

  raiseSeries(stub as never, CHART!, 1);
  expect(patches.pop()).toEqual({ series: [{ z: seriesZ(0) }, { z: SERIES_Z.focused }] });

  raiseSeries(stub as never, CHART!, null);
  expect(patches.pop()).toEqual({ series: [{ z: seriesZ(0) }, { z: seriesZ(1) }] });

  expect(seriesZ(1) - seriesZ(0)).toBeGreaterThan(1);
  expect(haloZ(1)).toBeGreaterThan(seriesZ(0));
  expect(haloZ(1)).toBeLessThan(seriesZ(1));
  expect(SERIES_Z.focused).toBeGreaterThan(seriesZ(100));
  const single = {
    ...CHART!,
    option: { ...CHART!.option, pa: { ...(CHART!.option.pa as object), legend: [{}] } },
  };
  raiseSeries(stub as never, single as never, 0);
  expect(patches, "单系列也去抬层，白改一次 option").toEqual([]);
});

test("换焦点一趟发完，不经由「谁都没聚焦」那一态", () => {
  const a = focusTarget(CHART!, 0, "在职人数");
  const b = focusTarget(CHART!, 1, "入职人数");
  // 从 a 换到 b：收回与点亮同在一个序列里，中间没有「只收回」的一趟
  expect(focusActions(a, b)).toEqual([
    { type: "downplay", seriesName: "在职人数" },
    { type: "highlight", seriesName: "入职人数" },
  ]);
  // 首次进入只点亮，离开整条读数条只收回
  expect(focusActions(null, a)).toEqual([{ type: "highlight", seriesName: "在职人数" }]);
  expect(focusActions(a, null)).toEqual([{ type: "downplay", seriesName: "在职人数" }]);
  expect(focusTarget({ ...CHART!, form: "pie" }, 1, "研发")).toEqual({
    seriesIndex: 0,
    dataIndex: 1,
  });
});

test("绘图区那块场地是圆角的，且瓦片档不画框", () => {
  const slabOf = (plot: "compact" | "tile" | "page") =>
    renderToStaticMarkup(<ViewChartCanvas chart={CHART!} plot={plot} />).match(
      /<div[^>]*data-slot="plot-surface"[^>]*>/,
    )?.[0] ?? "";

  const card = slabOf("compact");
  expect(card, "结果卡没铺出绘图场地").not.toBe("");
  expect(card).toContain("border-pa-line");
  // 场地不铺底色：它就是承载面本身，判据见 ui_spec「图表画布」节
  expect(card).not.toContain("bg-pa-");
  // 圆角是这块场地的形本身——canvas 画不出它，正是框落到 DOM 的理由
  expect(card).toContain(`border-radius:${PLOT_RADIUS}px`);
  // 位置读的是同一道算式，不是另写的数字
  expect(card).toContain(`inset-inline-start:${plotRect(CHART!, "compact").left}px`);
  // 这张是横排条形：类目那一栏叠进来了，场地不是纯场景留白
  expect(plotRect(CHART!, "compact").left).toBeGreaterThan(PLOT_PADDING.compact.left);

  // 瓦片壳自己就是边界，场地在但不画框
  const tile = slabOf("tile");
  expect(tile).not.toContain("border-pa-line");
  expect(tile).not.toContain("border-radius");
  expect(PLOT_FRAME.compact).not.toBe(PLOT_FRAME.tile);
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
    { type: "bar", x: "organization_name", y: ["active_employee_count"] } as never,
  ).chart;
  expect(rank?.layout, "单系列横排条形没走排行版式").toBe("rank");

  const html = renderToStaticMarkup(<ViewChartCanvas chart={rank!} plot="compact" />);
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
} as never).chart;

test("值轴档数随绘图区尺度走，不是编译期那个定数", () => {
  const patches: Record<string, unknown>[] = [];
  const stub = { setOption: (option: Record<string, unknown>) => patches.push(option) };
  type Axes = { xAxis: { splitNumber?: number }[]; yAxis: { splitNumber?: number }[] };
  const patch = (chart: typeof CHART, w: number, h: number) => {
    patches.length = 0;
    applyValueTickDensity(stub as never, chart!, "compact", { width: w, height: h });
    return patches.pop() as Axes | undefined;
  };

  // 值轴在纵向的折线：整页那么高刻得细，卡片那么矮刻得粗——同一张图，档数不同
  const tall = patch(LINE_CHART, 900, 700)?.yAxis[0]?.splitNumber ?? 0;
  const short = patch(LINE_CHART, 900, 200)?.yAxis[0]?.splitNumber ?? 0;
  expect(tall).toBeGreaterThan(short);

  expect(short).toBeGreaterThanOrEqual(2);
  expect(tall).toBeLessThanOrEqual(10);
  expect(patch(LINE_CHART, 900, 10)?.yAxis[0]?.splitNumber).toBeGreaterThanOrEqual(2);
  expect(patch(LINE_CHART, 900, 700)?.xAxis).toEqual([{}]);
  const wide = patch(CHART, 900, 300)?.xAxis[0]?.splitNumber ?? 0;
  const narrow = patch(CHART, 260, 300)?.xAxis[0]?.splitNumber ?? 0;
  expect(wide, "横排条形的值轴没跟着宽走").toBeGreaterThan(narrow);
  expect(patch(CHART, 900, 300)?.yAxis).toEqual([{}]);
  patches.length = 0;
  applyValueTickDensity(stub as never, { ...CHART!, form: "pie" }, "compact", {
    width: 900,
    height: 700,
  });
  expect(patches, "饼图也去改值轴，白改一次 option").toEqual([]);
});
