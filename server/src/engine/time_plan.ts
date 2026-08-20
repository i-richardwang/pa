/** 业务时间坐标到 Cube 原生时间查询的唯一编译点。 */
import { z } from "zod";
import { memberShortName } from "../semantic_core/member_name.js";
import type {
  CubeFilter,
  CubeFilterCondition,
  CubeQuery,
  CubeView,
  TimeContext,
} from "../ports/cube_gateway.js";
import { filterMembers } from "./query_contract.js";
import { physicalEvaluation, resolveMetricTime } from "./metric_time.js";
import {
  expandTimeCompare,
  expandTimeWindow,
  resolveTimeOutputGrain,
  type TimeBucket,
  timeBuckets,
  type TimeInput,
  type TimeOutputGrain,
} from "../semantic_core/time_contract.js";

export type TimeWindow = { from: string; to: string };

export type ResolvedTimeCoordinate = {
  kind: "cutoff" | "range";
  from: string;
  to: string;
  buckets: TimeBucket[];
};

export type BusinessTimeResolution = {
  outputGrain: TimeOutputGrain;
  /** 唯一编译点解析出的业务坐标与其桶；业务时间的事实来源。 */
  coordinates: ResolvedTimeCoordinate[];
};

export type PhysicalTimeResolution = {
  view: string;
  windows: TimeWindow[];
};

export type ResultTimeBucket = {
  key: { year: number; month?: number } | null;
  from: string;
  to: string;
};

export type ResultTimeCoordinate = {
  role: "primary" | "comparison";
  from: string;
  to: string;
};

export function resultCoordinates(resolution: BusinessTimeResolution): ResultTimeCoordinate[] {
  return resolution.coordinates.map((coordinate, index) => ({
    role: index === 0 ? "primary" : "comparison",
    from: coordinate.from,
    to: coordinate.to,
  }));
}

function resultBucketKey(bucket: TimeBucket, grain: TimeOutputGrain): ResultTimeBucket["key"] {
  if (grain === "total") return null;
  const year = Number(bucket.to.slice(0, 4));
  return grain === "year" ? { year } : { year, month: Number(bucket.to.slice(5, 7)) };
}

export function resultBuckets(resolution: BusinessTimeResolution): ResultTimeBucket[] {
  return resolution.coordinates.flatMap((coordinate) =>
    coordinate.buckets.map((bucket) => ({
      key: resultBucketKey(bucket, resolution.outputGrain),
      from: bucket.from,
      to: bucket.to,
    })),
  );
}

export type PlannedQueryLeg = { query: CubeQuery; time: PhysicalTimeResolution };
export type PlannedQuery = PlannedQueryLeg & { businessTime: BusinessTimeResolution };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RANGE = z.tuple([z.string().regex(DATE), z.string().regex(DATE)]);
const FILTER_CONDITION = z
  .object({
    member: z.string().min(1),
    operator: z.string().min(1),
    values: z.array(z.string()).optional(),
  })
  .strict();
const CUBE_FILTER: z.ZodType<CubeFilter> = z.lazy(() =>
  z.union([
    FILTER_CONDITION,
    z.object({ or: z.array(CUBE_FILTER).min(1) }).strict(),
    z.object({ and: z.array(CUBE_FILTER).min(1) }).strict(),
  ]),
);
const CUBE_QUERY: z.ZodType<CubeQuery> = z
  .object({
    measures: z.array(z.string().min(1)).optional(),
    dimensions: z.array(z.string().min(1)).optional(),
    filters: z.array(CUBE_FILTER).optional(),
    timeDimensions: z
      .array(
        z
          .object({
            dimension: z.string().min(1),
            granularity: z.enum(["month", "year"]).optional(),
            dateRange: DATE_RANGE.optional(),
            compareDateRange: z.array(DATE_RANGE).min(1).optional(),
          })
          .strict()
          .refine((value) => !(value.dateRange && value.compareDateRange), {
            message: "dateRange 与 compareDateRange 不能同时存在",
          }),
      )
      .max(1)
      .optional(),
    order: z.array(z.tuple([z.string().min(1), z.enum(["asc", "desc"])])).optional(),
    limit: z.number().int().positive().max(50000).optional(),
    offset: z.number().int().nonnegative().max(50000).optional(),
  })
  .strict();

