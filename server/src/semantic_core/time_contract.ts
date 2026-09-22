import { z } from "zod";
import type { MetricTimeContract, MetricTimeResolution } from "./metric_time_contract.js";
import { basisPeriod, METRIC_VALUE_BASIS_INPUT } from "./metric_value_basis.js";
import {
  formatYearMonth,
  isYearMonth,
  parseYearMonth,
  YEAR_MONTH_REGEX,
  yearMonthFromOrdinal,
  yearMonthOrdinal,
} from "./year_month.js";

export {
  formatYearMonth,
  isYearMonth,
  parseYearMonth,
  shiftYearMonth,
  yearMonthOrdinal,
} from "./year_month.js";

export const TIME_GRAINS = ["total", "year", "month"] as const;
export type TimeOutputGrain = (typeof TIME_GRAINS)[number];

/** `total` 是内部合计粒度，不进入期间窗口的公开选择。 */
export const SERIES_GRAINS = ["year", "month"] as const;
export type SeriesGrain = (typeof SERIES_GRAINS)[number];

export const TIME_RANGE_INPUT = z
  .object({
    from: z.string().regex(YEAR_MONTH_REGEX),
    to: z.string().regex(YEAR_MONTH_REGEX),
  })
  .strict();

export const TIME_COMPARE_INPUT = z.union([
  z.object({ cutoff: z.string().regex(YEAR_MONTH_REGEX) }).strict(),
  z.object({ range: TIME_RANGE_INPUT }).strict(),
  z.object({ previous_period: z.literal(true) }).strict(),
  z
    .object({
      years_ago: z.number().int().min(1).max(8),
      alignment: z.enum(["to_date", "full_period"]).optional(),
    })
    .strict(),
]);

export const TIME_LAST_INPUT = z.union([
  z.object({ months: z.number().int().min(1).max(60) }).strict(),
  z.object({ years: z.number().int().min(1).max(8) }).strict(),
]);

const CUTOFF_FIELD = z
  .string()
  .regex(YEAR_MONTH_REGEX)
  .optional()
  .describe("业务截止月份 YYYY-MM；省略时使用数据源 actual_through");
const OUTPUT_GRAIN_FIELD = z.enum(TIME_GRAINS).describe("结果按总计、年或月呈现");
const COMPARE_FIELD = z
  .array(TIME_COMPARE_INPUT)
  .min(1)
  .max(8)
  .optional()
  .describe(
    "对照坐标，按声明顺序返回。绝对形态（cutoff 或 range）须与主时间同类；" +
      "相对形态 {years_ago:n} 表示主坐标整体回移 n 个日历年，随主时间与数据推进自动滚动",
  );

export const TIME_INPUT = z
  .union([
    z
      .object({
        cutoff: CUTOFF_FIELD,
        grain: OUTPUT_GRAIN_FIELD.optional(),
        compare: COMPARE_FIELD,
      })
      .strict(),
    z
      .object({
        range: TIME_RANGE_INPUT.describe("连续业务月份范围"),
        grain: OUTPUT_GRAIN_FIELD,
        compare: COMPARE_FIELD,
      })
      .strict(),
    z
      .object({
        cutoff: CUTOFF_FIELD,
        last: TIME_LAST_INPUT.describe(
          "相对窗口：以锚点（cutoff，省略即 actual_through）为终点回看近 N 月或近 N 个日历年",
        ),
        grain: OUTPUT_GRAIN_FIELD,
        compare: COMPARE_FIELD,
      })
      .strict(),
  ])
  .superRefine((time, context) => {
    const kind = "range" in time || "last" in time ? "range" : "cutoff";
    const mixed = time.compare?.find((coordinate) => {
      if ("years_ago" in coordinate || "previous_period" in coordinate) return false;
      return kind === "range" ? !("range" in coordinate) : !("cutoff" in coordinate);
    });
    if (mixed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "对照时间必须与主时间同为截止月份或同为连续期间",
      });
    }
  });

