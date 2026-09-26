import type { AccessScope } from "../contracts/access_scope.js";

// HTTP、JWT、缓存、重试和原始响应归一化在适配器中实现，不放进本端口。

export class CubeGatewayError extends Error {
  override name = "CubeGatewayError";

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
  }
}

export type SqlParameter = string | number | boolean | null;
export type CubeCell = string | number | null;

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
  /** Cube /v1/meta 中度量的 type 固定为 number；聚合类型见 aggType。 */
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

/** 布尔组合过滤只用于服务端内部查询；对外查询只接受扁平条件。 */
export type CubeFilter = CubeFilterCondition | { or: CubeFilter[] } | { and: CubeFilter[] };

export interface CubeTimeDimension {
  dimension: string;
  granularity?: "month" | "year";
  dateRange?: [string, string];
  /** 多个对比期间按数组顺序逐个执行。 */
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
  data: Record<string, CubeCell>[];
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
  /** 当前语义包各时间源合并后的业务截止月，作为回答的 data_as_of。 */
  dataAsOf: string;
  /** 键为 view.meta.time_source 的取值。 */
  sources: Record<string, TimeSourceContext>;
};

/** Cube JWT 中的最小授权上下文。 */
export type CubeSecurityContext = {
  subject: string;
  groups: string[];
  accessScope: AccessScope;
};

export type CubeGateway = {
  meta(context: CubeSecurityContext): Promise<CubeView[]>;
  load(query: CubeQuery, context: CubeSecurityContext): Promise<LoadResponse>;
  loadMulti(query: CubeQuery, context: CubeSecurityContext): Promise<LoadResponse[]>;
  sql(query: CubeQuery, context: CubeSecurityContext): Promise<GeneratedSqlStatement[]>;
  timeContext(): Promise<TimeContext>;
};
