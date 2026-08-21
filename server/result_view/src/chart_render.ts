/**
 * 图表配置的渲染端补全：option 由 chart_config.ts 在完整行上生成（服务端查询管线，
 * 或编辑器草稿预览在浏览器直调同一份实现），函数不可序列化，
 * 故数值轴刻度与值标签的格式化在这里按 option.pa 扩展块注入。
 *
 * 读数卡不在此列：它是与菜单同层的浮层件（`readout_card.tsx`），要印的行出自 `readout.ts`。
 * 饼图另注入环心总计；单系列折线的面积渐变也在这里现拼——序列化只带得动纯色，
 * 而渐变必须用**已按主题翻转过的**那个色去算。
 * 暗色主题：option 恒为亮色原值，这里按 CHART_DARK_COLORS 映射递归替换字符串
 * （系列色与中性色均可按映射适配暗色）。
 */
import {
  CHART_CHROME,
  CHART_DARK_COLORS,
  FONT_FAMILY,
  PLOT_PADDING,
  valueLabelPillWidth,
  type PaChartExtension,
  type ViewChart,
} from "../../src/presentation_core/chart_config.js";
import { asArray, type MutableOption, pieData, pieTotal } from "./chart_option.js";
import { formatSeriesValue, formatTick } from "../../src/presentation_core/view_format.js";
import type { ColumnFormat } from "../../src/semantic_core/query_payload.js";

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

/** 值轴刻度：与读数卡同源的格式与位数，率轴按百分比/百分点标单位。 */
function injectAxisFormatters(option: MutableOption, pa: PaChartExtension): void {
  const inject = (
    axes: MutableOption[],
    formats: (ColumnFormat | null)[] | undefined,
    decimals: (number | null)[] | undefined,
  ) => {
    if (!formats) return;
    axes.forEach((axis, index) => {
      const format = formats[index];
      if (!format || axis.type !== "value") return;
      const label = (axis.axisLabel ?? {}) as MutableOption;
      const digits = decimals?.[index] ?? undefined;
      axis.axisLabel = {
        ...label,
        formatter: (value: number) => formatTick(value, format, digits),
      };
    });
  };
  inject(asArray(option.xAxis), pa.axes.x, pa.axis_decimals?.x);
  inject(asArray(option.yAxis), pa.axes.y, pa.axis_decimals?.y);
}

/** 值标签：与读数卡同一套格式（率带单位、位数随列声明），否则 0–1 标度的率会以小数印在图上。 */
function injectValueLabelFormatters(option: MutableOption, pa: PaChartExtension): void {
  asArray(option.series).forEach((series) => {
    const label = series.label as MutableOption | undefined;
    // 配了标签形制就装格式化器，不看此刻印不印：焦点会现出档位没选中的那条，
    // 缺格式化器它就按 echarts 的原样印，率会以 0–1 的小数落在图上
    if (!label) return;
    const name = String(series.name ?? "");
    const format: ColumnFormat = pa.series[name] ?? "number";
    const decimals = pa.decimals?.[name];
    series.label = {
      ...label,
      formatter: (params: { value?: unknown }) => {
        const value = Array.isArray(params.value) ? params.value.at(-1) : params.value;
        return typeof value === "number" ? formatSeriesValue(value, format, decimals) : "";
      },
    };
  });
}

/**
 * 值标签密度守卫：空间不足时按步距挑桶印数、恒印末点。
 * 折线：每点摊到 37.33px 以上才逐点印，否则步距 = ceil(50 / 每点宽)；
 * 柱：步距 = ceil((最宽底片 + 4) / 每列宽)（放得下即逐列印，无独立阈值）。
 * 宽度到渲染时才知道，故与符号密度一样在实例上按尺寸补丁，而非编译期定死。
 * 横排条一行一格不会横向挤，不在此列。
 */
const VALUE_LABEL_SPACING = 37.33;
const LINE_LABEL_BUDGET = 50;
const BAR_LABEL_GAP = 4;

