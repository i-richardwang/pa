/**
 * 编译产物 × 渲染状态 → `setOption` 对象。翻色按 CHART_DARK_COLORS 走字面值，
 * 函数与渐变必须在翻色之后注入。
 */
import {
  CHART_CHROME,
  CHART_DARK_COLORS,
  FONT_FAMILY,
  PLOT_PADDING,
  focusPatch,
  valueLabelPillWidth,
  type ChartModel,
  type ViewChart,
  type ViewScene,
} from "../../src/presentation_core/chart_config.js";
import { formatSeriesValue, formatTick } from "../../src/presentation_core/view_format.js";
import type { ColumnFormat } from "../../src/semantic_core/query_payload.js";

type MutableOption = Record<string, unknown>;

/** `series`、`xAxis` 这些字段单个与数组两种写法都合法，写它们的地方不各归一一遍。 */
function asArray(value: unknown): MutableOption[] {
  if (Array.isArray(value)) return value as MutableOption[];
  if (value && typeof value === "object") return [value as MutableOption];
  return [];
}

export type Viewport = { width: number; height: number };

/** grid 与 DOM 场地框读同一道算式，两处必须同源。 */
export function plotRect(
  chart: ViewChart,
  scene: ViewScene,
): { left: number; right: number; top: number; bottom: number } {
  const pad = PLOT_PADDING[scene];
  return { ...pad, left: pad.left + (chart.plot_gutter?.left ?? 0) };
}

/** 数据区 = 场地框 + 框内标签余量：框不因标签开关移动，余量只缩数据区。 */
export function gridRect(
  chart: ViewChart,
  scene: ViewScene,
): { left: number; right: number; top: number; bottom: number } {
  const rect = plotRect(chart, scene);
  const inset = chart.plot_inset ?? {};
  return { ...rect, top: rect.top + (inset.top ?? 0), right: rect.right + (inset.right ?? 0) };
}

export function plotSize(chart: ViewChart, scene: ViewScene, viewport: Viewport): Viewport {
  const rect = gridRect(chart, scene);
  return {
    width: Math.max(0, viewport.width - rect.left - rect.right),
    height: Math.max(0, viewport.height - rect.top - rect.bottom),
  };
}

/** 折线圆点：每点摊不到 12px 就只在指针命中时现出那一颗（`showSymbol` 的原生语义）。 */
const SYMBOL_SPACING = 12;

/** 值标签阈值（px）：每点可用宽低于此即按步距挑桶。 */
const VALUE_LABEL_SPACING = 37.33;
const LINE_LABEL_BUDGET = 50;
const BAR_LABEL_GAP = 4;

const TICK_SPACING = 80;

function labelStep(kind: unknown, per: number, widest: number): number {
  if (kind === "line") {
    return per <= VALUE_LABEL_SPACING ? Math.max(1, Math.ceil(LINE_LABEL_BUDGET / per)) : 1;
  }
  return Math.max(1, Math.ceil((widest + BAR_LABEL_GAP) / per));
}

/** 与读数卡同源的格式与位数；配了标签形制即装，焦点会现出此刻不印的那条。 */
function valueLabelFormatter(
  format: ColumnFormat,
  decimals: number | undefined,
  step: number,
  count: number,
) {
  return (params: { value?: unknown; dataIndex?: number }) => {
    const index = params.dataIndex ?? 0;
    if (step > 1 && index !== count - 1 && index % step !== 0) return "";
    const value = Array.isArray(params.value) ? params.value.at(-1) : params.value;
    return typeof value === "number" ? formatSeriesValue(value, format, decimals) : "";
  };
}

/** 真系列按 legend 对位：密度、格式化器都只写在这几条上，垫层不碰。 */
function applySeriesDensity(option: MutableOption, model: ChartModel, plotWidth: number): void {
  const series = asArray(option.series);
  const categoryOnX = asArray(option.xAxis)[0]?.type === "category";
  model.legend.forEach((item, i) => {
    const target = series[i];
    if (!target) return;
    const count = item.values.length;
    const per = count > 0 ? plotWidth / count : plotWidth;
    if (target.type === "line" && plotWidth > 0) {
      target.showSymbol = count <= plotWidth / SYMBOL_SPACING;
    }
    const label = target.label as MutableOption | undefined;
    if (!label) return;
    const widest = item.values.reduce<number>(
      (max, value) =>
        value === null
          ? max
          : Math.max(
              max,
              valueLabelPillWidth(formatSeriesValue(value, item.format, item.decimals)),
            ),
      0,
    );
    const step = categoryOnX && plotWidth > 0 ? labelStep(target.type, per, widest) : 1;
    target.label = {
      ...label,
      formatter: valueLabelFormatter(item.format, item.decimals, step, count),
    };
  });
}

function applyTickDensity(option: MutableOption, plot: Viewport): void {
  const ticks = (axes: MutableOption[], extent: number) => {
    for (const axis of axes) {
      if (axis.type !== "value" || extent <= 0) continue;
      axis.splitNumber = Math.min(10, Math.max(2, Math.round(extent / TICK_SPACING)));
    }
  };
  ticks(asArray(option.xAxis), plot.width);
  ticks(asArray(option.yAxis), plot.height);
}

