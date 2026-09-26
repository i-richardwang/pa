/** Cube Core HTTP 适配器：鉴权、缓存和请求调用；Cube 的单窗/多窗应答只在这里转换成产品使用的结构。 */
import { SignJWT } from "jose";
import { z } from "zod";
import { accessScopeValues } from "../contracts/access_scope.js";
import { CELL_SCHEMA } from "../semantic_core/query_payload.js";
import { parseKnownTimeSourceId, type TimeSourceRegistry } from "../semantic_core/time_source.js";
import { CubeGatewayError } from "../ports/cube_gateway.js";
import type {
  CubeGateway,
  CubeMember,
  CubeQuery,
  CubeSecurityContext,
  CubeView,
  GeneratedSqlStatement,
  LoadResponse,
  SqlParameter,
  TimeContext,
  TimeSourceContext,
} from "../ports/cube_gateway.js";

const unavailable = (diagnostic: string, cause?: unknown): CubeGatewayError =>
  new CubeGatewayError("数据引擎暂时不可用，请稍后重试", {
    diagnostic,
    cause,
  });

export type CubeGatewayConfig = {
  cubeUrl: string;
  apiSecret: string;
  accessScopeId: string;
  serviceContext: CubeSecurityContext;
  timeSources: TimeSourceRegistry;
  /** 单次 HTTP 请求超时；Continue wait 的重试轮数由 loadRaw 单独限制。 */
  requestTimeoutMs?: number;
};

const TOKEN_TTL_S = 3600;
const META_TTL_MS = 5 * 60 * 1000;
/** PA_CUBE_REQUEST_TIMEOUT_MS 未设置时的默认值。 */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

type CubeGatewayState = {
  config: CubeGatewayConfig & { requestTimeoutMs: number };
  tokenCache: Map<string, { token: string; expiresAt: number }>;
  metaCache: Map<string, { views: CubeView[]; fetchedAt: number }>;
  timeContextCache: { value: TimeContext; fetchedAt: number } | null;
};

function contextKey(context: CubeSecurityContext): string {
  return JSON.stringify([context.subject, context.groups, context.accessScope]);
}

