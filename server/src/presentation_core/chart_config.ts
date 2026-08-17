/**
 * 声明式呈现编译：在完整行上确定性编译表格、KPI 或 Agent 显式声明的图表。
 * 服务端产出可序列化的完整呈现块并在此完成选型，浏览器只布局和渲染。
 * 函数不可序列化，tooltip 与数值轴格式化由渲染端按 option.pa 注入。
 * 视觉常量取自 design_tokens.ts，
 * 序列化 option 恒为亮色原值，暗色由渲染端按 CHART_DARK_COLORS 映射翻转。
 * 本文件只做数据编排与样式声明，零度量算术（engine_boundary 守护）。
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
  type ChartDecl,
  type ChartRow,
  chartSourceRow,
  type PieSpec,
  type SeriesDef,
  type SeriesDisplay,
  type TableLayoutStatus,
  type TableModel,
  type TotalBand,
  type TrendSpec,
} from "./view_shape.js";
import { toNumber } from "./view_format.js";
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

/** 值轴的格式声明：widget 据此注入刻度与 tooltip 格式化函数（0–1 标度 → 百分比/百分点） */
export type AxisFormats = {
  x?: (ColumnFormat | null)[];
  y?: (ColumnFormat | null)[];
};

/** 值轴刻度的小数位，与 AxisFormats 按轴索引对位；null = 呈现层默认位数 */
export type AxisDecimals = {
  x?: (number | null)[];
  y?: (number | null)[];
};

/** option.pa：本产品的非样式扩展块，承载不可序列化格式化所需的声明 */
export type PaChartExtension = {
  /** 系列名 → 值格式（tooltip 数值按此格式化） */
  series: Record<string, ColumnFormat>;
  /** 系列名 → 模型声明的小数位；未声明的系列不列，走呈现层默认 */
  decimals?: Record<string, number>;
  /** 值轴刻度格式（按轴索引对位；null = 默认数值） */
  axes: AxisFormats;
  /** 值轴刻度小数位；只在有系列声明过位数时下发 */
  axis_decimals?: AxisDecimals;
  /** 结构占比注释：分类值 → 占比（0–1）；tooltip 随行附一条占比说明 */
  share?: { title: string; values: Record<string, number | null> };
  /**
   * 图例清单（图例是 HTML 而非 echarts legend 组件）：渲染端据此画图例行、
   * 取读数卡行内标记色（空心圆点把 itemStyle.color 让给了填充色，params.color 不可用）。
   * 折线/条形按系列对位，饼图按切片对位；单系列也交付（标记色仍需要），渲染端决定是否显示。
   *
   * `latest` 是该系列在**最后一个时间桶**上的取值，只随时间趋势下发：窄面读不到悬停浮层，
   * 图例是画面上唯一还剩的读数位。它取的是画面上真实存在的那一个点，不是另算的合计——
   * 哪一桶由 `legend_latest_label` 挑明，两者恒同进同出。
   */
  legend?: { name: string; color: string; latest?: number | null }[];
  /** `legend[].latest` 所属的时间桶名（末桶的横轴标签）；无 latest 时缺席。 */
  legend_latest_label?: string;
  /** ECharts seriesIndex/dataIndex → 原始结果格；只在浏览器交互通道消费。 */
  records?: { points: ({ row: number; column: string } | null)[][] };
};

function recordProjectionPoints(rows: ChartRow[], series: SeriesDef[]) {
  return {
    points: series.map((item) =>
      rows.map((row) => {
        const value = chartSourceRow(row, item.key) ?? chartSourceRow(row);
        return typeof value === "number" && item.column
          ? { row: value, column: item.column }
          : null;
      }),
    ),
  };
}

export type ViewChartForm = "line" | "bar" | "pie";

