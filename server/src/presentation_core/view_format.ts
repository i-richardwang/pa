/**
 * 结果列的语义与格式化：呈现层（服务端图表配置生成、预览卡片、重放页）共用的唯一落点。
 * 列格式以载荷 column_formats 为准（percent / percentage_point 原始值恒为 0–1 标度），
 * 缺省即普通数值/文本；时间列只认 year / month 两个成员名。
 * 本文件只做展示格式化（缩放到显示单位、千分位、排序比较），不做任何度量算术。
 *
 * 小数位：全站默认一位；模型成员可用 meta.decimals 按列改（载荷 column_decimals），
 * 例如调研结果整站按整数百分比报。产品不提供逐指标的位数设置，只采用一套全局策略，
 * 这里的默认位数就是那套策略；声明位数是给「口径本身如此」的指标留的，不是给读者调的。
 */
import { memberShortName } from "../semantic_core/member_name.js";
import type { ColumnFormat } from "../semantic_core/query_payload.js";

const TIME_KEYS = new Set(["year", "month"]);

export function columnFormat(column: string, formats?: Record<string, ColumnFormat>): ColumnFormat {
  return formats?.[column] ?? "number";
}

export const DEFAULT_DECIMALS = 1;

export function columnDecimals(column: string, decimals?: Record<string, number>): number {
  return decimals?.[column] ?? DEFAULT_DECIMALS;
}

/** 率族格式（percent / percentage_point，0–1 标度）：作差得百分点；量作相对变化率。 */
export function isRateFormat(format: ColumnFormat | undefined): boolean {
  return (format ?? "number") !== "number";
}

export function isRateColumn(column: string, formats?: Record<string, ColumnFormat>): boolean {
  return isRateFormat(formats?.[column]);
}

export function isTimeColumn(column: string): boolean {
  return TIME_KEYS.has(memberShortName(column));
}

export function toNumber(value: string | number | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") return value;
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 维度取值的显示名。**空只出占位符，不编词**：随手填一个「未知」会和真叫这个名字的取值
 * 撞在一起，读者从此分不出哪个是数据说的。
 *
 * 空、空串与纯空白同归一处——它们在数据里的差别构不成两个类别，而分开会让同一批行在图例里
 * 裂成两项。轴与图例都从这里取名，故它同时是**分组键**：任何一处绕过它，同一批行就会
 * 一边按 `""` 归组、一边按 `—` 查表，查不到。
 *
 * 明细表体不走这里：格子空着读得出来（见 `data_table`），图例项空着就成了没有名字的东西。
 */
export function isBlankCell(value: string | number | null | undefined): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

export function cellLabel(value: string | number | null | undefined): string {
  return isBlankCell(value) ? "—" : String(value);
}

export function formatCell(
  value: string | number | null,
  column: string,
  format?: ColumnFormat,
  decimals: number = DEFAULT_DECIMALS,
): string {
  if (value === null) return "—";
  if (isTimeColumn(column)) return String(value);
  const n = toNumber(value);
  if (n === null) return String(value);
  if (format === "percent") return `${(n * 100).toFixed(decimals)}%`;
  if (format === "percentage_point") return `${(n * 100).toFixed(decimals)} pp`;
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

/**
 * 带符号的差值读法：增长显式带 +，下降天然带 −，量纲与小数位沿用 formatCell。
 * 符号只陈述方向，不判断好坏——模型层没有指标方向声明，涨跌染色会把流失类指标读反。
 */
export function formatSignedDelta(
  value: number | null,
  format: ColumnFormat,
  decimals: number = DEFAULT_DECIMALS,
): string {
  if (value === null) return "—";
  const text = formatCell(value, "", format, decimals);
  return value > 0 ? `+${text}` : text;
}

const compact = new Intl.NumberFormat("zh-CN", { notation: "compact" });

/** 轴刻度：百分比与百分点分别标单位，普通数值用紧凑计数（1.5万）。 */
export function formatTick(
  value: number,
  format: ColumnFormat,
  decimals: number = DEFAULT_DECIMALS,
): string {
  if (format === "percent") return `${Number((value * 100).toFixed(decimals))}%`;
  if (format === "percentage_point") return `${Number((value * 100).toFixed(decimals))} pp`;
  return compact.format(value);
}

/** tooltip / 图例 / 值标签数值：率带单位、定位小数，普通数值用千分位。 */
export function formatSeriesValue(
  value: unknown,
  format: ColumnFormat,
  decimals: number = DEFAULT_DECIMALS,
): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (format === "percent") return `${(n * 100).toFixed(decimals)}%`;
  if (format === "percentage_point") return `${(n * 100).toFixed(decimals)} pp`;
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

/** 排序比较：数值列按数值，其余按 locale 字符串 */
export function compareCells(a: string | number | null, b: string | number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) return na - nb;
  return String(a).localeCompare(String(b), "zh-CN");
}
