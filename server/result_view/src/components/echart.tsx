import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GraphicComponent,
  GridComponent,
  MarkPointComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { plotRect, renderOption, type Viewport } from "../chart_render.js";
import { useDismiss } from "../dismiss.js";
import { legendShares, readoutModel, type ReadoutModel } from "../readout.js";
import { useDarkTheme } from "../use_dark_theme.js";
import { PlotSlab } from "./plot_slab.js";
import { RankRows } from "./rank_rows.js";
import { ReadoutCard } from "./readout_card.js";
import { observeElementSize } from "../element_size.js";
import { formatSeriesValue } from "../../../src/presentation_core/view_format.js";
import {
  chartMarkerClass,
  focusedColor,
  legendRowClass,
  type PLOT_PADDING,
  themedColor,
  type ViewChart,
} from "../../../src/presentation_core/chart_config.js";
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GraphicComponent,
  GridComponent,
  MarkPointComponent,
  TitleComponent,
  TooltipComponent,
  SVGRenderer,
]);

/**
 * 钉住期间指针停在被钉的那一格：option 里已交出 `triggerOn`，鼠标不再驱动指针，这里再点名
 * 画一次。不这么做，卡片冻在原地而指针继续跟着鼠标走，画面上就有两个「当前在哪一格」。
 * 饼图盘上没有随鼠标走的指针可冻。
 */
export function applyPin(
  instance: Pick<echarts.ECharts, "dispatchAction"> | null,
  chart: Pick<ViewChart, "model">,
  pinned: number | null,
): void {
  if (!instance || chart.model.pointer !== "axis") return;
  if (pinned === null) instance.dispatchAction({ type: "hideTip" });
  else instance.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: pinned });
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
 * 落在哪一格由 echarts 报：整列指针的图报 `updateAxisPointer`（与画出来的指针同源），
 * 逐项指针的图（饼图没有类目轴）由逐项的进出事件报。光标坐标另由容器上的 mousemove 供给。
 *
 * 退订认订阅时拿到的那两个手柄：React 按声明序跑清理，建实例那道在前，轮到这里时实例
 * 已 dispose，`getZr()` 返回的是 null。
 */
export function subscribeReadout(
  instance: ReadoutSource | null,
  chart: Pick<ViewChart, "model">,
  onIndex: (index: number | null) => void,
): (() => void) | undefined {
  if (!instance) return;
  const report = (...args: unknown[]) => {
    const params = args[0] as { dataIndex?: number } | undefined;
    onIndex(typeof params?.dataIndex === "number" ? params.dataIndex : null);
  };
  const leave = () => onIndex(null);
  const zr = instance.getZr();
  if (chart.model.pointer === "item") {
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
  const { legend: items, latest, pointer } = chart.model;
  // 切片图哪怕一片也列出（图例是它唯一的名目），系列图单系列不必再说一遍名字
  if (pointer === "item" ? items.length === 0 : items.length < 2) return null;
  const shares = pointer === "item" ? legendShares(chart.model) : null;
  const latestOf = (index: number) => (latest ? items[index]?.values[latest.index] : undefined);

  const dotColor = (item: { color: string }, i: number) =>
    themedColor(focusedColor(item.color, i, focused), dark);
  return (
    <div className={legendRowClass(plot, latest !== undefined)}>
      {/* 末桶名占满一行：值是那一桶的读数，不说是哪一桶就成了没有出处的数。
          桌面档 hidden 不占位，故这一行不影响既有版式。 */}
      {latest && (
        <p className="hidden text-xs text-pa-muted pointer-coarse:col-span-2 pointer-coarse:block">
          {latest.label}
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
            {latestOf(i) != null && (
              <span className="hidden truncate font-medium text-base text-pa-fg tabular-nums pointer-coarse:block">
                {formatSeriesValue(latestOf(i) as number, item.format, item.decimals)}
              </span>
            )}
          </span>
          {shares?.[i] != null && (
            <span className="font-normal text-pa-faint tabular-nums">{shares[i]}</span>
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
  onPointClick,
  canOpenPoint,
}: {
  chart: ViewChart;
  /** 高度取容器而非 chart.height；需容器给定确定高度。 */
  fill?: boolean;
  /** plot 留白档位（`PLOT_PADDING` 的键）：编译期不知道宿主是哪一档，整页宿主换到 page。 */
  plot?: keyof typeof PLOT_PADDING;
  /** 下钻：钉住读数卡后点卡内那一行开明细，画布本身不接管点击。 */
  onPointClick?: (point: { row: number; column: string }) => void;
  /** 该格能不能开明细：可点的样子由它决定，缺省即有投影就能开。 */
  canOpenPoint?: (point: { row: number; column: string }) => boolean;
}) {
  const block = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<echarts.ECharts | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const dark = useDarkTheme();
  // 焦点有两个来源、各持各的：图例上的悬停/键盘焦点，钉住卡片上的行悬停。
  // 谁说了算由「卡有没有钉住」定——钉住期间卡在台前，图例的那份退到幕后；撤钉即换回来。
  const [legendFocus, setLegendFocus] = useState<number | null>(null);
  const [cardFocus, setCardFocus] = useState<number | null>(null);
  // 格序号出自 echarts，光标坐标出自容器上的 mousemove：两个来源各存各的，合成才是一次读数
  const [index, setIndex] = useState<number | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [pinned, setPinnedState] = useState<Readout | null>(null);
  const setPinned = (next: Readout | null) => {
    setCardFocus(null);
    setPinnedState(next);
  };
  const focused = pinned ? cardFocus : legendFocus;
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

  // 换图即散场：新的一张图上，旧的焦点与旧的那一格都不再指向任何东西
  useEffect(() => {
    setLegendFocus(null);
    setCardFocus(null);
    setIndex(null);
    setPinnedState(null);
  }, [chart]);

  // 画面 = 一次派生：编译产物 × 此刻状态，整份重出（`notMerge`）
  const pinnedIndex = pinned?.index ?? null;
  useEffect(() => {
    const current = instance.current;
    if (!current) return;
    current.setOption(
      renderOption(chart, { dark, plot, viewport, focused, pinned: pinnedIndex }) as Parameters<
        echarts.ECharts["setOption"]
      >[0],
      { notMerge: true },
    );
    applyPin(current, chart, pinnedIndex);
  }, [chart, dark, plot, viewport, focused, pinnedIndex]);

  useEffect(() => subscribeReadout(instance.current, chart, setIndex), [chart]);

  // 尺寸进状态：它与主题、焦点同是画面的输入，换了就重派生一次
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    return observeElementSize(el, (next) => {
      instance.current?.resize();
      setViewport({ width: next.width, height: next.height });
    });
  }, []);

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
      <LegendRow chart={chart} dark={dark} onFocus={setLegendFocus} focused={focused} plot={plot} />

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
        onFocus={setCardFocus}
        onOpenPoint={onPointClick}
        canOpenPoint={canOpenPoint}
      />
    </div>
  );
}