export type TimeInput = z.infer<typeof TIME_INPUT>;
export type TimeCompareInput = z.infer<typeof TIME_COMPARE_INPUT>;

const timeRange = (time: TimeInput) => ("range" in time ? time.range : undefined);
const timeCutoff = (time: TimeInput) => ("cutoff" in time ? time.cutoff : undefined);

const SERIES_GRAIN_FIELD = z
  .enum(SERIES_GRAINS)
  .describe("期间按年还是按月成序列；整段合计恒由结果的合计位给出，不在这里表达");

export const TIME_WINDOW_INPUT = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("current_month"),
      month: z
        .string()
        .regex(YEAR_MONTH_REGEX)
        .optional()
        .describe("固定观察月份；省略时使用所选数据源共同具备的最新月份"),
    })
    .strict(),
  z.object({ kind: z.literal("year_to_date"), grain: SERIES_GRAIN_FIELD }).strict(),
  z
    .object({
      kind: z.literal("trailing"),
      count: z.number().int().min(1).max(60),
      unit: z.enum(["month", "year"]),
      grain: SERIES_GRAIN_FIELD,
    })
    .strict(),
  z
    .object({
      kind: z.literal("range"),
      from: z.string().regex(YEAR_MONTH_REGEX),
      to: z.string().regex(YEAR_MONTH_REGEX),
      grain: SERIES_GRAIN_FIELD,
    })
    .strict(),
]);

const CUSTOM_COMPARISON_WINDOW = z.union([
  z
    .object({
      kind: z.literal("current_month"),
      month: z.string().regex(YEAR_MONTH_REGEX),
    })
    .strict(),
  z
    .object({
      kind: z.literal("range"),
      from: z.string().regex(YEAR_MONTH_REGEX),
      to: z.string().regex(YEAR_MONTH_REGEX),
    })
    .strict()
    .refine((window) => window.from <= window.to, {
      message: "对照范围的开始月份不能晚于结束月份",
      path: ["from"],
    }),
]);

export const TIME_COMPARISON_INPUT = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("previous_period"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("previous_year"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("custom"),
      window: CUSTOM_COMPARISON_WINDOW,
    })
    .strict(),
]);

export const TIME_INTENT_INPUT = z
  .object({
    window: TIME_WINDOW_INPUT.describe(
      "观察时间：单个月份得到一个结果；年初至今、回看近 N 月/年或明确的起止月份是期间，" +
        "按所带的 grain 成序列。相对窗口随数据推进滚动，需要冻结时用明确的起止月份表达",
    ),
    comparison: TIME_COMPARISON_INPUT.optional().describe(
      "可选时间对比；上一等长期间、去年同期，或明确的单一自定义对照窗口",
    ),
  })
  .strict()
  .superRefine((time, context) => {
    if (time.window.kind === "trailing" && time.window.unit === "year" && time.window.count > 8) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["window", "count"],
        message: "按年选择最多支持近 8 年",
      });
    }
    if (time.window.kind === "range" && time.window.from > time.window.to) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["window", "from"],
        message: "时间范围的开始月份不能晚于结束月份",
      });
    }
    if (time.window.kind === "year_to_date" && time.comparison?.kind === "previous_period") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["comparison", "kind"],
        message: "今年至今应与去年同期比较；如需其他基准，请明确指定自定义对照期间",
      });
    }
    if (time.comparison?.kind === "custom") {
      const expected = time.window.kind === "current_month" ? "current_month" : "range";
      if (time.comparison.window.kind !== expected) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["comparison", "window"],
          message: "自定义对照必须与主时间同为单月或同为连续期间",
        });
      }
    }
  });

export type TimeIntent = z.infer<typeof TIME_INTENT_INPUT>;