export type ViewChart = {
  form: ViewChartForm;
  /** 建议渲染高度（px）：条形随分类数伸缩，布局由服务端一次算定 */
  height: number;

  plot_gutter?: { left: number };

  layout?: "rank";
  option: Record<string, unknown>;
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
  view_id: string;
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
            view_id: viewId,
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
        view_id: viewId,
        kind: "empty_result",
        note: "查询成功但结果为空，本次以空表呈现；呈现声明保留，数据满足后重跑即可生效。",
      },
    ];
  }
  return [
    ...tableNotes,
    {
      view_id: viewId,
      kind: "unsupported_shape",
      note: "查询已成功，但当前结果形态不支持声明的呈现，本次已按表格呈现。",
    },
  ];
}

export const SERIES_COLORS: readonly string[] = CHART_SERIES.map((pair) => pair.light);

const GRID_LINE = CHART_CHROME.gridLine.light;
const GRID_EDGE = CHART_CHROME.gridEdge.light;
const AXIS_TEXT = CHART_CHROME.axisText.light;
const VALUE_TEXT = CHART_CHROME.valueText.light;
const CHART_SURFACE = CHART_CHROME.surface.light;
const POINTER_BAND = CHART_CHROME.pointerBand.light;
const POINTER_LINE = CHART_CHROME.pointerLine.light;
const BLURRED = CHART_CHROME.blurred.light;

/** 渲染端补全（tooltip 结构、饼图中心总计）需要与序列化 option 同源的 chrome 色与字体栈 */
export { CHART_CHROME, FONT_FAMILY } from "./design_tokens.js";

/** 渲染端在宿主暗色下递归替换 option 内的已知颜色（键恒为小写亮色原值）。 */
export const CHART_DARK_COLORS: Record<string, string> = Object.fromEntries(
  [...CHART_SERIES, ...Object.values(CHART_CHROME)]
    .filter((pair) => pair.light !== pair.dark)
    .map((pair) => [pair.light.toLowerCase(), pair.dark]),
);

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

/** pa.legend：HTML 图例与 tooltip 标记的色源（图例组件本体在渲染端） */
function legendItems(names: string[], colorAt: (i: number) => string, latest?: (number | null)[]) {
  return names.map((name, i) => ({
    name,
    color: colorAt(i),
    ...(latest ? { latest: latest[i] ?? null } : {}),
  }));
}

const LABEL_COLUMN = { max: 160, gap: 8 } as const;

function labelColumnWidth(labels: string[]): number {
  const width = (text: string) =>
    [...text].reduce((sum, ch) => sum + (/[⺀-￯]/.test(ch) ? 12 : 6.6), 0);
  const widest = labels.reduce((max, label) => Math.max(max, width(label)), 0);
  return Math.ceil(Math.min(widest, LABEL_COLUMN.max));
}

export const SERIES_Z = { focused: 1000 } as const;
export const seriesZ = (index: number) => 2 * index + 2;
export const haloZ = (index: number) => 2 * index + 1;

/**
 * 折线的垫层：同一份数据、同一条路径，只画成 4px 的承载面色，压在本色线正下方。
 * 它不参与任何交互（`silent`），也不进读数卡——读数卡按 `pa.legend` 的条数取前几条系列。
 */
function lineHalo(source: Record<string, unknown>, index: number) {
  return {
    type: "line",
    data: source.data,
    z: haloZ(index),
    silent: true,
    showSymbol: false,
    lineStyle: { width: 4, color: CHART_SURFACE },
    emphasis: { disabled: true },
    blur: { lineStyle: { color: CHART_SURFACE, opacity: 1 } },
  };
}

/**
 * 给折线补垫层：垫层一律追加在真系列之后，真系列的序号因此不动——
 * `pa.legend`、`pa.records.points`、显式覆盖都是按序号对位的。
 */
function withLineHalo(series: Record<string, unknown>[]): Record<string, unknown>[] {
  const halos = series.flatMap((s, i) => (s.type === "line" ? [lineHalo(s, i)] : []));
  return [...series.map((s, i) => ({ ...s, z: seriesZ(i) })), ...halos];
}

function withLatestMarker(values: (number | null)[], color: string) {
  const last = values.length - 1;
  if (last < 0 || values[last] === null) return values;
  return values.map((value, i) =>
    i === last
      ? {
          value,
          symbolSize: 8,
          itemStyle: { color, borderColor: CHART_SURFACE, borderWidth: 1, opacity: 1 },
        }
      : value,
  );
}

