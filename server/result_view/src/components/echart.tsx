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

/** 与 renderOption 交出的 `triggerOn` 成对：钉住后指针改由此处点名。 */
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
/** 卡片与场地四缘的最小留白（px）。 */
const READOUT_EDGE = 10;
/** 过渡时长与卸载计时器同取这一个数（ms）。 */
const READOUT_FADE = 150;

/** 落点边界是结果面这一块（含读数条），不是画布。 */
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
  scene,
  focused,
  onFocus,
}: {
  chart: ViewChart;
  dark: boolean;
  scene: ViewScene;
  /** 焦点归画布层：图例色点与画布系列是同一个状态的两个消费点 */
  focused: number | null;
  onFocus: (index: number | null) => void;
}) {
  const { legend: items, latest, pointer } = chart.model;
  // 切片图的图例是它唯一的名目，一片也列
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

/** 进出只认「在不在」这一位，值走 ref：读数是每渲染现造的对象。 */
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

  // 落点写回节点不进状态：进状态即再渲染、再量
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
  /** 宿主场景：场地留白与框按它查表；填充场景高度取容器而非 chart.height。 */
  scene: ViewScene;
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
    // 渲染器必须显式点名：注册表里只有 svg 那一支，init 的缺省值仍是 canvas
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

  // 边界取外层 block，不取画布
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
