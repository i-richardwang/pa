export type HierarchyCondition = {
  member: string;
  includes: boolean;
  values?: readonly string[];
};

export type CompletedHierarchyDimensions = {
  dimensions: string[];
  added: { member: string; children: string[] }[];
};

/** 层级子项只有在全部上级可见或被单值等值过滤约束时才可唯一识别。 */
export function completeHierarchyDimensions(
  dimensions: readonly string[],
  filters: readonly HierarchyCondition[],
  chains: readonly (readonly string[])[],
  options: { filtersReferenceHierarchy?: boolean } = {},
): CompletedHierarchyDimensions {
  const grouped = [...dimensions];
  const referenced = new Set([
    ...grouped,
    ...(options.filtersReferenceHierarchy === false ? [] : filters.map((filter) => filter.member)),
  ]);
  if (!referenced.size) return { dimensions: grouped, added: [] };

  const constrained = (member: string) =>
    grouped.includes(member) ||
    filters.some(
      (filter) => filter.member === member && filter.includes && filter.values?.length === 1,
    );

  const added = new Map<string, Set<string>>();
  for (const chain of chains) {
    for (let index = chain.length - 1; index >= 1; index -= 1) {
      if (!referenced.has(chain[index])) continue;
      for (let ancestorIndex = 0; ancestorIndex < index; ancestorIndex += 1) {
        const ancestor = chain[ancestorIndex];
        const child = chain[ancestorIndex + 1];
        if (!ancestor || !child || constrained(ancestor)) continue;
        const children = added.get(ancestor) ?? new Set<string>();
        children.add(child);
        added.set(ancestor, children);
      }
      break;
    }
  }
  const additions = [...added].map(([member, children]) => ({ member, children: [...children] }));
  return { dimensions: [...additions.map((item) => item.member), ...grouped], added: additions };
}
