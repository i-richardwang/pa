/**
 * 声明式呈现编译：服务端产出可序列化的完整呈现块，浏览器只布局和渲染。
 * 图表交付 `option`（绘图指令）与 `model`（渲染端唯一读数源）。
 * 系列在编译前一次解析成 {形态, 色, 轴位}；样式不进数据格（`series.data` 恒为裸数值）。
 * 序列化 option 恒为亮色原值；格式化函数与四缘留白由渲染端按 `model` 注入。
 * 本文件只做数据编排与样式声明，零度量算术（engine_boundary 守护）。
 */
import {
  analyzeResultShape,
  canCompileKpi,
  compileChart,
  compileTableWithStatus,
  compileTotalBand,
  barChartHeight,
  makeTitleOf,
  structureTitle,
  type BarSpec,
  type CategoryComboSpec,
  type ChartRow,
  type ChartSourceRow,
  type PieSpec,
  type ResultShape,
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
 * 图例单元：笛卡尔图一系列一项、饼图一切片一项。
 * 取值按类目序对位（饼图只有 `values[0]`）。
 */
export type ChartLegendItem = {
  name: string;
  color: string;
  format: ColumnFormat;
  /** 模型声明的小数位；未声明缺席，走呈现层默认 */
  decimals?: number;
  values: (number | null)[];
  /** 所对照单元的序号（同期叠加里各对照期都指向主期）；读数卡据此附差值。 */
  baseline?: number;
};

/** 与 `option` 并列交付、供渲染端读的那份数据；渲染端不从 option 反解任何数。 */
export type ChartModel = {
  /** 类目名：笛卡尔图是类目轴的顺序，饼图是度量名那一个「桶」 */
  categories: string[];
  legend: ChartLegendItem[];
  axes: AxisFormats;
  /** 值轴刻度小数位；只在有单元声明过位数时下发 */
  axis_decimals?: AxisDecimals;
  /** 结构占比注释：按类目序对位；读数卡随附一行占比说明 */
  share?: { title: string; values: (number | null)[] };
  /** 每个单元都有值的最后一个时间桶，凑不齐则缺席；只随时间趋势下发。 */
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
  /** 结构式标题（`structureTitle`）：度量 · 按分类 · 趋势粒度；派生不出任何一段时缺席。 */
  structure_title?: string;
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
 * 图例色点与画布系列共用这道取色式。
 * echarts 的 blur/focus 状态机不声明；`emphasis` 只用来把指针所在那一列的点填实。
 */
export function focusedColor(color: string, index: number, focused: number | null): string {
  return focused === null || focused === index ? color : BLURRED;
}

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
 * 换焦点只重出样式段与层序，`data` 不动；饼图换的是整份调色板。
 * 前提是本色只以字面值出现，故系列在编译期一次建成、不回补（见 `resolveSeries`）。
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

/** 焦点在时只印焦点那条（含档位未选中的）；焦点不在时按编译期的 `show` 档位印。 */
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
 * 折线的垫层一律追加在真系列之后，真系列的序号因此不动：
 * `model.legend` 与 option.series 按序号对位，真系列条数以 `model.legend.length` 为准。
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
 * 末点实心标记走 markPoint，`series.data` 保持裸数值。
 * 色显式写在自己的 itemStyle 上：ECharts 的继承只取系列级 `color`，而焦点换色只重出样式段。
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
 * `showSymbol` 关时 echarts 只在指针命中处现出那一颗点；渲染端按实宽翻这一位。
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
 * tooltip 组件只留指针与读数索引：整列触发（折线的命中体只有 6px 圆点，逐项触发命不中），
 * `showContent` 关——读数卡是另一层浮层，此处只按 `updateAxisPointer` 报出落在哪一格。
 * 饼图没有类目轴也就没有指针，索引由逐项 mouseover 报出，故整个组件关掉。
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

/** 渲染栈唯一的场景词汇：场地留白、画不画框、chrome 取舍（`VIEW_SCENES`）都按它查表。 */
export type ViewScene = "card" | "tile" | "page";

export const PLOT_PADDING: Record<
  ViewScene,
  { left: number; right: number; top: number; bottom: number }
> = {
  card: { left: 16, right: 16, top: 0, bottom: 30 },
  tile: { left: 0, right: 0, top: 0, bottom: 26 },
  page: { left: 0, right: 0, top: 0, bottom: 30 },
};

/**
 * 画不画那圈圆角发丝框按宿主场景定、不看形态。
 * 框落在 DOM（`PlotSlab`）而不是 echarts 的 grid：canvas 画不出圆角。
 */
export const PLOT_FRAME: Record<ViewScene, boolean> = { card: true, tile: false, page: true };

export const PLOT_RADIUS = 10;

/**
 * 写成字面量：Tailwind 只扫源码里出现过的类名，拼出来的那种扫不到。
 * 与 `PLOT_PADDING` 的横向档同值，由 echart.test.tsx 逐档对表看住。
 */
export function sceneInsetClass(scene: ViewScene): "px-0" | "px-4" {
  return PLOT_PADDING[scene].left === 0 ? "px-0" : "px-4";
}

export function legendRowClass(scene: ViewScene, withLatest = false): string {
  // 触屏（`pointer-coarse`）带值时铺两列读数格：每项要放得下名字与值两行。
  const touch = withLatest
    ? " pointer-coarse:grid pointer-coarse:grid-cols-2 pointer-coarse:items-stretch pointer-coarse:gap-x-4 pointer-coarse:gap-y-3"
    : "";
  return `flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 pt-3 pb-2${touch} ${sceneInsetClass(scene)}`;
}

/**
 * 系列色点：读数条与读数卡逐行共用这一颗；`lead` 是读数卡单读数那一档（值印到 18px）。
 * 下移用位移不用外边距：点对的是视线，不进行高。
 */
export function chartMarkerClass(variant: "row" | "lead" = "row"): string {
  const drop =
    variant === "lead"
      ? "translate-y-[7px] pointer-coarse:translate-y-[4.5px]"
      : "translate-y-[4.5px] pointer-coarse:translate-y-[3px]";
  return `${drop} size-2 shrink-0 self-start rounded-full pointer-coarse:size-3`;
}

const CHART_HEIGHT = { cartesian: 300, pie: 320 } as const;

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

/** 解析在建 option 之前完成一次；同一条系列的色只有这一个来源。 */
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
 * 图级数值标签：main=仅第一主系列，all=全部系列。
 * 每条真系列都配齐形制，`show` 才是开关——焦点期要现出档位未选中的那条。
 * 系列色对底片的对比度两个主题都过 1.45（design_tokens 测试看住），故不带运行时调暗环节。
 * 堆叠段标签进段内，平铺条朝值轴末端画。
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

/** 值标签底片宽（px）：渲染层密度守卫与横排右栏都按它算。 */
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

/** 值标签要的框内余量：只按印得出数的系列算，框不随悬停移动。 */
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
 * `containLabel` 恒关，框也不由 grid 画（见 `PLOT_FRAME`）：四缘必须在渲染前算得出，
 * DOM 那层框才对得上。四缘数字由渲染端按 `PLOT_PADDING` 加 `plot_gutter`/`plot_inset` 算定。
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
        // 放不下即截断，全名在读数卡里
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
 * 饼图（声明路径专属）：占比与环心总计由渲染端注入。
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
export function buildViewChart(
  view: ViewBlock,
  decl: ChartRenderDecl,
  resultShape: ResultShape = analyzeResultShape(view),
): ViewChart | null {
  const chart = compileChart(view, makeTitleOf(view), decl, resultShape);
  if (!chart) return null;
  switch (chart.kind) {
    case "line":
      return trendOption(chart, decl);
    case "bar":
      return barOption(chart, decl);
    case "category_combo":
      return categoryComboOption(chart, decl);
    case "pie":
      return pieOption(chart);
  }
}

export function compilePresentationBlock(
  view: ViewBlock,
  decl: PresentationSpec,
): PresentationBlock {
  const titleOf = makeTitleOf(view);
  const resultShape = analyzeResultShape(view);
  const compiledTable = compileTableWithStatus(view, titleOf, decl, resultShape);
  const title = structureTitle(view, titleOf);
  const base = {
    table: compiledTable.table,
    table_layout: compiledTable.layout,
    ...(title ? { structure_title: title } : {}),
  };
  if (decl.type === "table") return { type: "table", ...base };
  if (decl.type === "kpi") {
    const totals = canCompileKpi(view, resultShape)
      ? compileTotalBand(view, titleOf, resultShape)
      : null;
    return totals ? { type: "kpi", ...base, totals } : { type: "table", ...base };
  }
  const chart = buildViewChart(view, decl, resultShape);
  return chart ? { type: decl.type, ...base, chart } : { type: "table", ...base };
}