export function applyValueLabelDensity(
  instance: { setOption: (option: unknown) => void },
  chart: ViewChart,
  width: number,
): void {
  const series = chart.option.series;
  if (!Array.isArray(series) || width <= 0) return;
  const xAxis = Array.isArray(chart.option.xAxis) ? chart.option.xAxis[0] : chart.option.xAxis;
  if ((xAxis as { type?: string } | undefined)?.type !== "category") return;
  const pa = chart.option.pa as PaChartExtension | undefined;
  let touched = false;
  const patch = series.map((s) => {
    const record = s as Record<string, unknown>;
    const label = record.label as Record<string, unknown> | undefined;
    const kind = record.type;
    // 按「配了标签形制」认领而非按此刻是否印：焦点能现出档位没选中的那条，格式化器得先在
    if ((kind !== "line" && kind !== "bar") || !label || !Array.isArray(record.data)) return {};
    touched = true;
    const count = (record.data as unknown[]).length;
    const per = count > 0 ? width / count : width;
    const name = String(record.name ?? "");
    const format: ColumnFormat = pa?.series[name] ?? "number";
    const decimals = pa?.decimals?.[name];
    const widest = (record.data as unknown[]).reduce<number>(
      (max, value) =>
        typeof value === "number"
          ? Math.max(max, valueLabelPillWidth(formatSeriesValue(value, format, decimals)))
          : max,
      0,
    );
    const step =
      kind === "line"
        ? per <= VALUE_LABEL_SPACING
          ? Math.max(1, Math.ceil(LINE_LABEL_BUDGET / per))
          : 1
        : Math.max(1, Math.ceil((widest + BAR_LABEL_GAP) / per));
    return {
      label: {
        formatter: (params: { value?: unknown; dataIndex?: number }) => {
          const index = params.dataIndex ?? 0;
          if (step > 1 && index !== count - 1 && index % step !== 0) return "";
          const value = Array.isArray(params.value) ? params.value.at(-1) : params.value;
          return typeof value === "number" ? formatSeriesValue(value, format, decimals) : "";
        },
      },
    };
  });
  if (touched) instance.setOption({ series: patch });
}

/** 环心总计：值为主、总计标签为次，居中常驻。 */
function injectPieCenterTotal(option: MutableOption, pa: PaChartExtension, dark: boolean): void {
  const total = pieTotal(option);
  if (pieData(option).length === 0) return;
  const format: ColumnFormat = Object.values(pa.series)[0] ?? "number";
  const decimals = Object.values(pa.decimals ?? {})[0];
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
        text: `{v|${formatSeriesValue(total, format, decimals)}}\n{l|总计}`,
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

/** 亮色 → 暗色：递归替换 option 里的已知颜色字符串。交互期的增量补丁走同一道翻译。 */
export function applyDarkColors(value: unknown): unknown {
  if (typeof value === "string") return CHART_DARK_COLORS[value.toLowerCase()] ?? value;
  if (Array.isArray(value)) return value.map(applyDarkColors);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as MutableOption).map(([k, v]) => [k, applyDarkColors(v)]),
    );
  }
  return value;
}

/**
 * 场地框相对画布四缘的退让（px）：场景留白 + 该形态自己那一栏框外轴标签。
 * echarts 的 grid 与 DOM 那层 plot 框读同一道算式——两处各算一次，框迟早圈错地方。
 * 值标签的框内余量（`plot_inset`）不在此列：它只缩数据区（见 `gridRect`），框不动。
 */
export function plotRect(
  chart: ViewChart,
  plot: keyof typeof PLOT_PADDING,
): { left: number; right: number; top: number; bottom: number } {
  const pad = PLOT_PADDING[plot];
  return { ...pad, left: pad.left + (chart.plot_gutter?.left ?? 0) };
}

/** 数据区 = 场地框 + 框内标签余量：框不因标签开关移动，余量只缩数据区。 */
export function gridRect(
  chart: ViewChart,
  plot: keyof typeof PLOT_PADDING,
): { left: number; right: number; top: number; bottom: number } {
  const rect = plotRect(chart, plot);
  const inset = chart.plot_inset ?? {};
  return { ...rect, top: rect.top + (inset.top ?? 0), right: rect.right + (inset.right ?? 0) };
}

/** 数据区实际宽度；依赖横轴空间的密度策略统一从这里取值。 */
export function plotWidth(
  chart: ViewChart,
  plot: keyof typeof PLOT_PADDING,
  canvasWidth: number,
): number {
  const rect = gridRect(chart, plot);
  return Math.max(0, canvasWidth - rect.left - rect.right);
}

/** 渲染前补全：克隆 option、注入格式化函数与环心总计、按主题翻色；返回可直接 setOption 的对象 */
export function prepareOption(
  chart: ViewChart,
  dark: boolean,
  layout?: { plot?: keyof typeof PLOT_PADDING },
): MutableOption {
  const base = dark
    ? (applyDarkColors(chart.option) as MutableOption)
    : (structuredClone(chart.option) as MutableOption);
  // 动画契约：option 保留静态形状，仅允许交互态透明度过渡。
  // 形状不做动画、只保留悬停态的透明度过渡（否则明暗瞬时跳变成闪烁）。
  // 系统开了减动效时在渲染端整体关闭。
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
    base.animation = false;
  }
  // 编译期只知道 compact 那一档（宿主身份那时还不存在）；宿主要换档就**按名取表**，
  // 不在这里另写数字——否则 grid() 与本处各持一份留白，改哪边都只改对一半。

  if (layout?.plot && base.grid) {
    const rect = gridRect(chart, layout.plot);
    for (const g of asArray(base.grid)) Object.assign(g, rect);
  }
  const pa = base.pa as PaChartExtension | undefined;
  delete base.pa;
  if (!pa) return base;
  injectAxisFormatters(base, pa);
  injectValueLabelFormatters(base, pa);
  injectAreaGradient(base);
  if (chart.form === "pie") injectPieCenterTotal(base, pa, dark);
  return base;
}
