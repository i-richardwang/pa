import type { CatalogQueryPayload } from "../application/catalog_service.js";
import { CATALOG_OUTPUT_SCHEMA, type AgentCatalogPayload } from "./contracts.js";

const member = (source: CatalogQueryPayload["measures"][number]) => ({
  id: source.id,
  kind: source.kind,
  title: source.title,
  description: source.description,
  ...(source.format ? { format: source.format } : {}),
  ...(source.ai_context ? { ai_context: source.ai_context } : {}),
  ...(source.sensitivity ? { sensitivity: source.sensitivity } : {}),
  ...(source.dimension_kind ? { dimension_kind: source.dimension_kind } : {}),
  ...(source.records_available ? { records_available: true as const } : {}),
  ...(source.incompatible_dimensions?.length
    ? { incompatible_dimensions: source.incompatible_dimensions }
    : {}),
  ...(source.report_calculations?.length
    ? { report_calculations: source.report_calculations }
    : {}),
  ...(source.formula
    ? {
        formula: {
          numerator: source.formula.numerator,
          denominator: source.formula.denominator,
        },
      }
    : {}),
  ...(source.relation ? { relation: source.relation } : {}),
  ...(source.time_constraints ? { time_constraints: source.time_constraints } : {}),
});

/** MCP 目录只投影 Agent 查询所需字段；Web 导航字段保留在 PublicCatalogDocument。 */
export function projectAgentCatalog(source: CatalogQueryPayload): AgentCatalogPayload {
  return CATALOG_OUTPUT_SCHEMA.parse({
    access_scope: source.access_scope,
    observation_scopes: source.observation_scopes,
    data_as_of: source.data_as_of,
    time_context: source.time_context,
    metric_domains: source.metric_domains.map((domain) => ({
      id: domain.id,
      title: domain.title,
      ...(domain.query_contract ? { query_contract: domain.query_contract } : {}),
      measure_ids: domain.measure_ids,
      dimension_ids: domain.dimension_ids,
    })),
    measures: source.measures.map(member),
    dimensions: source.dimensions.map(member),
    matched_terms: source.matched_terms,
    ambiguous_terms: source.ambiguous_terms,
    unmatched_terms: source.unmatched_terms,
    term_knowledge_status: source.term_knowledge_status,
    term_resolutions: source.term_resolutions,
  });
}
