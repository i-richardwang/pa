/**
 * 指针落格 → 读数行：行只出自 `chart.model` 的图例单元，不碰 echarts option。
 * 占比与对照变化均由服务端编译；浏览器只格式化和渲染。
 */
import type { ChartModel, ViewChart } from "../../src/presentation_core/chart_config.js";
import { formatSeriesValue, formatSignedDelta } from "../../src/presentation_core/view_format.js";

export type ReadoutRow = {
  /** 该行对应的图例单元序号（系列或切片）：行悬停据此驱动聚焦；占比注释那一行没有单元 */
  series?: number;
  color?: string;
  name: string;
  value: string;
  /** 随行的次要读数（占比），落在值下方那一行 */
  secondary?: string;
  /** 相对对照单元的差值（同期叠加），与占比同占次要那一行 */
  delta?: string;
  /** 该行在原始结果里的格：钉住后点行即下钻；无投影的行不可点 */
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

/** 饼图一张卡列全部切片：没有「落在哪一格」的区分，指到哪一片都是同一张结构表。 */
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