function compileParsedTimeIntent(business: TimeIntent): TimeInput {
  let primary: TimeInput;
  if (business.window.kind === "current_month") {
    primary = business.window.month ? { cutoff: business.window.month } : {};
  } else if (business.window.kind === "year_to_date") {
    primary = { last: { years: 1 }, grain: business.window.grain };
  } else if (business.window.kind === "trailing") {
    primary = {
      last:
        business.window.unit === "month"
          ? { months: business.window.count }
          : { years: business.window.count },
      grain: business.window.grain,
    };
  } else {
    primary = {
      range: { from: business.window.from, to: business.window.to },
      grain: business.window.grain,
    };
  }

  if (!business.comparison) return primary;
  const comparison = business.comparison;
  const compare: TimeCompareInput[] =
    comparison.kind === "previous_period"
      ? [{ previous_period: true }]
      : comparison.kind === "previous_year"
        ? [{ years_ago: 1, alignment: "to_date" }]
        : comparison.window.kind === "current_month"
          ? [{ cutoff: comparison.window.month }]
          : [{ range: { from: comparison.window.from, to: comparison.window.to } }];
  return { ...primary, compare };
}

/** 公开业务时间 → Planner 私有坐标；这是跨层翻译的唯一入口。 */
export function compileTimeIntent(time: TimeIntent): TimeInput {
  return compileParsedTimeIntent(parseTimeIntent(time));
}

export function parseTimeIntent(value: unknown): TimeIntent {
  return TIME_INTENT_INPUT.parse(value);
}

export type TimeSelectionCoordinate =
  | { kind: "cutoff"; cutoff: string }
  | { kind: "range"; from: string; to: string };

export type ResolvedTimeSelection = {
  coordinates: TimeSelectionCoordinate[];
  outputGrain: TimeOutputGrain;
  comparison: "none" | "relative" | "custom";
};

export type TimeSelectionIssue =
  | { code: "time_intent_invalid"; reason: string }
  | { code: "time_anchor_unavailable" }
  | { code: "time_range_invalid"; from: string; to: string }
  | { code: "time_coordinates_duplicate"; coordinate: string }
  | { code: "time_comparison_requires_series"; selected_grain: "total" }
  | {
      code: "time_output_bucket_overlap";
      selected_grain: SeriesGrain;
      bucket: string;
      alternative_grain?: "month";
    }
  | {
      code: "time_range_unavailable";
      requested: string;
      available_through: string;
    }
  | {
      code: "metric_time_grain_incompatible";
      metric_titles: string[];
      required_grain: "month";
      selected_grain: TimeOutputGrain;
    }
  | {
      code: "metric_time_calendar_year_total_incompatible";
      metric_titles: string[];
      from: string;
      to: string;
      selected_grain: "total";
    }
  | {
      code: "metric_time_comparison_incompatible";
      metric_titles: string[];
      required_comparison: "custom";
    };

export type TimeSelectionResult =
  | { status: "resolved"; selection: ResolvedTimeSelection }
  | { status: "invalid"; issue: TimeSelectionIssue };

