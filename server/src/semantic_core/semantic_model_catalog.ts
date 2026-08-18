/**
 * canonical model 的结构能力层：装配规范指标域、规范维度构件、物理事实与正式指标血缘。
 * 它既是能力呈现和仓库模型门禁的共同输入，也是进程级 canonical model 的组成部分；不产生事实 join。
 */
import { parse } from "yaml";
import type { MetricDomainId } from "./metric_domain_id.js";
import type { MetricTimeContract } from "./metric_time_contract.js";
import {
  dimensionGroupDefinition,
  parseKnownMetricDomainId,
  type SemanticTaxonomy,
} from "./semantic_taxonomy.js";
import { TIME_SOURCES, parseTimeSourceKey, type TimeSourceKey } from "./time_source.js";

export type SemanticCatalogMemberKind = "dimension" | "measure";
export type SemanticCatalogMemberRole =
  | "relationship_key"
  | "time_control"
  | "calculation_input"
  | "availability_control"
  | "restricted_detail";

export type SemanticCatalogComponents = { numerator: string; denominator: string };

export type SemanticCatalogMember = {
  name: string;
  title: string | null;
  description: string | null;
  kind: SemanticCatalogMemberKind;
  member_type: string | null;
  internal: boolean;
  role: SemanticCatalogMemberRole | null;
  metric_domain_id: MetricDomainId | null;
  time_contract: MetricTimeContract | null;
  format: string | null;
  components: SemanticCatalogComponents | null;
};

export type SemanticCatalogHierarchy = {
  name: string;
  title: string | null;
  levels: string[];
};

export type SemanticCatalogFact = {
  name: string;
  title: string | null;
  description: string | null;
  kind: "fact";
  members: SemanticCatalogMember[];
  hierarchies: SemanticCatalogHierarchy[];
};

export type SemanticCatalogDimensionGroupBinding = {
  fact: string;
  members: string[];
};

/** 一个规范维度构件及其物理可用绑定。 */
export type SemanticCatalogDimensionGroup = {
  name: string;
  title: string;
  description: string;
  members: string[];
  bindings: SemanticCatalogDimensionGroupBinding[];
};

export type SemanticCatalogMetric = { name: string; title: string };

export type SemanticCatalogMetricDomainBinding = {
  fact: string;
  /** 该事实为域内指标提供的叶子指标；内部计算叶子允许存在但不进入用户清单。 */
  includes: string[];
};

export type SemanticCatalogMetricDomain = {
  id: MetricDomainId;
  title: string;
  description: string;
  metrics: SemanticCatalogMetric[];
  /** 域内全部指标共同可用的规范维度。 */
  dimensions: string[];
  bindings: SemanticCatalogMetricDomainBinding[];
};

export type SemanticCatalogTimeSource = {
  key: TimeSourceKey;
  anchor: { view: string; measure: string };
};

export type SemanticModelCatalog = {
  facts: SemanticCatalogFact[];
  dimension_groups: SemanticCatalogDimensionGroup[];
  metric_domains: SemanticCatalogMetricDomain[];
  time_sources: SemanticCatalogTimeSource[];
};

/** 正式指标图给统一目录的最小语义投影；公式仍以运行时正式指标模型为唯一事实源。 */
export type SemanticCatalogFormalMetric = {
  name: string;
  title: string;
  metric_domain_id: MetricDomainId;
  components: string[];
};

export type SemanticModelYamlFile = { path: string; text: string };

type RawMeta = {
  internal?: boolean;
  member_role?: SemanticCatalogMemberRole;
  time_contract?: MetricTimeContract;
  components?: { numerator?: string; denominator?: string };
  query_surface?: string;
  time_source?: string;
  time_anchor_measure?: string;
  dimension_group?: string;
  metric_domain_id?: string;
};

type RawCubeMeta = { model_role?: "template" };

type RawMember = {
  name?: string;
  title?: string;
  description?: string;
  type?: string;
  format?: string;
  public?: boolean;
  meta?: RawMeta;
};

type RawHierarchy = { name?: string; title?: string; levels?: string[] };

type RawCube = {
  name?: string;
  extends?: string;
  title?: string;
  description?: string;
  meta?: RawCubeMeta;
  /** 架构禁运行时 join：本键只为 fail-closed 拒绝而存在，内容一律不解析。 */
  joins?: unknown;
  dimensions?: RawMember[];
  measures?: RawMember[];
  hierarchies?: RawHierarchy[];
};

