/**
 * 渲染期的 option 派生：编译产物（`chart.option` + `chart.model`）× 此刻的渲染状态
 * （主题、宿主场景、视口尺寸、焦点、钉住）→ 可直接 `setOption` 的完整对象。
 *
 * 编译期不知道的事全在这里一次算完：宿主是哪一档留白、画布多宽（符号与标签密度、刻度档数）、
 * 谁在焦点、是否钉住；函数不可序列化，值轴刻度与值标签的格式化器也在此注入。
 * 它是一个纯函数：同样的输入恒得同样的 option。
 *
 * 暗色主题：option 恒为亮色原值，这里按 CHART_DARK_COLORS 映射递归替换字符串；
 * 单系列折线的面积渐变在翻色之后现拼——序列化只带得动纯色，而渐变必须用翻过的那个色去算。
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

/** 宿主经 applyDocumentTheme 落 data-theme；无宿主环境时随系统明暗。 */
export function isDarkTheme(): boolean {
  const theme = document.documentElement.dataset.theme;
  if (theme) return theme === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** 主题变化订阅：宿主翻 data-theme 或系统翻 prefers-color-scheme 都触发 */
export function watchTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}

/* ---------- 几何 ---------- */

export type Viewport = { width: number; height: number };

/**
 * 场地框相对画布四缘的退让（px）：场景留白 + 该形态自己那一栏框外轴标签。
 * echarts 的 grid 与 DOM 那层 plot 框读同一道算式——两处各算一次，框迟早圈错地方。
 * 值标签的框内余量（`plot_inset`）不在此列：它只缩数据区（见 `gridRect`），框不动。
 */
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

/** 数据区实际尺寸；依赖轴向空间的密度策略统一从这里取值。 */
export function plotSize(chart: ViewChart, scene: ViewScene, viewport: Viewport): Viewport {
  const rect = gridRect(chart, scene);
  return {
    width: Math.max(0, viewport.width - rect.left - rect.right),
    height: Math.max(0, viewport.height - rect.top - rect.bottom),
  };
}

/* ---------- 密度 ---------- */

/** 折线圆点：每点摊不到 12px 就只在指针命中时现出那一颗（`showSymbol` 的原生语义）。 */
const SYMBOL_SPACING = 12;

/**
 * 值标签密度：空间不足时按步距挑桶印数、恒印末点。
 * 折线：每点摊到 37.33px 以上才逐点印，否则步距 = ceil(50 / 每点宽)；
 * 柱：步距 = ceil((最宽底片 + 4) / 每列宽)（放得下即逐列印，无独立阈值）。
 * 横排条一行一格不会横向挤，不在此列（类目不在 x 轴）。
 */
const VALUE_LABEL_SPACING = 37.33;
const LINE_LABEL_BUDGET = 50;
const BAR_LABEL_GAP = 4;

/** 值轴档数随绘图区尺度走：每 80px 一档，夹在 2–10。 */
const TICK_SPACING = 80;

function labelStep(kind: unknown, per: number, widest: number): number {
  if (kind === "line") {
    return per <= VALUE_LABEL_SPACING ? Math.max(1, Math.ceil(LINE_LABEL_BUDGET / per)) : 1;
  }
  return Math.max(1, Math.ceil((widest + BAR_LABEL_GAP) / per));
}

/**
 * 值标签格式化器：与读数卡同一套格式（率带单位、位数随列声明），否则 0–1 标度的率会以
 * 小数印在图上。配了标签形制就装，不看此刻印不印——焦点会现出档位没选中的那条。
 * 步距 > 1 时只印整步与末点。
 */
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

/* ---------- 注入 ---------- */

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

/** 饼图切片总量：呈现算术（与切片占比同级），环心总计与占比读同一份。 */
export function legendTotal(model: ChartModel): number {
  return model.legend.reduce((sum, item) => sum + (item.values[0] ?? 0), 0);
}

/** 环心总计：值为主、总计标签为次，居中常驻。 */
function injectPieCenterTotal(option: MutableOption, model: ChartModel, dark: boolean): void {
  const lead = model.legend[0];
  if (!lead) return;
  // 主次靠这两档的深浅差说话：值取 `valueText`（数据注释那一档），标签退到 `axisText`
  // （轴刻度那一档）。反过来接的后果是环心正中那个数比它自己的标签还淡——一张图里
  // 最该被读到的数，读起来像个注脚。
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
        text: `{v|${formatSeriesValue(legendTotal(model), lead.format, lead.decimals)}}\n{l|总计}`,
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

/** `#rrggbb` → 带 alpha 的 rgba；非六位十六进制（用户自定义色可能是任意写法）返回 null */
function withAlpha(color: string, alpha: number): string | null {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!hex) return null;
  const [r, g, b] = hex.slice(1).map((part) => Number.parseInt(part, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 单系列折线的面积：系列色自顶 5% 淡出，到 70% 高度收尽。
 *
 * 编译端只落一个纯色（暗色翻转按字面值查表，渐变对象里的 rgba 查不到），渐变在这里拼——
 * 此时色已经翻转过。收尽点定在 70% 而非底：铺到轴上就成了一块实色，把网格线与零基线读没了，
 * 面积要给的只是「量的体感」，不是第二个图层。
 */
function injectAreaGradient(option: MutableOption): void {
  for (const series of asArray(option.series)) {
    const area = series.areaStyle as MutableOption | undefined;
    if (!area || typeof area.color !== "string") continue;
    const top = withAlpha(area.color, 0.05);
    const bottom = withAlpha(area.color, 0);
    if (!top || !bottom) {
      // 自定义色解析不了就退成同效果的平涂，宁可淡一点也不留一块不透明的实色
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

/** 亮色 → 暗色：递归替换 option 里的已知颜色字符串。 */
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

/* ---------- 派生 ---------- */

export type RenderState = {
  dark: boolean;
  scene: ViewScene;
  viewport: Viewport;
  /** 在焦点的图例单元（系列或切片） */
  focused: number | null;
  /** 钉住的那一格；钉住期间指针不再跟随鼠标 */
  pinned: number | null;
};

/**
 * 焦点落到 option 上：样式段与层序按单元重出（`focusPatch` 出的就是按序号对位的那几项），
 * 饼图换的是整份调色板。在翻色之前做——焦点色与本色同是亮色原值。
 */
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
  // 系统开了减动效时整体关闭；option 本身的动画契约只留交互态那一点过渡
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
    option.animation = false;
  }
  const themed = (state.dark ? applyDarkColors(option) : option) as MutableOption;
  injectAxisFormatters(themed, model);
  injectAreaGradient(themed);
  if (chart.form === "pie") injectPieCenterTotal(themed, model, state.dark);
  return themed;
}
