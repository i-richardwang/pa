/**
 * 业务目录的语义消费面契约（对外唯一投影）；只含语义身份与允许公开给已授权 PA 用户的模型字段。
 * Agent 教学字段（ai_context、查询契约）也在白名单内——业务方核对 AI 行为的依据；
 * 成员物理绑定不进此面；指标域只承担业务导航，不要求客户端选择物理查询来源。
 */
import { z } from "zod";
import { ACCESS_SCOPE_DEFINITION_SCHEMA, type AccessScopeDefinition } from "./access_scope.js";
import {
  METRIC_DOMAIN_ID_PATTERN,
  type MetricDomainId,
} from "../semantic_core/metric_domain_id.js";
import { METRIC_TIME_INPUT, type MetricTime } from "../semantic_core/time_contract.js";
import type { ReportCalculationKind } from "../semantic_core/report_calculation.js";
import type { MeasureQueryCapabilities } from "../semantic_core/query_feasibility.js";

export type CatalogDimensionKind = "categorical" | "overlapping";

/**
 * 率指标公式的分子分母，已解析为中文标题（人读公式不读成员名）。
 * 两端本身是目录成员时随附其语义 id；内部计算件没有公开身份，那一端只有标题。
 */
export type PublicCatalogFormula = {
  numerator: string;
  denominator: string;
  numerator_id?: string;
  denominator_id?: string;
};

type PublicCatalogMemberBase = {
  /** 跨视图稳定的语义身份；报告、查询意图与翻值入口只引用此值。 */
  id: string;
  title: string;
  description: string;
  format?: string;
  /** 模型给 Agent 的选材与避坑规则（meta.ai_context），亮出供人核对 AI 的查询行为。 */
  ai_context?: string;
  sensitivity?: string;
};

export type PublicCatalogMeasure = PublicCatalogMemberBase & {
  kind: "measure";
  /** 指标结果可查看构成记录；具体目标由服务端按指标关系解析。 */
  records_available?: true;
  /** 指标在查询中的可组合维度与层级。 */
  query_capabilities: MeasureQueryCapabilities;
  /** 该正式指标允许在报告中承载的受控临时计算。 */
  report_calculations?: ReportCalculationKind[];
  formula?: PublicCatalogFormula;
  /** 指标间的机器可读关系；不用标题或同名猜测。 */
  relation?: { kind: "structure_share"; numerator_id: string };
  /** 指标的时间面：值代表什么时间（value_basis），以及用户能选什么时间（constraints）。 */
  time: MetricTime;
};

export type PublicCatalogDimension = PublicCatalogMemberBase & {
  kind: "dimension";
  dimension_kind?: CatalogDimensionKind;
  /** 维度在当前语义包中的业务属性组归属；每个公开维度必属一组，不参与物理选路。 */
  dimension_group: { id: string; title: string };
};

export type PublicCatalogMember = PublicCatalogMeasure | PublicCatalogDimension;

export function isSearchableCatalogDimension(
  member: { kind: PublicCatalogMember["kind"]; dimension_kind?: CatalogDimensionKind } | undefined,
): boolean {
  return (
    member?.kind === "dimension" &&
    (member.dimension_kind === "categorical" || member.dimension_kind === "overlapping")
  );
}

/** id 是稳定的目录身份。 */
export type PublicMetricDomain = {
  id: MetricDomainId;
  title: string;
  /** Agent 按此说明查询该主题（模型 description）。 */
  query_contract?: string;
  /** 该主题读数对应的数据时间业务标签；内部时间源 key 绝不上线。 */
  time_context_title?: string;
  synonyms: string[];
  /** 归属本域的指标；成员不反向携带域 id，从属关系只由域这一头说一次。 */
  measure_ids: string[];
  /** 域内全部指标共同可拆的维度，由服务端按物理可用性判定；客户端不自行推断。 */
  dimension_ids: string[];
};

