/**
 * 内部时间源的唯一事实源：声明时钟 key、对外业务标签、实际数据基准和可用上界语义。
 *
 * 时间源 key 是执行侧内务（Cube gateway 时钟、time_plan、application 层据此读 TimeContext.sources），
 * 绝不上线；对外只出现业务标签。此映射是这条边界上唯一的标签来源——公共时间上下文数组项标题、
 * 公共场景的 time_context_title 与 Cube Client 的时间上下文装配都取自这里；具体时钟指标由执行
 * View 的 time_anchor_measure 声明，Web 与客户端不得再维护第二份物理映射。
 */
export const TIME_SOURCES = [
  {
    key: "workforce",
    label: "人员数据",
    actual_source: "workforce",
    horizon: "actual",
    calendar: "continuous",
    primary: true,
  },
  {
    key: "headcount_plan",
    label: "人员与编制数据",
    actual_source: "workforce",
    horizon: "plan",
    calendar: "continuous",
    primary: false,
  },
  {
    key: "survey",
    label: "周期调研数据",
    actual_source: "survey",
    horizon: "actual",
    calendar: "wave",
    primary: false,
  },
] as const;

export type TimeSourceKey = (typeof TIME_SOURCES)[number]["key"];

/**
 * 时钟日历形态：continuous 是逐月连续推进的数据时钟；wave 是按期次投放的稀疏时钟
 * （月度桶承载「最近一期 ≤ 桶末」的读数）。wave 时钟上的日历相对对照（上一等长期间、
 * 去年同期）会静默跨期错位，编译器据此 fail-closed；显式自定义对照期间不受影响。
 */
export type TimeSourceCalendar = "continuous" | "wave";

const TIME_SOURCE_BY_KEY = new Map(TIME_SOURCES.map((source) => [source.key, source]));

export function parseTimeSourceKey(value: unknown, owner: string): TimeSourceKey {
  if (typeof value !== "string" || !TIME_SOURCE_BY_KEY.has(value as TimeSourceKey)) {
    throw new Error(`${owner} 声明了未登记的时间来源`);
  }
  return value as TimeSourceKey;
}

/** 内部时间源 key → 对外业务标签；未知 key fail-closed，绝不把执行标识回显给客户端。 */
export function timeSourceLabel(key: string): string {
  const source = TIME_SOURCE_BY_KEY.get(key as TimeSourceKey);
  if (!source) throw new Error(`模型声明了未登记的时间来源；请联系服务维护者`);
  return source.label;
}

/** 内部时间源 key → 日历形态；未知 key fail-closed。 */
export function timeSourceCalendar(key: string): TimeSourceCalendar {
  const source = TIME_SOURCE_BY_KEY.get(key as TimeSourceKey);
  if (!source) throw new Error(`模型声明了未登记的时间来源；请联系服务维护者`);
  return source.calendar;
}
