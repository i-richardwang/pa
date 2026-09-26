/**
 * 把指针所在的数据点转成读数行。行只来自 `chart.model` 的图例项，不读 echarts option。
 * 占比和对照差值都由服务端计算，浏览器只负责格式化。
 */
import type { ChartModel, ViewChart } from "../../src/presentation_core/chart_config.js";
import { formatSeriesValue, formatSignedDelta } from "../../src/presentation_core/view_format.js";

export type ReadoutRow = {
  /** 该行对应的图例项序号（系列或扇区），悬停该行时据此聚焦；占比行没有对应图例项 */
  series?: number;
  color?: string;
  name: string;
  value: string;
  /** 次要读数（占比），显示在值的下方 */
  secondary?: string;
  /** 相对对照期的差值，与占比一起显示在值的下方 */
  delta?: string;
  /** 该行在原始结果中的单元格；钉住后点击该行查看明细，没有明细的行不可点击 */
  point?: { row: number; column: string };
};

export type ReadoutModel = { header: string; rows: ReadoutRow[] };

function pointOf(model: ChartModel, unit: number, index: number) {
  const point = model.records?.points[unit]?.[index];
  return point ? { point } : {};
}

export function legendShares(model: ChartModel): (string | null)[] {
  return model.legend.map((item) =>
    item.share == null ? null : formatSeriesValue(item.share, "percent"),
  );
}

/** 饼图的读数卡列出全部扇区，无论指针在哪个扇区上，内容都相同。 */
function sliceModel(model: ChartModel): ReadoutModel {
  const shares = legendShares(model);
  return {
    header: model.categories[0] ?? "",
    rows: model.legend.map((item, i) => {
      const value = item.values[0] ?? null;
      return {
        series: i,
        color: item.color,
        name: item.name,
        value: value === null ? "—" : formatSeriesValue(value, item.format, item.decimals),
        ...(shares[i] === null ? {} : { secondary: shares[i] as string }),
        ...pointOf(model, i, 0),
      };
    }),
  };
}

export function readoutModel(chart: ViewChart, index: number): ReadoutModel {
  const model = chart.model;
  if (model.pointer === "item") return sliceModel(model);

  const rows: ReadoutRow[] = model.legend.map((item, i) => {
    const value = item.values[index] ?? null;
    const comparison = item.comparison;
    const comparisonValue = comparison?.values[index] ?? null;
    return {
      series: i,
      color: item.color,
      name: item.name,
      value: value === null ? "—" : formatSeriesValue(value, item.format, item.decimals),
      ...(comparison && comparisonValue !== null
        ? {
            delta: formatSignedDelta(comparisonValue, comparison.format, comparison.decimals),
          }
        : {}),
      ...pointOf(model, i, index),
    };
  });

  const share = model.share?.values[index];
  if (model.share && share != null) {
    rows.push({ name: model.share.title, value: formatSeriesValue(share, "percent") });
  }
  return { header: model.categories[index] ?? "", rows };
}
