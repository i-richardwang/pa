/**
 * 声明式呈现编译：在完整行上确定性编译表格、KPI 或 Agent 显式声明的图表。
 * 服务端产出可序列化的完整呈现块并在此完成选型，浏览器只布局和渲染。
 *
 * 图表交付两样东西：echarts `option`（绘图指令）与 `model`（呈现模型——渲染端要**读**的
 * 每一个数：类目、图例单元及其取值/格式/色、占比、最新桶、指针模型、下钻投影）。
 * 系列在编译前一次解析成 {形态, 色, 轴位}（缺省出自图型，显式声明按来源列覆盖），
 * option 的每一段样式都按解析结果一次写就。
 * 样式不进数据格：`series.data` 恒为裸数值，末点记号走 markPoint、饼图色走调色板。
 *
 * 函数不可序列化，数值轴与值标签的格式化由渲染端按 `model` 注入；四缘留白按宿主场景档位
 * 由渲染端算定。视觉常量取自 design_tokens.ts，序列化 option 恒为亮色原值，暗色由渲染端按
 * CHART_DARK_COLORS 映射翻转。本文件只做数据编排与样式声明，零度量算术（engine_boundary 守护）。
 */
import {
  canCompileKpi,
  compileChart,
  compileTableWithStatus,
  compileTotalBand,
  barChartHeight,
  makeTitleOf,
  type BarSpec,
  type CategoryComboSpec,
  type ChartRow,
  type ChartSourceRow,
  type PieSpec,
  type SeriesDef,
  type TableLayoutStatus,
  type TableModel,
  type TotalBand,
  type TrendSpec,
} from "./view_shape.js";
import type { ChartDecl, ChartRenderDecl, SeriesDisplay } from "./chart_decl.js";
import { formatSeriesValue, toNumber } from "./view_format.js";
import { CHART_CHROME, CHART_SERIES, FONT_FAMILY } from "./design_tokens.js";
import type { ColumnFormat, ViewBlock } from "../semantic_core/query_payload.js";
import { PRESENTATION_TYPE_SCHEMA } from "../semantic_core/presentation_type.js";
import type { PresentationSpec } from "./presentation_spec.js";

const MOTION = {
  animation: true,
  animationDuration: 0,
  animationDurationUpdate: 1,
  stateAnimation: { duration: 0 },
} as const;

/** tool result `_meta` 中完整呈现块的键名（带命名空间前缀，MCP _meta 键名规范） */
export const PRESENTATION_META_KEY = "ai.pa/presentation";

/** 值轴的格式声明：渲染端据此注入刻度格式化函数（0–1 标度 → 百分比/百分点） */
export type AxisFormats = {
  x?: (ColumnFormat | null)[];
  y?: (ColumnFormat | null)[];
};

/** 值轴刻度的小数位，与 AxisFormats 按轴索引对位；null = 呈现层默认位数 */
export type AxisDecimals = {
  x?: (number | null)[];
  y?: (number | null)[];
};

/**
 * 图例单元：画面上可被聚焦、可被逐行读出的那一个东西——笛卡尔图是系列，饼图是切片。
 * 取值按类目序对位（`values[i]` 是第 i 个类目上的读数；饼图一片一个值，只有 `values[0]`）。
 */
export type ChartLegendItem = {
  name: string;
  color: string;
  format: ColumnFormat;
  /** 模型声明的小数位；未声明缺席，走呈现层默认 */
  decimals?: number;
  values: (number | null)[];
  /**
   * 本单元所对照的那个单元的序号（同期叠加里各对照期都指向主期）。读数卡据此附差值；
   * 「谁减谁」在编排期立好，呈现层不猜哪条是主期。
   */
  baseline?: number;
};

/**
 * 呈现模型：与 echarts `option` 并列交付、供渲染端**读**的那份数据。
 *
 * option 只是绘图指令——它里面的数字是画出来给眼睛看的，不是给程序读回来的；读数卡、
 * 排行版式、图例读数、饼图环心总计要的每一个数都在这里，渲染端不从 option 里反解任何东西。
 */
export type ChartModel = {
  /** 类目名：笛卡尔图是类目轴的顺序，饼图是度量名那一个「桶」 */
  categories: string[];
  legend: ChartLegendItem[];
  axes: AxisFormats;
  /** 值轴刻度小数位；只在有单元声明过位数时下发 */
  axis_decimals?: AxisDecimals;
  /** 结构占比注释：按类目序对位；读数卡随附一行占比说明 */
  share?: { title: string; values: (number | null)[] };
  /**
   * 「最新」落在哪个类目：每个单元都有值的最后一个时间桶。图例读数与末点实心标记同出此处——
   * 一个标签只交代得了一个时间断面，凑不齐就整个不发。只随时间趋势下发。
   */
  latest?: { index: number; label: string };
  /** 读数索引由谁报：整列指针（类目轴）或逐项进出（饼图无类目轴） */
  pointer: "axis" | "item";
  /** legendIndex × categoryIndex → 原始结果格；只在浏览器交互通道消费 */
  records?: { points: ({ row: number; column: string } | null)[][] };
};

export type ViewChartForm = "line" | "bar" | "pie";

export type ViewChart = {
  form: ViewChartForm;
  /** 建议渲染高度（px）：条形随分类数伸缩，布局由服务端一次算定 */
  height: number;

  /** 框外栏（px）：留给框外轴标签的那一栏（横排条的左侧类目栏），场地框缩进让位 */
  plot_gutter?: { left?: number };
  /** 框内余量（px）：值标签占的那道，grid 缩进而场地框不动 */
  plot_inset?: { top?: number; right?: number };

  layout?: "rank";
  /** echarts 绘图指令；排行版式不落 echarts，此处为空对象 */
  option: Record<string, unknown>;
  model: ChartModel;
};

