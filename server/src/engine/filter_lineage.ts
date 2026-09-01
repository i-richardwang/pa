import type { CubeFilter } from "../ports/cube_gateway.js";

export type ResolvedFilterLineage = {
  filters: CubeFilter[];
  fingerprint: string;
};

function canonicalFilter(filter: CubeFilter): unknown {
  if ("member" in filter) {
    const values =
      filter.values && (filter.operator === "equals" || filter.operator === "notEquals")
        ? [...filter.values].sort()
        : filter.values;
    return {
      member: filter.member,
      operator: filter.operator,
      ...(values ? { values } : {}),
    };
  }
  const children = ("and" in filter ? filter.and : filter.or)
    .map(canonicalFilter)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return "and" in filter ? { and: children } : { or: children };
}

export function resolveFilterLineage(filters: readonly CubeFilter[] = []): ResolvedFilterLineage {
  const owned = [...filters];
  return {
    filters: owned,
    fingerprint: JSON.stringify(
      owned
        .map(canonicalFilter)
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    ),
  };
}

export function sameFilterLineage(
  left: ResolvedFilterLineage,
  right: ResolvedFilterLineage,
): boolean {
  return left.fingerprint === right.fingerprint;
}
