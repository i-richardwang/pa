import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  applyDarkColors,
  applyValueLabelDensity,
  gridRect,
  plotRect,
  plotWidth,
  prepareOption,
} from "../chart_render.js";
import { pieData, pieTotal } from "../chart_option.js";
import { useDismiss } from "../dismiss.js";
import { readoutModel, type ReadoutModel } from "../readout.js";
import { useDarkTheme } from "../use_dark_theme.js";
import { PlotSlab } from "./plot_slab.js";
import { RankRows } from "./rank_rows.js";
import { ReadoutCard } from "./readout_card.js";
import { observeElementSize } from "../element_size.js";
import { formatSeriesValue } from "../../../src/presentation_core/view_format.js";
import {
  chartMarkerClass,
  focusedColor,
  focusPatch,
  legendRowClass,
  type PaChartExtension,
  // 只取档位名（keyof typeof），留白数值本身归 chart_config 与 prepareOption
  type PLOT_PADDING,
  SERIES_Z,
  seriesZ,
  themedColor,
  type ViewChart,
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
    return { itemStyle: { opacity: visible ? 1 : 0 } };
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

/** 焦点下发：编译期的色恒为亮色原值，故补丁与首帧走同一道主题翻译再进 echarts。 */
export function applyFocus(
  instance: Pick<echarts.ECharts, "setOption"> | null,
  chart: ViewChart,
  dark: boolean,
  focused: number | null,
): void {
  if (!instance) return;
  const patch = focusPatch(chart, focused);
  instance.setOption(dark ? (applyDarkColors(patch) as typeof patch) : patch);
}

/**
 * 钉住期间指针停在被钉的那一格：交出 `triggerOn` 后鼠标不再驱动指针，再点名画一次。
 * 不这么做，卡片冻在原地而指针继续跟着鼠标走，画面上就有两个「当前在哪一格」。
 *
 * 饼图没有这一步要做：盘上没有随鼠标走的指针可冻（切片的悬停态在编译期就关着）。
 */
export function applyPin(
  instance: Pick<echarts.ECharts, "setOption" | "dispatchAction"> | null,
  chart: ViewChart,
  pinned: number | null,
): void {
  if (!instance || chart.form === "pie") return;
  if (pinned === null) {
    instance.setOption({ tooltip: { triggerOn: "mousemove|click" } });
    instance.dispatchAction({ type: "hideTip" });
    return;
  }
  instance.setOption({ tooltip: { triggerOn: "none" } });
  instance.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: pinned });
}

/** 读数卡与光标的距离；左置放不下才翻到右侧。 */
const READOUT_OFFSET = 24;
/** 卡片与场地四缘的最小留白：贴着缘印的卡读起来是被裁了一半的。 */
const READOUT_EDGE = 10;
/**
 * 进出同一道时长（ms）。它同时是过渡时长与卸载计时器的时长，两者差一点卡片就会在淡出中途
 * 被摘掉，故不写成 `duration-150` 类——那样这个数就有了两处拼写。
 */
const READOUT_FADE = 150;

/**
 * 卡片落点：默认在光标左侧、纵向随光标居中，边界恒是结果面这一块（含读数条）。
 * 夹在场地内而不是画布内——卡片本就该盖在图上，越出场地才叫跑出画面。
 */
export function readoutPosition(
  pointer: { x: number; y: number },
  card: { width: number; height: number },
  bounds: { width: number; height: number },
): { left: number; top: number } {
  const clamp = (value: number, room: number) =>
    Math.max(READOUT_EDGE, Math.min(value, Math.max(READOUT_EDGE, room - READOUT_EDGE)));
  const leftSide = pointer.x - READOUT_OFFSET - card.width;
  const left = leftSide >= READOUT_EDGE ? leftSide : pointer.x + READOUT_OFFSET;
  return {
    left: clamp(left, bounds.width - card.width),
    top: clamp(pointer.y - card.height / 2, bounds.height - card.height),
  };
}

/** 一次读数：读第几格，卡片落在哪。光标坐标与格序号分头供给，合成在此。 */
type Readout = { index: number; x: number; y: number };

