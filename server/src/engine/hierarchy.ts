/**
 * 查询引用了层级中的某一级，而其上级既不在分组中、也没有单值 equals 过滤时，把上级加入分组；
 * 否则同名下级会跨上级合并。
 */
import type { CubeFilterCondition, CubeQuery, CubeView } from "../ports/cube_gateway.js";
import { completeHierarchyDimensions } from "../semantic_core/hierarchy_completion.js";

const isCondition = (f: unknown): f is CubeFilterCondition =>
  typeof f === "object" && f !== null && "member" in f;

export interface CompletedQuery {
  query: CubeQuery;
  /** 补全加入的上级维度及触发它的直接下级；空数组表示查询未改写。 */
  added: { member: string; children: string[] }[];
}

/** chains 为各层级的成员名列表，从粗到细。 */
export function completeWithChains(
  query: CubeQuery,
  chains: string[][],
  options: { filtersReferenceHierarchy?: boolean } = {},
): CompletedQuery {
  const dims = query.dimensions ?? [];
  const conditions = (query.filters ?? []).filter(isCondition).map((filter) => ({
    member: filter.member,
    includes: filter.operator === "equals",
    values: filter.values,
  }));
  const { dimensions, added } = completeHierarchyDimensions(dims, conditions, chains, options);
  if (!added.length) return { query, added };
  return { query: { ...query, dimensions }, added };
}

export function completeHierarchy(query: CubeQuery, views: CubeView[]): CompletedQuery {
  const chains = views.flatMap((v) => v.hierarchies ?? []).map((h) => h.levels);
  return completeWithChains(query, chains);
}

/** grouping set 的筛选只约束层级，不决定结果分组：空分组保持总体，粗分组不会因筛选加回已移除的维度。 */
export function completeGroupingSetHierarchy(query: CubeQuery, views: CubeView[]): CompletedQuery {
  const chains = views
    .flatMap((view) => view.hierarchies ?? [])
    .map((hierarchy) => hierarchy.levels);
  return completeWithChains(query, chains, { filtersReferenceHierarchy: false });
}
