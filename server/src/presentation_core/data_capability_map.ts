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
const memberSchema = z.strictObject({
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
  components: z.strictObject({ numerator: z.string(), denominator: z.string() }).nullable(),
});

export const DATA_CAPABILITY_MAP_SCHEMA = z.strictObject({
  facts: z.array(
    z.strictObject({
      name: z.string(),
      title: nullableText,
      description: nullableText,
      kind: z.literal("fact"),
      members: z.array(memberSchema),
      hierarchies: z.array(
        z.strictObject({ name: z.string(), title: nullableText, levels: z.array(z.string()) }),
      ),
    }),
  ),
  dimension_groups: z.array(
    z.strictObject({
      name: z.string(),
      title: z.string(),
      description: z.string(),
      members: z.array(z.string()),
      bindings: z.array(z.strictObject({ fact: z.string(), members: z.array(z.string()) })),
    }),
  ),
  metric_domains: z.array(
    z.strictObject({
      id: z.string().regex(METRIC_DOMAIN_ID_PATTERN),
      title: z.string(),
      description: z.string(),
      metrics: z.array(z.strictObject({ name: z.string(), title: z.string() })),
      dimensions: z.array(z.string()),
      bindings: z.array(z.strictObject({ fact: z.string(), includes: z.array(z.string()) })),
    }),
  ),
}) as z.ZodType<DataCapabilityMapData>;

export function projectDataCapabilityMap(catalog: SemanticModelCatalog): DataCapabilityMapData {
  return {
    facts: catalog.facts,
    dimension_groups: catalog.dimension_groups,
    metric_domains: catalog.metric_domains,
  };
}