/** 服务端确定性编译产物；表格恒在册，图表只是同一结果的可选首选视图。 */
export type PresentationBlock = {
  type: ChartDecl["type"];
  table: TableModel;
  /** 声明式表格布局的实际编译状态；无法忠实成矩阵时才 unavailable。 */
  table_layout: TableLayoutStatus;
  chart?: ViewChart;

  totals?: TotalBand;
};

export type PresentationFallbackKind = "empty_result" | "unsupported_shape";

export type PresentationFallback = {
  result_view_id: string;
  kind: PresentationFallbackKind;
  note: string;
};

export function presentationFallbacks(
  viewId: string,
  compiled: PresentationBlock,
  presentation: PresentationSpec,
  rowCount: number,
): PresentationFallback[] {
  const tableNotes: PresentationFallback[] =
    presentation.type === "table" && compiled.table_layout.state === "unavailable"
      ? [
          {
            result_view_id: viewId,
            kind: "unsupported_shape",
            note: `声明的表格布局未生效：${compiled.table_layout.message}`,
          },
        ]
      : [];
  if (compiled.type === presentation.type) return tableNotes;
  if (rowCount === 0) {
    return [
      ...tableNotes,
      {
        result_view_id: viewId,
        kind: "empty_result",
        note: "查询成功但结果为空，本次以空表呈现；呈现声明保留，数据满足后重跑即可生效。",
      },
    ];
  }
  return [
    ...tableNotes,
    {
      result_view_id: viewId,
      kind: "unsupported_shape",
      note: "查询已成功，但当前结果形态不支持声明的呈现，本次已按表格呈现。",
    },
  ];
}

export const SERIES_COLORS: readonly string[] = CHART_SERIES.map((pair) => pair.light);

const GRID_LINE = CHART_CHROME.gridLine.light;
const GRID_EDGE = CHART_CHROME.gridEdge.light;
const AXIS_TEXT = CHART_CHROME.axisText.light;
const LABEL_CHIP = CHART_CHROME.labelChip.light;
const CHART_SURFACE = CHART_CHROME.surface.light;
const POINTER_BAND = CHART_CHROME.pointerBand.light;
const POINTER_LINE = CHART_CHROME.pointerLine.light;
const BLURRED = CHART_CHROME.blurred.light;

/** 渲染端补全（读数卡、饼图环心总计）需要与序列化 option 同源的 chrome 色与字体栈 */
export { CHART_CHROME, FONT_FAMILY } from "./design_tokens.js";
export { DIVERGING_PALETTES, shadingStops } from "./table_shading.js";

/** 渲染端在宿主暗色下递归替换 option 内的已知颜色（键恒为小写亮色原值）。 */
export const CHART_DARK_COLORS: Record<string, string> = Object.fromEntries(
  [...CHART_SERIES, ...Object.values(CHART_CHROME)]
    .filter((pair) => pair.light !== pair.dark)
    .map((pair) => [pair.light.toLowerCase(), pair.dark]),
);

/** 亮色原值 → 当前主题的那一档：映射表只此一张，取色处不各查一遍。 */
export function themedColor(color: string, dark: boolean): string {
  return dark ? (CHART_DARK_COLORS[color.toLowerCase()] ?? color) : color;
}

const axisLabelStyle = {
  color: AXIS_TEXT,
  fontWeight: 400,
  fontSize: 12,
  margin: 6,
} as const;

function insideValueLabel(side: "left" | "right" = "left") {
  return {
    ...axisLabelStyle,
    fontSize: 11,
    inside: true,
    align: side,
    verticalAlign: "bottom",
    verticalAlignMaxLabel: "top",
    padding: [4, 0, 4, 0],
  } as const;
}

const axisLineStyle = { show: false } as const;
const axisTickStyle = { show: false } as const;

const gridSplit = {
  show: true,
  showMinLine: false,
  showMaxLine: false,
  lineStyle: { color: GRID_LINE, type: [3, 3], width: 1 },
} as const;
const gridSplitEdge = {
  show: true,
  showMinLine: false,
  showMaxLine: false,
  lineStyle: { color: GRID_EDGE, type: [3, 3], width: 0.5 },
} as const;

const noSplit = { show: false } as const;

const VALUE_SPLIT = 4;

export const RANK_ROW = {
  height: 44,
  bar: 26,

  radius: 3,
  labelColumn: 160,
  valueColumn: 72,
  shareColumn: 56,
} as const;

