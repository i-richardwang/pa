import { z } from "zod";
import {
  METRIC_DOMAIN_ID_PATTERN,
  type MetricDomainId,
} from "../semantic_core/metric_domain_id.js";
import { TIME_CAPABILITIES_INPUT, type TimeCapabilities } from "../semantic_core/time_contract.js";
import type { ReportCalculationKind } from "../semantic_core/report_calculation.js";

export type CatalogDimensionKind = "categorical" | "overlapping" | "individual";

/**
 * 指标字典的语义消费面契约（对外唯一投影）；只含语义身份与允许公开给已授权 PA 用户的模型字段。
 * Agent 教学字段（ai_context、查询契约）也在白名单内——业务方核对 AI 行为的依据；
 * 成员物理绑定不进此面；指标域只承担业务导航，不要求客户端选择物理查询来源。
 */

/**
 * 率指标公式行的分子分母，已解析为中文标题（人读公式不读成员名）。
 * 两端本身也是目录成员时随附其语义 id，界面据此把公式做成可跳转的引用——
 * 「它由哪两个数算出来」和「那两个数是什么」本就该一步可达。
 * 内部计算件没有公开身份，那一端便只有标题。
 */
export type PublicCatalogFormula = {
  numerator: string;
  denominator: string;
  numerator_id?: string;
  denominator_id?: string;
};

export type PublicCatalogMember = {
  /** 跨视图稳定的语义身份；报告、查询意图与翻值入口只引用此值。 */
  id: string;
  kind: "measure" | "dimension";
  title: string;
  description: string;
  format?: string;
  /** 模型给 Agent 的选材与避坑规则（meta.ai_context），亮出供人核对 AI 的查询行为。 */
  ai_context?: string;
  sensitivity?: string;
  dimension_kind?: CatalogDimensionKind;
  /** 维度在当前语义包中的导航分组；不参与物理选路。 */
  dimension_group?: { id: string; title: string };
  /** 指标结果可查看构成记录；具体目标由服务端按指标关系解析。 */
  records_available?: true;
  /** 与当前成员不能同时分组的维度语义 id。 */
  incompatible_dimensions?: string[];
  /** 该正式指标允许在报告中承载的受控临时计算。 */
  report_calculations?: ReportCalculationKind[];
  formula?: PublicCatalogFormula;
  /** 指标间的机器可读关系；不用标题或同名猜测。 */
  relation?: { kind: "structure_share"; numerator_id: string };
  /** 时间能力卡：会约束用户选择的时间性格；不公开指标内部聚合合同。 */
  time_constraints?: TimeCapabilities;
};

export function isSearchableCatalogDimension(
  member: Pick<PublicCatalogMember, "kind" | "dimension_kind"> | undefined,
): boolean {
  return (
    member?.kind === "dimension" &&
    (member.dimension_kind === "categorical" || member.dimension_kind === "overlapping")
  );
}

/**
 * 指标域导览条目：id 是稳定的目录身份，其他字段承业务导航与查询说明。
 */
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
  default_population_scope: string;
  data_as_of: string;
  time_context: {
    title: string;
    actual_through: string;
    available_through: string;
    plan_through?: string;
  }[];
  metric_domains: PublicMetricDomain[];
  measures: PublicCatalogMember[];
  dimensions: PublicCatalogMember[];
};

/** GET /dashboard/api/catalog/values?member&contains */
export type CatalogDimensionValues = {
  dimension: string;
  title: string;
  values: string[];
  truncated?: string;
};

const CATALOG_MEMBER_SCHEMA: z.ZodType<PublicCatalogMember> = z
  .object({
    id: z.string(),
    kind: z.enum(["measure", "dimension"]),
    title: z.string(),
    description: z.string(),
    format: z.string().optional(),
    ai_context: z.string().optional(),
    sensitivity: z.string().optional(),
    dimension_kind: z.enum(["categorical", "overlapping", "individual"]).optional(),
    dimension_group: z.object({ id: z.string(), title: z.string() }).strict().optional(),
    records_available: z.literal(true).optional(),
    incompatible_dimensions: z.array(z.string()).optional(),
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
    time_constraints: TIME_CAPABILITIES_INPUT.optional(),
  })
  .strict();

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
    default_population_scope: z.string(),
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
    measures: z.array(CATALOG_MEMBER_SCHEMA),
    dimensions: z.array(CATALOG_MEMBER_SCHEMA),
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