function lineSeriesStyle(color: string, multi: boolean) {
  return {
    color,
    showSymbol: true,
    symbol: "circle",
    symbolSize: 6,
    lineStyle: { width: 1.5, color },
    itemStyle: { color: CHART_SURFACE, borderColor: color, borderWidth: 1.5 },
    ...(multi ? {} : { areaStyle: { color } }),
    emphasis: {
      focus: multi ? "series" : "self",
      scale: 1.35,

      lineStyle: { color },
      itemStyle: { color, borderColor: CHART_SURFACE, borderWidth: 1, opacity: 1 },
    },
    blur: {
      lineStyle: { color: BLURRED, opacity: 1 },
      itemStyle: { color: CHART_SURFACE, borderColor: BLURRED, opacity: 1 },
    },
  };
}

/**
 * 柱系列：同类目多柱紧贴（barGap 0）、类目带留 40% 白，方角无边框。
 * 柱占带宽 60%——柱之间要留得出「这是相邻两个桶」的间隙，贴太近就读成一条被切开的带子。
 */
function barSeriesStyle(color: string, multi: boolean) {
  return {
    color,
    itemStyle: { color },
    barGap: 0,
    barCategoryGap: "40%",
    emphasis: { focus: multi ? "series" : "self", itemStyle: { color } },
    blur: { itemStyle: { color: BLURRED, opacity: 1 } },
  };
}

/**
 * 读数卡的触发与指针。
 *
 * **整列触发**（trigger axis）：指针落在类目带内的任意高度都读得出数。逐项触发要求精确
 * 命中图形本身，而折线的命中体只有那颗 6px 圆点、密集时还被密度规则藏起来——那等于折线
 * 根本没有读数卡。整列触发同时让「一列多系列」只出一张卡，与卡内逐系列成行的排版同构。
 *
 * **指针形按图型分档**：有柱的图画整条列高亮带（柱已经占满高度，再叠一条竖线就是第二根
 * 轴）；纯折线画一条竖虚线（无柱可依，需要一条线把读数与横坐标对上）。饼图没有类目轴，
 * 保持逐项触发、无指针。
 *
 * echarts 自己那层容器一律**退成透明无框无影**：玻璃壳由 formatter 返回的内层 div 挂
 * `.pa-popup-surface` 承担，与菜单、Popover 同一张壳。容器上给壳会被 echarts 的内联
 * 样式压过，也就再无第二处可写。
 */
export type PointerForm = "band" | "line" | "item";

function axisPointer(form: Exclude<PointerForm, "item">) {
  return form === "band"
    ? { type: "shadow", shadowStyle: { color: POINTER_BAND } }
    : { type: "line", lineStyle: { color: POINTER_LINE, type: "dashed", width: 1 } };
}

function tooltip(form: PointerForm) {
  return {
    show: true,
    ...(form === "item"
      ? { trigger: "item" }
      : { trigger: "axis", axisPointer: axisPointer(form) }),
    confine: true,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    extraCssText: "box-shadow: none;",
  };
}

/** 指针形出自「图里有没有柱」这一件事实，故恒由已编译的 series 现算，不另存一份 */
function pointerFormOf(series: { type?: unknown }[]): Exclude<PointerForm, "item"> {
  return series.some((s) => s.type === "bar") ? "band" : "line";
}

export const PLOT_PADDING = {
  compact: { left: 16, right: 16, top: 0, bottom: 30 },

  tile: { left: 0, right: 0, top: 0, bottom: 26 },

  page: { left: 0, right: 0, top: 0, bottom: 30 },
} as const;

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

export const LEGEND_MARKER_CLASS =
  "mt-[4.5px] size-2 shrink-0 self-start rounded-full pointer-coarse:mt-[3px] pointer-coarse:size-3";

/**
 * plot 场地。`containLabel` 恒关，框也不由 grid 画（见 `PLOT_FRAME`）：绘图区四缘必须
 * 在渲染前就算得出来，DOM 那层框才对得上。开着 containLabel 就等于把四缘交给 echarts
 * 量标签，量出来的数只有画完才知道。要为标签留栏的形态自己给 `plot_gutter`。
 */
