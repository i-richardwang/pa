import type { CubeMember } from "../ports/cube_gateway.js";
import {
  parseMetricTimeContract,
  type MetricTimeContract,
} from "../semantic_core/metric_time_contract.js";
import type { MetricValueBasis } from "../semantic_core/metric_value_basis.js";

export type ResolvedMetricTime = {
  contract: MetricTimeContract;
  basis: MetricValueBasis;
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

/**
 * 从指标合同解析业务求值基准。比率不自己声明基准，按组件推导——组件基准不一致即报错，
 * 因为那样的比率没有单一的业务期间可言。
 */
export function resolveMetricTime(
  member: CubeMember,
  members: ReadonlyMap<string, CubeMember>,
  resolving: Set<string> = new Set(),
): ResolvedMetricTime {
  const contract = parseMetricTimeContract(member.meta?.time_contract, member.title ?? member.name);
  if (contract.window === "year_to_date") {
    return { contract, basis: "year_start_to_bucket_end" };
  }
  if (contract.aggregation === "last") return { contract, basis: "bucket_end" };
  if (contract.aggregation !== "recompute") return { contract, basis: "whole_bucket" };
  if (contract.grain === "month") return { contract, basis: "whole_bucket" };

  const components = componentNames(member);
  if (!components) {
    throw new Error(`指标「${member.title ?? member.name}」声明 recompute 但缺少完整 components`);
  }
  if (resolving.has(member.name)) {
    throw new Error(`指标「${member.title ?? member.name}」的时间聚合组件存在循环`);
  }
  resolving.add(member.name);
  try {
    const bases = components.map((name) => {
      const component = members.get(name);
      if (!component) {
        throw new Error(`指标「${member.title ?? member.name}」的时间聚合组件 ${name} 不存在`);
      }
      return resolveMetricTime(component, members, resolving).basis;
    });
    if (bases[0] !== bases[1]) {
      throw new Error(
        `指标「${member.title ?? member.name}」混合了不同时间聚合组件；` +
          "非月度正式指标应由指标 DAG 拆分组件后重算",
      );
    }
    return { contract, basis: bases[0] };
  } finally {
    resolving.delete(member.name);
  }
}

/** 物理求值形态：年初累计与月末时点都落在同一条截止月份腿上。 */
export function physicalForm(basis: MetricValueBasis): "interval" | "endpoint" {
  return basis === "whole_bucket" ? "interval" : "endpoint";
}