/** 系列色按序取用（palette 循环）；空心圆点与图例标记需要显式色，不能依赖 echarts 隐式分配 */
function seriesColorAt(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

const LABEL_COLUMN = { max: 160, gap: 8 } as const;

function labelColumnWidth(labels: string[]): number {
  const width = (text: string) =>
    [...text].reduce((sum, ch) => sum + (/[⺀-￯]/.test(ch) ? 12 : 6.6), 0);
  const widest = labels.reduce((max, label) => Math.max(max, width(label)), 0);
  return Math.ceil(Math.min(widest, LABEL_COLUMN.max));
}

/**
 * 失焦是一次取色。
 *
 * 「谁在焦点」只有一个状态，两个消费点——图例上的色点、画布上的系列——都按这一道式子取色，
 * 故两处不可能各自置灰一半。绘图区内的悬停只出读数（判据见 ui_spec「图表画布」节）：
 * echarts 的 blur/focus 状态机不声明；`emphasis` 只用来把指针所在那一列的点填实。
 */
export function focusedColor(color: string, index: number, focused: number | null): string {
  return focused === null || focused === index ? color : BLURRED;
}

/** 系列色写得出的几个段：线、面、柱面、激活态与末点标记都在其中。 */
const STYLE_KEYS = ["lineStyle", "itemStyle", "areaStyle", "emphasis", "markPoint"] as const;

function recolor<T>(node: T, from: string, to: string): T {
  if (typeof node === "string") return (node === from ? to : node) as T;
  if (Array.isArray(node)) return node.map((v) => recolor(v, from, to)) as T;
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, recolor(v, from, to)])) as T;
  }
  return node;
}

/**
 * 换焦点要改的那几样，按单元出一份：只重出样式段与层序，`data` 不动。
 * 段内凡是这个单元的本色一律换成取色结果——就地认色，不必逐形态各记一份「色写在哪几处」；
 * 这一招成立的前提是本色只以字面值出现，故系列在编译期一次建成、不回补（见 `resolveSeries`）。
 * 饼图的色在调色板上，换焦点即换一份调色板。
 */
export function focusPatch(
  chart: ViewChart,
  focused: number | null,
): { series?: Record<string, unknown>[]; color?: string[] } {
  const items = chart.model.legend;
  if (chart.model.pointer === "item") {
    return { color: items.map((item, i) => focusedColor(item.color, i, focused)) };
  }
  const series = (Array.isArray(chart.option.series) ? chart.option.series : []) as Record<
    string,
    unknown
  >[];
  return {
    series: items.map((item, i) => {
      const shown = focusedColor(item.color, i, focused);
      const source = series[i] ?? {};
      const styles = Object.fromEntries(
        STYLE_KEYS.filter((key) => key in source).map((key) => [
          key,
          recolor(source[key], item.color, shown),
        ]),
      );
      const label = source.label as { show?: boolean } | undefined;
      return {
        ...styles,
        z: i === focused ? SERIES_Z.focused : seriesZ(i),
        ...(label ? { label: { show: valueLabelShown(label, i, focused) } } : {}),
      };
    }),
  };
}

/**
 * 数值标签跟着焦点走：焦点在时只有焦点那条印数——十几个底片同时压在一堆灰线上，
 * 读的人认不出哪个数属于他正看的那条。焦点不在时按图级档位印（档位写在编译期的 `show` 里），
 * 焦点落在档位没选中的系列上时把它现出来：焦点即「此刻要读的那条」。
 */
function valueLabelShown(
  label: { show?: boolean },
  index: number,
  focused: number | null,
): boolean {
  return focused === null ? label.show === true : focused === index;
}

export const SERIES_Z = { focused: 1000 } as const;
export const seriesZ = (index: number) => 2 * index + 2;
export const haloZ = (index: number) => 2 * index + 1;

/**
 * 折线的垫层：同一份数据、同一条路径，只画成 4px 的承载面色，压在本色线正下方。
 * 垫层一律追加在真系列之后，真系列的序号因此不动——`model.legend` 与 option.series 按序号对位，
 * 真系列的条数以 `model.legend.length` 为准。它不参与任何交互（`silent`），也不进读数卡。
 */
function lineHalo(values: (number | null)[], index: number) {
  return {
    type: "line",
    data: values,
    z: haloZ(index),
    silent: true,
    showSymbol: false,
    lineStyle: { width: 4, color: CHART_SURFACE },
    emphasis: { disabled: true },
  };
}

/**
 * 末点实心标记：「最新」那一桶上压一颗本色实心圆。它是样式不是数据，故走 markPoint——
 * `series.data` 恒为裸数值，读数、垫层、焦点换色都不必认识「末点长得不一样」这个特例。
 * 颜色显式写在自己的 itemStyle 上：ECharts 的继承取系列级 `color`，而焦点换色只重出样式段。
 */
function latestMarkPoint(values: (number | null)[], latest: number | undefined, color: string) {
  const value = latest === undefined ? null : values[latest];
  if (value === null || value === undefined) return {};
  return {
    markPoint: {
      silent: true,
      symbol: "circle",
      symbolSize: 8,
      label: { show: false },
      emphasis: { label: { show: false } },
      itemStyle: { color, borderColor: CHART_SURFACE, borderWidth: 1 },
      data: [{ coord: [latest, value] }],
    },
  };
}

/**
 * 折线：空心圆点，指针所在那一列的点由 emphasis 填实。`showSymbol` 是密度开关——
 * 关掉后 echarts 只在指针命中时现出那一颗，这正是「密集时藏点、悬停仍读得出」要的行为，
 * 渲染端按实宽翻这一位即可，不必另写透明度。
 */
function lineSeriesPreferences(color: string, multi: boolean) {
  return {
    color,
    showSymbol: true,
    symbol: "circle",
    symbolSize: 6,
    lineStyle: { width: 1.5, color },
    itemStyle: { color: CHART_SURFACE, borderColor: color, borderWidth: 1.5 },
    ...(multi ? {} : { areaStyle: { color } }),
    emphasis: {
      scale: 1.35,
      lineStyle: { color },
      itemStyle: { color, borderColor: CHART_SURFACE, borderWidth: 1 },
    },
  };
}

