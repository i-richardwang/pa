/** 执行已规划的单一 Cube 时间查询；多窗只做结果平铺，不重新推断时间语义。 */
import { compareCells } from "../presentation_core/view_format.js";
import type {
  CubeGateway,
  CubeCell,
  CubeQuery,
  CubeSecurityContext,
  LoadResponse,
} from "../ports/cube_gateway.js";
import type { PlannedQuery } from "./time_plan.js";
import { ResultLimitExceededError } from "./result_limit.js";

const MULTI_QUERY_LIMIT = 5000;

export type ResolvedLoad = LoadResponse;

const orderCell = (value: CubeCell): CubeCell =>
  value == null ? null : typeof value === "number" ? value : String(value);

const comparator =
  (order: [string, "asc" | "desc"][]) =>
  (a: Record<string, CubeCell>, b: Record<string, CubeCell>): number => {
    for (const [member, direction] of order) {
      const result = compareCells(orderCell(a[member]), orderCell(b[member]));
      if (result) return direction === "desc" ? -result : result;
    }
    return 0;
  };

export function sortRowsByOrder(
  rows: Record<string, CubeCell>[],
  order: [string, "asc" | "desc"][],
): Record<string, CubeCell>[] {
  if (order.length) rows.sort(comparator(order));
  return rows;
}

type TimeOutputPart = "year" | "month";

/** 月粒度的完整行键是 year + month；所有出口从这一处派生时间列。 */
function timeOutputParts(plan: PlannedQuery): TimeOutputPart[] {
  if (plan.businessTime.outputGrain === "year") return ["year"];
  if (plan.businessTime.outputGrain === "month") return ["year", "month"];
  return [];
}

function timeOutputMembers(plan: PlannedQuery): string[] {
  return timeOutputParts(plan).map((part) => `${plan.time.view}.${part}`);
}

function bucketKey(plan: PlannedQuery): string | null {
  const td = plan.query.timeDimensions?.[0];
  return td?.granularity ? `${plan.time.view}.period_month.${td.granularity}` : null;
}

function shapeRow(
  plan: PlannedQuery,
  row: Record<string, CubeCell>,
  rangeYear?: number,
): Record<string, CubeCell> {
  const bucket = String(
    (bucketKey(plan) && row[bucketKey(plan)!]) ?? row[`${plan.time.view}.period_month`] ?? "",
  );
  const bucketYear = bucket.length >= 4 ? Number(bucket.slice(0, 4)) : Number.NaN;
  const year = Number.isInteger(bucketYear) ? bucketYear : rangeYear;
  const month = Number(bucket.slice(5, 7));
  const result: Record<string, CubeCell> = {};
  for (const dimension of plan.query.dimensions ?? []) result[dimension] = row[dimension] ?? null;
  for (const part of timeOutputParts(plan)) {
    if (part === "year" && year === undefined) {
      throw new Error("时间查询结果缺少有效年份，请联系服务维护者");
    }
    result[`${plan.time.view}.${part}`] = String(part === "year" ? year : month);
  }
  for (const measure of plan.query.measures ?? []) result[measure] = row[measure] ?? null;
  return result;
}

function annotation(plan: PlannedQuery, results: LoadResponse[]): LoadResponse["annotation"] {
  const first = results[0]?.annotation ?? { measures: {}, dimensions: {} };
  const dimensions = Object.fromEntries(
    (plan.query.dimensions ?? []).flatMap((name) =>
      first.dimensions[name] ? [[name, first.dimensions[name]]] : [],
    ),
  );
  for (const part of timeOutputParts(plan)) {
    dimensions[`${plan.time.view}.${part}`] =
      part === "year"
        ? { title: "年", description: "结果对应的年份。" }
        : { title: "月", description: "结果对应的月份。" };
  }
  const measures = Object.fromEntries(
    (plan.query.measures ?? []).flatMap((name) =>
      first.measures[name] ? [[name, first.measures[name]]] : [],
    ),
  );
  return { measures, dimensions };
}

export function outputMembers(plan: PlannedQuery): string[] {
  return [
    ...(plan.query.dimensions ?? []),
    ...timeOutputMembers(plan),
    ...(plan.query.measures ?? []),
  ];
}

