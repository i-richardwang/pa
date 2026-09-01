import { z } from "zod";
import type { MetricTimeContract } from "./metric_time_contract.js";

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const TIME_GRAINS = ["total", "year", "month"] as const;
export type TimeOutputGrain = (typeof TIME_GRAINS)[number];

/**
 * 用户与 Agent 能选的显示方式只有序列粒度；整段合计由结果自带的合计位承担（见 view.totals）。
 * 「对照 × 合计」「年初归零 × 跨日历年合计」这类组合在这条轴上不可表达。
 * 内部 grain 保留 total 档：单月窗口解析为整段单桶，合计腿按它求值，不对外开放。
 */
export const TIME_DISPLAY_CHOICES = ["year", "month"] as const;
export type TimeDisplayChoice = (typeof TIME_DISPLAY_CHOICES)[number];

export const TIME_RANGE_INPUT = z
  .object({
    from: z.string().regex(YEAR_MONTH),
    to: z.string().regex(YEAR_MONTH),
  })
  .strict();

export const TIME_COMPARE_INPUT = z.union([
  z.object({ cutoff: z.string().regex(YEAR_MONTH) }).strict(),
  z.object({ range: TIME_RANGE_INPUT }).strict(),
  z.object({ previous_period: z.literal(true) }).strict(),
  z
    .object({
      years_ago: z.number().int().min(1).max(8),
      alignment: z.enum(["to_date", "full_period"]).optional(),
    })
    .strict(),
]);

/**
 * 相对窗口：以锚点（主 cutoff，省略即数据 actual_through）为终点，回看近 N 个自然月
 * 或近 N 个日历年。唯一编译点按锚点展开为绝对 range，随数据推进自动滚动；与绝对 range
 * 互斥（两者都是窗口），与 cutoff 组合正是「锚点 × 窗口」。
 */
export const TIME_LAST_INPUT = z.union([
  z.object({ months: z.number().int().min(1).max(60) }).strict(),
  z.object({ years: z.number().int().min(1).max(8) }).strict(),
]);

/**
 * Planner 私有时间坐标。公开业务时间必须先经 compileTimeIntent 翻译；指标的
 * sum/average/last/recompute 与固定年初窗口仍由模型 time_contract 和唯一时间编译点决定。
 */
export const TIME_INPUT = z
  .object({
    cutoff: z
      .string()
      .regex(YEAR_MONTH)
      .optional()
      .describe("业务截止月份 YYYY-MM；省略时使用数据源 actual_through"),
    range: TIME_RANGE_INPUT.optional().describe("连续业务月份范围"),
    last: TIME_LAST_INPUT.optional().describe(
      "相对窗口：以锚点（cutoff，省略即 actual_through）为终点回看近 N 月或近 N 个日历年，" +
        "随数据推进自动滚动；省略结果粒度时 months 按月、years 按年呈现",
    ),
    grain: z.enum(TIME_GRAINS).optional().describe("结果按总计、年或月呈现"),
    compare: z
      .array(TIME_COMPARE_INPUT)
      .min(1)
      .max(8)
      .optional()
      .describe(
        "对照坐标，按声明顺序返回。绝对形态（cutoff 或 range）须与主时间同类；" +
          "相对形态 {years_ago:n} 表示主坐标整体回移 n 个日历年，随主时间与数据推进自动滚动",
      ),
  })
  .strict()
  .superRefine((time, context) => {
    if (time.cutoff && time.range) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "时间只能选择截止月份或连续期间，不能同时选择两者",
      });
    }
    if (time.range && time.last) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "连续期间与相对窗口都是窗口，只能选择其一",
      });
    }
    // last 展开后即 range，故与 range 同属「范围」类，对照须为范围形态或相对形态。
    const kind = time.range || time.last ? "range" : "cutoff";
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

/**
 * Agent 与产品界面共用的业务时间意图；三个字段各自的取值与冻结性见 docs/time_contract.md §1。
 * 冻结由窗口种类本身承载，不靠额外的截止字段。
 * display 是可省略的结果显示方式，comparison 是按需启用的分析能力。
 * 指标跨桶求和、平均、取期末或重算仍由模型 time_contract 决定。物理 Planner 只消费
 * compileTimeIntent 的内部坐标产物。
 */
