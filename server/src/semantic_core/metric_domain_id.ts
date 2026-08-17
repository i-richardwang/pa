/** 指标域的公共语义身份；与 Cube View name 分离，物理模型重命名不改变消费协议。 */
export const METRIC_DOMAIN_ID_PATTERN = /^metric_domain:[a-z][a-z0-9_]*$/;

export type MetricDomainId = `metric_domain:${string}`;

export function parseMetricDomainId(value: unknown, owner: string): MetricDomainId {
  if (typeof value !== "string" || !METRIC_DOMAIN_ID_PATTERN.test(value)) {
    throw new Error(`${owner} 缺少有效的 metric_domain_id`);
  }
  return value as MetricDomainId;
}