export function timeSelectionIssueMessage(issue: TimeSelectionIssue): string {
  switch (issue.code) {
    case "time_intent_invalid":
      return issue.reason;
    case "time_anchor_unavailable":
      return "数据最新月份暂不可用，无法解析相对时间";
    case "time_range_invalid":
      return `时间范围「${issue.from} 至 ${issue.to}」的开始月份不能晚于结束月份；请调整为开始月份早于或等于结束月份`;
    case "time_coordinates_duplicate":
      return `主时间与对照时间重复：${issue.coordinate}`;
    case "time_comparison_requires_series":
      return "存在对照时间时不能合并为无时间标识的总计，请改为按年或按月呈现";
    case "time_output_bucket_overlap": {
      const label = issue.selected_grain === "year" ? `${issue.bucket} 年` : issue.bucket;
      return (
        `主时间与对照时间在${issue.selected_grain === "year" ? "按年" : "按月"}呈现时都会产生 ${label}，结果无法区分；` +
        (issue.alternative_grain
          ? "请改为按月呈现，或选择互不重叠的对照时间"
          : "请选择互不重叠的主时间或对照时间")
      );
    }
    case "time_range_unavailable":
      return `当前数据可查询至 ${issue.available_through}，不能查询 ${issue.requested}；请把结束月份改为 ${issue.available_through} 或更早月份`;
    case "metric_time_grain_incompatible": {
      const subject = issue.metric_titles.length
        ? `指标「${issue.metric_titles.join("、")}」`
        : "所选指标";
      return `${subject}按月定义；连续期间请改为按月呈现，不能合并多个月份`;
    }
    case "metric_time_calendar_year_total_incompatible": {
      const subject = issue.metric_titles.length
        ? `指标「${issue.metric_titles.join("、")}」`
        : "所选指标";
      return (
        `${subject}按日历年重新起算，不能把跨年的「${issue.from} 至 ${issue.to}」合并为一个总计；` +
        "请改为按年或按月呈现，或选择单一日历年"
      );
    }
    case "metric_time_comparison_incompatible": {
      const subject = issue.metric_titles.length
        ? `指标「${issue.metric_titles.join("、")}」`
        : "所选指标";
      return `${subject}只允许显式对照期间；请改用明确的自定义对照期间`;
    }
  }
}

export class TimeSelectionError extends Error {
  override name = "TimeSelectionError";

  constructor(readonly issue: TimeSelectionIssue) {
    super(timeSelectionIssueMessage(issue));
  }
}

const monthIndex = (value: string) => {
  const parsed = parseYearMonth(value);
  if (!parsed) throw new Error(`月份「${value}」无效，请使用 YYYY-MM`);
  return yearMonthOrdinal(parsed);
};

const monthAt = (index: number) => formatYearMonth(yearMonthFromOrdinal(index));

const shiftYears = (month: string, delta: number) => {
  const parsed = parseYearMonth(month);
  if (!parsed) throw new Error(`月份「${month}」无效，请使用 YYYY-MM`);
  return formatYearMonth({ ...parsed, year: parsed.year + delta });
};

export function expandTimeCompare(time: TimeInput, defaultCutoff?: string): TimeInput {
  if (
    !time.compare?.some(
      (coordinate) => "years_ago" in coordinate || "previous_period" in coordinate,
    )
  )
    return time;
  const range = timeRange(time);
  const cutoff = timeCutoff(time);
  const compare = time.compare.map((coordinate): TimeCompareInput => {
    if ("previous_period" in coordinate) {
      if (range) {
        const length = monthIndex(range.to) - monthIndex(range.from) + 1;
        return {
          range: {
            from: monthAt(monthIndex(range.from) - length),
            to: monthAt(monthIndex(range.from) - 1),
          },
        };
      }
      const base = cutoff ?? defaultCutoff;
      return base ? { cutoff: monthAt(monthIndex(base) - 1) } : coordinate;
    }
    if (!("years_ago" in coordinate)) return coordinate;
    const back = coordinate.years_ago;
    if (coordinate.alignment === "full_period") {
      const anchor = range?.to ?? cutoff ?? defaultCutoff;
      if (!anchor) return coordinate;
      const year = Number(anchor.slice(0, 4)) - back;
      return { range: { from: `${year}-01`, to: `${year}-12` } };
    }
    if (range) {
      return {
        range: {
          from: shiftYears(range.from, -back),
          to: shiftYears(range.to, -back),
        },
      };
    }
    const base = cutoff ?? defaultCutoff;
    return base ? { cutoff: shiftYears(base, -back) } : coordinate;
  });
  return { ...time, compare };
}

export function expandTimeWindow(time: TimeInput, defaultCutoff?: string): TimeInput {
  if (!("last" in time)) return time;
  const anchor = time.cutoff ?? defaultCutoff;
  if (!anchor) return time;
  const from =
    "months" in time.last
      ? monthAt(monthIndex(anchor) - (time.last.months - 1))
      : `${Number(anchor.slice(0, 4)) - (time.last.years - 1)}-01`;
  const { last: _last, cutoff: _cutoff, ...rest } = time;
  return { ...rest, range: { from, to: anchor } };
}

