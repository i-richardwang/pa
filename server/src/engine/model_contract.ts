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
