/**
 * 数据能力地图的纯逻辑：三列归属与列内排序、定高节点的确定性布局、选中邻接与按需边计算。
 * 指标域居中为枢纽，维度构件、事实构件分居左右——用户从指标族进入，向两侧看复用维度与事实血缘。
 * 维度构件按全局业务语义组织，同一构件只出现一次；事实构件只承载物理指标来源。
 * 事实→维度构件是物理承载血缘，指标域→维度/事实是语义投影；前者只在选中时入画，后者常亮。
 * 列内按被指标域绑定的连接度排序以减少边交叉。
 */
import type {
  DataCapabilityMapMetricDomain,
  DataCapabilityMapFact,
  DataCapabilityMapData,
  DataCapabilityMapDimensionGroup,
} from "@data-capability-map";

export const NODE_WIDTH = 272;
export const NODE_HEIGHT = 88;
const COLUMN_GAP = 176;
const NODE_GAP = 32;
const LANE_LABEL_OFFSET = 48;

/**
 * 上图的事实：有业务名，且有公开成员。读者念不出名字的构件，地图上没有它能说的话——
 * 这条由类型带着走，于是节点标题、档案与关系行都无处回落到物理名。
 */
export type CanvasFact = DataCapabilityMapFact & { title: string };

export type CapabilityNodeRef =
  | { kind: "fact"; fact: CanvasFact }
  | { kind: "dimension_group"; group: DataCapabilityMapDimensionGroup }
  | { kind: "metric_domain"; topic: DataCapabilityMapMetricDomain };

/** 事实节点的 id 只认名字：还没上图的事实也要问得出「它在不在图上」。 */
export function factNodeId(fact: DataCapabilityMapFact): string {
  return `fact:${fact.name}`;
}

export function nodeId(ref: CapabilityNodeRef): string {
  if (ref.kind === "fact") return factNodeId(ref.fact);
  if (ref.kind === "dimension_group") return `dimension_group:${ref.group.name}`;
  return ref.topic.id;
}

/** 左侧泳道只承载全局规范维度构件，不把物理事实伪装成维度。 */
export type DimensionComponentRef = {
  kind: "dimension_group";
  group: DataCapabilityMapDimensionGroup;
};

export type CapabilityColumns = {
  dimensions: DimensionComponentRef[];
  facts: CanvasFact[];
  metricDomains: DataCapabilityMapMetricDomain[];
};

export function canvasFact(fact: DataCapabilityMapFact): fact is CanvasFact {
  return fact.title !== null && fact.members.some((member) => !member.internal);
}

/** 可上屏的一条成员：名字是业务名，没有业务名的成员根本不成行。 */
export type ListedMember = {
  name: string;
  label: string;
  kind: "dimension" | "measure";
};

/** 可上屏的一条部门树：树名与逐层业务名。 */
export type ListedHierarchy = {
  name: string;
  title: string;
  levels: string[];
};

/**
 * 展平为可列举成员：不传 names 取事实全部公开成员；传 names（绑定 includes）时逐名解析，
 * 公开成员按类型归组、部门树归入维度组。内部成员与没有业务名的名字都不列——
 * 控制台只说业务的话，说不出的那一条整行不发，不退回物理名或语义 id。
 */
export function listedMembers(fact: DataCapabilityMapFact, names?: string[]): ListedMember[] {
  const named = (name: string, title: string | null, kind: ListedMember["kind"]) =>
    title ? [{ name, label: title, kind }] : [];
  if (!names) {
    return fact.members.flatMap((member) =>
      member.internal ? [] : named(member.name, member.title, member.kind),
    );
  }
  return names.flatMap((name) => {
    const member = fact.members.find((candidate) => candidate.name === name);
    if (member) return member.internal ? [] : named(name, member.title, member.kind);
    const hierarchy = fact.hierarchies.find((candidate) => candidate.name === name);
    return named(name, hierarchy?.title ?? null, "dimension");
  });
}

