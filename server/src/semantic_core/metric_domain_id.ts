/** 指标域的公开语义 id，独立于 Cube View name，物理模型重命名不影响它。 */
export const METRIC_DOMAIN_ID_PATTERN = /^metric_domain:[a-z][a-z0-9_]*$/;

export type MetricDomainId = `metric_domain:${string}`;

export function parseMetricDomainId(value: unknown, owner: string): MetricDomainId {
  if (typeof value !== "string" || !METRIC_DOMAIN_ID_PATTERN.test(value)) {
    throw new Error(`${owner} 缺少有效的 metric_domain_id`);
  }
  return value as MetricDomainId;
}