/** 订阅得到的实例最小面：`on`/`off` 与那一个 zrender 手柄。 */
type ReadoutSource = {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off: (event: string, handler: (...args: unknown[]) => void) => void;
  getZr: () => {
    on: (event: string, handler: () => void) => void;
    off: (event: string, handler: () => void) => void;
  };
};

/**
 * 落在哪一格由 echarts 报：整列触发的图报 `updateAxisPointer`（与画出来的指针同源），
 * 饼图没有类目轴，改由逐项的进出事件报。光标坐标另由容器上的 mousemove 供给。
 *
 * 退订认订阅时拿到的那两个手柄：React 按声明序跑清理，建实例那道在前，轮到这里时实例
 * 已 dispose，`getZr()` 返回的是 null。
 */
export function subscribeReadout(
  instance: ReadoutSource | null,
  chart: Pick<ViewChart, "form">,
  onIndex: (index: number | null) => void,
): (() => void) | undefined {
  if (!instance) return;
  const report = (...args: unknown[]) => {
    const params = args[0] as { dataIndex?: number } | undefined;
    onIndex(typeof params?.dataIndex === "number" ? params.dataIndex : null);
  };
  const leave = () => onIndex(null);
  const zr = instance.getZr();
  if (chart.form === "pie") {
    instance.on("mouseover", report);
    instance.on("mouseout", leave);
  } else {
    instance.on("updateAxisPointer", report);
  }
  zr.on("globalout", leave);
  return () => {
    instance.off("mouseover", report);
    instance.off("mouseout", leave);
    instance.off("updateAxisPointer", report);
    zr.off("globalout", leave);
  };
}

/** 饼图读数条的占比列：切片值 / 总量，与卡内占比读同一份切片。 */
function piePercents(chart: ViewChart): (string | null)[] | null {
  if (chart.form !== "pie") return null;
  const total = pieTotal(chart.option);
  return pieData(chart.option).map((slice) =>
    slice.value === null || total <= 0 ? null : formatSeriesValue(slice.value / total, "percent"),
  );
}

function LegendRow({
  chart,
  dark,
  plot = "compact",
  focused,
  onFocus,
}: {
  chart: ViewChart;
  dark: boolean;
  plot?: keyof typeof PLOT_PADDING;
  /** 焦点归画布层：图例色点与画布系列是同一个状态的两个消费点 */
  focused: number | null;
  onFocus: (index: number | null) => void;
}) {
  const pa = chart.option.pa as PaChartExtension | undefined;
  const items = pa?.legend ?? [];
  const isPie = chart.form === "pie";
  if (isPie ? items.length === 0 : items.length < 2) return null;
  const percents = piePercents(chart);
  const withLatest = items.some((item) => item.latest != null);
  const latestLabel = pa?.legend_latest_label;

  const dotColor = (item: { color: string }, i: number) =>
    themedColor(focusedColor(item.color, i, focused), dark);
  return (
    <div className={legendRowClass(plot, withLatest)}>
      {/* 末桶名占满一行：值是那一桶的读数，不说是哪一桶就成了没有出处的数。
          桌面档 hidden 不占位，故这一行不影响既有版式。 */}
      {latestLabel && withLatest && (
        <p className="hidden text-xs text-pa-muted pointer-coarse:col-span-2 pointer-coarse:block">
          {latestLabel}
        </p>
      )}
      {/* 图例项是真按钮：它的作为就是把那条系列提到前面来，键盘聚焦与鼠标悬停同效 */}
      {items.map((item, i) => (
        <button
          className="flex min-w-0 items-start gap-1.5 rounded-sm border-0 bg-transparent p-0 text-left text-pa-muted text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pa-accent"
          key={`${item.name}-${i}`}
          onBlur={() => onFocus(null)}
          onFocus={() => onFocus(i)}
          onMouseEnter={() => onFocus(i)}
          onMouseLeave={() => onFocus(null)}
          type="button"
        >
          <span
            aria-hidden="true"
            className={chartMarkerClass()}
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
        </button>
      ))}
    </div>
  );
}