/** 值轴刻度：与读数卡同源的格式与位数，率轴按百分比/百分点标单位。 */
function injectAxisFormatters(option: MutableOption, model: ChartModel): void {
  const inject = (
    axes: MutableOption[],
    formats: (ColumnFormat | null)[] | undefined,
    decimals: (number | null)[] | undefined,
  ) => {
    axes.forEach((axis, index) => {
      const format = formats?.[index];
      if (!format || axis.type !== "value") return;
      const digits = decimals?.[index] ?? undefined;
      axis.axisLabel = {
        ...((axis.axisLabel ?? {}) as MutableOption),
        formatter: (value: number) => formatTick(value, format, digits),
      };
    });
  };
  inject(asArray(option.xAxis), model.axes.x, model.axis_decimals?.x);
  inject(asArray(option.yAxis), model.axes.y, model.axis_decimals?.y);
}

export function legendTotal(model: ChartModel): number | null {
  return model.total?.value ?? null;
}

function injectPieCenterTotal(option: MutableOption, model: ChartModel, dark: boolean): void {
  const lead = model.legend[0];
  const total = legendTotal(model);
  if (!lead || total === null) return;
  const valueColor = dark ? CHART_CHROME.valueText.dark : CHART_CHROME.valueText.light;
  const labelColor = dark ? CHART_CHROME.axisText.dark : CHART_CHROME.axisText.light;
  option.graphic = [
    {
      type: "text",
      left: "center",
      top: "middle",
      silent: true,
      z: 10,
      style: {
        text: `{v|${formatSeriesValue(total, model.total?.format ?? lead.format, model.total?.decimals)}}\n{l|总计}`,
        rich: {
          v: {
            fontSize: 22,
            fontWeight: 600,
            fill: valueColor,
            fontFamily: FONT_FAMILY,
            align: "center",
          },
          l: {
            fontSize: 14,
            fill: labelColor,
            fontFamily: FONT_FAMILY,
            align: "center",
            padding: [4, 0, 0, 0],
          },
        },
      },
    },
  ];
}

/** 自定义色可能不是六位十六进制，此时返回 null。 */
function withAlpha(color: string, alpha: number): string | null {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!hex) return null;
  const [r, g, b] = hex.slice(1).map((part) => Number.parseInt(part, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 面积渐变在翻色之后现拼；收尽点 70%，铺到底会盖住网格线与零基线。 */
function injectAreaGradient(option: MutableOption): void {
  for (const series of asArray(option.series)) {
    const area = series.areaStyle as MutableOption | undefined;
    if (!area || typeof area.color !== "string") continue;
    const top = withAlpha(area.color, 0.05);
    const bottom = withAlpha(area.color, 0);
    if (!top || !bottom) {
      area.opacity = 0.05;
      continue;
    }
    area.color = {
      type: "linear",
      x: 0,
      y: 0,
      x2: 0,
      y2: 1,
      colorStops: [
        { offset: 0, color: top },
        { offset: 0.7, color: bottom },
      ],
    };
  }
}

function applyDarkColors(value: unknown): unknown {
  if (typeof value === "string") return CHART_DARK_COLORS[value.toLowerCase()] ?? value;
  if (Array.isArray(value)) return value.map(applyDarkColors);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as MutableOption).map(([k, v]) => [k, applyDarkColors(v)]),
    );
  }
  return value;
}

export type RenderState = {
  dark: boolean;
  scene: ViewScene;
  viewport: Viewport;
  /** 在焦点的图例单元（系列或切片） */
  focused: number | null;
  /** 钉住的那一格；钉住期间指针不再跟随鼠标 */
  pinned: number | null;
};

/** 必须在翻色之前：焦点色与本色同是亮色原值。 */
function applyFocus(option: MutableOption, chart: ViewChart, focused: number | null): void {
  const patch = focusPatch(chart, focused);
  if (patch.color) option.color = patch.color;
  if (patch.series) {
    const series = asArray(option.series);
    patch.series.forEach((item, i) => {
      if (series[i]) Object.assign(series[i], item);
    });
  }
}

/**
 * 一次派生出这张图此刻该长的样子。顺序只有一条硬约束：翻色要在注入函数之前——
 * 翻色递归走字面值，函数与渐变对象走不进去；其余各步互不相干。
 */
export function renderOption(chart: ViewChart, state: RenderState): MutableOption {
  const option = structuredClone(chart.option) as MutableOption;
  const model = chart.model;
  applyFocus(option, chart, state.focused);
  if (option.grid)
    option.grid = { ...(option.grid as MutableOption), ...gridRect(chart, state.scene) };
  const plot = plotSize(chart, state.scene, state.viewport);
  applySeriesDensity(option, model, plot.width);
  applyTickDensity(option, plot);
  if (model.pointer === "axis") {
    option.tooltip = {
      ...((option.tooltip ?? {}) as MutableOption),
      triggerOn: state.pinned === null ? "mousemove|click" : "none",
    };
  }
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
    option.animation = false;
  }
  const themed = (state.dark ? applyDarkColors(option) : option) as MutableOption;
  injectAxisFormatters(themed, model);
  injectAreaGradient(themed);
  if (chart.form === "pie") injectPieCenterTotal(themed, model, state.dark);
  return themed;
}
