import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GraphicComponent,
  GridComponent,
  MarkPointComponent,
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
import { VIEW_SCENES, type ViewScene } from "../scene.js";
import { formatSeriesValue } from "../../../src/presentation_core/view_format.js";
import {
  chartMarkerClass,
  focusedColor,
  legendRowClass,
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
  TooltipComponent,
  SVGRenderer,
]);

/** 与 renderOption 设置的 `triggerOn` 配合：读数卡钉住后，由这里用 showTip 指定轴指针的位置。 */
export function applyPin(
  instance: Pick<echarts.ECharts, "dispatchAction"> | null,
  chart: Pick<ViewChart, "model">,
  pinned: number | null,
): void {
  if (!instance || chart.model.pointer !== "axis") return;
  if (pinned === null) instance.dispatchAction({ type: "hideTip" });
  else instance.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: pinned });
}

/** 读数卡与光标的距离（px）。 */
const READOUT_OFFSET = 24;
/** 读数卡与绘图区域边缘的最小间距（px）。 */
const READOUT_EDGE = 10;
/** 淡入淡出时长（ms），同时用作卸载延迟。 */
const READOUT_FADE = 150;

/** 定位边界是整个结果区域（含图例行），而非 echarts 画布。 */
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

type Readout = { index: number; x: number; y: number };

type ReadoutSource = {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off: (event: string, handler: (...args: unknown[]) => void) => void;
  getZr: () => {
    on: (event: string, handler: () => void) => void;
    off: (event: string, handler: () => void) => void;
  };
};

/**
 * 当前数据点由 echarts 事件给出：轴指针图用 `updateAxisPointer`，饼图等逐项指针图用 mouseover/mouseout。
 * 光标坐标另由容器的 mousemove 提供。
 *
 * 退订时使用订阅时拿到的 zr 引用：React 按声明顺序执行清理，创建实例的 effect 先清理，
 * 到这里时实例已 dispose，再调 `getZr()` 会得到 null。
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
  scene,
  focused,
  onFocus,
}: {
  chart: ViewChart;
  dark: boolean;
  scene: ViewScene;
  /** 聚焦状态由图表组件持有，图例色点和画布系列读同一个值。 */
  focused: number | null;
  onFocus: (index: number | null) => void;
}) {
  const { legend: items, latest, pointer } = chart.model;
  // 饼图只有图例标出各扇区名称，只有一项也显示
  if (pointer === "item" ? items.length === 0 : items.length < 2) return null;
  const shares = pointer === "item" ? legendShares(chart.model) : null;
  const latestOf = (index: number) => (latest ? items[index]?.values[latest.index] : undefined);

  const dotColor = (item: { color: string }, i: number) =>
    themedColor(focusedColor(item.color, i, focused), dark);
  return (
    <div className={legendRowClass(scene, latest !== undefined)}>
      {latest && (
        <p className="hidden text-xs text-pa-muted pointer-coarse:col-span-2 pointer-coarse:block">
          {latest.label}
        </p>
      )}
      {items.map((item, i) => (
        <button
          className="flex min-w-0 items-start gap-1.5 rounded-sm border-0 bg-transparent p-0 text-left text-pa-muted text-xs pa-focus"
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

/** 只按「有没有值」触发进出动画；值存在 ref 里，因为读数对象每次渲染都会新建。 */
function useFloatingPresence<T>(
  value: T | null,
  duration: number,
): { held: T | null; open: boolean } {
  const present = value !== null;
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

  // 位置直接写到 DOM 上，不放进 state，否则会触发重渲染和再次测量
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
  scene,
  onPointClick,
  canOpenPoint,
}: {
  chart: ViewChart;
  /** 宿主场景；fill 场景的高度取容器高度，而非 chart.height。 */
  scene: ViewScene;
  /** 查看明细：钉住读数卡后点击卡内的行触发，点击画布本身不触发。 */
  onPointClick?: (point: { row: number; column: string }) => void;
  /** 该数据点能否查看明细，决定是否显示为可点击；不传时有明细定义即可点击。 */
  canOpenPoint?: (point: { row: number; column: string }) => boolean;
}) {
  const block = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<echarts.ECharts | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const dark = useDarkTheme();
  const { fill } = VIEW_SCENES[scene];
  const [legendFocus, setLegendFocus] = useState<number | null>(null);
  const [cardFocus, setCardFocus] = useState<number | null>(null);
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
  useDismiss(pinned !== null, block, () => setPinned(null));

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    // 必须显式指定 svg：只注册了 SVGRenderer，但 init 的默认渲染器仍是 canvas
    const created = echarts.init(el, null, { renderer: "svg" });
    instance.current = created;
    return () => {
      instance.current = null;
      created.dispose();
    };
  }, []);

  useEffect(() => {
    setLegendFocus(null);
    setCardFocus(null);
    setIndex(null);
    setPinnedState(null);
  }, [chart]);

  const pinnedIndex = pinned?.index ?? null;
  useEffect(() => {
    const current = instance.current;
    if (!current) return;
    current.setOption(
      renderOption(chart, { dark, scene, viewport, focused, pinned: pinnedIndex }) as Parameters<
        echarts.ECharts["setOption"]
      >[0],
      { notMerge: true },
    );
    applyPin(current, chart, pinnedIndex);
  }, [chart, dark, scene, viewport, focused, pinnedIndex]);

  useEffect(() => subscribeReadout(instance.current, chart, setIndex), [chart]);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    return observeElementSize(el, (next) => {
      instance.current?.resize();
      setViewport({ width: next.width, height: next.height });
    });
  }, []);

  useEffect(() => {
    const el = block.current;
    if (!el) return;
    return observeElementSize(el, (next) => setBounds({ width: next.width, height: next.height }));
  }, []);

  const trackPointer = (event: { clientX: number; clientY: number }) => {
    if (pinned) return;
    const rect = block.current?.getBoundingClientRect();
    if (!rect) return;
    setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const rect = plotRect(chart, scene);

  if (chart.layout === "rank") {
    return (
      <div
        className={fill ? "relative h-full min-h-0 w-full" : "relative w-full"}
        style={fill ? undefined : { height: chart.height }}
      >
        <PlotSlab scene={scene} rect={rect}>
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
      <LegendRow
        chart={chart}
        dark={dark}
        onFocus={setLegendFocus}
        focused={focused}
        scene={scene}
      />

      <div
        className={`relative ${fill ? "min-h-0 w-full flex-1" : "w-full"}`}
        style={fill ? undefined : { height: chart.height }}
      >
        <PlotSlab scene={scene} rect={rect} />
        {/* biome-ignore lint/a11y/noStaticElementInteractions: 这一层是 echarts 画布，不是控件；加上控件语义会让读屏器报出一个无法操作的元素 */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: 悬停和钉住是鼠标的增强功能；键盘用户通过表格或导出读取同一份结果 */}
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