/** 引擎结果到产品结果的纯转换边界，供执行路径和最终行契约测试共用。 */
export function resolvePlannedResults(plan: PlannedQuery, results: LoadResponse[]): ResolvedLoad {
  const rows = results.flatMap((result, index) =>
    result.data.map((row) =>
      shapeRow(
        plan,
        row,
        results.length > 1 ? Number(plan.time.windows[index]?.from.slice(0, 4)) : undefined,
      ),
    ),
  );
  const timeOrder = timeOutputMembers(plan).map((member): [string, "asc"] => [member, "asc"]);
  const order = [...(plan.query.order ?? []), ...timeOrder];
  if (order.length) rows.sort(comparator(order));
  const requestedLimit = plan.query.limit;
  return {
    data: requestedLimit == null ? rows : rows.slice(0, requestedLimit),
    annotation: annotation(plan, results),
  };
}

export async function executePlanned(
  cube: Pick<CubeGateway, "load" | "loadMulti">,
  plan: PlannedQuery,
  context: CubeSecurityContext,
  multiLimit = MULTI_QUERY_LIMIT,
): Promise<ResolvedLoad> {
  const requestedLimit = plan.query.limit;
  const compare = plan.query.timeDimensions?.[0]?.compareDateRange;
  const executionQuery: CubeQuery = compare
    ? { ...plan.query, limit: Math.max(requestedLimit ?? 0, multiLimit) }
    : plan.query;
  const results = compare
    ? await cube.loadMulti(executionQuery, context)
    : [await cube.load(executionQuery, context)];
  if (
    compare &&
    results.some((result) => result.data.length >= (executionQuery.limit ?? multiLimit))
  ) {
    throw new ResultLimitExceededError(
      `多窗查询命中取回上限（${executionQuery.limit ?? multiLimit} 行），请增加过滤或减少分组维度`,
      { limit: executionQuery.limit ?? multiLimit },
    );
  }
  return resolvePlannedResults(plan, results);
}

/** 完整结果执行：每个物理时间窗口独立使用探测上限，命中即拒绝，不把上限写回业务计划。 */
export async function executeCompletePlanned(
  cube: Pick<CubeGateway, "load" | "loadMulti">,
  plan: PlannedQuery,
  context: CubeSecurityContext,
  perWindowLimit = MULTI_QUERY_LIMIT,
): Promise<ResolvedLoad> {
  if (plan.query.limit !== undefined) {
    throw new Error("完整结果执行计划不能携带物理行 limit");
  }
  const compare = plan.query.timeDimensions?.[0]?.compareDateRange;
  const executionQuery: CubeQuery = { ...plan.query, limit: perWindowLimit };
  const results = compare
    ? await cube.loadMulti(executionQuery, context)
    : [await cube.load(executionQuery, context)];
  if (results.some((result) => result.data.length >= perWindowLimit)) {
    throw new ResultLimitExceededError(
      `完整查询命中单窗取回上限（${perWindowLimit} 行），请增加过滤或减少分组维度`,
      { limit: perWindowLimit },
    );
  }
  return resolvePlannedResults(plan, results);
}

/** 有界完整性探测：供导出使用；返回触顶状态而不是把触顶结果误当完整数据。 */
export async function executeBoundedPlanned(
  cube: Pick<CubeGateway, "load" | "loadMulti">,
  plan: PlannedQuery,
  context: CubeSecurityContext,
  perWindowLimit: number,
): Promise<{ load: ResolvedLoad; complete: boolean }> {
  if (plan.query.limit !== undefined) throw new Error("有界完整性探测不能携带业务行数限制");
  const compare = plan.query.timeDimensions?.[0]?.compareDateRange;
  const executionQuery: CubeQuery = { ...plan.query, limit: perWindowLimit };
  const results = compare
    ? await cube.loadMulti(executionQuery, context)
    : [await cube.load(executionQuery, context)];
  return {
    load: resolvePlannedResults(plan, results),
    complete: results.every((result) => result.data.length < perWindowLimit),
  };
}
