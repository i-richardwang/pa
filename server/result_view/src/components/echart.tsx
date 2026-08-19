
import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GraphicComponent,
  GridComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import {
  applyValueLabelDensity,
  gridRect,
  plotRect,
  plotWidth,
  prepareOption,
} from "../chart_render.js";
import { useDarkTheme } from "../use_dark_theme.js";
import { PlotSlab } from "./plot_slab.js";
import { RankRows } from "./rank_rows.js";
import { observeElementSize } from "../element_size.js";
import { formatSeriesValue } from "../../../src/presentation_core/view_format.js";
import {
  CHART_CHROME,
  CHART_DARK_COLORS,
  type PaChartExtension,
  SERIES_Z,
  seriesZ,
  type ViewChart,
} from "../../../src/presentation_core/chart_config.js";
// 只取档位名（keyof typeof），留白数值本身归 chart_config 与 prepareOption
import {
  LEGEND_MARKER_CLASS,
  legendRowClass,
  type PLOT_PADDING,
} from "../../../src/presentation_core/chart_config.js";
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GraphicComponent,
  GridComponent,
  TitleComponent,
  TooltipComponent,
  SVGRenderer,
]);

function applySymbolDensity(instance: echarts.ECharts, chart: ViewChart, width: number): void {
  const series = chart.option.series;
  if (!Array.isArray(series) || width <= 0) return;
  let touched = false;
  const patch = series.map((s) => {
    const record = s as Record<string, unknown>;
    if (record.type !== "line" || !Array.isArray(record.data)) return {};
    touched = true;
    const visible = (record.data as unknown[]).length <= width / 12;

    // 再压一道透明度，落选的点就与换过色的线不同步，糊成两种灰。
    return {
      itemStyle: { opacity: visible ? 1 : 0 },
      blur: { itemStyle: { opacity: visible ? 1 : 0 } },
    };
  });
  if (touched) instance.setOption({ series: patch });
}

const TICK_SPACING = 80;
function tickPatch(axis: unknown, extent: number): Record<string, unknown>[] {
  const list = Array.isArray(axis) ? axis : axis ? [axis] : [];
  return list.map((a) =>
    (a as Record<string, unknown>)?.type === "value"
      ? { splitNumber: Math.min(10, Math.max(2, Math.round(extent / TICK_SPACING))) }
      : {},
  );
}

export function applyValueTickDensity(
  instance: Pick<echarts.ECharts, "setOption">,
  chart: ViewChart,
  plot: keyof typeof PLOT_PADDING,
  size: { width: number; height: number },
): void {
  if (chart.form === "pie" || chart.layout === "rank") return;
  if (size.width <= 0 || size.height <= 0) return;
  const rect = gridRect(chart, plot);
  const patch = {
    xAxis: tickPatch(chart.option.xAxis, size.width - rect.left - rect.right),
    yAxis: tickPatch(chart.option.yAxis, size.height - rect.top - rect.bottom),
  };
  if (patch.xAxis.length === 0 && patch.yAxis.length === 0) return;
  instance.setOption(patch);
}

export function raiseSeries(
  instance: Pick<echarts.ECharts, "setOption"> | null,
  chart: ViewChart,
  focused: number | null,
): void {
  // 只动真系列：垫层追加在它们之后，短一截的 series 数组按序号合并，后面那些原样不动
  const count = (chart.option.pa as PaChartExtension | undefined)?.legend?.length ?? 0;
  if (!instance || chart.form === "pie" || count < 2) return;
  instance.setOption({
    series: Array.from({ length: count }, (_, i) => ({
      z: i === focused ? SERIES_Z.focused : seriesZ(i),
    })),
  });
}

/** 聚焦某一项在 echarts 那边的指名方式：饼图按切片、其余按系列名 */
export type FocusTarget = { seriesIndex: number; dataIndex: number } | { seriesName: string };