function grid(gutter: { left: number } = { left: 0 }) {
  const pad = PLOT_PADDING.compact;
  return { containLabel: false, ...pad, left: pad.left + gutter.left };
}

/* ---------- option 构建 ---------- */

export const CHART_HEIGHT = { cartesian: 300, pie: 320 } as const;

function seriesFormats(series: SeriesDef[]): Record<string, ColumnFormat> {
  return Object.fromEntries(series.map((s) => [s.name, s.format]));
}

function seriesDecimals(series: { name: string; decimals?: number }[]) {
  const entries = series.flatMap((s) => (s.decimals === undefined ? [] : [[s.name, s.decimals]]));
  return entries.length ? { decimals: Object.fromEntries(entries) } : {};
}

/** 一根轴上的系列若声明了位数，刻度随它；同轴多系列位数不一时取最长的那档 */
function axisDecimalsOf(...groups: SeriesDef[][]): (number | null)[] {
  return groups.map((group) => {
    const declared = group.flatMap((s) => (s.decimals === undefined ? [] : [s.decimals]));
    return declared.length ? Math.max(...declared) : null;
  });
}

function axisDecimals(key: "x" | "y", values: (number | null)[]) {
  return values.some((v) => v !== null) ? { axis_decimals: { [key]: values } } : {};
}

function cellNumber(value: string | number | null | undefined): number | null {
  return value === undefined ? null : toNumber(value);
}

function applyDisplay(
  option: Record<string, unknown>,
  display: Record<string, SeriesDisplay>,
  series: SeriesDef[],
  orientation: "vertical" | "horizontal" = "vertical",
): void {
  const optionSeries = option.series as Record<string, unknown>[] | undefined;
  if (!Array.isArray(optionSeries)) return;
  const pa = option.pa as PaChartExtension | undefined;
  const multi = optionSeries.length > 1;

  series.forEach((definition, index) => {
    const target = optionSeries[index];
    const intent = definition.column ? display[definition.column] : undefined;
    if (!target || !intent) return;
    const color =
      intent.color ?? (typeof target.color === "string" ? target.color : seriesColorAt(index));

    if (intent.type === "bar") {
      Object.assign(target, { type: "bar" }, barSeriesStyle(color, multi));
      delete target.showSymbol;
      delete target.symbol;
      delete target.symbolSize;
      delete target.lineStyle;
      delete target.areaStyle;
    } else if (intent.type === "line") {
      Object.assign(target, { type: "line" }, lineSeriesStyle(color, multi));
    } else if (intent.color !== undefined) {
      target.color = color;
      if (target.type === "line") {
        target.lineStyle = {
          ...((target.lineStyle as Record<string, unknown> | undefined) ?? {}),
          color,
        };
        target.itemStyle = {
          ...((target.itemStyle as Record<string, unknown> | undefined) ?? {}),
          borderColor: color,
        };
      } else {
        target.itemStyle = {
          ...((target.itemStyle as Record<string, unknown> | undefined) ?? {}),
          color,
        };
      }
    }
    if (pa?.legend?.[index]) pa.legend[index].color = color;
    if (intent.label !== undefined) {
      target.label = intent.label
        ? {
            show: true,
            position: orientation === "horizontal" ? "right" : "top",
            color: VALUE_TEXT,
            fontSize: 13,
            fontWeight: 500,
            textBorderColor: CHART_SURFACE,
            textBorderWidth: 3,
          }
        : { show: false };
    }
    if (intent.yAxis !== undefined) {
      target.yAxisIndex = intent.yAxis === "right" ? 1 : 0;
      if (intent.yAxis === "right") {
        const currentAxes = Array.isArray(option.yAxis)
          ? [...option.yAxis]
          : option.yAxis
            ? [option.yAxis]
            : [];
        while (currentAxes.length < 2) {
          currentAxes.push({
            type: "value",
            splitNumber: VALUE_SPLIT,
            axisLabel: insideValueLabel("right"),
            axisLine: axisLineStyle,
            splitLine: { show: false },
          });
        }
        option.yAxis = currentAxes;
        if (pa) {
          const yFormats = [...(pa.axes.y ?? [])];
          while (yFormats.length < 2) yFormats.push(definition.format);
          pa.axes.y = yFormats;
        }
      }
    }
  });

  // 指针形取决于覆盖后的系列类型，避免纯折线仍使用列高亮带。
  const currentTooltip = option.tooltip as Record<string, unknown> | undefined;
  if (currentTooltip?.trigger === "axis") {
    currentTooltip.axisPointer = axisPointer(pointerFormOf(optionSeries));
  }
}