export const TIME_WINDOW_INPUT = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("current_month"),
      month: z
        .string()
        .regex(YEAR_MONTH)
        .optional()
        .describe("固定观察月份；省略时使用所选数据源共同具备的最新月份"),
    })
    .strict(),
  z.object({ kind: z.literal("year_to_date") }).strict(),
  z
    .object({
      kind: z.literal("trailing"),
      count: z.number().int().min(1).max(60),
      unit: z.enum(["month", "year"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("range"),
      from: z.string().regex(YEAR_MONTH),
      to: z.string().regex(YEAR_MONTH),
    })
    .strict(),
]);

const CUSTOM_COMPARISON_WINDOW = z.union([
  z
    .object({
      kind: z.literal("current_month"),
      month: z.string().regex(YEAR_MONTH),
    })
    .strict(),
  z
    .object({
      kind: z.literal("range"),
      from: z.string().regex(YEAR_MONTH),
      to: z.string().regex(YEAR_MONTH),
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
      "观察时间：最新或固定月份、年初至今、回看近 N 月/年，或明确的起止月份；" +
        "相对窗口随数据推进滚动，需要冻结时用明确的起止月份表达",
    ),
    display: z
      .enum(TIME_DISPLAY_CHOICES)
      .optional()
      .describe(
        "可选序列粒度：month 或 year；省略时按窗口和指标自动选择。" +
          "整段时间的合计恒由结果的合计位给出，不必也不能在这里要求",
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

/** 公开业务时间 → Planner 私有坐标；这是跨层翻译的唯一入口。 */
export function compileTimeIntent(time: TimeIntent): TimeInput {
  const business = parseTimeIntent(time);
  const grain = business.display;
  let primary: TimeInput;
  if (business.window.kind === "current_month") {
    primary = {
      ...(business.window.month ? { cutoff: business.window.month } : {}),
      ...(grain ? { grain } : {}),
    };
  } else if (business.window.kind === "year_to_date") {
    primary = { last: { years: 1 }, ...(grain ? { grain } : {}) };
  } else if (business.window.kind === "trailing") {
    primary = {
      last:
        business.window.unit === "month"
          ? { months: business.window.count }
          : { years: business.window.count },
      ...(grain ? { grain } : {}),
    };
  } else {
    primary = {
      range: { from: business.window.from, to: business.window.to },
      ...(grain ? { grain } : {}),
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

export function parseTimeIntent(value: unknown): TimeIntent {
  return TIME_INTENT_INPUT.parse(value);
}

type OutputCoordinate =
  | { kind: "cutoff"; cutoff?: string }
  | { kind: "range"; from: string; to: string };

const monthIndex = (value: string) => {
  const [year, month] = value.split("-").map(Number);
  return year * 12 + month - 1;
};

const monthAt = (index: number) => {
  const year = Math.floor(index / 12);
  return `${year}-${String((index % 12) + 1).padStart(2, "0")}`;
};

const shiftYears = (month: string, delta: number) => {
  const [year, monthPart] = month.split("-");
  return `${Number(year) + delta}-${monthPart}`;
};

/**
 * 把相对对照归一为绝对坐标：years_ago 将主坐标整体回移 n 年，previous_period 使用
 * 紧邻主坐标且长度相同的前一段时间。主截止月省略且无 actual_through 兜底时保留相对形态，
 * 由结果粒度层按保守规则处理；绝对对照原样保留。
 */
export function expandTimeCompare(time: TimeInput, defaultCutoff?: string): TimeInput {
  if (
    !time.compare?.some(
      (coordinate) => "years_ago" in coordinate || "previous_period" in coordinate,
    )
  )
    return time;
  const compare = time.compare.map((coordinate): TimeCompareInput => {
    if ("previous_period" in coordinate) {
      if (time.range) {
        const length = monthIndex(time.range.to) - monthIndex(time.range.from) + 1;
        return {
          range: {
            from: monthAt(monthIndex(time.range.from) - length),
            to: monthAt(monthIndex(time.range.from) - 1),
          },
        };
      }
      const base = time.cutoff ?? defaultCutoff;
      return base ? { cutoff: monthAt(monthIndex(base) - 1) } : coordinate;
    }
    if (!("years_ago" in coordinate)) return coordinate;
    const back = coordinate.years_ago;
    if (coordinate.alignment === "full_period") {
      const anchor = time.range?.to ?? time.cutoff ?? defaultCutoff;
      if (!anchor) return coordinate;
      const year = Number(anchor.slice(0, 4)) - back;
      return { range: { from: `${year}-01`, to: `${year}-12` } };
    }
    if (time.range) {
      return {
        range: {
          from: shiftYears(time.range.from, -back),
          to: shiftYears(time.range.to, -back),
        },
      };
    }
    const base = time.cutoff ?? defaultCutoff;
    return base ? { cutoff: shiftYears(base, -back) } : coordinate;
  });
  return { ...time, compare };
}

/**
 * 相对窗口省略结果粒度时的默认：months 按月；years 只有跨过多个日历年才按年，
 * 单个年桶按月。只对无业务分组的结果成立。
 */
function lastDefaultGrain(time: TimeInput): TimeOutputGrain | undefined {
  if (!time.last) return undefined;
  if ("months" in time.last) return "month";
  return time.last.years > 1 ? "year" : "month";
}

/**
 * 把相对窗口 {last} 展开为绝对 range：锚点＝主 cutoff，省略时用 defaultCutoff（服务端
 * actual_through）。months 回看 N 个自然月至锚点，years 回看至 (锚点年-(N-1)) 年 1 月。
 * 默认结果粒度仍由原始 last 单位在 resolveTimeOutputGrain 中决定；展开本身只落定坐标。
 * 无锚点可用时（浏览器预览无 actual_through）保留相对形态。展开顺序恒为窗口先于对照，
 * 相对对照因此直接作用在展开后的 range 上。
 */
export function expandTimeWindow(time: TimeInput, defaultCutoff?: string): TimeInput {
  if (!time.last) return time;
  const anchor = time.cutoff ?? defaultCutoff;
  if (!anchor) return time;
  const from =
    "months" in time.last
      ? monthAt(monthIndex(anchor) - (time.last.months - 1))
      : `${Number(anchor.slice(0, 4)) - (time.last.years - 1)}-01`;
  const { last: _last, cutoff: _cutoff, ...rest } = time;
  return { ...rest, range: { from, to: anchor } };
}

function outputCoordinates(time: TimeInput, defaultCutoff?: string): OutputCoordinate[] {
  const base: OutputCoordinate = time.range
    ? { kind: "range", ...time.range }
    : { kind: "cutoff", cutoff: time.cutoff ?? defaultCutoff };
  return [
    base,
    ...(time.compare ?? []).map((coordinate): OutputCoordinate => {
      if ("range" in coordinate) return { kind: "range", ...coordinate.range };
      if ("years_ago" in coordinate || "previous_period" in coordinate) {
        return { kind: "cutoff", cutoff: undefined };
      }
      return { kind: "cutoff", cutoff: coordinate.cutoff };
    }),
  ];
}

function coordinateBuckets(
  coordinate: OutputCoordinate,
  grain: Exclude<TimeOutputGrain, "total">,
): string[] | null {
  if (coordinate.kind === "cutoff") {
    if (!coordinate.cutoff) return null;
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
  coordinates: OutputCoordinate[],
  grain: Exclude<TimeOutputGrain, "total">,
): string | undefined {
  const seen = new Set<string>();
  for (const coordinate of coordinates) {
    const buckets = coordinateBuckets(coordinate, grain);
    if (!buckets) continue;
    const duplicate = buckets.find((bucket) => seen.has(bucket));
    if (duplicate) return duplicate;
    buckets.forEach((bucket) => {
      seen.add(bucket);
    });
  }
  return undefined;
}

/**
 * 意图层与物理时间编译层共用的结果粒度规则。对照窗口在最终时间键上必须互斥，
 * 否则相同行无法判断属于哪一个业务坐标。省略主截止月且带对照时恒按月输出：
 * 浏览器规划器拿不到 actual_through，必须与服务端同解。
 *
 * 省略粒度时的默认逐形态列在 docs/time_contract.md §1 的表里，本函数是那张表的唯一实现。
 * 内部 grain 可显式要求 total（合计腿、记录投影都这么用），带对照时拒绝：合计没有时间键。
 */
export function resolveTimeOutputGrain(
  time: TimeInput,
  defaultCutoff?: string,
  opts: { defaultOutput?: "series" | "total" } = {},
): TimeOutputGrain {
  const windowed = expandTimeWindow(time, defaultCutoff);
  const coordinates = outputCoordinates(expandTimeCompare(windowed, defaultCutoff), defaultCutoff);
  const seriesDefault = opts.defaultOutput !== "total";
  const requested = windowed.grain ?? (seriesDefault ? lastDefaultGrain(time) : undefined);
  if (coordinates.length === 1) {
    return requested ?? (windowed.range && seriesDefault ? "month" : "total");
  }
  if (requested === "total") {
    throw new Error("存在对照时间时不能合并为无时间标识的总计，请改为按年或按月呈现");
  }
  const grain =
    requested ??
    (windowed.range || !windowed.cutoff
      ? "month"
      : duplicateOutputBucket(coordinates, "year")
        ? "month"
        : "year");
  const duplicate = duplicateOutputBucket(coordinates, grain);
  if (duplicate) {
    const label = grain === "year" ? `${duplicate} 年` : duplicate;
    const canResolveByMonth =
      grain === "year" && duplicateOutputBucket(coordinates, "month") === undefined;
    throw new Error(
      `主时间与对照时间在${grain === "year" ? "按年" : "按月"}呈现时都会产生 ${label}，结果无法区分；` +
        (canResolveByMonth
          ? "请改为按月呈现，或选择互不重叠的对照时间"
          : "请选择互不重叠的主时间或对照时间"),
    );
  }
  return grain;
}

/**
 * 指标的时间能力卡：编译器时间守卫的事前投影。每一位镜像一处服务端 fail-closed，
 * 由模型 `time_contract` 在目录装配时推导生成，永不手写——卡与守卫因此不会分叉。
 */
export const TIME_CAPABILITIES_INPUT = z
  .object({
    multi_month_display: z
      .literal("month")
      .optional()
      .describe("指标只在单月桶上有定义；跨月窗口只能按月呈现"),
    year_scoped: z
      .literal(true)
      .optional()
      .describe("指标按日历年归零（年初累计族）；跨日历年的窗口没有单一合计"),
  })
  .strict();

export type TimeCapabilities = z.infer<typeof TIME_CAPABILITIES_INPUT>;

/**
 * 由指标合同推导能力卡。目录装配（下发给编辑器）与整窗合计求值共用这一份推导，
 * 卡因此永不手写，也不会各自解读合同字段。
 */
export function metricTimeCapabilities(contract: MetricTimeContract | undefined): TimeCapabilities {
  return {
    ...(contract?.grain === "month" ? { multi_month_display: "month" as const } : {}),
    ...(contract?.window === "year_to_date" ? { year_scoped: true as const } : {}),
  };
}

export type TotalCoverage = "window" | "endpoint";
/** 整窗合计的求值期间：真实覆盖的业务月份区间，以及它是整窗还是终点降级。 */
export type TotalPeriod = { from: string; to: string; coverage: TotalCoverage };

/**
 * 指标在一个时间坐标上的合计求值期间。能整窗合并即 window，期间就是坐标本身；
 * 不能合并的两族退为 endpoint——按月定义只覆盖终点当月，年初归零覆盖终点所在日历年的
 * 年初至终点。两条降级各镜像 compatibleTimeGrain 与 assertYearToDateBuckets。
 */
export function totalPeriodOf(
  capabilities: TimeCapabilities,
  period: { from: string; to: string },
): TotalPeriod {
  if (capabilities.multi_month_display === "month" && period.from !== period.to) {
    return { from: period.to, to: period.to, coverage: "endpoint" };
  }
  if (capabilities.year_scoped && period.from.slice(0, 4) !== period.to.slice(0, 4)) {
    // 跨日历年才会走到这里，故终点所在年的年初必晚于期间起点。
    return { from: `${period.to.slice(0, 4)}-01`, to: period.to, coverage: "endpoint" };
  }
  return { from: period.from, to: period.to, coverage: "window" };
}

/** 主期间的绝对起止；相对窗口按 latest 展开，截止月份形态起止同月。 */
export function primaryTimeRange(time: TimeIntent, latest: string): { from: string; to: string } {
  const expanded = expandTimeWindow(compileTimeIntent(time), latest);
  if (expanded.range) return expanded.range;
  const cutoff = expanded.cutoff ?? latest;
  return { from: cutoff, to: cutoff };
}

/** 按月定义的指标遇到跨月窗口：省略显示方式时服务端隐式按月返回（compatibleTimeGrain 同规则）。 */
export function requiresMonthlyDisplay(
  time: TimeIntent,
  capabilities: TimeCapabilities,
  latest: string,
): boolean {
  if (capabilities.multi_month_display !== "month") return false;
  const range = primaryTimeRange(time, latest);
  return range.from !== range.to;
}

/**
 * 该意图最终会得到的结果粒度：省略显示方式时按窗口与指标能力推导，与服务端一致——
 * 服务端对「按月定义 × 跨月 × 未显式指定」隐式降为按月（compatibleTimeGrain 的非显式分支），
 * 其余情形由 resolveTimeOutputGrain 决定。
 */
export function resolvedTimeDisplay(
  time: TimeIntent,
  latest: string,
  capabilities: TimeCapabilities = {},
  hasBusinessGrouping = false,
): TimeOutputGrain {
  if (time.display === undefined && requiresMonthlyDisplay(time, capabilities, latest)) {
    return "month";
  }
  const grain = resolveTimeOutputGrain(compileTimeIntent(time), latest, {
    defaultOutput: hasBusinessGrouping ? "total" : "series",
  });
  if (time.display === undefined && grain === "total" && capabilities.year_scoped) {
    const { from, to } = primaryTimeRange(time, latest);
    // 年初归零指标跨日历年没有单一合计：服务端隐式降为按年（compatibleYearScopedGrain）。
    if (from.slice(0, 4) !== to.slice(0, 4)) return "year";
  }
  return grain;
}

/**
 * 各显示档在当前窗口下不可用的理由；空表示全部可用。唯一规则：按月定义 × 跨月 →
 * 镜像 compatibleTimeGrain 的显式分支。年初归零由合计位的终点降级承担（totalPeriodOf），
 * 不在本表内。
 */
export function timeDisplayIssues(
  time: TimeIntent,
  capabilities: TimeCapabilities,
  latest: string,
): Partial<Record<TimeDisplayChoice, string>> {
  const issues: Partial<Record<TimeDisplayChoice, string>> = {};
  if (requiresMonthlyDisplay(time, capabilities, latest)) {
    issues.year = "所选指标按月定义；跨月范围会自动按月返回。";
  }
  return issues;
}

/** 业务时间桶：月份原子构成的闭区间，终点恒为 to。 */
export type TimeBucket = { from: string; to: string };

/**
 * 时间层唯一的枚举规则：业务坐标 × 结果粒度 → 桶列表。截止月份是单月桶；按月逐月成桶；
 * 按年每个日历年一桶，期间不足整年时即部分年桶（2024-06 起的期间，2024 桶就是 6–12 月）；
 * 合计是整段一个大桶。桶只回答「切成哪几段」，不回答「怎么求值」——指标的 time_contract
 * 决定每个桶求和、求平均、取期末还是读取年初窗口。物理窗口编译与业务时间签名
 * 共用此规则，不得各自枚举。
 */
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