/**
 * 柱系列：同类目多柱紧贴（barGap 0）、类目带留 40% 白，方角无边框。
 * 柱占带宽 60%——柱之间要留得出「这是相邻两个桶」的间隙，贴太近就读成一条被切开的带子。
 */
function barSeriesPreferences(color: string) {
  return {
    color,
    itemStyle: { color },
    barGap: 0,
    barCategoryGap: "40%",
    emphasis: { itemStyle: { color } },
  };
}

/**
 * 指针与读数索引：echarts 的 tooltip 组件只留下这两件事，卡片本体不归它。
 *
 * **整列触发**（trigger axis）：指针落在类目带内的任意高度都读得出数。逐项触发要求精确
 * 命中图形本身，而折线的命中体只有那颗 6px 圆点、密集时还被密度规则藏起来——那等于折线
 * 根本没有读数卡。整列触发同时让「一列多系列」只出一张卡，与卡内逐系列成行的排版同构。
 *
 * **指针形按图型分档**：有柱的图画整条列高亮带（柱已经占满高度，再叠一条竖线就是第二根
 * 轴）；纯折线画一条竖虚线（无柱可依，需要一条线把读数与横坐标对上）。
 *
 * **内容不由它出**（`showContent: false`）：读数卡是与菜单同层的浮层，要能钉住、能命中、
 * 卡内行还要回头驱动系列聚焦——echarts 那只 HTML 盒子给不了这些，它只负责把指针画在
 * 该在的一列，并按 `updateAxisPointer` 报出落在哪一格。饼图没有类目轴也就没有指针，
 * 索引由逐项的 mouseover 报出，故整个组件关掉。
 */
function pointerOption(hasBar: boolean) {
  return {
    show: true,
    showContent: false,
    trigger: "axis",
    axisPointer: hasBar
      ? { type: "shadow", shadowStyle: { color: POINTER_BAND } }
      : { type: "line", lineStyle: { color: POINTER_LINE, type: "dashed", width: 1 } },
  };
}

/** 系列 key → 序号：对照关系在编排期按 key 立，图例与 series 数组按序号对位。 */
function seriesIndexOf(series: { key: string }[], key: string): number | null {
  const index = series.findIndex((item) => item.key === key);
  return index < 0 ? null : index;
}

export const PLOT_PADDING = {
  compact: { left: 16, right: 16, top: 0, bottom: 30 },

  tile: { left: 0, right: 0, top: 0, bottom: 26 },

  page: { left: 0, right: 0, top: 0, bottom: 30 },
} as const;

/**
 * 结果面场地画不画那圈圆角发丝框，按宿主场景定、不看形态：画布、排行、表格在同一场景下同框。
 * 瓦片壳自己就是边界，故不画。框落在 DOM（`PlotSlab`）而不是 echarts 的 grid：canvas 画不出圆角。
 */
export const PLOT_FRAME = { compact: true, tile: false, page: true } as const;

export const PLOT_RADIUS = 10;

export function legendRowClass(plot: keyof typeof PLOT_PADDING, withLatest = false): string {
  // 带末桶读数时，触屏（`pointer-coarse`）铺成两列读数格：每项要放得下名字与值两行。
  // 网格由「带值」触发而不是无条件——不带值的图例在触屏上没有变形的理由。
  const touch = withLatest
    ? " pointer-coarse:grid pointer-coarse:grid-cols-2 pointer-coarse:items-stretch pointer-coarse:gap-x-4 pointer-coarse:gap-y-3"
    : "";
  // 记号写成字面量：Tailwind 只扫源码里出现过的类名，拼出来的那种扫不到。
  // 它与 `PLOT_PADDING` 的横向档必须同值，由 echart.test.tsx 逐档对表看住。
  return `flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 pt-3 pb-2${touch} ${
    PLOT_PADDING[plot].left === 0 ? "px-0" : "px-4"
  }`;
}

/**
 * 系列色点：读数条与读数卡逐行都是这一颗，故形制只此一处。
 * `lead` 是读数卡单读数那一档——值印到 18px，点要跟着再落下来一点才在同一条视线上。
 * 下移用位移不用外边距：点与首行文字对的是视线，不该把自己那半像素算进行高。
 */
export function chartMarkerClass(variant: "row" | "lead" = "row"): string {
  const drop =
    variant === "lead"
      ? "translate-y-[7px] pointer-coarse:translate-y-[4.5px]"
      : "translate-y-[4.5px] pointer-coarse:translate-y-[3px]";
  return `${drop} size-2 shrink-0 self-start rounded-full pointer-coarse:size-3`;
}

/* ---------- option 构建 ---------- */

export const CHART_HEIGHT = { cartesian: 300, pie: 320 } as const;

function cellNumber(value: string | number | null | undefined): number | null {
  return value === undefined ? null : toNumber(value);
}

type Mark = "line" | "bar";

/** 一条系列画出来要知道的全部：形态出自量纲、色出自色板，都可被显式声明覆盖——但只解析这一次。 */
type ResolvedSeries = Omit<SeriesDef, "mark"> & {
  mark: Mark;
  color: string;
  axis: number;
  values: (number | null)[];
};

/**
 * 系列解析：缺省形态/轴位由图型给，显式声明（`decl.display`）按来源列覆盖，色缺省按序取板。
 * 解析在建 option 之前完成，option 里的每一段样式都按解析结果一次写就——没有「先按缺省建好
 * 再改」的第二遍：第二遍改不到的那几段（面积色、激活态色、末点）就是换色后的残影。
 */