/**
 * 浮层的进与出走同一道时长：值在时淡入，值撤走后卡片再留 `duration` 淡出。
 * 不留这一手，钉住与移出都是瞬时消失，玻璃壳会像闪了一下。
 *
 * 进出只认「在不在」这一位，值本身走 ref——读数是随光标现造的对象，每渲染换一个身份。
 */
function useFloatingPresence<T>(
  value: T | null,
  duration: number,
): { held: T | null; open: boolean } {
  const present = value !== null;
  // 淡出的那一段值已经撤走，画面上却还得留着它读完最后 `duration`
  const last = useRef<T | null>(value);
  if (value !== null) last.current = value;
  const [lingering, setLingering] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (present) {
      setLingering(true);
      const frame = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(frame);
    }
    setOpen(false);
    const timer = setTimeout(() => setLingering(false), duration);
    return () => clearTimeout(timer);
  }, [present, duration]);
  return { held: present || lingering ? last.current : null, open };
}

function ReadoutLayer({
  chart,
  dark,
  readout,
  pinned,
  bounds,
  onClose,
  onFocus,
  onOpenPoint,
  canOpenPoint,
}: {
  chart: ViewChart;
  dark: boolean;
  readout: Readout | null;
  pinned: boolean;
  bounds: { width: number; height: number };
  onClose: () => void;
  onFocus: (series: number | null) => void;
  onOpenPoint?: (point: { row: number; column: string }) => void;
  canOpenPoint?: (point: { row: number; column: string }) => boolean;
}) {
  const card = useRef<HTMLDivElement>(null);
  const model: ReadoutModel | null = readout ? readoutModel(chart, readout.index) : null;
  const { held, open } = useFloatingPresence(
    model && readout ? { model, readout } : null,
    READOUT_FADE,
  );

  // 量过再落点：卡宽随行数成档，落点要按这一档的实际尺寸算，否则左置那一版恒偏。
  // 量出来的落点直接写回节点，不进状态：写状态就要再渲染一遍，而这遍渲染又得重新量。
  useLayoutEffect(() => {
    const node = card.current;
    if (!node || !held) return;
    const { left, top } = readoutPosition(
      held.readout,
      { width: node.offsetWidth, height: node.offsetHeight },
      bounds,
    );
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  });

  // 撤钉即把这张卡拿走的那份聚焦还回去：卡是整片撤下的，行上的 mouseleave 不再触发。
  useEffect(() => {
    if (!pinned) onFocus(null);
  }, [pinned, onFocus]);

  if (!held) return null;
  return (
    <div
      ref={card}
      className={`absolute z-10 transition-opacity motion-reduce:transition-none ${
        open ? "opacity-100" : "opacity-0"
      } ${pinned ? "" : "pointer-events-none"}`}
      style={{ transitionDuration: `${READOUT_FADE}ms` }}
    >
      <ReadoutCard
        model={held.model}
        dark={dark}
        pinned={pinned}
        onClose={onClose}
        onRowHover={onFocus}
        onRowClick={onOpenPoint}
        canOpenRow={canOpenPoint}
      />
    </div>
  );
}