/** 纯时间趋势 / 柱线组合：时间恒占 x 轴；混量纲时量画柱（主轴）、率画线（副轴） */
function trendOption(spec: TrendSpec): ViewChart {
  const labels = spec.rows.map((r) => String(r.t ?? ""));
  // 图例读数取「每条系列都有值的最后一个桶」，不是单纯的最后一行：当月未完时，
  // 存量指标已有数而流量指标还空着，取最后一行会让同一行读数缺几个。
  // 一个标签只交代得了一个时间断面，凑不齐就整条不发。
  const latestRow = [...spec.rows]
    .reverse()
    .find((row) => spec.series.every((s) => cellNumber(row[s.key]) !== null));
  const countFormat = spec.series.find((s) => !s.isRate)?.format ?? "number";
  const yFormats: (ColumnFormat | null)[] = spec.mixedAxes
    ? [countFormat, spec.rateFormat]
    : [spec.allRate ? spec.rateFormat : countFormat];
  const multi = spec.series.length > 1;
  const hasBar = spec.series.some((s) => s.mark === "bar");
  const rateSeries = spec.series.filter((s) => s.isRate);
  const countSeries = spec.series.filter((s) => !s.isRate);
  const yDecimals = spec.mixedAxes
    ? axisDecimalsOf(countSeries, rateSeries)
    : axisDecimalsOf(spec.allRate ? rateSeries : countSeries);
  const pa: PaChartExtension = {
    series: seriesFormats(spec.series),
    ...seriesDecimals(spec.series),
    axes: { y: yFormats },
    ...axisDecimals("y", yDecimals),
    legend: legendItems(
      spec.series.map((s) => s.name),
      seriesColorAt,
      // 值取自铺开的行本身，不重算：图例给的就是画面上那一列真实的点。
      latestRow ? spec.series.map((s) => cellNumber(latestRow[s.key])) : undefined,
    ),
    ...(latestRow ? { legend_latest_label: String(latestRow.t ?? "") } : {}),
    records: recordProjectionPoints(spec.rows, spec.series),
  };
  return {
    form: "line",
    height: CHART_HEIGHT.cartesian,
    option: {
      color: [...SERIES_COLORS],
      textStyle: { fontFamily: FONT_FAMILY },
      ...MOTION,
      grid: grid(),
      tooltip: tooltip(hasBar ? "band" : "line"),
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: axisLabelStyle,
        axisLine: axisLineStyle,
        axisTick: axisTickStyle,
        splitLine: hasBar ? noSplit : gridSplitEdge,
      },
      yAxis: yFormats.map((_, i) => ({
        type: "value",
        splitNumber: VALUE_SPLIT,
        axisLabel: insideValueLabel(i === 0 ? "left" : "right"),
        axisLine: axisLineStyle,
        axisTick: axisTickStyle,
        splitLine: i === 0 ? gridSplit : { show: false },
      })),
      series: spec.series.map((s, i) => {
        const values = spec.rows.map((r) => cellNumber(r[s.key]));
        return {
          name: s.name,
          type: s.mark === "bar" ? "bar" : "line",
          data: s.mark === "bar" ? values : withLatestMarker(values, seriesColorAt(i)),
          ...(s.mark === "bar"
            ? { yAxisIndex: 0, ...barSeriesStyle(seriesColorAt(i), multi) }
            : {
                yAxisIndex: spec.mixedAxes ? 1 : 0,
                ...lineSeriesStyle(seriesColorAt(i), multi),
              }),
        };
      }),
      pa,
    },
  };
}