type RawViewCube = { join_path?: string; includes?: "*" | (string | { name?: string })[] };
type RawView = { name?: string; meta?: RawMeta; cubes?: RawViewCube[] };
type RawModelFile = { cubes?: RawCube[]; views?: RawView[] };

const MEMBER_ROLES = new Set<SemanticCatalogMemberRole>([
  "relationship_key",
  "time_control",
  "calculation_input",
  "availability_control",
  "restricted_detail",
]);

function required(value: string | undefined, what: string, path: string): string {
  if (!value) throw new Error(`semantic model catalog: ${path} 缺少 ${what}`);
  return value;
}

function bindingCube(joinPath: string): string {
  const segments = joinPath.split(".");
  return segments[segments.length - 1];
}

function toMember(
  raw: RawMember,
  kind: SemanticCatalogMemberKind,
  path: string,
  taxonomy: SemanticTaxonomy,
): SemanticCatalogMember {
  const name = required(raw.name, "成员 name", path);
  const meta = raw.meta ?? {};
  const internal = raw.public === false || meta.internal === true;
  if (meta.member_role && !MEMBER_ROLES.has(meta.member_role)) {
    throw new Error(`semantic model catalog: ${path} 的成员 ${name} 使用了未知 member_role`);
  }
  if (internal && !meta.member_role) {
    throw new Error(`semantic model catalog: ${path} 的非公开成员 ${name} 缺少 member_role`);
  }
  const components =
    meta.components?.numerator && meta.components.denominator
      ? { numerator: meta.components.numerator, denominator: meta.components.denominator }
      : null;
  return {
    name,
    title: raw.title ?? null,
    description: raw.description?.trim() ?? null,
    kind,
    member_type: raw.type ?? null,
    internal,
    role: meta.member_role ?? null,
    metric_domain_id:
      kind === "measure" && meta.metric_domain_id !== undefined
        ? parseKnownMetricDomainId(
            meta.metric_domain_id,
            `semantic model catalog: ${path} 的指标 ${name}`,
            taxonomy.metric_domains,
          )
        : null,
    time_contract: meta.time_contract ?? null,
    format: raw.format ?? null,
    components,
  };
}

function toFact(raw: RawCube, path: string, taxonomy: SemanticTaxonomy): SemanticCatalogFact {
  const name = required(raw.name, "cube name", path);
  const measures = raw.measures ?? [];
  if (!measures.length) {
    throw new Error(`semantic model catalog: ${path} 的公开构件 ${name} 不是宽事实`);
  }
  if (raw.joins !== undefined) {
    throw new Error(`semantic model catalog: ${path} 的宽事实 ${name} 不得声明运行时 join`);
  }
  return {
    name,
    title: raw.title ?? null,
    description: raw.description?.trim() ?? null,
    kind: "fact",
    members: [
      ...(raw.dimensions ?? []).map((member) => toMember(member, "dimension", path, taxonomy)),
      ...measures.map((member) => toMember(member, "measure", path, taxonomy)),
    ],
    hierarchies: (raw.hierarchies ?? []).map((hierarchy) => ({
      name: required(hierarchy.name, "hierarchy name", path),
      title: hierarchy.title ?? null,
      levels: hierarchy.levels ?? [],
    })),
  };
}

function mergeNamed<T extends { name?: string }>(parent: T[] = [], child: T[] = []): T[] {
  const values = new Map(parent.map((item) => [item.name, item]));
  for (const item of child) values.set(item.name, item);
  return [...values.values()];
}