export function ViewChartCanvas({
  chart,
  fill = false,
  plot = "compact",
  suspendResize = false,
  onPointClick,
  canOpenPoint,
}: {
  chart: ViewChart;
  /** 高度取容器而非 chart.height；需容器给定确定高度。 */
  fill?: boolean;
  /** plot 留白档位（`PLOT_PADDING` 的键）：编译期给的是 compact，整页宿主换到 page。 */
  plot?: keyof typeof PLOT_PADDING;
  /** 冻结尺寸响应（拖拽缩放期），解除时补渲一次。 */
  suspendResize?: boolean;
  /** 下钻：钉住读数卡后点卡内那一行开明细，画布本身不接管点击。 */
  onPointClick?: (point: { row: number; column: string }) => void;
  /** 该格能不能开明细：可点的样子由它决定，缺省即有投影就能开。 */
  canOpenPoint?: (point: { row: number; column: string }) => boolean;
}) {
  const block = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<echarts.ECharts | null>(null);
  const size = useRef({ width: 0, height: 0 });
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const dark = useDarkTheme();
  const [focused, setFocused] = useState<number | null>(null);
  // 格序号出自 echarts，光标坐标出自容器上的 mousemove：两个来源各存各的，合成才是一次读数
  const [index, setIndex] = useState<number | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [pinned, setPinned] = useState<Readout | null>(null);
  const hover: Readout | null = index === null ? null : { index, ...pointer };
  const readout = pinned ?? hover;
  // 钉住的卡片会留在原地等人，故按浮层那套撤下（策略与订阅见 dismiss.ts）
  useDismiss(pinned !== null, block, () => setPinned(null));

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

  // 换图即散场：新的一张图上，旧的焦点与旧的那一格都不再指向任何东西
  useEffect(() => {
    setFocused(null);
    setIndex(null);
    setPinned(null);
  }, [chart]);

  // 焦点与钉住都是打在首帧那份 option 上的补丁，故 option 每重出一次（换图、换主题、
  // 换留白档）都要照当前状态再打一遍——依赖里的 dark/plot 是「option 重出了」这件事的凭据
  useEffect(() => {
    applyFocus(instance.current, chart, dark, focused);
    raiseSeries(instance.current, chart, focused);
  }, [chart, dark, plot, focused]);

  useEffect(() => {
    applyPin(instance.current, chart, pinned?.index ?? null);
  }, [chart, dark, plot, pinned]);

  useEffect(() => subscribeReadout(instance.current, chart, setIndex), [chart]);

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

  // 卡片的边界是结果面这一块（含读数条），故尺寸取外层而非画布
  useEffect(() => {
    const el = block.current;
    if (!el) return;
    return observeElementSize(el, (next) => setBounds({ width: next.width, height: next.height }));
  }, []);

  const trackPointer = (event: { clientX: number; clientY: number }) => {
    // 钉住后落点不再随光标走，坐标也就不必再记：记了只是每动一下鼠标白渲染一遍
    if (pinned) return;
    const rect = block.current?.getBoundingClientRect();
    if (!rect) return;
    setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const rect = plotRect(chart, plot);

  if (chart.layout === "rank") {
    return (
      <div
        className={fill ? "relative h-full min-h-0 w-full" : "relative w-full"}
        style={fill ? undefined : { height: chart.height }}
      >
        <PlotSlab plot={plot} rect={rect}>
          <RankRows
            chart={chart}
            dark={dark}
            onPointClick={onPointClick}
            canOpenPoint={canOpenPoint}
          />
        </PlotSlab>
      </div>
    );
  }
  return (
    <div
      ref={block}
      className={`relative ${fill ? "flex h-full min-h-0 w-full flex-col" : "w-full"}`}
    >
      <LegendRow chart={chart} dark={dark} onFocus={setFocused} focused={focused} plot={plot} />

      <div
        className={`relative ${fill ? "min-h-0 w-full flex-1" : "w-full"}`}
        style={fill ? undefined : { height: chart.height }}
      >
        <PlotSlab plot={plot} rect={rect} />
        {/* 点一下钉住，再点一下撤下：钉住期间指针停着不走，落点也就无处可换 */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: 这一层是 echarts 的画布，图形不是控件；安上控件语义等于向读屏器报出一件它按不动的东西 */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: 悬停与钉住是鼠标增强，同一份结果在键盘上的读法是它的表形态与导出，不在这一层 */}
        <div
          className="absolute inset-0"
          onClick={() => setPinned(pinned ? null : hover)}
          onMouseLeave={() => setIndex(null)}
          onMouseMove={trackPointer}
          ref={container}
        />
      </div>
      <ReadoutLayer
        chart={chart}
        dark={dark}
        readout={readout}
        pinned={pinned !== null}
        bounds={bounds}
        onClose={() => setPinned(null)}
        onFocus={setFocused}
        onOpenPoint={onPointClick}
        canOpenPoint={canOpenPoint}
      />
    </div>
  );
}
