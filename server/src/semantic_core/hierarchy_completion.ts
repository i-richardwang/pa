export type HierarchyCondition = {
  member: string;
  includes: boolean;
  values?: readonly string[];
};

export type CompletedHierarchyDimensions = {
  dimensions: string[];
  added: string[];
};

/** 层级子项只有在全部上级可见或被单值等值过滤约束时才可唯一识别。 */
export function completeHierarchyDimensions(
  dimensions: readonly string[],
  filters: readonly HierarchyCondition[],
  chains: readonly (readonly string[])[],
): CompletedHierarchyDimensions {
  const grouped = [...dimensions];
  const referenced = new Set([...grouped, ...filters.map((filter) => filter.member)]);
  if (!referenced.size) return { dimensions: grouped, added: [] };

  const constrained = (member: string) =>
    grouped.includes(member) ||
    filters.some(
      (filter) => filter.member === member && filter.includes && filter.values?.length === 1,
    );

  const added: string[] = [];
  for (const chain of chains) {
    for (let index = chain.length - 1; index >= 1; index -= 1) {
      if (!referenced.has(chain[index])) continue;
      for (const ancestor of chain.slice(0, index)) {
        if (!constrained(ancestor) && !added.includes(ancestor)) added.push(ancestor);
      }
      break;
    }
  }
  return { dimensions: [...added, ...grouped], added };
}
