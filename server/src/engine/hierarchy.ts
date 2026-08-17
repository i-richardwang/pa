/**
 * 层级维度补全：同名下级组织可能挂在不同上级下；查询只引用下级而上级未被约束时，
 * 同名组织会被静默跨上级加总成错数。
 * 模型层以 Cube 原生 hierarchies 参数声明层级（随 /v1/meta 暴露）。查询引用层级某一级，
 * 其上级既不在分组维度、也无单值 equals 过滤时，把缺失上级加入分组维度——同名下级
 * 按上级拆行呈现，宁多一列不出错数。
 */
import type { CubeFilterCondition, CubeQuery, CubeView } from "../ports/cube_gateway.js";
import { completeHierarchyDimensions } from "../semantic_core/hierarchy_completion.js";

const isCondition = (f: unknown): f is CubeFilterCondition =>
  typeof f === "object" && f !== null && "member" in f;

export interface CompletedQuery {
  query: CubeQuery;
  /** 补全加入分组的上级维度；空数组表示查询未改写。 */
  added: string[];
}

/** 补全判定（纯函数）：chains 为各层级链的成员名列表（从粗到细） */
export function completeWithChains(query: CubeQuery, chains: string[][]): CompletedQuery {
  const dims = query.dimensions ?? [];
  const conditions = (query.filters ?? []).filter(isCondition).map((filter) => ({
    member: filter.member,
    includes: filter.operator === "equals",
    values: filter.values,
  }));
  const { dimensions, added } = completeHierarchyDimensions(dims, conditions, chains);
  if (!added.length) return { query, added };
  return { query: { ...query, dimensions }, added };
}

export function completeHierarchy(query: CubeQuery, views: CubeView[]): CompletedQuery {
  const chains = views.flatMap((v) => v.hierarchies ?? []).map((h) => h.levels);
  return completeWithChains(query, chains);
}