/** 分类柱线组合：分类占 x 轴，绝对量画柱（左轴），率画线（右轴）。 */
function categoryComboOption(spec: CategoryComboSpec): ViewChart {
  const labels = spec.rows.map((row) => String(row.label ?? ""));
  const multi = spec.series.length > 1;
  const shareSeries = spec.series.find((series) => series.shareKey !== undefined);
  const share = shareSeries?.shareKey
    ? {
        title: "占比",
        values: Object.fromEntries(
          spec.rows.map((row) => [String(row.label ?? ""), cellNumber(row[shareSeries.shareKey!])]),
        ),
      }
    : undefined;
  const pa: PaChartExtension = {
    series: seriesFormats(spec.series),
    ...seriesDecimals(spec.series),
    axes: { y: [spec.countFormat, spec.rateFormat] },
    ...axisDecimals(
      "y",
      axisDecimalsOf(
        spec.series.filter((s) => !s.isRate),
        spec.series.filter((s) => s.isRate),
      ),
    ),
    ...(share ? { share } : {}),
    legend: legendItems(
      spec.series.map((series) => series.name),
      seriesColorAt,
    ),
    records: recordProjectionPoints(spec.rows, spec.series),
  };
  return {
    form: "bar",
    height: CHART_HEIGHT.cartesian,
    option: {
      color: [...SERIES_COLORS],
      textStyle: { fontFamily: FONT_FAMILY },
      ...MOTION,
      grid: grid(),
      tooltip: tooltip("band"),
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: axisLabelStyle,
        axisLine: axisLineStyle,
        axisTick: axisTickStyle,
        splitLine: noSplit,
      },
      yAxis: [spec.countFormat, spec.rateFormat].map((_, index) => ({
        type: "value",
        splitNumber: VALUE_SPLIT,
        axisLabel: insideValueLabel(index === 0 ? "left" : "right"),
        axisLine: axisLineStyle,
        axisTick: axisTickStyle,
        splitLine: index === 0 ? gridSplit : { show: false },
      })),
      series: spec.series.map((series, index) => ({
        name: series.name,
        type: series.isRate ? "line" : "bar",
        yAxisIndex: series.isRate ? 1 : 0,
        data: spec.rows.map((row) => cellNumber(row[series.key])),
        ...(series.isRate
          ? lineSeriesStyle(seriesColorAt(index), multi)
          : barSeriesStyle(seriesColorAt(index), multi)),
      })),
      pa,
    },
  };
}

/** 分类条形（横排容纳中文长标签）：多系列并列、双分类构成堆叠；占比注释随 tooltip */
function barOption(spec: BarSpec): ViewChart {
  const multi = spec.series.length > 1;
  const labels = spec.rows.map((r) => String(r.label ?? ""));
  const height = barChartHeight(labels.length, spec.stacked ? 1 : spec.series.length);
  const share = spec.hasShare
    ? {
        title: "占比",
        values: Object.fromEntries(
          spec.rows.map((r) => {
            const key = spec.stacked ? "share" : (spec.series[0]?.shareKey ?? "share");
            return [String(r.label ?? ""), cellNumber(r[key])];
          }),
        ),
      }
    : undefined;
  const pa: PaChartExtension = {
    series: seriesFormats(spec.series),
    ...seriesDecimals(spec.series),
    axes: { x: [spec.format] },
    ...axisDecimals("x", axisDecimalsOf(spec.series)),
    ...(share ? { share } : {}),
    legend: legendItems(
      spec.series.map((s) => s.name),
      seriesColorAt,
    ),
    records: recordProjectionPoints(spec.rows, spec.series),
  };
  // 单系列（不堆叠）改走排行版式：一行说一个类目，值与占比各占一列
  if (!multi && !spec.stacked) {
    return {
      form: "bar",
      height: labels.length * RANK_ROW.height,
      layout: "rank",
      option: {
        color: [...SERIES_COLORS],
        textStyle: { fontFamily: FONT_FAMILY },
        ...MOTION,
        yAxis: { type: "category", data: labels },
        series: spec.series.map((s, i) => ({
          name: s.name,
          type: "bar",
          data: spec.rows.map((r) => cellNumber(r[s.key])),
          ...barSeriesStyle(seriesColorAt(i), multi),
        })),
        pa,
      },
    };
  }
  const gutter = { left: labelColumnWidth(labels) + LABEL_COLUMN.gap };
  return {
    form: "bar",
    height: height + 24,
    plot_gutter: gutter,
    option: {
      color: [...SERIES_COLORS],
      textStyle: { fontFamily: FONT_FAMILY },
      ...MOTION,
      // 类目在左轴（中文长标签），刻度留在框外自占一栏
      grid: grid(gutter),
      tooltip: tooltip("band"),
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
        data: labels,
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
      series: spec.series.map((s, i) => ({
        name: s.name,
        type: "bar",
        data: spec.rows.map((r) => cellNumber(r[s.key])),
        ...barSeriesStyle(seriesColorAt(i), multi),
        ...(spec.stacked ? { stack: "total" } : {}),
      })),
      pa,
    },
  };
}