function outputCoordinates(time: TimeInput, defaultCutoff: string): TimeSelectionCoordinate[] {
  const range = timeRange(time);
  const base: TimeSelectionCoordinate = range
    ? { kind: "range", ...range }
    : { kind: "cutoff", cutoff: timeCutoff(time) ?? defaultCutoff };
  return [
    base,
    ...(time.compare ?? []).map((coordinate): TimeSelectionCoordinate => {
      if ("range" in coordinate) return { kind: "range", ...coordinate.range };
      if ("years_ago" in coordinate || "previous_period" in coordinate) {
        throw new Error("相对对照未解析为绝对坐标");
      }
      return { kind: "cutoff", cutoff: coordinate.cutoff };
    }),
  ];
}

function coordinateBuckets(
  coordinate: TimeSelectionCoordinate,
  grain: Exclude<TimeOutputGrain, "total">,
): string[] {
  if (coordinate.kind === "cutoff") {
    return [grain === "year" ? coordinate.cutoff.slice(0, 4) : coordinate.cutoff];
  }
  const buckets = new Set<string>();
  for (let index = monthIndex(coordinate.from); index <= monthIndex(coordinate.to); index += 1) {
    const month = monthAt(index);
    buckets.add(grain === "year" ? month.slice(0, 4) : month);
  }
  return [...buckets];
}

function duplicateOutputBucket(
  coordinates: TimeSelectionCoordinate[],
  grain: Exclude<TimeOutputGrain, "total">,
): string | undefined {
  const seen = new Set<string>();
  for (const coordinate of coordinates) {
    const buckets = coordinateBuckets(coordinate, grain);
    const duplicate = buckets.find((bucket) => seen.has(bucket));
    if (duplicate) return duplicate;
    buckets.forEach((bucket) => {
      seen.add(bucket);
    });
  }
  return undefined;
}

const coordinateLabel = (coordinate: TimeSelectionCoordinate) =>
  coordinate.kind === "cutoff" ? coordinate.cutoff : `${coordinate.from} 至 ${coordinate.to}`;

/** 公开意图与 Planner 共用的时间坐标和结果粒度解析。 */
export function resolveTimeSelection(time: TimeInput, defaultCutoff: string): TimeSelectionResult {
  if (!isYearMonth(defaultCutoff)) {
    return { status: "invalid", issue: { code: "time_anchor_unavailable" } };
  }
  const windowed = expandTimeWindow(time, defaultCutoff);
  const comparison = !windowed.compare?.length
    ? "none"
    : windowed.compare.some(
          (coordinate) => "years_ago" in coordinate || "previous_period" in coordinate,
        )
      ? "relative"
      : "custom";
  const coordinates = outputCoordinates(expandTimeCompare(windowed, defaultCutoff), defaultCutoff);
  const invalidRange = coordinates.find(
    (coordinate) => coordinate.kind === "range" && coordinate.from > coordinate.to,
  );
  if (invalidRange?.kind === "range") {
    return {
      status: "invalid",
      issue: { code: "time_range_invalid", from: invalidRange.from, to: invalidRange.to },
    };
  }
  const labels = coordinates.map(coordinateLabel);
  const duplicateCoordinate = labels.find((label, index) => labels.indexOf(label) !== index);
  if (duplicateCoordinate) {
    return {
      status: "invalid",
      issue: { code: "time_coordinates_duplicate", coordinate: duplicateCoordinate },
    };
  }
  const requested = windowed.grain;
  if (coordinates.length === 1) {
    return {
      status: "resolved",
      selection: { coordinates, outputGrain: requested ?? "total", comparison },
    };
  }
  if (requested === "total") {
    return {
      status: "invalid",
      issue: { code: "time_comparison_requires_series", selected_grain: "total" },
    };
  }
  const grain =
    requested ??
    (!timeCutoff(windowed)
      ? "month"
      : duplicateOutputBucket(coordinates, "year")
        ? "month"
        : "year");
  const duplicate = duplicateOutputBucket(coordinates, grain);
  if (duplicate) {
    const canResolveByMonth =
      grain === "year" && duplicateOutputBucket(coordinates, "month") === undefined;
    return {
      status: "invalid",
      issue: {
        code: "time_output_bucket_overlap",
        selected_grain: grain,
        bucket: duplicate,
        ...(canResolveByMonth ? { alternative_grain: "month" as const } : {}),
      },
    };
  }
  return { status: "resolved", selection: { coordinates, outputGrain: grain, comparison } };
}