export function focusTarget(chart: ViewChart, index: number, name: string): FocusTarget {
  return chart.form === "pie" ? { seriesIndex: 0, dataIndex: index } : { seriesName: name };
}

export function focusActions(
  previous: FocusTarget | null,
  next: FocusTarget | null,
): ({ type: "downplay" | "highlight" } & FocusTarget)[] {
  const actions: ({ type: "downplay" | "highlight" } & FocusTarget)[] = [];
  if (previous) actions.push({ type: "downplay", ...previous });
  if (next) actions.push({ type: "highlight", ...next });
  return actions;
}

/** 饼图图例的占比列：切片值 / 总量（呈现算术，与 tooltip 占比同源同级） */
function piePercents(chart: ViewChart): (string | null)[] | null {
  if (chart.form !== "pie") return null;
  const series = chart.option.series;
  const data = (Array.isArray(series) ? (series[0]?.data ?? []) : []) as { value?: unknown }[];
  const values = data.map((d) => (typeof d.value === "number" ? d.value : null));
  const total = values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  if (total <= 0) return values.map(() => null);
  return values.map((v) => (v === null ? null : formatSeriesValue(v / total, "percent")));
}

function LegendRow({
  chart,
  dark,
  plot = "compact",
  onHover,
}: {
  chart: ViewChart;
  dark: boolean;

  plot?: keyof typeof PLOT_PADDING;
  onHover: (index: number | null, name: string) => void;
}) {
  const pa = chart.option.pa as PaChartExtension | undefined;
  const items = pa?.legend ?? [];
  const isPie = chart.form === "pie";
  if (isPie ? items.length === 0 : items.length < 2) return null;
  const colorOf = (color: string) =>
    dark ? (CHART_DARK_COLORS[color.toLowerCase()] ?? color) : color;
  const percents = piePercents(chart);
  const withLatest = items.some((item) => item.latest != null);
  const latestLabel = pa?.legend_latest_label;

  const [focused, setFocused] = useState<number | null>(null);
  const dotColor = (item: { color: string }, i: number) =>
    colorOf(focused !== null && focused !== i ? CHART_CHROME.blurred.light : item.color);

  const focus = (i: number | null) => {
    setFocused(i);
    onHover(i, i === null ? "" : (items[i]?.name ?? ""));
  };
  return (

    <div className={legendRowClass(plot, withLatest)} onMouseLeave={() => focus(null)}>
      {/* 末桶名占满一行：值是那一桶的读数，不说是哪一桶就成了没有出处的数。
          桌面档 hidden 不占位，故这一行不影响既有版式。 */}
      {latestLabel && withLatest && (
        <p className="hidden text-xs text-pa-muted pointer-coarse:col-span-2 pointer-coarse:block">
          {latestLabel}
        </p>
      )}
      {items.map((item, i) => (

          <span
            key={`${item.name}-${i}`}
            className="flex min-w-0 items-start gap-1.5 text-xs text-pa-muted"
            onMouseEnter={() => focus(i)}
          >
            <span
              aria-hidden="true"
              className={LEGEND_MARKER_CLASS}
              style={{ backgroundColor: dotColor(item, i) }}
            />
            <span className="flex min-w-0 flex-col">
              <span className={`truncate ${focused === i ? "text-pa-fg" : ""}`}>{item.name}</span>
              {item.latest != null && (
                <span className="hidden truncate font-medium text-base text-pa-fg tabular-nums pointer-coarse:block">
                  {formatSeriesValue(
                    item.latest,
                    pa?.series?.[item.name] ?? "number",
                    pa?.decimals?.[item.name],
                  )}
                </span>
              )}
            </span>

            {percents?.[i] != null && (
              <span className="font-normal text-pa-faint tabular-nums">{percents[i]}</span>
            )}
          </span>
      ))}
    </div>
  );
}