function resolveSeries(
  series: SeriesDef[],
  rows: ChartRow[],
  display: Record<string, SeriesDisplay> | undefined,
  defaults: (s: SeriesDef) => { mark: Mark; axis: number },
): ResolvedSeries[] {
  return series.map((s, i) => {
    const intent = (s.column && display?.[s.column]) || {};
    const base = defaults(s);
    return {
      ...s,
      mark: intent.type ?? base.mark,
      axis: intent.yAxis === undefined ? base.axis : intent.yAxis === "right" ? 1 : 0,
      color: intent.color ?? seriesColorAt(i),
      values: rows.map((row) => cellNumber(row[s.key])),
    };
  });
}

/** 值轴按系列落在哪根轴上算出来：轴的格式取落在它上面的第一条，位数取最长的那档。 */
function valueAxes(series: ResolvedSeries[]) {
  const count = Math.max(1, ...series.map((s) => s.axis + 1));
  const axes = Array.from({ length: count }, (_, axis) => {
    const on = series.filter((s) => s.axis === axis);
    const declared = on.flatMap((s) => (s.decimals === undefined ? [] : [s.decimals]));
    return {
      format: on[0]?.format ?? null,
      decimals: declared.length ? Math.max(...declared) : null,
    };
  });
  return {
    formats: axes.map((a) => a.format),
    decimals: axes.map((a) => a.decimals),
  };
}

function axisDecimals(key: "x" | "y", values: (number | null)[]) {
  return values.some((v) => v !== null) ? { axis_decimals: { [key]: values } } : {};
}

function legendOf(series: ResolvedSeries[], all: SeriesDef[]): ChartLegendItem[] {
  return series.map((s) => ({
    name: s.name,
    color: s.color,
    format: s.format,
    ...(s.decimals === undefined ? {} : { decimals: s.decimals }),
    values: s.values,
    ...(s.baselineKey && seriesIndexOf(all, s.baselineKey) !== null
      ? { baseline: seriesIndexOf(all, s.baselineKey) as number }
      : {}),
  }));
}

function recordPoints(rows: ChartRow[], sourceRows: ChartSourceRow[], series: SeriesDef[]) {
  return {
    points: series.map((item) =>
      rows.map((_, rowIndex) => {
        const source = sourceRows[rowIndex];
        const value = source?.series?.[item.key] ?? source?.row;
        return typeof value === "number" && item.column
          ? { row: value, column: item.column }
          : null;
      }),
    ),
  };
}

/**
 * 图级数值标签：main=仅第一主系列，all=全部系列。每条真系列都配齐标签形制，`show` 才是开关：
 * 焦点期间「只有焦点系列印数」要把档位没选中的那些也现出来，形制现搭会与编译期这份长不一样。
 * 形制是浅灰底片（高 18、圆角 4、承载面色描边）+ 14px 系列色数字——系列色对底片的对比度
 * 整套色板两个主题都过 1.45，由 design_tokens 测试看住，故不带运行时调暗环节。
 * 堆叠段的外侧是相邻段不是空场地：标签进段内；平铺条才朝值轴末端画。
 */
function valueLabel(show: boolean, color: string, position: "inside" | "top" | "right") {
  return {
    show,
    position,
    distance: VALUE_LABEL_GAP,
    color,
    fontSize: 14,
    lineHeight: 14,
    padding: [2, 5],
    backgroundColor: LABEL_CHIP,
    borderColor: CHART_SURFACE,
    borderWidth: 1,
    borderRadius: 4,
  };
}

/** 值标签的顶部余量（px）：间距 6 + 底片 18，余下是描边与最高点自身的缓冲。 */
const VALUE_LABEL_HEADROOM = 30;

/** 标签底片与数据点/条端的间距（px）。 */
const VALUE_LABEL_GAP = 6;

/**
 * 值标签底片宽（px）：逐字符查表（数字 8/逗号 4/点 4/% 10/负号 6）+ 两侧衬垫 5、最小 20。
 * 值、格式、位数编译期全知道，渲染层密度守卫与横排右栏都按它算。
 */
export function valueLabelPillWidth(text: string): number {
  const width = [...text].reduce((sum, ch) => {
    if (/\d/.test(ch)) return sum + 8;
    if (ch === ",") return sum + 4;
    if (ch === ".") return sum + 4;
    if (ch === "%") return sum + 10;
    if (ch === "-") return sum + 6;
    if (/[⺀-￯]/.test(ch)) return sum + 14;
    return sum + 8;
  }, 0);
  return Math.max(width + 10, 20);
}

/** 横排条右侧标签要占的框内余量：最宽底片 + 号距 + 描边缓冲。 */
function valueLabelSpan(series: ResolvedSeries[]): number {
  let widest = 0;
  for (const s of series) {
    for (const value of s.values) {
      if (value === null) continue;
      widest = Math.max(
        widest,
        valueLabelPillWidth(formatSeriesValue(value, s.format, s.decimals)),
      );
    }
  }
  return widest === 0 ? 0 : widest + VALUE_LABEL_GAP + 2;
}

type SeriesContext = {
  multi: boolean;
  orientation: "vertical" | "horizontal";
  latest?: number;
  stacked?: boolean;
  valueLabels?: "main" | "all";
};

