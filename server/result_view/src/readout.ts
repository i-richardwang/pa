/**
 * 读数模型：把「指针落在第几格」翻成读数卡要印的那几行。
 *
 * 卡片本体是 DOM 件（`readout_card.tsx`），本模块只出数据——取值、格式、对照差值与下钻
 * 投影都在这里定，卡片不碰 option。一格出几行的判据见 `docs/ui_spec.md`；饼图那一张的
 * 行序与图例同序。
 *
 * 卡内只有两处呈现算术：切片占比（切片值 ÷ 总量）与对照差值（本期 − 对照期）。两者都是
 * 画面上已有的两个数之间的一步，不回头找明细，也不改口径；「谁减谁」由编译期在
 * `pa.legend[].baseline` 上立好，此处不猜哪条是主期。
 *
 * 差值恒中性、恒带符号，与整窗读数的注脚同一套读法：模型层没有指标方向声明，涨跌染色会把
 * 流失类指标读反。
 */
import {
  SERIES_COLORS,
  type PaChartExtension,
  type ViewChart,
} from "../../src/presentation_core/chart_config.js";
import { formatSeriesValue, formatSignedDelta } from "../../src/presentation_core/view_format.js";
import type { ColumnFormat } from "../../src/semantic_core/query_payload.js";
import { asArray, type MutableOption, pieData, pieTotal } from "./chart_option.js";

export type ReadoutRow = {
  /** 该行对应的系列序号（饼图为切片序号）：行悬停据此驱动聚焦；占比注释那一行没有系列 */
  series?: number;
  color?: string;
  name: string;
  value: string;
  /** 随行的次要读数（占比），落在值下方那一行 */
  secondary?: string;
  /** 相对对照系列的差值（同期叠加），与占比同占次要那一行 */
  delta?: string;
  /** 该行在原始结果里的格：钉住后点行即下钻；无投影的行不可点 */
  point?: { row: number; column: string };
};

export type ReadoutModel = { header: string; rows: ReadoutRow[] };

function seriesColorAt(pa: PaChartExtension, index: number): string {
  return pa.legend?.[index]?.color ?? SERIES_COLORS[index % SERIES_COLORS.length];
}

/** 类目名恒取自类目轴：横排条的类目在左轴，其余在横轴。 */
function categoryAt(option: MutableOption, index: number): string {
  for (const axis of [...asArray(option.xAxis), ...asArray(option.yAxis)]) {
    if (axis.type !== "category" || !Array.isArray(axis.data)) continue;
    return String((axis.data as unknown[])[index] ?? "");
  }
  return "";
}

function valueAt(series: MutableOption | undefined, index: number): number | null {
  const raw = Array.isArray(series?.data) ? (series.data as unknown[])[index] : null;
  return typeof raw === "number" ? raw : null;
}

/** 率作差得百分点，量作差仍是量——差值与被差的数不共用一个量纲。 */
function deltaFormat(format: ColumnFormat): ColumnFormat {
  return format === "percent" ? "percentage_point" : format;
}

function pieModel(chart: ViewChart, pa: PaChartExtension): ReadoutModel {
  const data = pieData(chart.option);
  const total = pieTotal(chart.option);
  const format: ColumnFormat = Object.values(pa.series)[0] ?? "number";
  const decimals = Object.values(pa.decimals ?? {})[0];
  return {
    header: Object.keys(pa.series)[0] ?? "",
    rows: data.map((slice, index) => ({
      series: index,
      color: seriesColorAt(pa, index),
      name: slice.name,
      value: slice.value === null ? "—" : formatSeriesValue(slice.value, format, decimals),
      ...(slice.value === null || total <= 0
        ? {}
        : { secondary: formatSeriesValue(slice.value / total, "percent") }),
      ...pointOf(pa, 0, index),
    })),
  };
}

function pointOf(pa: PaChartExtension, series: number, index: number) {
  const point = pa.records?.points[series]?.[index];
  return point ? { point } : {};
}

export function readoutModel(chart: ViewChart, index: number): ReadoutModel | null {
  const pa = chart.option.pa as PaChartExtension | undefined;
  if (!pa) return null;
  if (chart.form === "pie") return pieModel(chart, pa);

  // 只取真系列：折线的垫层追加在它们之后，是同一条线的第二遍描边，不是第二个读数
  const series = asArray(chart.option.series).slice(0, pa.legend?.length ?? 0);
  const rows: ReadoutRow[] = series.map((s, i) => {
    const name = String(s.name ?? "");
    const format: ColumnFormat = pa.series[name] ?? "number";
    const decimals = pa.decimals?.[name];
    const value = valueAt(s, index);
    const baseline = pa.legend?.[i]?.baseline;
    const against = baseline === undefined ? null : valueAt(series[baseline], index);
    return {
      series: i,
      color: seriesColorAt(pa, i),
      name,
      value: value === null ? "—" : formatSeriesValue(value, format, decimals),
      ...(value !== null && against !== null
        ? { delta: formatSignedDelta(value - against, deltaFormat(format), decimals) }
        : {}),
      ...pointOf(pa, i, index),
    };
  });

  const header = categoryAt(chart.option, index);
  const share = pa.share?.values[header];
  if (pa.share && share !== null && share !== undefined) {
    rows.push({ name: pa.share.title, value: formatSeriesValue(share, "percent") });
  }
  return { header, rows };
}
