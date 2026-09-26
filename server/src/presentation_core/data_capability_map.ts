import type {
  SemanticCatalogDimensionGroup,
  SemanticCatalogFact,
  SemanticCatalogMetricDomain,
  SemanticModelCatalog,
} from "../semantic_core/semantic_model_catalog.js";
import { z } from "zod";
import { METRIC_TIME_CONTRACT_SCHEMA } from "../semantic_core/metric_time_contract.js";
import { METRIC_DOMAIN_ID_PATTERN } from "../semantic_core/metric_domain_id.js";

export type DataCapabilityMapFact = SemanticCatalogFact;
export type DataCapabilityMapDimensionGroup = SemanticCatalogDimensionGroup;
export type DataCapabilityMapMetricDomain = SemanticCatalogMetricDomain;
export type DataCapabilityMapData = {
  facts: DataCapabilityMapFact[];
  dimension_groups: DataCapabilityMapDimensionGroup[];
  metric_domains: DataCapabilityMapMetricDomain[];
};

const nullableText = z.string().nullable();
const memberSchema = z
  .object({
    name: z.string(),
    title: nullableText,
    description: nullableText,
    kind: z.enum(["dimension", "measure"]),
    member_type: nullableText,
    internal: z.boolean(),
    role: z
      .enum([
        "relationship_key",
        "time_control",
        "calculation_input",
        "availability_control",
        "restricted_detail",
      ])
      .nullable(),
    metric_domain_id: z.string().regex(METRIC_DOMAIN_ID_PATTERN).nullable(),
    time_contract: METRIC_TIME_CONTRACT_SCHEMA.nullable(),
    format: nullableText,
    components: z.object({ numerator: z.string(), denominator: z.string() }).strict().nullable(),
  })
  .strict();

export const DATA_CAPABILITY_MAP_SCHEMA = z
  .object({
    facts: z.array(
      z
        .object({
          name: z.string(),
          title: nullableText,
          description: nullableText,
          kind: z.literal("fact"),
          members: z.array(memberSchema),
          hierarchies: z.array(
            z
              .object({ name: z.string(), title: nullableText, levels: z.array(z.string()) })
              .strict(),
          ),
        })
        .strict(),
    ),
    dimension_groups: z.array(
      z
        .object({
          name: z.string(),
          title: z.string(),
          description: z.string(),
          members: z.array(z.string()),
          bindings: z.array(z.object({ fact: z.string(), members: z.array(z.string()) }).strict()),
        })
        .strict(),
    ),
    metric_domains: z.array(
      z
        .object({
          id: z.string().regex(METRIC_DOMAIN_ID_PATTERN),
          title: z.string(),
          description: z.string(),
          metrics: z.array(z.object({ name: z.string(), title: z.string() }).strict()),
          dimensions: z.array(z.string()),
          bindings: z.array(z.object({ fact: z.string(), includes: z.array(z.string()) }).strict()),
        })
        .strict(),
    ),
  })
  .strict() as z.ZodType<DataCapabilityMapData>;

export function projectDataCapabilityMap(catalog: SemanticModelCatalog): DataCapabilityMapData {
  return {
    facts: catalog.facts,
    dimension_groups: catalog.dimension_groups,
    metric_domains: catalog.metric_domains,
  };
}
