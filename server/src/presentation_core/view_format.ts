import type { BusinessTime } from "../semantic_core/time_contract.js";
/**
 * 结果列的格式化，服务端图表配置、预览卡片和重放页共用。
 * 列格式取载荷 column_formats，未声明时按普通数值或文本处理；percent / percentage_point 的原始值是 0–1 比例。
 * 时间列按成员名 year / month 识别。
 * 小数位默认一位，模型成员可用 meta.decimals 按列声明（载荷 column_decimals）。
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

/** 率类格式（percent / percentage_point，0–1 比例）：比较时作差得百分点；普通数值比较时算相对变化率。 */
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
 * 维度取值的显示名。空值、空串和纯空白都显示占位符，不生成名称，以免与真实取值重名。
 * 轴和图例的名称同时用作分组键，都必须经过这里取得。明细表体不经过这里（见 `data_table`）。
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
 * 带符号的差值，格式与小数位同 formatCell。
 * 只标正负号不着色：模型没有声明指标方向，按涨跌着色会把流失类指标读反。
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

/** 读数卡、读数条和数值标签的数值：率带单位并固定小数位，普通数值用千分位。 */
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

/** 月份 `YYYY-MM` 的业务写法：`2026年8月`。 */
export function monthLabel(month: string): string {
  return `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`;
}

/** 月份闭区间的业务写法；起止同月时只写一个月。 */
export function monthRangeLabel(from: string, to: string): string {
  return from === to ? monthLabel(from) : `${monthLabel(from)}—${monthLabel(to)}`;
}

export function windowSummary(time: BusinessTime): string {
  const { window } = time;
  if (window.kind === "current_month") {
    return window.month ? monthLabel(window.month) : "最新月份";
  }
  if (window.kind === "observation") {
    const { selection } = window;
    if (selection.kind === "occurrence") return `期次 ${selection.id}`;
    if (selection.kind === "as_of") return `截至 ${selection.date} 的最近一期`;
    return `${selection.from} 至 ${selection.to} 的调研期次`;
  }
  if (window.kind === "year_to_date") return "今年至今";
  if (window.kind === "trailing") {
    return `最近 ${window.count} ${window.unit === "month" ? "个月" : "年"}`;
  }
  return monthRangeLabel(window.from, window.to);
}