/** 树是一条自上而下的路径：其中一层说不出业务名，这条路径就读不通，整条不发。 */
export function listedHierarchies(fact: DataCapabilityMapFact): ListedHierarchy[] {
  return fact.hierarchies.flatMap((hierarchy) => {
    const levels = hierarchy.levels.map(
      (level) => fact.members.find((candidate) => candidate.name === level)?.title ?? null,
    );
    if (!hierarchy.title || levels.some((level) => level === null)) return [];
    return [{ name: hierarchy.name, title: hierarchy.title, levels: levels as string[] }];
  });
}

/** 某事实被属性组认领的维度名集合；这些成员在呈现上归属左列属性组而非事实本体。 */
export function groupedMemberNames(
  groups: DataCapabilityMapDimensionGroup[],
  fact: string,
): Set<string> {
  const names = new Set<string>();
  for (const group of groups) {
    const binding = group.bindings.find((candidate) => candidate.fact === fact);
    if (!binding) continue;
    for (const member of binding.members) names.add(member);
  }
  return names;
}

/** 指标域共同维度落入某个规范构件的成员，按构件声明顺序。 */
export function bindingGroupIncludes(
  includes: string[],
  group: DataCapabilityMapDimensionGroup,
): string[] {
  const included = new Set(includes);
  return group.members.filter((member) => included.has(member));
}

export function memberCounts(
  fact: DataCapabilityMapFact,
  grouped?: ReadonlySet<string>,
): {
  dimensions: number;
  measures: number;
} {
  let dimensions = 0;
  let measures = 0;
  for (const member of fact.members) {
    if (member.internal) continue;
    if (grouped?.has(member.name)) continue;
    if (member.kind === "dimension") dimensions += 1;
    else measures += 1;
  }
  return { dimensions, measures };
}

export function capabilityColumns(data: DataCapabilityMapData): CapabilityColumns {
  const bindingDegree = new Map<string, number>();
  const groupBindingDegree = new Map<string, number>();
  for (const topic of data.metric_domains) {
    for (const binding of topic.bindings) {
      bindingDegree.set(binding.fact, (bindingDegree.get(binding.fact) ?? 0) + 1);
    }
    for (const group of data.dimension_groups) {
      if (bindingGroupIncludes(topic.dimensions, group).length === 0) continue;
      groupBindingDegree.set(group.name, (groupBindingDegree.get(group.name) ?? 0) + 1);
    }
  }
  const bound = (name: string) => bindingDegree.get(name) ?? 0;
  const dimensions: DimensionComponentRef[] = data.dimension_groups
    .map((group) => ({ kind: "dimension_group", group }) as const)
    .sort(
      (a, b) =>
        (groupBindingDegree.get(b.group.name) ?? 0) - (groupBindingDegree.get(a.group.name) ?? 0) ||
        b.group.members.length - a.group.members.length ||
        a.group.name.localeCompare(b.group.name),
    );
  const facts = data.facts
    .filter(canvasFact)
    .sort(
      (a, b) =>
        bound(b.name) - bound(a.name) ||
        b.members.length - a.members.length ||
        a.name.localeCompare(b.name),
    );
  const metricDomains = [...data.metric_domains].sort(
    (a, b) => b.bindings.length - a.bindings.length || a.id.localeCompare(b.id),
  );
  return { dimensions, facts, metricDomains };
}

export type NodePosition = { x: number; y: number };

export type LaneKey = "dimensions" | "metric_domains" | "facts";

export type CapabilityLayout = {
  positions: Map<string, NodePosition>;
  laneLabels: { key: LaneKey; position: NodePosition }[];
};

export function layoutCapabilities(columns: CapabilityColumns): CapabilityLayout {
  const lanes: { key: LaneKey; refs: CapabilityNodeRef[] }[] = [
    { key: "dimensions", refs: columns.dimensions },
    {
      key: "metric_domains",
      refs: columns.metricDomains.map((topic) => ({ kind: "metric_domain", topic }) as const),
    },
    { key: "facts", refs: columns.facts.map((fact) => ({ kind: "fact", fact }) as const) },
  ];
  const laneHeights = lanes.map(
    ({ refs }) => refs.length * NODE_HEIGHT + Math.max(0, refs.length - 1) * NODE_GAP,
  );
  const maxHeight = Math.max(...laneHeights);
  const positions = new Map<string, NodePosition>();
  const laneLabels: CapabilityLayout["laneLabels"] = [];
  lanes.forEach(({ key, refs }, laneIndex) => {
    const x = laneIndex * (NODE_WIDTH + COLUMN_GAP);
    const top = (maxHeight - laneHeights[laneIndex]) / 2;
    laneLabels.push({ key, position: { x, y: top - LANE_LABEL_OFFSET } });
    refs.forEach((ref, index) => {
      positions.set(nodeId(ref), { x, y: top + index * (NODE_HEIGHT + NODE_GAP) });
    });
  });
  return { positions, laneLabels };
}