async function token(state: CubeGatewayState, context: CubeSecurityContext): Promise<string> {
  const key = contextKey(context);
  const cached = state.tokenCache.get(key);
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) return cached.token;
  const jwt = await new SignJWT({
    email: context.subject,
    groups: context.groups,
    data_scope: {
      id: state.config.accessScopeId,
      values: accessScopeValues(context.accessScope),
    },
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(context.subject)
    .setExpirationTime(`${TOKEN_TTL_S}s`)
    .sign(new TextEncoder().encode(state.config.apiSecret));
  state.tokenCache.set(key, {
    token: jwt,
    expiresAt: Date.now() + TOKEN_TTL_S * 1000,
  });
  return jwt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Cube 可能返回非 JSON 应答（如网关 502 页面）。 */
async function request(
  state: CubeGatewayState,
  path: string,
  context: CubeSecurityContext,
  init?: RequestInit,
): Promise<unknown> {
  let res: Response;
  let text: string;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), state.config.requestTimeoutMs);
  try {
    res = await fetch(`${state.config.cubeUrl}/cubejs-api/v1${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: await token(state, context),
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    text = await res.text();
  } catch (e) {
    throw unavailable(
      controller.signal.aborted
        ? `Cube 请求超过 ${state.config.requestTimeoutMs}ms：${path}`
        : `Cube 引擎不可达：${state.config.cubeUrl}`,
      e,
    );
  } finally {
    clearTimeout(timeout);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw unavailable(`Cube 引擎返回非 JSON 应答（HTTP ${res.status}）`);
  }
  if (!isRecord(body) && !Array.isArray(body)) {
    throw unavailable(`Cube 引擎应答格式异常（HTTP ${res.status}）`);
  }
  if (!res.ok && !(isRecord(body) && body.error)) throw unavailable(`Cube HTTP ${res.status}`);
  return body;
}

/** meta.internal 成员从公开 measures/dimensions 移到 internal* 字段，只供服务端解析模型契约。 */
function normalizeMetaViews(cubes: (CubeView & { type: string })[]): CubeView[] {
  const isInternal = (member: CubeMember) => member.meta?.internal === true;
  return cubes
    .filter((cube) => cube.type === "view")
    .map((view) => ({
      ...view,
      measures: view.measures.filter((member) => !isInternal(member)),
      dimensions: view.dimensions.filter((member) => !isInternal(member)),
      internalMeasures: view.measures.filter(isInternal),
      internalDimensions: view.dimensions.filter(isInternal),
    }));
}

const CUBE_MEMBER_SCHEMA = z.object({
  name: z.string(),
  title: z.string(),
  type: z.string(),
  shortTitle: z.string().optional(),
  description: z.string().optional(),
  aggType: z.string().optional(),
  format: z.string().optional(),
  aliasMember: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

const CUBE_HIERARCHY_SCHEMA = z.object({
  name: z.string(),
  title: z.string().optional(),
  levels: z.array(z.string()),
});

const META_SCHEMA = z.object({
  cubes: z.array(z.object({ type: z.string() }).passthrough()),
});

const META_VIEW_SCHEMA = z.object({
  type: z.literal("view"),
  name: z.string(),
  title: z.string(),
  description: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  measures: z.array(CUBE_MEMBER_SCHEMA),
  dimensions: z.array(CUBE_MEMBER_SCHEMA),
  hierarchies: z.array(CUBE_HIERARCHY_SCHEMA).optional(),
});

const ANNOTATION_MEMBERS_SCHEMA = z.record(
  z.string(),
  z.object({ title: z.string(), description: z.string().optional() }),
);

const LOAD_RESPONSE_SCHEMA = z.object({
  data: z.array(z.record(z.string(), CELL_SCHEMA)),
  annotation: z.object({
    measures: ANNOTATION_MEMBERS_SCHEMA,
    dimensions: ANNOTATION_MEMBERS_SCHEMA,
  }),
});

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw unavailable(`Cube ${label} 应答格式与预期不符：${parsed.error.message}`);
  return parsed.data;
}

async function fetchMeta(
  state: CubeGatewayState,
  context: CubeSecurityContext,
): Promise<CubeView[]> {
  const key = contextKey(context);
  const cached = state.metaCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < META_TTL_MS) return cached.views;
  const raw = await request(state, "/meta", context);
  if (!isRecord(raw)) throw unavailable("Cube /meta 应答格式异常");
  const body = raw;
  if (body.error) throw unavailable(`Cube /meta 错误：${String(body.error)}`);
  const views = normalizeMetaViews(
    parse(META_SCHEMA, body, "/meta")
      .cubes.filter((cube) => cube.type === "view")
      .map((cube, index) => parse(META_VIEW_SCHEMA, cube, `/meta cubes[${index}]`)),
  );
  state.metaCache.set(key, { views, fetchedAt: Date.now() });
  return views;
}

async function loadRaw(
  state: CubeGatewayState,
  query: CubeQuery,
  payload: Record<string, unknown>,
  context: CubeSecurityContext,
): Promise<Record<string, unknown>> {
  for (let i = 0; i < 30; i++) {
    const raw = await request(state, "/load", context, {
      method: "POST",
      body: JSON.stringify({ query, ...payload }),
    });
    if (!isRecord(raw)) throw unavailable("Cube /load 应答格式异常");
    const body = raw;
    if (body.error === "Continue wait") {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    if (body.error) throw unavailable(`Cube /load 错误：${String(body.error)}`);
    return body;
  }
  throw unavailable("Cube 查询超时（等待结果的重试次数已用完）");
}

async function fetchLoad(
  state: CubeGatewayState,
  query: CubeQuery,
  context: CubeSecurityContext,
): Promise<LoadResponse> {
  const body = await loadRaw(state, query, {}, context);
  return parse(LOAD_RESPONSE_SCHEMA, body, "/load");
}

/** compareDateRange 查询的 POST 体须带 queryType=multi；应答 results 的顺序与 compareDateRange 一致。 */
async function fetchLoadMulti(
  state: CubeGatewayState,
  query: CubeQuery,
  context: CubeSecurityContext,
): Promise<LoadResponse[]> {
  const body = await loadRaw(state, query, { queryType: "multi" }, context);
  if (!Array.isArray(body.results)) throw unavailable("Cube /load 多窗口查询的应答缺少 results");
  return body.results.map((result, index) =>
    parse(LOAD_RESPONSE_SCHEMA, result, `/load results[${index}]`),
  );
}

function isSqlParameter(value: unknown): value is SqlParameter {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
}

function sqlPair(value: unknown): [string, SqlParameter[]] | null {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    Array.isArray(value[1]) &&
    value[1].every(isSqlParameter)
  ) {
    return [value[0], value[1]];
  }
  return isRecord(value) && "sql" in value ? sqlPair(value.sql) : null;
}

/** 兼容 Cube /sql 对单期间与多期间查询的两种应答形态。 */
export function normalizeSqlResponse(query: CubeQuery, body: unknown): GeneratedSqlStatement[] {
  const direct = sqlPair(body);
  const rawStatements = direct ? [body] : Array.isArray(body) ? body : [body];
  const pairs = rawStatements.map(sqlPair);
  if (pairs.some((pair) => pair === null)) throw unavailable("Cube /sql 应答缺少 SQL 或参数");

  const time = query.timeDimensions?.[0];
  const ranges = time?.compareDateRange ?? (time?.dateRange ? [time.dateRange] : [null]);
  if (pairs.length !== ranges.length) {
    throw unavailable(`Cube /sql 应答窗口数异常：期望 ${ranges.length}，实际 ${pairs.length}`);
  }
  return pairs.map((pair, index) => ({
    window: ranges[index] ? { from: ranges[index]![0], to: ranges[index]![1] } : null,
    sql: pair![0],
    params: pair![1],
  }));
}

async function fetchSql(
  state: CubeGatewayState,
  query: CubeQuery,
  context: CubeSecurityContext,
): Promise<GeneratedSqlStatement[]> {
  const body = await request(
    state,
    `/sql?query=${encodeURIComponent(JSON.stringify(query))}`,
    context,
  );
  if (isRecord(body) && body.error) throw unavailable(`Cube /sql 错误：${String(body.error)}`);
  return normalizeSqlResponse(query, body);
}

const TIME_CONTEXT_TTL_MS = 10 * 60 * 1000;

export type TimeSourceAnchor = { view: string; measure: string };

/** 主时间来源必须有锚点；其他来源只要被执行 View 使用，就必须有唯一锚点。 */
export function resolveTimeSourceAnchors(
  views: CubeView[],
  registry: TimeSourceRegistry,
): Map<string, TimeSourceAnchor> {
  const anchors = new Map<string, TimeSourceAnchor>();
  const declared = new Set<string>();
  for (const view of views) {
    if (view.meta?.query_surface !== "metric_source") continue;
    const source = parseKnownTimeSourceId(
      view.meta.time_source,
      `执行 View ${view.name}`,
      registry,
    );
    declared.add(source);
    const anchorMeasure = view.meta.time_anchor_measure;
    if (anchorMeasure === undefined) continue;
    if (typeof anchorMeasure !== "string" || !anchorMeasure) {
      throw new Error(`执行 View ${view.name} 的时间锚点无效`);
    }
    const measure = `${view.name}.${anchorMeasure}`;
    if (!view.measures.some((candidate) => candidate.name === measure)) {
      throw new Error(`执行 View ${view.name} 的时间锚点 ${anchorMeasure} 不是公开指标`);
    }
    if (anchors.has(source)) throw new Error(`时间来源 ${source} 声明了多个锚点`);
    anchors.set(source, { view: view.name, measure: anchorMeasure });
  }
  for (const source of registry.definitions) {
    if (!source.primary && !declared.has(source.id)) continue;
    if (!anchors.has(source.id)) throw new Error(`时间来源 ${source.id} 缺少唯一时间锚点`);
  }
  return anchors;
}

/** 取某个公开指标有非零数据的最新月份；year/month 是不对外公开的内部分区维度。 */
async function latestMonth(
  state: CubeGatewayState,
  view: string,
  measure: string,
): Promise<string> {
  const res = await fetchLoad(
    state,
    {
      dimensions: [`${view}.year`, `${view}.month`],
      measures: [`${view}.${measure}`],
      filters: [{ member: `${view}.${measure}`, operator: "gt", values: ["0"] }],
      order: [
        [`${view}.year`, "desc"],
        [`${view}.month`, "desc"],
      ],
      limit: 1,
    },
    state.config.serviceContext,
  );
  const row = res.data[0];
  if (!row) throw unavailable(`无法确定 ${view}.${measure} 的可用月份`);
  const integer = (value: unknown, label: string, from: number, to: number): number => {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string" && /^\d+$/.test(value.trim())
          ? Number(value)
          : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < from || parsed > to) {
      throw unavailable(`${view}.${measure} 返回无效的 ${label}`);
    }
    return parsed;
  };
  const year = integer(row[`${view}.year`], "year", 1_000, 9_999);
  const month = integer(row[`${view}.month`], "month", 1, 12);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * actualThrough 取 reference_source 的最新月份，作为默认参考月；
 * availableThrough 取本来源的最新月份，作为显式查询的上界。
 */
async function fetchTimeContext(state: CubeGatewayState): Promise<TimeContext> {
  if (
    state.timeContextCache &&
    Date.now() - state.timeContextCache.fetchedAt < TIME_CONTEXT_TTL_MS
  ) {
    return state.timeContextCache.value;
  }
  const anchors = resolveTimeSourceAnchors(
    await fetchMeta(state, state.config.serviceContext),
    state.config.timeSources,
  );
  // 当前语义包未使用的时间来源不进入上下文；客户端按目录的 time_sources 判断可用来源
  const present = state.config.timeSources.definitions.filter((source) => anchors.has(source.id));
  const anchorMonths = new Map(
    await Promise.all(
      present.map(async (source) => {
        const anchor = anchors.get(source.id)!;
        return [source.id, await latestMonth(state, anchor.view, anchor.measure)] as const;
      }),
    ),
  );
  const sources: Record<string, TimeSourceContext> = {};
  for (const source of present) {
    const actualThrough = anchorMonths.get(source.reference_source);
    if (actualThrough === undefined) {
      throw new Error(`时间来源 ${source.id} 引用的实际数据来源 ${source.reference_source} 不存在`);
    }
    const availableThrough = anchorMonths.get(source.id)!;
    sources[source.id] = {
      actualThrough,
      availableThrough,
      ...(source.role === "plan" ? { planThrough: availableThrough } : {}),
    };
  }
  const dataAsOf = anchorMonths.get(state.config.timeSources.primary.id)!;
  const value: TimeContext = {
    dataAsOf,
    sources,
  };
  state.timeContextCache = { value, fetchedAt: Date.now() };
  return value;
}

export function createCubeGateway(config: CubeGatewayConfig): CubeGateway {
  const state: CubeGatewayState = {
    config: { ...config, requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS },
    tokenCache: new Map(),
    metaCache: new Map(),
    timeContextCache: null,
  };
  return {
    meta: (context) => fetchMeta(state, context),
    load: (query, context) => fetchLoad(state, query, context),
    loadMulti: (query, context) => fetchLoadMulti(state, query, context),
    sql: (query, context) => fetchSql(state, query, context),
    timeContext: () => fetchTimeContext(state),
  };
}
