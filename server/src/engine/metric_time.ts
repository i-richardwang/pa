import type { CubeMember } from "../ports/cube_gateway.js";
import {
  parseMetricTimeContract,
  type MetricTimeContract,
} from "../semantic_core/metric_time_contract.js";

export type MetricTimeEvaluation = "interval" | "endpoint" | "year_to_date";

export type ResolvedMetricTime = {
  contract: MetricTimeContract;
  evaluation: MetricTimeEvaluation;
};

function qualify(member: CubeMember, reference: string): string {
  return reference.includes(".") ? reference : `${member.name.split(".")[0]}.${reference}`;
}

function componentNames(member: CubeMember): [string, string] | null {
  const raw = member.meta?.components as { numerator?: unknown; denominator?: unknown } | undefined;
  return typeof raw?.numerator === "string" && typeof raw.denominator === "string"
    ? [qualify(member, raw.numerator), qualify(member, raw.denominator)]
    : null;
}

/** 从指标合同推导物理时间求值方式。 */
export function resolveMetricTime(
  member: CubeMember,
  members: ReadonlyMap<string, CubeMember>,
  resolving: Set<string> = new Set(),
): ResolvedMetricTime {
  const contract = parseMetricTimeContract(member.meta?.time_contract, member.title ?? member.name);
  if (contract.window === "year_to_date") {
    return { contract, evaluation: "year_to_date" };
  }
  if (contract.aggregation === "last") return { contract, evaluation: "endpoint" };
  if (contract.aggregation !== "recompute") return { contract, evaluation: "interval" };
  if (contract.grain === "month") return { contract, evaluation: "interval" };

  const components = componentNames(member);
  if (!components) {
    throw new Error(`指标「${member.title ?? member.name}」声明 recompute 但缺少完整 components`);
  }
  if (resolving.has(member.name)) {
    throw new Error(`指标「${member.title ?? member.name}」的时间聚合组件存在循环`);
  }
  resolving.add(member.name);
  try {
    const evaluations = components.map((name) => {
      const component = members.get(name);
      if (!component) {
        throw new Error(`指标「${member.title ?? member.name}」的时间聚合组件 ${name} 不存在`);
      }
      return resolveMetricTime(component, members, resolving).evaluation;
    });
    if (evaluations[0] !== evaluations[1]) {
      throw new Error(
        `指标「${member.title ?? member.name}」混合了不同时间聚合组件；` +
          "非月度正式指标应由指标 DAG 拆分组件后重算",
      );
    }
    return { contract, evaluation: evaluations[0] };
  } finally {
    resolving.delete(member.name);
  }
}

export function physicalEvaluation(
  evaluation: MetricTimeEvaluation,
): Exclude<MetricTimeEvaluation, "year_to_date"> {
  return evaluation === "year_to_date" ? "endpoint" : evaluation;
}