/**
 * 饼图（声明路径专属）：内半径 = 外半径 3/5、切缝用底面色边框，
 * 切片不出外部标签和引线，
 * 占比进图例（percent_visibility 默认 legend，渲染端按值计算）、环心常驻总计（渲染端注入）。
 */

function pieOption(spec: PieSpec): ViewChart {
  const pa: PaChartExtension = {
    series: { [spec.seriesName]: spec.format },
    ...seriesDecimals([{ name: spec.seriesName, decimals: spec.decimals }]),
    axes: {},
    legend: legendItems(
      spec.rows.map((r) => r.label),
      seriesColorAt,
    ),
    records: {
      points: [
        spec.rows.map((row) => {
          const source = chartSourceRow(row);
          return source === undefined ? null : { row: source, column: spec.column };
        }),
      ],
    },
  };
  return {
    form: "pie",
    height: CHART_HEIGHT.pie,
    option: {
      color: [...SERIES_COLORS],
      textStyle: { fontFamily: FONT_FAMILY },
      ...MOTION,
      tooltip: tooltip("item"),
      series: [
        {
          name: spec.seriesName,
          type: "pie",
          radius: ["48%", "80%"],
          center: ["50%", "50%"],
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderColor: CHART_SURFACE, borderWidth: 2 },
          emphasis: { focus: "self", scaleSize: 4 },
          blur: { itemStyle: { color: BLURRED, opacity: 1 } },
          data: spec.rows.map((r, i) => ({
            name: r.label,
            value: r.value,
            itemStyle: { color: seriesColorAt(i) },
            emphasis: { itemStyle: { color: seriesColorAt(i) } },
          })),
        },
      ],
      pa,
    },
  };
}

/** 按显式声明编译图表配置；不声明图表的 table/kpi 直接返回 null。 */
export function buildViewChart(view: ViewBlock, decl: ChartDecl): ViewChart | null {
  const shape = compileChart(view, makeTitleOf(view), decl);
  if (!shape) return null;
  // 垫层最后补：显式覆盖可以把一条折线改成柱，改完才知道谁还是折线
  const withHalo = (chart: ViewChart): ViewChart => {
    const series = chart.option.series;
    if (!Array.isArray(series)) return chart;
    chart.option.series = withLineHalo(series as Record<string, unknown>[]);
    return chart;
  };
  if (shape.kind === "line") {
    const chart = trendOption(shape);
    if (decl.display) applyDisplay(chart.option, decl.display, shape.series);
    return withHalo(chart);
  }
  if (shape.kind === "bar") {
    const chart = barOption(shape);
    if (decl.display) applyDisplay(chart.option, decl.display, shape.series, "horizontal");
    return withHalo(chart);
  }
  if (shape.kind === "category_combo") {
    const chart = categoryComboOption(shape);
    if (decl.display) applyDisplay(chart.option, decl.display, shape.series);
    return withHalo(chart);
  }
  return pieOption(shape);
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
    isRecord(value.option)
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
    !["table", "kpi", "line", "bar", "pie"].includes(String(value.type)) ||
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
