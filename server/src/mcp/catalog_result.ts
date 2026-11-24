import type { CatalogQueryPayload } from "../application/catalog_service.js";
import type {
  PublicCatalogDimension,
  PublicCatalogMeasure,
  PublicCatalogMember,
} from "../contracts/catalog_contract.js";
import { CATALOG_OUTPUT_SCHEMA, type AgentCatalogPayload } from "./contracts.js";

const memberBase = (source: PublicCatalogMember) => ({
  id: source.id,
  kind: source.kind,
  title: source.title,
  description: source.description,
  ...(source.format ? { format: source.format } : {}),
  ...(source.ai_context ? { ai_context: source.ai_context } : {}),
  ...(source.sensitivity ? { sensitivity: source.sensitivity } : {}),
});

const measure = (source: PublicCatalogMeasure) => ({
  ...memberBase(source),
  ...(source.data_as_of ? { data_as_of: source.data_as_of } : {}),
  ...(source.records_available ? { records_available: true as const } : {}),
  query_capabilities: source.query_capabilities,
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
  time: source.time,
});

const dimension = (source: PublicCatalogDimension) => ({
  ...memberBase(source),
  ...(source.dimension_kind ? { dimension_kind: source.dimension_kind } : {}),
  ...(source.entity_label ? { entity_label: source.entity_label } : {}),
});

/** MCP 目录只输出 Agent 查询需要的字段；Web 导航字段只在 PublicCatalogDocument 中。 */
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
    measures: source.measures.map(measure),
    dimensions: source.dimensions.map(dimension),
    matched_terms: source.matched_terms,
    ambiguous_terms: source.ambiguous_terms,
    unmatched_terms: source.unmatched_terms,
    term_knowledge_status: source.term_knowledge_status,
    term_resolutions: source.term_resolutions,
  });
}