/** Cube extends 只在装配期展开模型复用，不产生运行时 join。 */
function resolveCubeInheritance(
  name: string,
  rawByName: ReadonlyMap<string, RawCube>,
  resolved: Map<string, RawCube>,
  resolving: Set<string>,
): RawCube {
  const cached = resolved.get(name);
  if (cached) return cached;
  const raw = rawByName.get(name);
  if (!raw) throw new Error(`semantic model catalog: cube ${name} 不存在`);
  if (!raw.extends) {
    resolved.set(name, raw);
    return raw;
  }
  if (resolving.has(name))
    throw new Error(`semantic model catalog: cube extends 存在循环：${name}`);
  resolving.add(name);
  try {
    const parent = resolveCubeInheritance(raw.extends, rawByName, resolved, resolving);
    const { model_role: _parentRole, ...parentMeta } = parent.meta ?? {};
    const merged: RawCube = {
      ...parent,
      ...raw,
      meta: { ...parentMeta, ...(raw.meta ?? {}) },
      dimensions: mergeNamed(parent.dimensions, raw.dimensions),
      measures: mergeNamed(parent.measures, raw.measures),
      hierarchies: mergeNamed(parent.hierarchies, raw.hierarchies),
    };
    resolved.set(name, merged);
    return merged;
  } finally {
    resolving.delete(name);
  }
}

function sameDimensionContract(a: SemanticCatalogMember, b: SemanticCatalogMember): boolean {
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.member_type === b.member_type &&
    a.format === b.format &&
    JSON.stringify(a.time_contract) === JSON.stringify(b.time_contract)
  );
}

function buildDimensionGroups(
  facts: SemanticCatalogFact[],
  rawByCube: ReadonlyMap<string, RawCube>,
  paths: ReadonlyMap<string, string>,
  definitions: readonly SemanticTaxonomy["dimension_groups"][number][],
): SemanticCatalogDimensionGroup[] {
  const bindings = new Map<string, SemanticCatalogDimensionGroupBinding[]>();
  const contracts = new Map<string, SemanticCatalogMember>();
  const groupByMember = new Map<string, string>();
  for (const fact of facts) {
    const raw = rawByCube.get(fact.name);
    const path = paths.get(fact.name) ?? fact.name;
    const rawDimensions = new Map((raw?.dimensions ?? []).map((member) => [member.name, member]));
    const byGroup = new Map<string, string[]>();
    for (const member of fact.members.filter(
      (candidate) => candidate.kind === "dimension" && !candidate.internal,
    )) {
      const groupName = rawDimensions.get(member.name)?.meta?.dimension_group;
      if (!groupName) {
        throw new Error(
          `semantic model catalog: ${path} 的公开维度 ${member.name} 缺少 dimension_group 归属`,
        );
      }
      if (!dimensionGroupDefinition(groupName, definitions)) {
        throw new Error(
          `semantic model catalog: ${path} 的维度 ${member.name} 归属未登记的属性组 ${groupName}`,
        );
      }
      const previousGroup = groupByMember.get(member.name);
      if (previousGroup && previousGroup !== groupName) {
        throw new Error(
          `semantic model catalog: 规范维度 ${member.name} 同时归属 ${previousGroup} 与 ${groupName}`,
        );
      }
      groupByMember.set(member.name, groupName);
      const semanticKey = `${groupName}.${member.name}`;
      const previous = contracts.get(semanticKey);
      if (previous && !sameDimensionContract(previous, member)) {
        throw new Error(
          `semantic model catalog: 规范维度 ${member.name} 在多个事实中的公开契约不一致`,
        );
      }
      contracts.set(semanticKey, member);
      byGroup.set(groupName, [...(byGroup.get(groupName) ?? []), member.name]);
    }
    for (const [group, members] of byGroup) {
      bindings.set(group, [...(bindings.get(group) ?? []), { fact: fact.name, members }]);
    }
  }
  return definitions.flatMap((definition) => {
    const groupBindings = bindings.get(definition.name) ?? [];
    if (!groupBindings.length) return [];
    const members = [...new Set(groupBindings.flatMap((binding) => binding.members))];
    return [
      {
        name: definition.name,
        title: definition.title,
        description: definition.description,
        members,
        bindings: groupBindings.sort((a, b) => a.fact.localeCompare(b.fact)),
      },
    ];
  });
}

type MetricSource = { fact: string; member: string };