/** 一条系列的 option：形态、色、轴位、标签、末点，按解析结果一次写就。 */
function seriesOption(s: ResolvedSeries, index: number, ctx: SeriesContext) {
  const label =
    ctx.valueLabels === undefined
      ? {}
      : {
          label: valueLabel(
            ctx.valueLabels === "all" || index === 0,
            s.color,
            ctx.stacked ? "inside" : ctx.orientation === "horizontal" ? "right" : "top",
          ),
        };
  return {
    name: s.name,
    type: s.mark,
    data: s.values,
    z: seriesZ(index),
    ...(ctx.orientation === "vertical" ? { yAxisIndex: s.axis } : {}),
    ...(s.mark === "bar"
      ? { ...barSeriesPreferences(s.color), ...(ctx.stacked ? { stack: "total" } : {}) }
      : {
          ...lineSeriesPreferences(s.color, ctx.multi),
          ...latestMarkPoint(s.values, ctx.latest, s.color),
        }),
    ...label,
  };
}

/** 真系列在前、垫层在后：序号约定见 `lineHalo`。 */
function seriesWithHalo(series: ResolvedSeries[], ctx: SeriesContext) {
  return [
    ...series.map((s, i) => seriesOption(s, i, ctx)),
    ...series.flatMap((s, i) => (s.mark === "line" ? [lineHalo(s.values, i)] : [])),
  ];
}

/** 值标签要的框内余量：段内标签不占，平铺标签按方向留顶栏或右栏（只按印得出数的系列算，框不随悬停移动） */
function valueLabelInset(series: ResolvedSeries[], ctx: SeriesContext) {
  if (ctx.valueLabels === undefined || ctx.stacked) return {};
  return ctx.orientation === "horizontal"
    ? { plot_inset: { right: valueLabelSpan(series) } }
    : { plot_inset: { top: VALUE_LABEL_HEADROOM } };
}

const valueAxisOption = (side: "left" | "right", first: boolean) => ({
  type: "value",
  splitNumber: VALUE_SPLIT,
  axisLabel: insideValueLabel(side),
  axisLine: axisLineStyle,
  axisTick: axisTickStyle,
  splitLine: first ? gridSplit : noSplit,
});

const OPTION_BASE = { textStyle: { fontFamily: FONT_FAMILY }, ...MOTION } as const;

/**
 * plot 场地。`containLabel` 恒关，框也不由 grid 画（见 `PLOT_FRAME`）：绘图区四缘必须
 * 在渲染前就算得出来，DOM 那层框才对得上。四缘的数字由渲染端按场景档位（`PLOT_PADDING`）
 * 加 `plot_gutter`/`plot_inset` 算定——编译期不知道宿主是哪一档，故不写数字。
 */
const GRID = { containLabel: false } as const;

type CartesianInput = {
  form: "line" | "bar";
  categories: string[];
  series: ResolvedSeries[];
  all: SeriesDef[];
  sourceRows: ChartSourceRow[];
  rows: ChartRow[];
  latest?: { index: number; label: string };
  share?: { title: string; values: (number | null)[] };
  valueLabels?: "main" | "all";
};

/**
 * 竖排笛卡尔图：类目占 x 轴，量画柱（主轴）、率画线（副轴）；时间趋势与分类组合同一张版式，
 * 差别只在类目是什么、有没有「最新」与占比。
 */
function cartesianOption(input: CartesianInput): ViewChart {
  const { series } = input;
  const ctx: SeriesContext = {
    multi: series.length > 1,
    orientation: "vertical",
    latest: input.latest?.index,
    valueLabels: input.valueLabels,
  };
  const axes = valueAxes(series);
  const hasBar = series.some((s) => s.mark === "bar");
  return {
    form: input.form,
    height: CHART_HEIGHT.cartesian,
    ...valueLabelInset(series, ctx),
    option: {
      ...OPTION_BASE,
      grid: GRID,
      tooltip: pointerOption(hasBar),
      xAxis: {
        type: "category",
        data: input.categories,
        axisLabel: axisLabelStyle,
        axisLine: axisLineStyle,
        axisTick: axisTickStyle,
        splitLine: hasBar ? noSplit : gridSplitEdge,
      },
      yAxis: axes.formats.map((_, i) => valueAxisOption(i === 0 ? "left" : "right", i === 0)),
      series: seriesWithHalo(series, ctx),
    },
    model: {
      categories: input.categories,
      legend: legendOf(series, input.all),
      axes: { y: axes.formats },
      ...axisDecimals("y", axes.decimals),
      ...(input.share ? { share: input.share } : {}),
      ...(input.latest ? { latest: input.latest } : {}),
      pointer: "axis",
      records: recordPoints(input.rows, input.sourceRows, input.all),
    },
  };
}

function lastIndexWhere(length: number, test: (index: number) => boolean): number {
  for (let i = length - 1; i >= 0; i--) if (test(i)) return i;
  return -1;
}

/** 纯时间趋势 / 柱线组合：时间恒占 x 轴；混量纲时量画柱（主轴）、率画线（副轴） */
function trendOption(spec: TrendSpec, decl: ChartRenderDecl): ViewChart {
  const categories = spec.rows.map((r) => String(r.t ?? ""));
  const series = resolveSeries(spec.series, spec.rows, decl.display, (s) => ({
    mark: s.mark === "bar" ? "bar" : "line",
    axis: spec.mixedAxes && s.mark !== "bar" ? 1 : 0,
  }));
  // 「最新」取每条系列都有值的最后一个桶，不是单纯的最后一行：当月未完时存量已有数而流量
  // 还空着，取最后一行会让同一断面的读数缺几个。
  const latestIndex = lastIndexWhere(spec.rows.length, (i) =>
    series.every((s) => s.values[i] !== null),
  );
  return cartesianOption({
    form: "line",
    categories,
    series,
    all: spec.series,
    rows: spec.rows,
    sourceRows: spec.sourceRows,
    ...(latestIndex >= 0 ? { latest: { index: latestIndex, label: categories[latestIndex] } } : {}),
    valueLabels: decl.valueLabels,
  });
}

