import { expect, test } from "bun:test";
import type { DataCapabilityMapData } from "@data-capability-map";
import embedded from "./data_capability_map_data.json";
import {
  NODE_HEIGHT,
  canvasFact,
  capabilityColumns,
  capabilityEdges,
  factNodeId,
  groupedMemberNames,
  highlightFor,
  layoutCapabilities,
  listedHierarchies,
  listedMembers,
  memberCounts,
  nodeId,
  visibleEdges,
} from "./data_capability_map";

const member = (name: string, kind: "dimension" | "measure", title: string | null = name) => ({
  name,
  title,
  description: null,
  kind,
  member_type: null,
  internal: false,
  role: null,
  metric_domain_id: null,
  time_contract: null,
  format: null,
  components: null,
});

const synthetic: DataCapabilityMapData = {
  facts: [
    {
      name: "fact_a",
      title: "事实一",
      description: null,
      kind: "fact",
      members: [member("d1", "dimension"), member("m1", "measure")],
      hierarchies: [],
    },
    {
      name: "fact_b",
      title: "事实二",
      description: null,
      kind: "fact",
      members: [member("d2", "dimension"), member("m2", "measure")],
      hierarchies: [],
    },
    {
      name: "technical_fact",
      title: "技术事实",
      description: null,
      kind: "fact",
      members: [
        { ...member("availability", "measure"), internal: true, role: "availability_control" },
      ],
      hierarchies: [],
    },
    {
      name: "unnamed_fact",
      title: null,
      description: null,
      kind: "fact",
      members: [member("d3", "dimension"), member("m3", "measure")],
      hierarchies: [],
    },
  ],
  dimension_groups: [
    {
      name: "g1",
      title: "维度一",
      description: "维度一。",
      members: ["d1"],
      bindings: [{ fact: "fact_a", members: ["d1"] }],
    },
    {
      name: "g2",
      title: "维度二",
      description: "维度二。",
      members: ["d2"],
      bindings: [{ fact: "fact_b", members: ["d2"] }],
    },
  ],
  metric_domains: [
    {
      id: "metric_domain:scene_a",
      title: "指标域一",
      description: "指标域一。",
      metrics: [{ name: "m1", title: "指标一" }],
      dimensions: ["d1"],
      bindings: [{ fact: "fact_a", includes: ["m1"] }],
    },
    {
      id: "metric_domain:scene_b",
      title: "指标域二",
      description: "指标域二。",
      metrics: [{ name: "m2", title: "指标二" }],
      dimensions: ["d1", "d2"],
      bindings: [
        { fact: "fact_a", includes: ["m1"] },
        { fact: "fact_b", includes: ["m2"] },
      ],
    },
  ],
};

test("列归属与排序只使用全局维度、业务指标域和宽事实", () => {
  const columns = capabilityColumns(synthetic);
  expect(columns.dimensions.map(nodeId)).toEqual(["dimension_group:g1", "dimension_group:g2"]);
  expect(columns.metricDomains.map((domain) => domain.id)).toEqual([
    "metric_domain:scene_b",
    "metric_domain:scene_a",
  ]);
  // 全内部成员与无业务名的事实都不上图。
  expect(columns.facts.map((fact) => fact.name)).toEqual(["fact_a", "fact_b"]);
});

test("布局保持维度、指标域、事实三列且同列节点不重叠", () => {
  const columns = capabilityColumns(synthetic);
  const { positions, laneLabels } = layoutCapabilities(columns);
  const dimensionX = positions.get("dimension_group:g1")?.x ?? Number.NaN;
  const domainX = positions.get("metric_domain:scene_a")?.x ?? Number.NaN;
  const factX = positions.get("fact:fact_a")?.x ?? Number.NaN;
  expect(dimensionX).toBeLessThan(domainX);
  expect(domainX).toBeLessThan(factX);
  const top = positions.get("fact:fact_a");
  const below = positions.get("fact:fact_b");
  if (!top || !below) throw new Error("布局缺节点");
  expect(below.y - top.y).toBeGreaterThanOrEqual(NODE_HEIGHT);
  expect(laneLabels.map((label) => label.key)).toEqual(["dimensions", "metric_domains", "facts"]);
});