export function resolveTimeIntentSelection(time: unknown, latest: string): TimeSelectionResult {
  const parsed = TIME_INTENT_INPUT.safeParse(time);
  if (!parsed.success) {
    return {
      status: "invalid",
      issue: {
        code: "time_intent_invalid",
        reason: parsed.error.issues[0]?.message ?? "时间组合无效",
      },
    };
  }
  return resolveTimeSelection(compileParsedTimeIntent(parsed.data), latest);
}

export function timeAvailabilityIssue(
  selection: ResolvedTimeSelection,
  availableThrough: string,
): TimeSelectionIssue | undefined {
  const unavailable = selection.coordinates.find((coordinate) => {
    const to = coordinate.kind === "cutoff" ? coordinate.cutoff : coordinate.to;
    return to > availableThrough;
  });
  if (!unavailable) return undefined;
  return {
    code: "time_range_unavailable",
    requested: coordinateLabel(unavailable),
    available_through: availableThrough,
  };
}

/** 时间能力由模型合同推导，不接受手写值。 */
export const TIME_CAPABILITIES_INPUT = z
  .object({
    grain: z.literal("month").optional().describe("指标只在单月桶上有定义；跨月窗口只能按月呈现"),
    year_scoped: z
      .literal(true)
      .optional()
      .describe("指标按日历年归零（年初累计族）；跨日历年的窗口没有单一合计"),
    comparison: z.literal("explicit_only").optional().describe("指标只允许显式自定义对照期间"),
  })
  .strict();

export type TimeCapabilities = z.infer<typeof TIME_CAPABILITIES_INPUT>;

export const METRIC_TIME_INPUT = z
  .object({
    value_basis: METRIC_VALUE_BASIS_INPUT,
    constraints: TIME_CAPABILITIES_INPUT.optional().describe(
      "指标对时间选择的限制；省略表示没有额外限制",
    ),
  })
  .strict();

export type MetricTime = z.infer<typeof METRIC_TIME_INPUT>;

export function metricTimeCapabilities(contract: MetricTimeContract): TimeCapabilities {
  return {
    ...(contract.grain === "month" ? { grain: "month" as const } : {}),
    ...(contract.window === "year_to_date" ? { year_scoped: true as const } : {}),
  };
}

export function mergeTimeCapabilities(capabilities: readonly TimeCapabilities[]): TimeCapabilities {
  return {
    ...(capabilities.some((item) => item.grain === "month") ? { grain: "month" as const } : {}),
    ...(capabilities.some((item) => item.year_scoped) ? { year_scoped: true as const } : {}),
    ...(capabilities.some((item) => item.comparison === "explicit_only")
      ? { comparison: "explicit_only" as const }
      : {}),
  };
}

export type MetricTimeRequirement = {
  capabilities: TimeCapabilities;
  title?: string;
};

const requirementTitles = (requirements: readonly MetricTimeRequirement[]) => [
  ...new Set(requirements.flatMap((requirement) => (requirement.title ? [requirement.title] : []))),
];