/** 分类柱线组合：分类占 x 轴，绝对量画柱（左轴），率画线（右轴）。 */
function categoryComboOption(spec: CategoryComboSpec, decl: ChartRenderDecl): ViewChart {
  const series = resolveSeries(spec.series, spec.rows, decl.display, (s) => ({
    mark: s.isRate ? "line" : "bar",
    axis: s.isRate ? 1 : 0,
  }));
  const shareKey = spec.series.find((s) => s.shareKey !== undefined)?.shareKey;
  return cartesianOption({
    form: "bar",
    categories: spec.rows.map((row) => String(row.label ?? "")),
    series,
    all: spec.series,
    rows: spec.rows,
    sourceRows: spec.sourceRows,
    ...(shareKey
      ? { share: { title: "占比", values: spec.rows.map((row) => cellNumber(row[shareKey])) } }
      : {}),
    valueLabels: decl.valueLabels,
  });
}

/** 分类条形（横排容纳中文长标签）：多系列并列、双分类构成堆叠；占比注释随读数卡 */
function barOption(spec: BarSpec, decl: ChartRenderDecl): ViewChart {
  const categories = spec.rows.map((r) => String(r.label ?? ""));
  const series = resolveSeries(spec.series, spec.rows, decl.display, () => ({
    mark: "bar",
    axis: 0,
  }));
  const declared = series.flatMap((s) => (s.decimals === undefined ? [] : [s.decimals]));
  const shareKey = spec.stacked ? "share" : (spec.series[0]?.shareKey ?? "share");
  const model: ChartModel = {
    categories,
    legend: legendOf(series, spec.series),
    axes: { x: [spec.format] },
    ...axisDecimals("x", [declared.length ? Math.max(...declared) : null]),
    ...(spec.hasShare
      ? { share: { title: "占比", values: spec.rows.map((r) => cellNumber(r[shareKey])) } }
      : {}),
    pointer: "axis",
    records: recordPoints(spec.rows, spec.sourceRows, spec.series),
  };
  // 单系列（不堆叠）改走排行版式：一行说一个类目，值与占比各占一列；不落 echarts，故无 option
  if (series.length === 1 && !spec.stacked) {
    return {
      form: "bar",
      height: categories.length * RANK_ROW.height,
      layout: "rank",
      option: {},
      model,
    };
  }
  const ctx: SeriesContext = {
    multi: series.length > 1,
    orientation: "horizontal",
    stacked: spec.stacked,
    valueLabels: decl.valueLabels,
  };
  const gutter = { left: labelColumnWidth(categories) + LABEL_COLUMN.gap };
  return {
    form: "bar",
    height: barChartHeight(categories.length, spec.stacked ? 1 : series.length) + 24,
    plot_gutter: gutter,
    ...valueLabelInset(series, ctx),
    option: {
      ...OPTION_BASE,
      // 类目在左轴（中文长标签），刻度留在框外自占一栏
      grid: GRID,
      tooltip: pointerOption(true),
      xAxis: {
        type: "value",
        splitNumber: VALUE_SPLIT,
        axisLabel: axisLabelStyle,
        axisLine: axisLineStyle,
        axisTick: axisTickStyle,
        splitLine: gridSplit,
      },
      yAxis: {
        type: "category",
        data: categories,
        inverse: true,
        // 栏宽已按字面量算定，放不下的截断——全名仍在读数卡里
        axisLabel: {
          ...axisLabelStyle,
          width: gutter.left - LABEL_COLUMN.gap,
          overflow: "truncate",
        },
        axisLine: axisLineStyle,
        axisTick: axisTickStyle,
        splitLine: noSplit,
      },
      series: seriesWithHalo(series, ctx),
    },
    model,
  };
}

/**
 * 饼图（声明路径专属）：内半径 = 外半径 3/5、切缝用底面色边框，切片不出外部标签和引线，
 * 占比进图例（渲染端按值计算）、环心常驻总计（渲染端注入）。
 * 切片色走调色板（`option.color` 按切片序对位），数据格只有名与值。
 */
function pieOption(spec: PieSpec): ViewChart {
  const legend: ChartLegendItem[] = spec.rows.map((r, i) => ({
    name: r.label,
    color: seriesColorAt(i),
    format: spec.format,
    ...(spec.decimals === undefined ? {} : { decimals: spec.decimals }),
    values: [r.value],
  }));
  return {
    form: "pie",
    height: CHART_HEIGHT.pie,
    option: {
      ...OPTION_BASE,
      color: legend.map((item) => item.color),
      tooltip: { show: false },
      series: [
        {
          name: spec.seriesName,
          type: "pie",
          radius: ["48%", "80%"],
          center: ["50%", "50%"],
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderColor: CHART_SURFACE, borderWidth: 2 },
          // 扇形的角度就是值：鼠标碰哪一片都不许它改样子
          emphasis: { disabled: true },
          data: spec.rows.map((r) => ({ name: r.label, value: r.value })),
        },
      ],
    },
    model: {
      categories: [spec.seriesName],
      legend,
      axes: {},
      pointer: "item",
      records: {
        points: spec.rows.map((_, rowIndex) => {
          const source = spec.sourceRows[rowIndex]?.row;
          return [source === undefined ? null : { row: source, column: spec.column }];
        }),
      },
    },
  };
}