test("边方向区分维度投影与事实来源", () => {
  const edges = capabilityEdges(synthetic);
  for (const edge of edges.filter((candidate) => candidate.target.includes("dimension_group:"))) {
    expect(edge.sourceHandle).toBe("source-left");
    expect(edge.targetHandle).toBe("target-right");
  }
  const toFact = edges.find((edge) => edge.id === "binding:metric_domain:scene_a->fact_a");
  expect(toFact?.sourceHandle).toBe("source-right");
  expect(toFact?.targetHandle).toBe("target-left");
  if (toFact?.kind !== "binding") throw new Error("缺少事实绑定边");
  expect(toFact.includes).toBe(1);
});

test("邻接高亮覆盖指标域投影与事实承载血缘", () => {
  const edges = capabilityEdges(synthetic);
  const forDomain = highlightFor(edges, "metric_domain:scene_a");
  expect(forDomain?.nodes).toEqual(
    new Set(["metric_domain:scene_a", "fact:fact_a", "dimension_group:g1"]),
  );
  const forGroup = highlightFor(edges, "dimension_group:g1");
  expect(forGroup?.nodes).toEqual(
    new Set([
      "dimension_group:g1",
      "fact:fact_a",
      "metric_domain:scene_a",
      "metric_domain:scene_b",
    ]),
  );
  expect(highlightFor(edges, null)).toBeNull();
});

test("无选中只画语义投影，选中事实后补画物理承载血缘", () => {
  const edges = capabilityEdges(synthetic);
  expect(visibleEdges(edges, null).every((edge) => edge.kind === "binding")).toBe(true);
  const forFact = highlightFor(edges, "fact:fact_a");
  expect(visibleEdges(edges, forFact).some((edge) => edge.id === "attribute:fact_a->g1")).toBe(
    true,
  );
});

test("说不出业务名的成员、部门树不成行，也不退回原名", () => {
  const fact = {
    name: "fact_x",
    title: "事实",
    description: null,
    kind: "fact" as const,
    members: [
      member("d1", "dimension", "部门"),
      member("d2", "dimension", null),
      { ...member("secret", "measure", "内部量"), internal: true },
      member("level_1", "dimension", "一级部门"),
      member("level_2", "dimension", null),
    ],
    hierarchies: [
      { name: "readable", title: "部门树", levels: ["level_1"] },
      { name: "broken", title: "断树", levels: ["level_1", "level_2"] },
      { name: "unnamed", title: null, levels: ["level_1"] },
    ],
  };

  expect(listedMembers(fact).map((row) => row.label)).toEqual(["部门", "一级部门"]);
  expect(listedMembers(fact, ["d1", "d2", "secret", "readable"]).map((row) => row.label)).toEqual([
    "部门",
    "部门树",
  ]);
  expect(listedHierarchies(fact)).toEqual([
    { name: "readable", title: "部门树", levels: ["一级部门"] },
  ]);
});

test("Demo 参考数据可完整布局且成员计数守恒", () => {
  const data = embedded as unknown as DataCapabilityMapData;
  const columns = capabilityColumns(data);
  const { positions } = layoutCapabilities(columns);
  const visibleFacts = data.facts.filter(canvasFact);
  expect(positions.size).toBe(
    visibleFacts.length + data.dimension_groups.length + data.metric_domains.length,
  );
  for (const fact of data.facts) {
    const grouped = groupedMemberNames(data.dimension_groups, fact.name);
    const counts = memberCounts(fact, grouped);
    expect(counts.dimensions + counts.measures + grouped.size).toBe(
      fact.members.filter((candidate) => !candidate.internal).length,
    );
    expect(positions.has(factNodeId(fact))).toBe(canvasFact(fact));
  }
  for (const group of data.dimension_groups) {
    expect(positions.has(nodeId({ kind: "dimension_group", group }))).toBe(true);
  }
});
