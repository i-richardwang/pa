/**
 * 指针落格 → 读数行：行只出自 `chart.model` 的图例单元，不碰 echarts option。
 * 卡内只做两步呈现算术（切片占比、对照差值），「谁减谁」由编译期写在 `legend[].baseline`。
 *
 * 差值恒带符号、恒中性色，与整窗读数的注脚同一套读法（见 view_format.formatSignedDelta）。
 */
import type { ChartModel, ViewChart } from "../../src/presentation_core/chart_config.js";
import { formatSeriesValue, formatSignedDelta } from "../../src/presentation_core/view_format.js";
import type { ColumnFormat } from "../../src/semantic_core/query_payload.js";
import { legendTotal } from "./chart_render.js";

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

/** 率作差得百分点，量作差仍是量——差值与被差的数不共用一个量纲。 */
function deltaFormat(format: ColumnFormat): ColumnFormat {
  return format === "percent" ? "percentage_point" : format;
}

function pointOf(model: ChartModel, unit: number, index: number) {
  const point = model.records?.points[unit]?.[index];
  return point ? { point } : {};
}

/** 切片占比（饼图图例与卡内同一份）：切片值 ÷ 总量；总量为零或切片缺值时无占比。 */
export function legendShares(model: ChartModel): (string | null)[] {
  const total = legendTotal(model);
  return model.legend.map((item) => {
    const value = item.values[0];
    return value == null || total <= 0 ? null : formatSeriesValue(value / total, "percent");
  });
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
    const against =
      item.baseline === undefined ? null : (model.legend[item.baseline]?.values[index] ?? null);
    return {
      series: i,
      color: item.color,
      name: item.name,
      value: value === null ? "—" : formatSeriesValue(value, item.format, item.decimals),
      ...(value !== null && against !== null
        ? {
            delta: formatSignedDelta(value - against, deltaFormat(item.format), item.decimals),
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