export function metricTimeComparisonIssue(
  requirements: readonly MetricTimeRequirement[],
  comparison: ResolvedTimeSelection["comparison"],
): TimeSelectionIssue | undefined {
  if (comparison !== "relative") return undefined;
  const restricted = requirements.filter(
    (requirement) => requirement.capabilities.comparison === "explicit_only",
  );
  return restricted.length
    ? {
        code: "metric_time_comparison_incompatible",
        metric_titles: requirementTitles(restricted),
        required_comparison: "custom",
      }
    : undefined;
}

export function metricTimeSelectionIssue(
  requirements: readonly MetricTimeRequirement[],
  selection: ResolvedTimeSelection,
): TimeSelectionIssue | undefined {
  const comparison = metricTimeComparisonIssue(requirements, selection.comparison);
  if (comparison) return comparison;
  const monthly = requirements.filter((requirement) => requirement.capabilities.grain === "month");
  const combinesMonths = selection.coordinates.some(
    (coordinate) => coordinate.kind === "range" && coordinate.from !== coordinate.to,
  );
  if (monthly.length && selection.outputGrain !== "month" && combinesMonths) {
    return {
      code: "metric_time_grain_incompatible",
      metric_titles: requirementTitles(monthly),
      required_grain: "month",
      selected_grain: selection.outputGrain,
    };
  }
  const yearScoped = requirements.filter((requirement) => requirement.capabilities.year_scoped);
  const crossYear = selection.coordinates.find(
    (coordinate) =>
      coordinate.kind === "range" && coordinate.from.slice(0, 4) !== coordinate.to.slice(0, 4),
  );
  if (yearScoped.length && selection.outputGrain === "total" && crossYear?.kind === "range") {
    return {
      code: "metric_time_calendar_year_total_incompatible",
      metric_titles: requirementTitles(yearScoped),
      from: crossYear.from,
      to: crossYear.to,
      selected_grain: "total",
    };
  }
  return undefined;
}

/** 月粒度指标跨月求值时降级到终点月，并显式标记 degraded。 */
export type TotalPeriod = {
  from: string;
  to: string;
  degraded?: true;
};

export function totalPeriodOf(
  time: MetricTimeResolution,
  coordinate: { from: string; to: string },
): TotalPeriod {
  const degraded = time.contract.grain === "month" && coordinate.from !== coordinate.to;
  return { ...basisPeriod(time.basis, coordinate, degraded), ...(degraded ? { degraded } : {}) };
}

export function primaryTimeRange(time: TimeIntent, latest: string): { from: string; to: string } {
  const expanded = expandTimeWindow(compileTimeIntent(time), latest);
  const range = timeRange(expanded);
  if (range) return range;
  const cutoff = timeCutoff(expanded) ?? latest;
  return { from: cutoff, to: cutoff };
}

export type TimeBucket = { from: string; to: string };

/** 年桶按日历年切分，首尾允许是不完整自然年。 */
export function timeBuckets(
  coordinate: { kind: "cutoff"; cutoff: string } | { kind: "range"; from: string; to: string },
  grain: TimeOutputGrain,
): TimeBucket[] {
  if (coordinate.kind === "cutoff") {
    return [{ from: coordinate.cutoff, to: coordinate.cutoff }];
  }
  const { from, to } = coordinate;
  if (grain === "month") {
    const buckets: TimeBucket[] = [];
    for (let index = monthIndex(from); index <= monthIndex(to); index += 1) {
      const month = monthAt(index);
      buckets.push({ from: month, to: month });
    }
    return buckets;
  }
  if (grain === "year") {
    const fromYear = Number(from.slice(0, 4));
    const toYear = Number(to.slice(0, 4));
    const buckets: TimeBucket[] = [];
    for (let year = fromYear; year <= toYear; year += 1) {
      buckets.push({
        from: year > fromYear ? `${year}-01` : from,
        to: year < toYear ? `${year}-12` : to,
      });
    }
    return buckets;
  }
  return [{ from, to }];
}
