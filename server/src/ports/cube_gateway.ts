/**
 * Cube 查询引擎端口：领域与应用层只依赖这里的稳定产品契约。
 * HTTP、JWT、缓存、重试和原始响应归一属于外部适配器实现，不进入本模块。
 */

export type SqlParameter = string | number | boolean | null;

export type GeneratedSqlStatement = {
  window: { from: string; to: string } | null;
  sql: string;
  params: SqlParameter[];
};

export interface CubeMember {
  name: string;
  title: string;
  shortTitle?: string;
  description?: string;
  /** /v1/meta 中度量恒为 number（值类型）；聚合类型看 aggType。 */
  type: string;
  /** Cube /meta 的度量聚合类型（count/countDistinct/sum/number…）。 */
  aggType?: string;
  /** 度量呈现格式（模型层声明）；percent 标识率指标。 */
  format?: string;
  /** 视图成员指回底层 cube 成员，用于归并同一规范指标。 */
  aliasMember?: string;
  meta?: Record<string, unknown>;
}

export interface CubeHierarchy {
  name: string;
  title?: string;
  /** 层级成员名（view 前缀），从粗到细。 */
  levels: string[];
}

export interface CubeView {
  name: string;
  title: string;
  description?: string;
  meta?: Record<string, unknown>;
  measures: CubeMember[];
  dimensions: CubeMember[];
  /** 仅供服务端解析模型契约，不进入目录与结构化查询面。 */
  internalMeasures?: CubeMember[];
  internalDimensions?: CubeMember[];
  hierarchies?: CubeHierarchy[];
}

export interface CubeFilterCondition {
  member: string;
  operator: string;
  values?: string[];
}

/** 布尔组合过滤只在服务端内部查询使用，对外查询面仍是扁平条件。 */
export type CubeFilter = CubeFilterCondition | { or: CubeFilter[] } | { and: CubeFilter[] };

export interface CubeTimeDimension {
  dimension: string;
  granularity?: "month" | "year";
  dateRange?: [string, string];
  /** 同期多窗按数组顺序逐窗执行。 */
  compareDateRange?: [string, string][];
}

export interface CubeQuery {
  measures?: string[];
  dimensions?: string[];
  filters?: CubeFilter[];
  timeDimensions?: CubeTimeDimension[];
  order?: [string, "asc" | "desc"][];
  limit?: number;
  offset?: number;
}

export interface LoadResponse {
  data: Record<string, unknown>[];
  annotation: {
    measures: Record<string, { title: string; description?: string }>;
    dimensions: Record<string, { title: string; description?: string }>;
  };
}

export type TimeSourceContext = {
  actualThrough: string;
  availableThrough: string;
  planThrough?: string;
};

export type TimeContext = {
  /** 人员快照与流量的统一业务截至月，保留为回答级 data_as_of。 */
  dataAsOf: string;
  /** view.meta.time_source 指向这里的时钟。 */
  sources: Record<string, TimeSourceContext>;
};

/** Cube JWT 中的最小授权上下文。 */
export type CubeSecurityContext = {
  subject: string;
  groups: string[];
  orgScope: "*" | string[];
};

export function isCubeSecurityContext(value: unknown): value is CubeSecurityContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const scope = candidate.orgScope;
  return (
    typeof candidate.subject === "string" &&
    candidate.subject.length > 0 &&
    Array.isArray(candidate.groups) &&
    candidate.groups.length > 0 &&
    candidate.groups.every((group) => typeof group === "string") &&
    (scope === "*" ||
      (Array.isArray(scope) && scope.length > 0 && scope.every((org) => typeof org === "string")))
  );
}

export type CubeGateway = {
  meta(context: CubeSecurityContext): Promise<CubeView[]>;
  load(query: CubeQuery, context: CubeSecurityContext): Promise<LoadResponse>;
  loadMulti(query: CubeQuery, context: CubeSecurityContext): Promise<LoadResponse[]>;
  sql(query: CubeQuery, context: CubeSecurityContext): Promise<GeneratedSqlStatement[]>;
  timeContext(): Promise<TimeContext>;
};
