/**
 * 编译器私有目录（CompilerCatalog）：唯一保留 Cube view/member 物理绑定与选路信息的目录投影。
 *
 * 只在服务端编译边界内流转——planQueryIntent / compileAnalysisView /
 * record projection planner 消费此结构，
 * 把语义成员 id 解析成精确的执行视图与限定成员名。绝不上线（MCP、Web、Analysis/View 身份、报告、ReplayPayload
 * 只见语义投影 PublicCatalogDocument）。对外投影由 catalog_document.toSemanticCatalog 从同一份
 * CatalogDocument 派生，两者共享一个权威事实源，不复制维护。
 */

import type { MetricDomainId } from "./metric_domain_id.js";
import type { MetricTimeContract } from "./metric_time_contract.js";
import type { ReportCalculationKind } from "./report_calculation.js";
import type { TimeComparisonPolicy } from "./time_source.js";
import type { AccessScopeDefinition } from "./access_scope_definition.js";
import type { MeasureQueryCapabilities } from "./query_feasibility.js";
import type { TimeCapabilities } from "./time_contract.js";

/** 率指标公式行的分子分母，已解析为中文标题（人读公式不读成员名）。 */
export type CompilerCatalogFormula = {
  numerator: string;
  denominator: string;
};

/** 规范成员在某个视图中的可执行限定名（物理绑定），只存在于编译器目录。 */
export type CompilerCatalogAvailability = {
  view: string;
  member: string;
  /** 仅供受保护明细入口使用，不参与普通分析选路。 */
  detail?: true;
  /** 该物理绑定具备受保护的底层记录投影；同一语义指标的其他绑定不因此自动获得明细能力。 */
  records_available?: true;
};

type CompilerCatalogMemberBase = {
  /** 跨视图稳定的语义身份；报告与查询意图只持久化此值。 */
  id: string;
  /** 首个可查视图的限定名；仅供编译器选路与对账，不上线。 */
  name: string;
  /** 指标的唯一业务归属；维度不声明。业务归属不参与物理选路。 */
  metric_domain_id?: MetricDomainId;
  title: string;
  description: string;
  format?: string;
  ai_context?: string;
  sensitivity?: string;
  dimension_kind?: "categorical" | "overlapping";
  dimension_group?: { id: string; title: string };
  /** 引擎私有的时间聚合合同；对外 Catalog 不暴露。 */
  time_contract?: MetricTimeContract;
  /** 从时间合同推导的公共时间能力。 */
  time_constraints?: TimeCapabilities;
  records_available?: true;
  /** 与当前成员不能同时分组的维度语义 id（已在目录装配阶段按声明视图上下文解析，绝无物理短名）。 */
  incompatible_dimensions?: string[];
  /** 可由报告规格引用、但不进入全局指标目录的受控计算能力。 */
  report_calculations?: ReportCalculationKind[];
  formula?: CompilerCatalogFormula;
  relation?: { kind: "structure_share"; numerator_id: string };
  /** 可查执行 View 及其中的精确成员名（物理绑定），随浏览者权限裁剪。 */
  available_in: CompilerCatalogAvailability[];
};

export type CompilerCatalogMeasure = CompilerCatalogMemberBase & {
  kind: "measure";
  /** 从物理可用性与语义限制共同推导的公共查询能力。 */
  query_capabilities: MeasureQueryCapabilities;
};

export type CompilerCatalogDimension = CompilerCatalogMemberBase & {
  kind: "dimension";
};

export type CompilerCatalogMember = CompilerCatalogMeasure | CompilerCatalogDimension;

/** Cube 执行 View：只承载物理绑定、权限、时间源与层级；业务指标域不在此层。 */
export type CompilerCatalogView = {
  name: string;
  title: string;
  /** 内部时间源 key，只在服务端流转（对外投影为业务标签，绝不上线）。 */
  time_source?: string;
  /** 该时钟允许的相对比较形态。 */
  comparison_policy: TimeComparisonPolicy;
  /** 业务层级链，已解析为维度语义 id。 */
  hierarchies?: string[][];
};

/** 业务指标域的私有目录投影；只用于发现与导航，不提供物理 View 绑定。 */
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
