/**
 * 业务目录的对外投影：只含语义 id 和可公开给已授权用户的模型字段（含 ai_context 与查询说明），
 * 不含成员的物理绑定。
 */
import { z } from "zod";
import { YEAR_MONTH_REGEX } from "../semantic_core/year_month.js";
import { ACCESS_SCOPE_DEFINITION_SCHEMA, type AccessScopeDefinition } from "./access_scope.js";
import {
  METRIC_DOMAIN_ID_PATTERN,
  type MetricDomainId,
} from "../semantic_core/metric_domain_id.js";
import { METRIC_TIME_INPUT, type MetricTime } from "../semantic_core/time_contract.js";
import type { ReportCalculationKind } from "../semantic_core/report_calculation.js";
import type { MeasureQueryCapabilities } from "../semantic_core/query_feasibility.js";

export type CatalogDimensionKind = "categorical" | "overlapping";

/** 率指标的分子与分母标题；该端是公开目录成员时附带其语义 id，否则只有标题。 */
export type PublicCatalogFormula = {
  numerator: string;
  denominator: string;
  numerator_id?: string;
  denominator_id?: string;
};

type PublicCatalogMemberBase = {
  /** 跨视图稳定的语义 id；报告、查询意图与维度候选值查询都用它引用成员。 */
  id: string;
  title: string;
  description: string;
  format?: string;
  /** 模型的 meta.ai_context，公开给用户核对 Agent 的查询方式。 */
  ai_context?: string;
  /** 受限成员按数据权限决定是否可见。 */
  sensitivity?: "restricted";
};

export type PublicCatalogMeasure = PublicCatalogMemberBase & {
  kind: "measure";
  /** 指标结果可查看构成记录；具体目标由服务端按指标关系解析。 */
  records_available?: true;
  /** 该指标的相对期间以此月份为终点。 */
  data_as_of?: string;
  query_capabilities: MeasureQueryCapabilities;
  /** 该正式指标允许在报告中承载的受控临时计算。 */
  report_calculations?: ReportCalculationKind[];
  formula?: PublicCatalogFormula;
  /** 结构占比指标与其分子指标的关系。 */
  relation?: { kind: "structure_share"; numerator_id: string };
  /** value_basis 表示值对应的时间，constraints 表示用户可选的时间。 */
  time: MetricTime;
};

export type PublicCatalogDimension = PublicCatalogMemberBase & {
  kind: "dimension";
  dimension_kind?: CatalogDimensionKind;
  /** 维度所属的业务属性组，每个公开维度都有；不影响查询来源的选择。 */
  dimension_group: { id: string; title: string };
  entity_label?: string;
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

export type PublicMetricDomain = {
  id: MetricDomainId;
  title: string;
  /** 取自模型 description，说明 Agent 应怎样查询该主题。 */
  query_contract?: string;
  /** 该主题数据时间的业务标签；不暴露内部时间源 key。 */
  time_context_title?: string;
  synonyms: string[];
  /** 归属本域的指标；指标本身不带域 id。 */
  measure_ids: string[];
  /** 域内全部指标都能拆分的维度，由服务端按物理可用性计算。 */
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

export const MEASURE_DATA_AS_OF_SCHEMA = z
  .string()
  .regex(YEAR_MONTH_REGEX)
  .optional()
  .describe("该指标滚动期间所依据的实际数据截止月");

export const MEASURE_QUERY_CAPABILITIES_SCHEMA: z.ZodType<MeasureQueryCapabilities> = z
  .object({
    dimension_ids: z.array(z.string()).describe("可用于分组、筛选和排序的维度 id"),
    hierarchies: z
      .array(z.array(z.string()))
      .optional()
      .describe("该指标可用的维度层级，每条从粗到细排列"),
    grouping: z
      .object({
        minimum_varying_dimensions: z
          .number()
          .int()
          .positive()
          .describe("查询该指标至少需要的分组维度数；筛选成单个值的维度不计入"),
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
    sensitivity: z.literal("restricted").optional(),
  })
  .strict();

const CATALOG_MEASURE_SCHEMA: z.ZodType<PublicCatalogMeasure> = CATALOG_MEMBER_BASE_SCHEMA.extend({
  kind: z.literal("measure"),
  records_available: z.literal(true).optional(),
  data_as_of: MEASURE_DATA_AS_OF_SCHEMA,
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
    entity_label: z.string().optional(),
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