export type CapabilityEdgeRef = {
  id: string;
  source: string;
  target: string;
  sourceHandle: "source-left" | "source-right";
  targetHandle: "target-left" | "target-right";
} & ({ kind: "attribute" } | { kind: "binding"; includes: number });

function handlesToward(
  target: "dimension" | "fact",
): Pick<CapabilityEdgeRef, "sourceHandle" | "targetHandle"> {
  return target === "dimension"
    ? { sourceHandle: "source-left", targetHandle: "target-right" }
    : { sourceHandle: "source-right", targetHandle: "target-left" };
}

export function capabilityEdges(data: DataCapabilityMapData): CapabilityEdgeRef[] {
  const onCanvas = new Set(data.facts.filter(canvasFact).map((fact) => fact.name));
  // 属性组归属线：事实→属性组的物理承载血缘，选中时按需入画。
  const attributes = data.dimension_groups.flatMap((group) =>
    group.bindings
      .filter((binding) => onCanvas.has(binding.fact))
      .map((binding) => ({
        id: `attribute:${binding.fact}->${group.name}`,
        source: `fact:${binding.fact}`,
        target: `dimension_group:${group.name}`,
        ...handlesToward("dimension"),
        kind: "attribute" as const,
      })),
  );
  // 指标域只连接一次规范维度构件，并按正式指标叶子来源连接物理事实。
  const bindings = data.metric_domains.flatMap((topic) => {
    const dimensionEdges = data.dimension_groups.flatMap((group): CapabilityEdgeRef[] => {
      const includes = bindingGroupIncludes(topic.dimensions, group).length;
      if (includes === 0) return [];
      return [
        {
          id: `binding:${topic.id}->${group.name}`,
          source: topic.id,
          target: `dimension_group:${group.name}`,
          ...handlesToward("dimension"),
          kind: "binding",
          includes,
        },
      ];
    });
    const factEdges = topic.bindings.flatMap((binding): CapabilityEdgeRef[] => {
      if (!onCanvas.has(binding.fact)) return [];
      return [
        {
          id: `binding:${topic.id}->${binding.fact}`,
          source: topic.id,
          target: `fact:${binding.fact}`,
          ...handlesToward("fact"),
          kind: "binding",
          includes: binding.includes.length,
        },
      ];
    });
    return [...dimensionEdges, ...factEdges];
  });
  return [...attributes, ...bindings];
}

export type CapabilityHighlight = { nodes: ReadonlySet<string>; edges: ReadonlySet<string> };

/** 选中节点 → 该节点与其相邻边和对端节点保持全亮，其余淡出 */
export function highlightFor(
  edges: CapabilityEdgeRef[],
  selected: string | null,
): CapabilityHighlight | null {
  if (!selected) return null;
  const nodes = new Set<string>([selected]);
  const lit = new Set<string>();
  for (const edge of edges) {
    if (edge.source !== selected && edge.target !== selected) continue;
    lit.add(edge.id);
    nodes.add(edge.source);
    nodes.add(edge.target);
  }
  return { nodes, edges: lit };
}

/** 常亮边只有语义绑定线；事实承载血缘仅在选中端点时入画。 */
export function visibleEdges(
  edges: CapabilityEdgeRef[],
  highlight: CapabilityHighlight | null,
): CapabilityEdgeRef[] {
  return edges.filter(
    (edge) => edge.kind === "binding" || (highlight?.edges.has(edge.id) ?? false),
  );
}
