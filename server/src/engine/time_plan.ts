/** 把业务时间坐标编译为 Cube 原生时间查询；业务时间只在本模块解析，其他模块复用解析结果。 */
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
import { physicalForm, resolveMetricTime, type TimeEvalForm } from "./metric_time.js";
import {
  metricTimeSelectionIssue,
  metricTimeCapabilities,
  resolveTimeSelection,
  timeAvailabilityIssue,
  TimeSelectionError,
  type TimeBucket,
  timeBuckets,
  type ResolvedTimeSelection,
  type TimeInput,
  type TimeOutputGrain,
  type TimeSelectionCoordinate,
} from "../semantic_core/time_contract.js";
import {
  parseYearMonth,
  YEAR_MONTH_REGEX,
  type YearMonth,
  yearMonthFromOrdinal,
  yearMonthOrdinal,
} from "../semantic_core/year_month.js";

export type TimeWindow = { from: string; to: string };

export type ResolvedTimeCoordinate = {
  kind: "cutoff" | "range";
  from: string;
  to: string;
  buckets: TimeBucket[];
};

export type BusinessTimeResolution = {
  outputGrain: TimeOutputGrain;
  /** 解析后的业务时间坐标及其时间桶。 */
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
  .object({ from: z.string().regex(YEAR_MONTH_REGEX), to: z.string().regex(YEAR_MONTH_REGEX) })
  .strict();

export const BUSINESS_TIME_SCHEMA = z
  .object({
    outputGrain: z.enum(["total", "year", "month"]),
    coordinates: z
      .array(
        z
          .object({
            kind: z.enum(["cutoff", "range"]),
            from: z.string().regex(YEAR_MONTH_REGEX),
            to: z.string().regex(YEAR_MONTH_REGEX),
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

const pad2 = (value: number) => String(value).padStart(2, "0");
const yearMonthOf = (date: string) => date.slice(0, 7);
const endOfMonth = (year: number, month: number) =>
  `${year}-${pad2(month)}-${pad2(new Date(year, month, 0).getDate())}`;

function requiredMonth(value: string): YearMonth {
  const parsed = parseYearMonth(value);
  if (!parsed) throw new Error(`月份「${value}」无效，请使用 YYYY-MM`);
  return parsed;
}

function monthsBetween(from: string, to: string): YearMonth[] {
  const first = yearMonthOrdinal(requiredMonth(from));
  const last = yearMonthOrdinal(requiredMonth(to));
  const values: YearMonth[] = [];
  for (let index = first; index <= last; index += 1) {
    values.push(yearMonthFromOrdinal(index));
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

function measureTimes(query: CubeQuery, views: CubeView[]) {
  const measures = new Map(
    views
      .flatMap((view) => [...view.measures, ...(view.internalMeasures ?? [])])
      .map((member) => [member.name, member]),
  );
  return (query.measures ?? []).map((name) => {
    const member = measures.get(name);
    if (!member) throw new Error("查询包含当前身份不可用的指标，请刷新指标列表后重试");
    return { name, title: member.title ?? name, time: resolveMetricTime(member, measures) };
  });
}

function assertMetricTimeSelection(
  measures: ReturnType<typeof measureTimes>,
  selection: ResolvedTimeSelection,
): void {
  const issue = metricTimeSelectionIssue(
    measures.map((measure) => ({
      title: measure.title,
      capabilities: metricTimeCapabilities(measure.time.contract),
    })),
    selection,
  );
  if (issue) throw new TimeSelectionError(issue);
}

export function queryTimeBounds(query: CubeQuery, context: TimeContext, views: CubeView[]) {
  const selectedViews = queryViews(query);
  const sources = unique(
    selectedViews.map((viewName) => {
      const sourceName = views.find((candidate) => candidate.name === viewName)?.meta?.time_source;
      if (typeof sourceName !== "string") {
        throw new Error(`指标域 ${viewName} 缺少可用时间范围，请联系服务维护者`);
      }
      return sourceName;
    }),
  );
  if (!sources.length) throw new Error("查询缺少可用的数据时间状态");
  const clocks = [];
  for (const id of sources) {
    const clock = context.sources[id];
    if (!clock) return { unavailable: id } as const;
    clocks.push(clock);
  }
  return {
    // 默认截止月取各来源实际数据都已覆盖的月份；显式上界可到计划数据覆盖的未来月份。
    defaultThrough: clocks.map((source) => source.actualThrough).sort()[0],
    availableThrough: clocks
      .map((source) => source.availableThrough)
      .sort()
      .at(-1)!,
  };
}

export type TimeEmission = { windows: TimeWindow[]; granularity?: "month" | "year" };
type EnumeratedCoordinate = { coordinate: TimeSelectionCoordinate; buckets: TimeBucket[] };

function monthWindow(month: string): TimeWindow {
  const at = requiredMonth(month);
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

/** 期末值指标按每个时间桶的末月生成单月窗口；截止月或逐月输出时用整段窗口按月分组。 */
function emitEndpoint(time: BusinessTimeResolution): TimeEmission {
  const perMonthBuckets = time.coordinates[0].kind === "cutoff" || time.outputGrain === "month";
  return {
    windows: perMonthBuckets
      ? time.coordinates.map(({ buckets }) => hullWindow(buckets))
      : time.coordinates.flatMap(({ buckets }) => buckets.map((bucket) => monthWindow(bucket.to))),
    granularity: "month",
  };
}

function enumerateCoordinates(
  coordinates: TimeSelectionCoordinate[],
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
  // period_month 由 make_date(year, month, 1) 计算；另加 year 谓词，让 parquet 读取按年份下推过滤。
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

/** 业务时间只通过此函数解析。 */
export function resolveTimePlanning(
  query: CubeQuery,
  time: TimeInput | undefined,
  context: TimeContext,
  views: CubeView[],
  preferredView?: string,
): ResolvedTimePlanning {
  if (!time) throw new Error("查询必须提供业务时间；使用截止月份或连续期间");
  if ("observation" in time && time.observation) throw new Error("期次选择须先解析为具体观测");
  assertNoRawTimeMembers(query);
  const view = queryTimeView(query, preferredView);
  const measures = measureTimes(query, views);
  const bounds = queryTimeBounds(query, context, views);
  if (bounds.unavailable !== undefined) {
    throw new Error(`数据时间状态 ${bounds.unavailable} 不可用，请稍后重试`);
  }
  const result = resolveTimeSelection(time, bounds.defaultThrough);
  if (result.status === "invalid") throw new TimeSelectionError(result.issue);
  const { selection } = result;
  const unavailable = timeAvailabilityIssue(selection, bounds.availableThrough);
  if (unavailable) throw new TimeSelectionError(unavailable);
  assertMetricTimeSelection(measures, selection);
  const enumerated = enumerateCoordinates(selection.coordinates, selection.outputGrain);
  const businessTime = {
    outputGrain: selection.outputGrain,
    coordinates: enumerated.map(resolvedCoordinate),
  } satisfies BusinessTimeResolution;
  return {
    businessTime,
    view,
    evalForms: new Map(measures.map((measure) => [measure.name, physicalForm(measure.time.basis)])),
  };
}

function emissionForQuery(query: CubeQuery, planning: ResolvedTimePlanning): TimeEmission {
  const forms = new Set(
    (query.measures ?? []).map((measure) => {
      const form = planning.evalForms.get(measure);
      if (!form) throw new Error(`指标 ${measure} 缺少已解析的时间求值方式`);
      return form;
    }),
  );
  if (!forms.size) forms.add("interval");
  const emissions = [...forms].map((form) => timeEmissionForForm(planning.businessTime, form));
  if (emissions.some((emission) => !sameTimeEmission(emissions[0], emission))) {
    throw new Error("单条物理查询不能混用不同时间窗口；查询编译器应先拆分物理子查询");
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
  const ranges = emission.windows.map((window) => [window.from, window.to] as [string, string]);
  const timeDimension = {
    dimension: axis,
    ...(emission.granularity ? { granularity: emission.granularity } : {}),
    ...(ranges.length === 1 ? { dateRange: ranges[0] } : { compareDateRange: ranges }),
  };
  return {
    query: withTime(query, view, yearsOf(emission.windows), timeDimension),
    time: { view, windows: emission.windows },
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