export function buildSemanticModelCatalog(
  files: SemanticModelYamlFile[],
  taxonomy: SemanticTaxonomy,
  formalMetrics: readonly SemanticCatalogFormalMetric[] = [],
): SemanticModelCatalog {
  const documents = [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => ({ file, doc: (parse(file.text) ?? {}) as RawModelFile }));
  const rawCubes = documents.flatMap(({ file, doc }) =>
    (doc.cubes ?? []).map((raw) => ({ raw, path: file.path })),
  );
  const rawByName = new Map(
    rawCubes.map(({ raw, path }) => [required(raw.name, "cube name", path), raw]),
  );
  if (rawByName.size !== rawCubes.length)
    throw new Error("semantic model catalog: cube name 不得重复");

  const resolved = new Map<string, RawCube>();
  const paths = new Map<string, string>();
  const rawByCube = new Map<string, RawCube>();
  const facts: SemanticCatalogFact[] = [];
  for (const { raw, path } of rawCubes) {
    const name = required(raw.name, "cube name", path);
    const inherited = resolveCubeInheritance(name, rawByName, resolved, new Set());
    if (inherited.meta?.model_role === "template") continue;
    facts.push(toFact(inherited, path, taxonomy));
    rawByCube.set(name, inherited);
    paths.set(name, path);
  }
  const factByName = new Map(facts.map((fact) => [fact.name, fact]));

  const sourceByMetric = new Map<string, MetricSource>();
  const publicDimensionsByFact = new Map<string, Set<string>>();
  const usedTimeSources = new Set<TimeSourceKey>();
  const timeAnchors = new Map<TimeSourceKey, SemanticCatalogTimeSource["anchor"]>();
  for (const { file, doc } of documents) {
    for (const view of doc.views ?? []) {
      const viewName = required(view.name, "view name", file.path);
      const surface = view.meta?.query_surface;
      if (surface !== "metric_source" && surface !== "detail") {
        throw new Error(
          `semantic model catalog: ${file.path} 的 View ${viewName} 缺少有效 query_surface`,
        );
      }
      const timeSource = parseTimeSourceKey(
        view.meta?.time_source,
        `semantic model catalog: ${file.path} 的 View ${viewName}`,
      );
      if (surface === "detail") {
        if (view.meta?.time_anchor_measure !== undefined) {
          throw new Error(`semantic model catalog: 明细 View ${viewName} 不得声明时间锚点`);
        }
        continue;
      }
      usedTimeSources.add(timeSource);
      if (view.meta?.metric_domain_id !== undefined) {
        throw new Error(
          `semantic model catalog: ${file.path} 的执行 View 不得声明 metric_domain_id`,
        );
      }
      if (view.cubes?.length !== 1) {
        throw new Error(`semantic model catalog: 执行 View ${viewName} 必须绑定且只绑定一张宽事实`);
      }
      for (const entry of view.cubes ?? []) {
        const factName = bindingCube(required(entry.join_path, "join_path", file.path));
        const fact = factByName.get(factName);
        if (!fact)
          throw new Error(`semantic model catalog: 执行 View 绑定不存在的宽事实 ${factName}`);
        const includes =
          entry.includes === "*"
            ? [...fact.members.map((member) => member.name), ...fact.hierarchies.map((h) => h.name)]
            : (entry.includes ?? []).map((include) =>
                typeof include === "string"
                  ? include
                  : required(include.name, `include name（${factName}）`, file.path),
              );
        const available = new Set([
          ...fact.members.map((member) => member.name),
          ...fact.hierarchies.map((hierarchy) => hierarchy.name),
        ]);
        for (const include of includes) {
          if (!available.has(include)) {
            throw new Error(`semantic model catalog: ${factName} 不存在成员 ${include}`);
          }
        }
        const anchorMeasure = view.meta?.time_anchor_measure;
        if (anchorMeasure !== undefined) {
          const anchor = fact.members.find(
            (member) => member.name === anchorMeasure && member.kind === "measure",
          );
          if (!anchor || !includes.includes(anchorMeasure)) {
            throw new Error(
              `semantic model catalog: 执行 View ${viewName} 的时间锚点 ${anchorMeasure} 不是公开指标`,
            );
          }
          if (timeAnchors.has(timeSource)) {
            throw new Error(`semantic model catalog: 时间来源 ${timeSource} 声明了多个锚点`);
          }
          timeAnchors.set(timeSource, { view: viewName, measure: anchorMeasure });
        }
        publicDimensionsByFact.set(
          factName,
          new Set(
            includes.filter((name) =>
              fact.members.some(
                (member) => member.name === name && member.kind === "dimension" && !member.internal,
              ),
            ),
          ),
        );
        for (const member of fact.members.filter(
          (candidate) => candidate.kind === "measure" && includes.includes(candidate.name),
        )) {
          if (!member.internal && !member.metric_domain_id) {
            throw new Error(
              `semantic model catalog: ${file.path} 的公开指标 ${member.name} 缺少 metric_domain_id`,
            );
          }
          const previous = sourceByMetric.get(member.name);
          if (previous) {
            throw new Error(`semantic model catalog: 叶子指标 ${member.name} 在多个事实来源中重复`);
          }
          sourceByMetric.set(member.name, { fact: factName, member: member.name });
        }
      }
    }
  }
  for (const source of usedTimeSources) {
    if (!timeAnchors.has(source)) {
      throw new Error(`semantic model catalog: 时间来源 ${source} 缺少唯一时间锚点`);
    }
  }

  const formalByName = new Map(formalMetrics.map((metric) => [metric.name, metric]));
  if (formalByName.size !== formalMetrics.length) {
    throw new Error("semantic model catalog: 正式指标 name 不得重复");
  }
  for (const name of formalByName.keys()) {
    if (sourceByMetric.has(name)) {
      throw new Error(`semantic model catalog: 正式指标 ${name} 与叶子指标重名`);
    }
  }
  const resolving = new Set<string>();
  const leafSources = (name: string): MetricSource[] => {
    const leaf = sourceByMetric.get(name);
    if (leaf) return [leaf];
    const formal = formalByName.get(name);
    if (!formal) throw new Error(`semantic model catalog: 正式指标组件 ${name} 缺少叶子来源`);
    if (resolving.has(name)) throw new Error(`semantic model catalog: 正式指标图存在循环 ${name}`);
    resolving.add(name);
    try {
      return formal.components.flatMap(leafSources);
    } finally {
      resolving.delete(name);
    }
  };

  const metricDomains = taxonomy.metric_domains.flatMap(
    (definition): SemanticCatalogMetricDomain[] => {
      const leafMetrics = [...sourceByMetric.values()].flatMap((source) => {
        const member = factByName
          .get(source.fact)
          ?.members.find((candidate) => candidate.name === source.member);
        return member && !member.internal && member.metric_domain_id === definition.id
          ? [{ name: member.name, title: member.title ?? member.name }]
          : [];
      });
      const derivedMetrics = formalMetrics.flatMap((metric) =>
        metric.metric_domain_id === definition.id
          ? [{ name: metric.name, title: metric.title }]
          : [],
      );
      const metrics = [
        ...new Map([...leafMetrics, ...derivedMetrics].map((m) => [m.name, m])).values(),
      ];
      if (!metrics.length) return [];
      const sourceMap = new Map<string, Set<string>>();
      for (const metric of metrics) {
        for (const source of leafSources(metric.name)) {
          sourceMap.set(
            source.fact,
            new Set([...(sourceMap.get(source.fact) ?? []), source.member]),
          );
        }
      }
      const sourceFacts = [...sourceMap.keys()].sort();
      const dimensionSets = sourceFacts.map(
        (fact) => publicDimensionsByFact.get(fact) ?? new Set<string>(),
      );
      const dimensions = dimensionSets.length
        ? [...dimensionSets[0]].filter((name) => dimensionSets.every((set) => set.has(name)))
        : [];
      return [
        {
          id: definition.id,
          title: definition.title,
          description: definition.description,
          metrics,
          dimensions,
          bindings: sourceFacts.map((fact) => ({
            fact,
            includes: [...(sourceMap.get(fact) ?? [])],
          })),
        },
      ];
    },
  );

  const dimensionGroups = buildDimensionGroups(facts, rawByCube, paths, taxonomy.dimension_groups);
  for (const group of dimensionGroups) {
    if (factByName.has(group.name)) {
      throw new Error(`semantic model catalog: 属性组 ${group.name} 与同名宽事实冲突`);
    }
  }

  facts.sort((a, b) => a.name.localeCompare(b.name));
  const timeSources = TIME_SOURCES.flatMap((source): SemanticCatalogTimeSource[] => {
    const anchor = timeAnchors.get(source.key);
    return anchor ? [{ key: source.key, anchor }] : [];
  });
  return {
    facts,
    dimension_groups: dimensionGroups,
    metric_domains: metricDomains,
    time_sources: timeSources,
  };
}