/** GET /dashboard/api/catalog */
export type PublicCatalogDocument = {
  access_scope: AccessScopeDefinition;
  observation_scopes: string[];
  data_as_of: string;
  time_context: {
    title: string;
    actual_through: string;
    available_through: string;
    plan_through?: string;
  }[];
  metric_domains: PublicMetricDomain[];
  measures: PublicCatalogMeasure[];
  dimensions: PublicCatalogDimension[];
};

/** GET /dashboard/api/catalog/values?member&contains */
export type CatalogDimensionValues = {
  dimension: string;
  title: string;
  values: string[];
  truncated?: string;
};

export const MEASURE_QUERY_CAPABILITIES_SCHEMA: z.ZodType<MeasureQueryCapabilities> = z
  .object({
    dimension_ids: z.array(z.string()).describe("可用于分组、筛选与排序的维度语义 id"),
    hierarchies: z
      .array(z.array(z.string()))
      .optional()
      .describe("该指标查询空间中的语义层级链，从粗到细"),
    grouping: z
      .object({
        minimum_varying_dimensions: z
          .number()
          .int()
          .positive()
          .describe("指标成立所需的最少非单值分组维度数"),
      })
      .strict()
      .optional(),
  })
  .strict();

const CATALOG_MEMBER_BASE_SCHEMA = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    format: z.string().optional(),
    ai_context: z.string().optional(),
    sensitivity: z.string().optional(),
  })
  .strict();

const CATALOG_MEASURE_SCHEMA: z.ZodType<PublicCatalogMeasure> = CATALOG_MEMBER_BASE_SCHEMA.extend({
  kind: z.literal("measure"),
  records_available: z.literal(true).optional(),
  query_capabilities: MEASURE_QUERY_CAPABILITIES_SCHEMA,
  report_calculations: z.array(z.literal("percent_of_total")).optional(),
  formula: z
    .object({
      numerator: z.string(),
      denominator: z.string(),
      numerator_id: z.string().optional(),
      denominator_id: z.string().optional(),
    })
    .strict()
    .optional(),
  relation: z
    .object({ kind: z.literal("structure_share"), numerator_id: z.string() })
    .strict()
    .optional(),
  time: METRIC_TIME_INPUT,
});

const CATALOG_DIMENSION_SCHEMA: z.ZodType<PublicCatalogDimension> =
  CATALOG_MEMBER_BASE_SCHEMA.extend({
    kind: z.literal("dimension"),
    dimension_kind: z.enum(["categorical", "overlapping"]).optional(),
    dimension_group: z.object({ id: z.string(), title: z.string() }).strict(),
  });

const METRIC_DOMAIN_SCHEMA: z.ZodType<PublicMetricDomain> = z
  .object({
    id: z.string().regex(METRIC_DOMAIN_ID_PATTERN) as z.ZodType<MetricDomainId>,
    title: z.string(),
    query_contract: z.string().optional(),
    time_context_title: z.string().optional(),
    synonyms: z.array(z.string()),
    measure_ids: z.array(z.string()),
    dimension_ids: z.array(z.string()),
  })
  .strict();

export const PUBLIC_CATALOG_DOCUMENT_SCHEMA: z.ZodType<PublicCatalogDocument> = z
  .object({
    access_scope: ACCESS_SCOPE_DEFINITION_SCHEMA,
    observation_scopes: z.array(z.string()),
    data_as_of: z.string(),
    time_context: z.array(
      z
        .object({
          title: z.string(),
          actual_through: z.string(),
          available_through: z.string(),
          plan_through: z.string().optional(),
        })
        .strict(),
    ),
    metric_domains: z.array(METRIC_DOMAIN_SCHEMA),
    measures: z.array(CATALOG_MEASURE_SCHEMA),
    dimensions: z.array(CATALOG_DIMENSION_SCHEMA),
  })
  .strict();

export const CATALOG_DIMENSION_VALUES_SCHEMA: z.ZodType<CatalogDimensionValues> = z
  .object({
    dimension: z.string(),
    title: z.string(),
    values: z.array(z.string()),
    truncated: z.string().optional(),
  })
  .strict();