const TIME_BUCKET = z
  .object({ from: z.string().regex(MONTH), to: z.string().regex(MONTH) })
  .strict();

export const BUSINESS_TIME_SCHEMA = z
  .object({
    outputGrain: z.enum(["total", "year", "month"]),
    coordinates: z
      .array(
        z
          .object({
            kind: z.enum(["cutoff", "range"]),
            from: z.string().regex(MONTH),
            to: z.string().regex(MONTH),
            buckets: z.array(TIME_BUCKET).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict() satisfies z.ZodType<BusinessTimeResolution>;

export const PLANNED_QUERY_LEG_SCHEMA = z
  .object({
    query: CUBE_QUERY,
    time: z
      .object({
        view: z.string().min(1),
        windows: z
          .array(z.object({ from: z.string().regex(DATE), to: z.string().regex(DATE) }).strict())
          .min(1),
      })
      .strict(),
  })
  .strict() satisfies z.ZodType<PlannedQueryLeg>;

type Month = { year: number; month: number };
type LogicalCoordinate =
  | { kind: "cutoff"; cutoff: string }
  | { kind: "range"; from: string; to: string };
const pad2 = (value: number) => String(value).padStart(2, "0");
const yearMonthOf = (date: string) => date.slice(0, 7);
const endOfMonth = (year: number, month: number) =>
  `${year}-${pad2(month)}-${pad2(new Date(year, month, 0).getDate())}`;

function parseMonth(value: string): Month {
  const [year, month] = value.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`月份「${value}」无效，请使用 YYYY-MM`);
  }
  return { year, month };
}

function monthIndex(value: Month): number {
  return value.year * 12 + value.month;
}

function monthsBetween(from: string, to: string): Month[] {
  const first = parseMonth(from);
  const last = parseMonth(to);
  const values: Month[] = [];
  for (let index = monthIndex(first); index <= monthIndex(last); index += 1) {
    const year = Math.floor((index - 1) / 12);
    values.push({ year, month: index - year * 12 });
  }
  return values;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function queryViews(query: CubeQuery): string[] {
  const members = [
    ...(query.measures ?? []),
    ...(query.dimensions ?? []),
    ...filterMembers(query.filters),
    ...(query.order ?? []).map(([member]) => member),
  ];
  return unique(members.map((member) => member.split(".")[0]).filter(Boolean));
}

function queryTimeView(query: CubeQuery, preferredView?: string): string {
  const views = queryViews(query);
  if (preferredView) return preferredView;
  if (!views.length) throw new Error("查询缺少可用于时间规划的指标域");
  return views[0];
}

function assertNoRawTimeMembers(query: CubeQuery): void {
  const members = [
    ...(query.dimensions ?? []),
    ...filterMembers(query.filters),
    ...(query.order ?? []).map(([member]) => member),
  ];
  const hit = members.find((member) =>
    ["year", "month", "period_month"].includes(memberShortName(member)),
  );
  if (hit) {
    throw new Error("时间字段不能直接分组、筛选或排序，请使用截止月份、连续期间和结果粒度");
  }
}

function measureContracts(query: CubeQuery, views: CubeView[]) {
  const measures = new Map(
    views
      .flatMap((view) => [...view.measures, ...(view.internalMeasures ?? [])])
      .map((member) => [member.name, member]),
  );
  return (query.measures ?? []).map((name) => {
    const member = measures.get(name);
    if (!member) throw new Error("查询包含当前身份不可用的指标，请刷新指标列表后重试");
    const resolved = resolveMetricTime(member, measures);
    return {
      name,
      title: member.title ?? name,
      contract: resolved.contract,
      evaluation: resolved.evaluation,
    };
  });
}

export type TimeEvalForm = "interval" | "endpoint";

function compatibleTimeGrain(
  contracts: ReturnType<typeof measureContracts>,
  coordinates: LogicalCoordinate[],
  grain: TimeOutputGrain,
  explicit: boolean,
): TimeOutputGrain {
  const monthly = contracts.filter((contract) => contract.contract.grain === "month");
  if (!monthly.length) return grain;
  const combinesMonths = coordinates.some(
    (coordinate) =>
      coordinate.kind === "range" &&
      monthIndex(parseMonth(coordinate.from)) !== monthIndex(parseMonth(coordinate.to)),
  );
  if (combinesMonths && grain !== "month") {
    if (!explicit) return "month";
    throw new Error(
      `指标「${monthly.map((contract) => contract.title).join("、")}」按月定义；` +
        "连续期间请改为按月呈现，不能合并多个月份",
    );
  }
  return grain;
}

function compatibleYearScopedGrain(
  contracts: ReturnType<typeof measureContracts>,
  coordinates: LogicalCoordinate[],
  grain: TimeOutputGrain,
  explicit: boolean,
): TimeOutputGrain {
  if (explicit || grain !== "total") return grain;
  if (!contracts.some((contract) => contract.contract.window === "year_to_date")) return grain;
  const crossesYears = coordinates.some(
    (coordinate) =>
      coordinate.kind === "range" && coordinate.from.slice(0, 4) !== coordinate.to.slice(0, 4),
  );
  return crossesYears ? "year" : grain;
}

function timeBounds(query: CubeQuery, context: TimeContext, views: CubeView[]) {
  const selectedViews = queryViews(query);
  const sources = unique(
    selectedViews.map((viewName) => {
      const sourceName = views.find((candidate) => candidate.name === viewName)?.meta?.time_source;
      if (typeof sourceName !== "string") {
        throw new Error(`指标域 ${viewName} 缺少可用时间范围，请联系服务维护者`);
      }
      return sourceName;
    }),
  ).map((sourceName) => {
    const source = context.sources[sourceName];
    if (!source) throw new Error(`数据时间状态 ${sourceName} 不可用，请稍后重试`);
    return source;
  });
  if (!sources.length) throw new Error("查询缺少可用的数据时间状态");
  return {
    // 默认时间取所有来源都已具备的最近月份；显式查询上界允许计划域延伸到未来。
    defaultThrough: sources.map((source) => source.actualThrough).sort()[0],
    availableThrough: sources
      .map((source) => source.availableThrough)
      .sort()
      .at(-1)!,
  };
}

function coordinatesOf(time: TimeInput, defaultThrough: string): LogicalCoordinate[] {
  const base: LogicalCoordinate = time.range
    ? { kind: "range", from: time.range.from, to: time.range.to }
    : { kind: "cutoff", cutoff: time.cutoff ?? defaultThrough };
  const compare = (time.compare ?? []).map((coordinate): LogicalCoordinate => {
    if ("range" in coordinate) {
      return { kind: "range", from: coordinate.range.from, to: coordinate.range.to };
    }
    if ("years_ago" in coordinate || "previous_period" in coordinate) {
      throw new Error("相对对照未展开为绝对坐标，请联系服务维护者");
    }
    return { kind: "cutoff", cutoff: coordinate.cutoff };
  });
  return [base, ...compare];
}

function coordinateLabel(coordinate: LogicalCoordinate): string {
  return coordinate.kind === "cutoff"
    ? coordinate.cutoff
    : `${coordinate.from} 至 ${coordinate.to}`;
}

function assertCoordinates(coordinates: LogicalCoordinate[], availableThrough: string): void {
  const available = parseMonth(availableThrough);
  for (const coordinate of coordinates) {
    const from = parseMonth(coordinate.kind === "cutoff" ? coordinate.cutoff : coordinate.from);
    const to = parseMonth(coordinate.kind === "cutoff" ? coordinate.cutoff : coordinate.to);
    if (monthIndex(from) > monthIndex(to)) {
      throw new Error(
        `时间范围「${coordinateLabel(coordinate)}」的开始月份不能晚于结束月份；` +
          "请调整为开始月份早于或等于结束月份",
      );
    }
    if (monthIndex(to) > monthIndex(available)) {
      throw new Error(
        `当前数据可查询至 ${availableThrough}，不能查询 ${coordinateLabel(coordinate)}；` +
          `请把结束月份改为 ${availableThrough} 或更早月份`,
      );
    }
  }
  const labels = coordinates.map(coordinateLabel);
  const duplicate = labels.find((label, index) => labels.indexOf(label) !== index);
  if (duplicate) throw new Error(`主时间与对照时间重复：${duplicate}`);
}

export type TimeEmission = { windows: TimeWindow[]; granularity?: "month" | "year" };
type EnumeratedCoordinate = { coordinate: LogicalCoordinate; buckets: TimeBucket[] };

function monthWindow(month: string): TimeWindow {
  const at = parseMonth(month);
  return { from: `${month}-01`, to: endOfMonth(at.year, at.month) };
}

function hullWindow(buckets: TimeBucket[]): TimeWindow {
  return { from: `${buckets[0].from}-01`, to: monthWindow(buckets[buckets.length - 1].to).to };
}

function bucketGranularity(
  coordinate: ResolvedTimeCoordinate,
  grain: TimeOutputGrain,
): "month" | "year" | undefined {
  if (coordinate.kind === "cutoff" || grain === "month") return "month";
  return grain === "year" ? "year" : undefined;
}

function emitInterval(time: BusinessTimeResolution): TimeEmission {
  const granularity = bucketGranularity(time.coordinates[0], time.outputGrain);
  return {
    windows: time.coordinates.map(({ buckets }) => hullWindow(buckets)),
    ...(granularity ? { granularity } : {}),
  };
}

/** 终点求值按桶终点发射单月窗口；逐月时可合并为整段窗口。 */
function emitEndpoint(time: BusinessTimeResolution): TimeEmission {
  const perMonthBuckets = time.coordinates[0].kind === "cutoff" || time.outputGrain === "month";
  return {
    windows: perMonthBuckets
      ? time.coordinates.map(({ buckets }) => hullWindow(buckets))
      : time.coordinates.flatMap(({ buckets }) => buckets.map((bucket) => monthWindow(bucket.to))),
    granularity: "month",
  };
}

function assertYearToDateBuckets(time: BusinessTimeResolution, enabled: boolean): void {
  if (!enabled) return;
  for (const coordinate of time.coordinates) {
    const { buckets } = coordinate;
    if (buckets.some((bucket) => bucket.from.slice(0, 4) !== bucket.to.slice(0, 4))) {
      throw new Error(
        `YTD 指标跨多个日历年时无法合并为一个合计（「${coordinate.from} 至 ${coordinate.to}」）；` +
          "请改为按年或按月呈现，或改用一个截止月份表达单一终点",
      );
    }
  }
}

function enumerateCoordinates(
  coordinates: LogicalCoordinate[],
  grain: TimeOutputGrain,
): EnumeratedCoordinate[] {
  const kind = coordinates[0]?.kind;
  if (coordinates.some((coordinate) => coordinate.kind !== kind)) {
    throw new Error("对照时间类型不一致");
  }
  return coordinates.map((coordinate) => ({
    coordinate,
    buckets: timeBuckets(coordinate, grain),
  }));
}

function resolvedCoordinate({ coordinate, buckets }: EnumeratedCoordinate): ResolvedTimeCoordinate {
  return {
    kind: coordinate.kind,
    from: coordinate.kind === "cutoff" ? coordinate.cutoff : coordinate.from,
    to: coordinate.kind === "cutoff" ? coordinate.cutoff : coordinate.to,
    buckets,
  };
}

export function timeEmissionForForm(
  time: BusinessTimeResolution,
  form: TimeEvalForm,
): TimeEmission {
  return form === "interval" ? emitInterval(time) : emitEndpoint(time);
}

export function sameTimeEmission(left: TimeEmission, right: TimeEmission): boolean {
  return (
    left.granularity === right.granularity &&
    left.windows.length === right.windows.length &&
    left.windows.every(
      (window, index) =>
        window.from === right.windows[index].from && window.to === right.windows[index].to,
    )
  );
}

function yearsOf(windows: TimeWindow[]): number[] {
  return unique(
    windows.flatMap((window) =>
      monthsBetween(yearMonthOf(window.from), yearMonthOf(window.to)).map(({ year }) => year),
    ),
  ).sort((left, right) => left - right);
}

function partitionFilter(view: string, years: number[]): CubeFilterCondition {
  // period_month 由 make_date(year, month, 1) 计算，裸年份谓词用于 parquet pushdown。
  return { member: `${view}.year`, operator: "equals", values: years.map(String) };
}

function withTime(
  query: CubeQuery,
  view: string,
  years: number[],
  timeDimension: NonNullable<CubeQuery["timeDimensions"]>[number],
): CubeQuery {
  return {
    ...query,
    filters: [...(query.filters ?? []), partitionFilter(view, years)],
    timeDimensions: [timeDimension],
  };
}

export type ResolvedTimePlanning = {
  businessTime: BusinessTimeResolution;
  view: string;
  evalForms: ReadonlyMap<string, TimeEvalForm>;
};

/** 业务时间的唯一解析入口。 */
export function resolveTimePlanning(
  query: CubeQuery,
  time: TimeInput | undefined,
  context: TimeContext,
  views: CubeView[],
  preferredView?: string,
): ResolvedTimePlanning {
  if (!time) throw new Error("查询必须提供业务时间；使用截止月份或连续期间");
  assertNoRawTimeMembers(query);
  const view = queryTimeView(query, preferredView);
  const contracts = measureContracts(query, views);
  const bounds = timeBounds(query, context, views);
  // 窗口先于对照展开：相对窗口先落为绝对 range，年同移的相对对照再作用其上。
  const resolved = expandTimeCompare(
    expandTimeWindow(time, bounds.defaultThrough),
    bounds.defaultThrough,
  );
  const coordinates = coordinatesOf(resolved, bounds.defaultThrough);
  assertCoordinates(coordinates, bounds.availableThrough);
  const explicitGrain = time.grain !== undefined;
  const grain = compatibleYearScopedGrain(
    contracts,
    coordinates,
    compatibleTimeGrain(
      contracts,
      coordinates,
      resolveTimeOutputGrain(time, bounds.defaultThrough, {
        grouped: (query.dimensions ?? []).length > 0,
      }),
      explicitGrain,
    ),
    explicitGrain,
  );
  const enumerated = enumerateCoordinates(coordinates, grain);
  const businessTime = {
    outputGrain: grain,
    coordinates: enumerated.map(resolvedCoordinate),
  } satisfies BusinessTimeResolution;
  assertYearToDateBuckets(
    businessTime,
    contracts.some((contract) => contract.contract.window === "year_to_date"),
  );
  return {
    businessTime,
    view,
    evalForms: new Map(
      contracts.map((contract) => [contract.name, physicalEvaluation(contract.evaluation)]),
    ),
  };
}

function emissionForQuery(query: CubeQuery, planning: ResolvedTimePlanning): TimeEmission {
  const forms = new Set(
    (query.measures ?? []).map((measure) => {
      const form = planning.evalForms.get(measure);
      if (!form) throw new Error(`指标 ${measure} 缺少已解析的时间求值形态`);
      return form;
    }),
  );
  if (!forms.size) forms.add("interval");
  const emissions = [...forms].map((form) => timeEmissionForForm(planning.businessTime, form));
  if (emissions.some((emission) => !sameTimeEmission(emissions[0], emission))) {
    throw new Error("单条物理查询不能混用不同时间窗口；查询编译器应先拆分物理查询腿");
  }
  return emissions[0];
}

export function planResolvedTimeQuery(
  query: CubeQuery,
  planning: ResolvedTimePlanning,
  emission: TimeEmission = emissionForQuery(query, planning),
): PlannedQueryLeg {
  assertNoRawTimeMembers(query);
  const { view } = planning;
  const axis = `${view}.period_month`;
  const physical = emission;
  const ranges = physical.windows.map((window) => [window.from, window.to] as [string, string]);
  const timeDimension = {
    dimension: axis,
    ...(physical.granularity ? { granularity: physical.granularity } : {}),
    ...(ranges.length === 1 ? { dateRange: ranges[0] } : { compareDateRange: ranges }),
  };
  return {
    query: withTime(query, view, yearsOf(physical.windows), timeDimension),
    time: { view, windows: physical.windows },
  };
}

export function planTimeQuery(
  query: CubeQuery,
  time: TimeInput | undefined,
  context: TimeContext,
  views: CubeView[],
  preferredView?: string,
): PlannedQuery {
  const planning = resolveTimePlanning(query, time, context, views, preferredView);
  return {
    ...planResolvedTimeQuery(query, planning),
    businessTime: planning.businessTime,
  };
}

export function withPlannedLimit(plan: PlannedQuery, limit: number | undefined): PlannedQuery;
export function withPlannedLimit(plan: PlannedQueryLeg, limit: number | undefined): PlannedQueryLeg;
export function withPlannedLimit<T extends PlannedQuery | PlannedQueryLeg>(
  plan: T,
  limit: number | undefined,
): T {
  return { ...plan, query: { ...plan.query, limit } };
}
