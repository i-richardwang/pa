import { memberShortName } from "../semantic_core/member_name.js";
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
 * 字符串维度天然是分类维度；数值和时间只有显式声明后才进入候选值查询。
 * overlapping 仍是可搜索分类，只额外改变结果解释。
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
