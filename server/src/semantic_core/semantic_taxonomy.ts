import { parseMetricDomainId, type MetricDomainId } from "./metric_domain_id.js";

export type MetricDomainDefinition = {
  id: MetricDomainId;
  title: string;
  description: string;
  time_source: string;
  synonyms: readonly string[];
};

export type SemanticTaxonomy = {
  metric_domains: readonly MetricDomainDefinition[];
  dimension_groups: readonly DimensionGroupDefinition[];
};

export function parseKnownMetricDomainId(
  value: unknown,
  owner: string,
  metricDomains: readonly MetricDomainDefinition[],
): MetricDomainId {
  const id = parseMetricDomainId(value, owner);
  if (!metricDomains.some((domain) => domain.id === id)) {
    throw new Error(`${owner} 引用了未登记的业务指标域 ${id}`);
  }
  return id;
}

export type DimensionGroupDefinition = {
  name: string;
  title: string;
  description: string;
};

export function dimensionGroupDefinition(
  name: string,
  dimensionGroups: readonly DimensionGroupDefinition[],
): DimensionGroupDefinition | undefined {
  return dimensionGroups.find((group) => group.name === name);
}