/** 按显式声明编译图表配置；不声明图表的 table/kpi 直接返回 null。 */
export function buildViewChart(view: ViewBlock, decl: ChartRenderDecl): ViewChart | null {
  const shape = compileChart(view, makeTitleOf(view), decl);
  if (!shape) return null;
  switch (shape.kind) {
    case "line":
      return trendOption(shape, decl);
    case "bar":
      return barOption(shape, decl);
    case "category_combo":
      return categoryComboOption(shape, decl);
    case "pie":
      return pieOption(shape);
  }
}

export function compilePresentationBlock(
  view: ViewBlock,
  decl: PresentationSpec,
): PresentationBlock {
  const titleOf = makeTitleOf(view);
  const compiledTable = compileTableWithStatus(view, titleOf, decl);
  const base = { table: compiledTable.table, table_layout: compiledTable.layout };
  if (decl.type === "table") return { type: "table", ...base };
  if (decl.type === "kpi") {
    const totals = canCompileKpi(view) ? compileTotalBand(view, titleOf) : null;
    return totals ? { type: "kpi", ...base, totals } : { type: "table", ...base };
  }
  const chart = buildViewChart(view, decl);
  return chart ? { type: decl.type, ...base, chart } : { type: "table", ...base };
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 宿主边界校验：图表块属不可信输入，渲染端只接受完整结构（option 内容交给 echarts） */
export function isViewChart(value: unknown): value is ViewChart {
  return (
    isRecord(value) &&
    (value.form === "line" || value.form === "bar" || value.form === "pie") &&
    typeof value.height === "number" &&
    Number.isFinite(value.height) &&
    value.height > 0 &&
    isRecord(value.option) &&
    isRecord(value.model) &&
    Array.isArray(value.model.categories) &&
    Array.isArray(value.model.legend)
  );
}

function isCell(value: unknown): value is string | number | null {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isTableModel(value: unknown): value is TableModel {
  if (!isRecord(value) || !Array.isArray(value.columns) || !Array.isArray(value.rows)) return false;
  const columns = value.columns;
  if (
    !columns.every(
      (column) =>
        isRecord(column) &&
        typeof column.label === "string" &&
        typeof column.formatKey === "string" &&
        typeof column.numeric === "boolean" &&
        Array.isArray(column.headerPath) &&
        column.headerPath.length > 0 &&
        column.headerPath.every(
          (part) =>
            isRecord(part) && typeof part.key === "string" && typeof part.label === "string",
        ),
    )
  ) {
    return false;
  }
  const validRows = (rows: unknown) =>
    Array.isArray(rows) &&
    rows.every(
      (row) =>
        Array.isArray(row) && row.length === columns.length && row.every((cell) => isCell(cell)),
    );
  if (!validRows(value.rows)) return false;
  if (value.summaryRows !== undefined && !validRows(value.summaryRows)) return false;
  if (
    value.sourceRows !== undefined &&
    (!Array.isArray(value.sourceRows) ||
      !value.sourceRows.every(
        (row) =>
          Array.isArray(row) &&
          row.length === columns.length &&
          row.every(
            (source) => source === null || (typeof source === "number" && Number.isInteger(source)),
          ),
      ))
  ) {
    return false;
  }
  return true;
}

function isTotalBand(value: unknown): value is TotalBand {
  if (!isRecord(value) || !Array.isArray(value.metrics) || !value.metrics.length) return false;
  const isFormat = (format: unknown) =>
    format === "number" || format === "percent" || format === "percentage_point";
  return value.metrics.every(
    (metric) =>
      isRecord(metric) &&
      typeof metric.column === "string" &&
      typeof metric.label === "string" &&
      isCell(metric.value) &&
      isFormat(metric.format) &&
      (metric.period === undefined ||
        (isRecord(metric.period) &&
          typeof metric.period.label === "string" &&
          typeof metric.period.from === "string" &&
          typeof metric.period.to === "string")) &&
      Array.isArray(metric.comparisons) &&
      metric.comparisons.every(
        (comparison) =>
          isRecord(comparison) &&
          typeof comparison.label === "string" &&
          isCell(comparison.value) &&
          isFormat(comparison.format),
      ),
  );
}

/** 宿主边界校验：浏览器只接受服务端完整编译的呈现块。 */
export function isPresentationBlock(value: unknown): value is PresentationBlock {
  if (
    !isRecord(value) ||
    !PRESENTATION_TYPE_SCHEMA.safeParse(value.type).success ||
    !isTableModel(value.table) ||
    !isRecord(value.table_layout)
  ) {
    return false;
  }
  const layout = value.table_layout;
  if (
    (layout.state !== "applied" && layout.state !== "unavailable") ||
    typeof layout.leafColumns !== "number" ||
    !Number.isInteger(layout.leafColumns) ||
    layout.leafColumns < 0
  ) {
    return false;
  }
  if (layout.state === "unavailable") {
    if (
      !["duplicate_coordinate", "resource_limit", "missing_axis"].includes(String(layout.reason)) ||
      typeof layout.message !== "string"
    ) {
      return false;
    }
  }
  if (value.totals !== undefined && !isTotalBand(value.totals)) return false;

  if (value.type === "kpi" && value.totals === undefined) return false;
  if (value.chart === undefined) {
    return value.type === "table" || value.type === "kpi";
  }
  return (
    (value.type === "line" || value.type === "bar" || value.type === "pie") &&
    isViewChart(value.chart) &&
    value.chart.form === value.type
  );
}
