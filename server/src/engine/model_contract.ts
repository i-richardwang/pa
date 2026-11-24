import { memberShortName } from "../semantic_core/member_name.js";
import type { ResultGuard } from "../semantic_core/result_guard.js";
import type { CubeMember } from "../ports/cube_gateway.js";

export const DIMENSION_KINDS = ["categorical", "overlapping"] as const;
export type DimensionKind = (typeof DIMENSION_KINDS)[number];

const DIMENSION_KIND_SET = new Set<string>(DIMENSION_KINDS);

export function memberSemanticId(
  kind: "measure" | "dimension",
  member: Pick<CubeMember, "name"> | string,
): string {
  return `${kind}:${memberShortName(typeof member === "string" ? member : member.name)}`;
}

function explicitDimensionKind(member: CubeMember): DimensionKind | undefined {
  const value = member.meta?.dimension_kind;
  return typeof value === "string" && DIMENSION_KIND_SET.has(value)
    ? (value as DimensionKind)
    : undefined;
}

/**
 * string 维度默认为分类维度；数值和时间维度需显式声明 dimension_kind 才能查询候选值。
 * overlapping 维度同样可搜索，只影响结果解释。
 */
export function dimensionKind(member: CubeMember): DimensionKind | undefined {
  const explicit = explicitDimensionKind(member);
  if (explicit) return explicit;
  return member.type === "string" ? "categorical" : undefined;
}

export function isSearchableDimension(member: CubeMember): boolean {
  const kind = dimensionKind(member);
  return kind === "categorical" || kind === "overlapping";
}

export function resultGuards(member: CubeMember): ResultGuard[] {
  const raw = member.meta?.result_guards;
  if (raw === undefined) return [];
  const title = `指标「${member.title ?? member.name}」`;
  if (!Array.isArray(raw) || !raw.length)
    throw new Error(`${title} 的 result_guards 必须是非空数组`);
  return raw.map((candidate: unknown) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`${title} 的结果保护规则无效`);
    }
    const guard = candidate as Record<string, unknown>;
    if (guard.kind !== "minimum_support") throw new Error(`${title} 声明了未知结果保护类型`);
    if (typeof guard.support_measure !== "string" || !guard.support_measure.trim()) {
      throw new Error(`${title} 的支撑指标必须显式声明`);
    }
    const threshold = Number(guard.threshold);
    if (!Number.isInteger(threshold) || threshold <= 0)
      throw new Error(`${title} 的最小支撑量必须是正整数`);
    return {
      kind: guard.kind,
      support_measure: memberSemanticId("measure", guard.support_measure.replace(/^measure:/, "")),
      threshold,
    };
  });
}
