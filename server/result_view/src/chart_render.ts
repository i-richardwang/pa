/**
 * 由编译产物和渲染状态生成 `setOption` 对象。深色模式按 CHART_DARK_COLORS 替换颜色字面值，
 * 因此格式化函数和渐变必须在替换之后注入。
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

/** echarts 的 `series`、`xAxis` 等字段既可以是对象也可以是数组，统一转成数组。 */
function asArray(value: unknown): MutableOption[] {
  if (Array.isArray(value)) return value as MutableOption[];
  if (value && typeof value === "object") return [value as MutableOption];
  return [];
}

export type Viewport = { width: number; height: number };

/** echarts grid 与 DOM 绘图区边框使用同一个矩形，两处必须一致。 */
export function plotRect(
  chart: ViewChart,
  scene: ViewScene,
): { left: number; right: number; top: number; bottom: number } {
  const pad = PLOT_PADDING[scene];
  return { ...pad, left: pad.left + (chart.plot_gutter?.left ?? 0) };
}

/** 数据区 = 绘图区矩形再减去标签留白；开关数值标签时边框不动，只缩小数据区。 */
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

/** 每个点分到的宽度小于 12px 时关闭折线圆点（echarts `showSymbol`），只在指针悬停时显示。 */
const SYMBOL_SPACING = 12;

/** 数值标签阈值（px）：每个点分到的宽度小于此值时，按间隔隔几个点显示一个标签。 */
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

/** 与读数卡使用相同的格式和小数位；所有配了标签样式的系列都装上，聚焦时可能显示原本不显示标签的系列。 */
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

/** 按 legend 顺序对应数据系列；密度和格式化只作用于数据系列，不作用于折线的衬底系列。 */
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

/** 数值轴刻度与读数卡使用相同的格式和小数位，比率轴按百分比或百分点标注单位。 */
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

/** 面积渐变在深色替换之后生成；在 70% 处渐变到透明，铺到底会盖住网格线和零基线。 */
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
  /** 当前聚焦的系列或扇区 */
  focused: number | null;
  /** 钉住的数据点；钉住期间指针不再跟随鼠标 */
  pinned: number | null;
};

/** 必须在深色替换之前执行：聚焦色和系列色都是浅色模式的原始值。 */
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
 * 生成当前状态下的完整 option。深色替换必须在注入函数和渐变之前：替换只递归处理字面值，
 * 处理不到函数和渐变对象。其余步骤之间没有顺序要求。
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