export function ViewChartCanvas({
  chart,
  fill = false,
  plot = "compact",
  suspendResize = false,
  onPointClick,
}: {
  chart: ViewChart;
  /** 高度取容器而非 chart.height；需容器给定确定高度。 */
  fill?: boolean;
  /** plot 留白档位（`PLOT_PADDING` 的键）：编译期给的是 compact，整页宿主换到 page。 */
  plot?: keyof typeof PLOT_PADDING;
  /** 冻结尺寸响应（拖拽缩放期），解除时补渲一次。 */
  suspendResize?: boolean;
  onPointClick?: (point: { row: number; column: string }) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<echarts.ECharts | null>(null);
  const size = useRef({ width: 0, height: 0 });
  const dark = useDarkTheme();

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    // 渲染器必须显式点名：注册表里只有 svg 那一支，init 的缺省值仍是 canvas
    const created = echarts.init(el, null, { renderer: "svg" });
    instance.current = created;
    return () => {
      instance.current = null;
      created.dispose();
    };
  }, []);

  useEffect(() => {
    const current = instance.current;
    if (!current) return;
    current.setOption(
      prepareOption(chart, dark, { plot }) as Parameters<echarts.ECharts["setOption"]>[0],
      { notMerge: true },
    );
    applySymbolDensity(current, chart, size.current.width);
    applyValueLabelDensity(current, chart, plotWidth(chart, plot, size.current.width));
    applyValueTickDensity(current, chart, plot, size.current);
  }, [chart, dark, plot]);

  useEffect(() => {
    const current = instance.current;
    if (!current || !onPointClick) return;
    const click = (params: { seriesIndex?: number; dataIndex?: number }) => {
      if (params.seriesIndex === undefined || params.dataIndex === undefined) return;
      const pa = chart.option.pa as PaChartExtension | undefined;
      const point = pa?.records?.points[params.seriesIndex]?.[params.dataIndex];
      if (point) onPointClick(point);
    };
    current.on("click", click);
    return () => {
      current.off("click", click);
    };
  }, [chart, onPointClick]);

  // 解冻时 effect 重订阅，observeElementSize 立即以当前尺寸回调一次即补渲
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    return observeElementSize(el, (next) => {
      size.current = { width: next.width, height: next.height };
      if (suspendResize) return;
      const current = instance.current;
      current?.resize();
      if (!current) return;
      applySymbolDensity(current, chart, next.width);
      applyValueLabelDensity(current, chart, plotWidth(chart, plot, next.width));
      applyValueTickDensity(current, chart, plot, next);
    });
  }, [suspendResize, chart, plot]);

  const hovered = useRef<FocusTarget | null>(null);
  const hoverLegend = (index: number | null, name: string) => {
    const current = instance.current;
    if (!current) return;
    const next = index === null ? null : focusTarget(chart, index, name);
    for (const action of focusActions(hovered.current, next)) current.dispatchAction(action);
    hovered.current = next;
    raiseSeries(current, chart, index);
  };

  const rect = plotRect(chart, plot);

  if (chart.layout === "rank") {
    return (
      <div
        className={fill ? "relative h-full min-h-0 w-full" : "relative w-full"}
        style={fill ? undefined : { height: chart.height }}
      >
        <PlotSlab plot={plot} rect={rect}>
          <RankRows chart={chart} dark={dark} onPointClick={onPointClick} />
        </PlotSlab>
      </div>
    );
  }
  return (
    <div className={fill ? "flex h-full min-h-0 w-full flex-col" : "w-full"}>
      <LegendRow chart={chart} dark={dark} onHover={hoverLegend} plot={plot} />

      <div
        className={`relative ${fill ? "min-h-0 w-full flex-1" : "w-full"}`}
        style={fill ? undefined : { height: chart.height }}
      >
        <PlotSlab plot={plot} rect={rect} />
        <div
          ref={container}
          className={`absolute inset-0 ${onPointClick ? "cursor-pointer" : ""}`}
        />
      </div>
    </div>
  );
}
