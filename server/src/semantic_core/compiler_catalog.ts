/** 编译器私有目录，含物理绑定，不进入对外契约或持久化数据。 */

import type { MetricDomainId } from "./metric_domain_id.js";
import type { ReportCalculationKind } from "./report_calculation.js";
import type { TimeComparisonPolicy } from "./time_source.js";
import type { AccessScopeDefinition } from "./access_scope_definition.js";
import type { MeasureQueryCapabilities } from "./query_feasibility.js";
import type { MetricTime } from "./time_contract.js";

/** 率指标的分子与分母标题。 */
export type CompilerCatalogFormula = {
  numerator: string;
  denominator: string;
};

/** 成员在某个执行 View 中的限定名（物理绑定）。 */
export type CompilerCatalogAvailability = {
  view: string;
  member: string;
  /** 只用于明细查询，普通分析不选用该绑定。 */
  detail?: true;
  /** 该绑定可查询明细记录；同一指标的其他绑定各自声明。 */
  records_available?: true;
};

type CompilerCatalogMemberBase = {
  /** 跨视图稳定的语义 id；报告与查询意图只存这个值。 */
  id: string;
  /** 第一个可查视图中的限定名，只在编译器内部使用，不对外返回。 */
  name: string;
  /** 指标所属的业务指标域，维度没有；不影响执行 View 的选择。 */
  metric_domain_id?: MetricDomainId;
  title: string;
  description: string;
  format?: string;
  ai_context?: string;
  /** 受限成员按数据权限决定是否可见。 */
  sensitivity?: "restricted";
  dimension_kind?: "categorical" | "overlapping";
  dimension_group?: { id: string; title: string };
  records_available?: true;
  /** 不能与当前成员同时分组的维度语义 id，在目录装配时按声明所在的视图解析。 */
  incompatible_dimensions?: string[];
  /** 可由报告规格引用、但不进入全局指标目录的受控计算能力。 */
  report_calculations?: ReportCalculationKind[];
  formula?: CompilerCatalogFormula;
  relation?: { kind: "structure_share"; numerator_id: string };
  /** 可查询该成员的执行 View 及成员限定名，按当前用户权限过滤。 */
  available_in: CompilerCatalogAvailability[];
};

export type CompilerCatalogMeasure = CompilerCatalogMemberBase & {
  kind: "measure";
  /** 由物理可用性和语义限制共同推导。 */
  query_capabilities: MeasureQueryCapabilities;
  /** 值对应的时间与用户可选的时间。 */
  time: MetricTime;
};

export type CompilerCatalogDimension = CompilerCatalogMemberBase & {
  kind: "dimension";
};

export type CompilerCatalogMember = CompilerCatalogMeasure | CompilerCatalogDimension;

/** Cube 执行 View 的时间源、比较策略与层级；不含业务指标域。 */
export type CompilerCatalogView = {
  name: string;
  title: string;
  /** 内部时间源 key，只在服务端使用；对外只显示业务标签。 */
  time_source?: string;
  /** 该时钟允许的相对比较形态。 */
  comparison_policy: TimeComparisonPolicy;
  /** 业务层级链，已解析为维度语义 id。 */
  hierarchies?: string[][];
};

/** 业务指标域，只用于目录发现与导航，不含物理 View 绑定。 */
export type CompilerCatalogMetricDomain = {
  id: MetricDomainId;
  title: string;
  query_contract: string;
  time_source: string;
  synonyms: string[];
};

export type CompilerCatalog = {
  access_scope: AccessScopeDefinition;
  observation_scopes: string[];
  views: CompilerCatalogView[];
  metric_domains: CompilerCatalogMetricDomain[];
  measures: CompilerCatalogMeasure[];
  dimensions: CompilerCatalogDimension[];
};
