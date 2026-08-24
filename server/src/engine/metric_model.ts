import type { CubeMember, CubeView } from "../ports/cube_gateway.js";
import { memberShortName } from "../semantic_core/member_name.js";
import type { MetricDomainId } from "../semantic_core/metric_domain_id.js";
import type { MetricTimeContract } from "../semantic_core/metric_time_contract.js";
import type { SemanticCatalogFormalMetric } from "../semantic_core/semantic_model_catalog.js";
import type { ResultGuard } from "../semantic_core/result_guard.js";

export type MetricComponent = {
  /** 组件的规范指标身份；解析时必须唯一落到一个普通指标来源。 */
  metric_id: string;
  /** 聚合结果缺行或为空时的显式解释，禁止结果对齐器自行猜测。 */
  missing: "null" | "zero";
};

export type RatioMetricNode = {
  kind: "ratio";
  numerator: MetricComponent;
  denominator: MetricComponent;
  division_by_zero: "null";
};

export type AvailabilityGuardMetricNode = {
  kind: "availability_guard";
  value: MetricComponent;
  availability: MetricComponent;
  unavailable: "null";
};

export type MetricNode = RatioMetricNode | AvailabilityGuardMetricNode;

export type UnderlyingRecords = {
  record_set: string;
  selection: { kind: "self" } | { kind: "numerator" } | { kind: "measure"; member: string };
};

export type MetricRecordProjection = {
  view: string;
  components?: { numerator: string; denominator: string };
  underlying_records: UnderlyingRecords;
};

export type FormalMetricDefinition = {
  name: string;
  metric_domain_id: MetricDomainId;
  /** 复合指标在 Cube /meta 中的执行锚点；只用于物理成员命名与维度绑定，不表示业务域。 */
  host_view: string;
  title: string;
  description: string;
  time_contract: MetricTimeContract;
  node: MetricNode;
  format?: "number" | "percent";
  result_guards?: ResultGuard[];
  sensitivity?: "restricted";
  ai_context?: string;
  incompatible_dimensions?: Array<{ member: string; reason: string }>;
  record_projection?: MetricRecordProjection;
};

/** build-time 语义目录只消费正式指标的业务身份与依赖边，不复制公式或执行配置。 */
export function semanticCatalogFormalMetrics(
  formalMetrics: readonly FormalMetricDefinition[],
): SemanticCatalogFormalMetric[] {
  const short = (id: string) => id.slice("measure:".length);
  return formalMetrics.map((metric) => {
    const nodeComponents =
      metric.node.kind === "ratio"
        ? [short(metric.node.numerator.metric_id), short(metric.node.denominator.metric_id)]
        : [short(metric.node.value.metric_id), short(metric.node.availability.metric_id)];
    return {
      name: metric.name,
      title: metric.title,
      metric_domain_id: metric.metric_domain_id,
      components: [
        ...new Set([
          ...nodeComponents,
          ...(metric.result_guards ?? []).map((guard) => guard.support_measure),
        ]),
      ],
    };
  });
}

export function metricNodeOf(member: CubeMember): MetricNode | undefined {
  const node = member.meta?.metric_node;
  const kind = node && typeof node === "object" ? (node as { kind?: unknown }).kind : undefined;
  if (!node || typeof node !== "object" || (kind !== "ratio" && kind !== "availability_guard")) {
    return undefined;
  }
  return node as MetricNode;
}

function virtualMember(
  definition: FormalMetricDefinition,
  view: CubeView,
  previous?: CubeMember,
  detail = false,
): CubeMember {
  const record = detail ? definition.record_projection : undefined;
  const components = (() => {
    if (record?.components) return record.components;
    if (definition.node.kind !== "ratio") return undefined;
    return {
      numerator: definition.node.numerator.metric_id.slice("measure:".length),
      denominator: definition.node.denominator.metric_id.slice("measure:".length),
    };
  })();
  return {
    ...(previous ?? {}),
    name: `${view.name}.${definition.name}`,
    title: definition.title,
    description: definition.description,
    type: "number",
    aggType: "number",
    ...(definition.format ? { format: definition.format } : {}),
    aliasMember: undefined,
    meta: {
      ...(previous?.meta ?? {}),
      time_contract: definition.time_contract,
      ...(components ? { components } : {}),
      ...(definition.result_guards ? { result_guards: definition.result_guards } : {}),
      metric_domain_id: definition.metric_domain_id,
      metric_node: definition.node,
      ...(definition.sensitivity ? { sensitivity: definition.sensitivity } : {}),
      ...(definition.ai_context ? { ai_context: definition.ai_context } : {}),
      ...(definition.incompatible_dimensions
        ? { incompatible_dimensions: definition.incompatible_dimensions }
        : {}),
      ...(record ? { underlying_records: record.underlying_records } : {}),
    },
  };
}

/**
 * 把正式指标图叠加到权限裁剪后的 Cube 元数据：只有全部组件可见时才暴露复合指标。
 * PA 层不另造授权规则。
 */
export function applyFormalMetricModel(
  views: CubeView[],
  formalMetrics: readonly FormalMetricDefinition[],
): CubeView[] {
  const visibleMetricIds = new Set(
    views
      .filter((view) => view.meta?.query_surface !== "detail")
      .flatMap((view) => [...view.measures, ...(view.internalMeasures ?? [])])
      .filter((member) => !metricNodeOf(member))
      .map((member) => `measure:${memberShortName(member.name)}`),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const metric of formalMetrics) {
      const components = [
        ...(metric.node.kind === "ratio"
          ? [metric.node.numerator, metric.node.denominator]
          : [metric.node.value, metric.node.availability]),
        ...(metric.result_guards ?? []).map((guard) => ({
          metric_id: `measure:${guard.support_measure}`,
          missing: "null" as const,
        })),
      ];
      const id = `measure:${metric.name}`;
      if (
        !visibleMetricIds.has(id) &&
        components.every((component) => visibleMetricIds.has(component.metric_id))
      ) {
        visibleMetricIds.add(id);
        changed = true;
      }
    }
  }
  return views.map((view) => {
    const detail = view.meta?.query_surface === "detail";
    const applicable = formalMetrics.filter((metric) => {
      return (
        visibleMetricIds.has(`measure:${metric.name}`) &&
        (detail ? metric.record_projection?.view === view.name : metric.host_view === view.name)
      );
    });
    if (!applicable.length) return view;
    const replacements = new Map(applicable.map((metric) => [metric.name, metric]));
    const measures = view.measures
      .filter((member) => !replacements.has(memberShortName(member.name)))
      .concat(
        applicable.map((metric) => {
          const previous = view.measures.find(
            (member) => memberShortName(member.name) === metric.name,
          );
          return virtualMember(metric, view, previous, detail);
        }),
      );
    return { ...view, measures };
  });
}
