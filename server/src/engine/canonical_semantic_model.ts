/** 语义包声明与 Cube 编译执行面的进程级装配结果。 */
import type { CompilerCatalog } from "../semantic_core/compiler_catalog.js";
import type { SemanticModelCatalog } from "../semantic_core/semantic_model_catalog.js";
import type { SemanticTaxonomy } from "../semantic_core/semantic_taxonomy.js";
import type { TimeSourceRegistry } from "../semantic_core/time_source.js";
import { memberShortName } from "../semantic_core/member_name.js";
import type { CubeView } from "../ports/cube_gateway.js";
import type { CubeGateway, CubeSecurityContext } from "../ports/cube_gateway.js";
import { loadSemanticModelCatalog, type SemanticPackage } from "./semantic_package.js";
import { projectRecordMetadata, recordProjectionTargetsOf } from "./record_metadata.js";
import {
  buildCatalogDocument,
  toCompilerCatalog,
  type CatalogDocument,
  type CatalogViewDocument,
} from "./catalog_document.js";

export type CanonicalSemanticModel = {
  capabilities: SemanticModelCatalog;
  views: CubeView[];
  document: CatalogDocument;
  time_sources: TimeSourceRegistry;
};

export type AuthorizedSemanticModel = {
  views: CubeView[];
  document: CatalogDocument;
  compiler: CompilerCatalog;
  time_sources: TimeSourceRegistry;
};

export function buildCanonicalSemanticModel(input: {
  capabilities: SemanticModelCatalog;
  views: CubeView[];
  taxonomy: SemanticTaxonomy;
  time_sources: TimeSourceRegistry;
}): CanonicalSemanticModel {
  const document = buildCatalogDocument(input.views, input.taxonomy, input.time_sources);
  assertCatalogConsistency(input.capabilities, input.views, toCompilerCatalog(document));
  return {
    capabilities: input.capabilities,
    views: input.views,
    document,
    time_sources: input.time_sources,
  };
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function assertSameValues(owner: string, declared: Iterable<string>, compiled: Iterable<string>) {
  const expected = sorted(new Set(declared));
  const actual = sorted(new Set(compiled));
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`canonical model 的${owner}与 Cube 编译结果不一致`);
  }
}

function assertCatalogConsistency(
  capabilities: SemanticModelCatalog,
  views: CubeView[],
  compiler: CompilerCatalog,
): void {
  assertSameValues(
    "指标能力目录",
    capabilities.metric_domains.flatMap((domain) =>
      domain.metrics.map((metric) => `${domain.id}:${metric.name}:${metric.title}`),
    ),
    compiler.measures.map(
      (measure) =>
        `${measure.metric_domain_id ?? "未归类"}:${memberShortName(measure.name)}:${measure.title}`,
    ),
  );

  const declaredDimensionGroups = new Map(
    capabilities.dimension_groups.flatMap((group) =>
      group.members.map((member) => [member, group.name] as const),
    ),
  );
  for (const dimension of compiler.dimensions) {
    const name = memberShortName(dimension.name);
    if (declaredDimensionGroups.get(name) !== dimension.dimension_group?.id) {
      throw new Error(`canonical model 的维度 ${name} 与能力目录归属不一致`);
    }
  }

  const runtimeAnchors = views.flatMap((view) => {
    const raw = view.meta?.time_anchor_measure;
    if (raw === undefined) return [];
    if (typeof raw !== "string" || !raw.trim()) {
      throw new Error(`canonical model 的 View ${view.name} 时间锚点无效`);
    }
    const measure = memberShortName(raw);
    if (!view.measures.some((candidate) => memberShortName(candidate.name) === measure)) {
      throw new Error(`canonical model 的 View ${view.name} 时间锚点不存在`);
    }
    return [`${String(view.meta?.time_source)}:${view.name}:${measure}`];
  });
  assertSameValues(
    "时间锚点",
    capabilities.time_sources.map(({ key, anchor }) => `${key}:${anchor.view}:${anchor.measure}`),
    runtimeAnchors,
  );
}

const DEFAULT_META_ATTEMPTS = 30;
const DEFAULT_META_DELAY_MS = 1_000;

export async function loadCanonicalViews(input: {
  cube: Pick<CubeGateway, "meta">;
  service_context: CubeSecurityContext;
  retry?: {
    attempts?: number;
    delay_ms?: number;
    wait?: (delayMs: number) => Promise<void>;
  };
}): Promise<CubeView[]> {
  const attempts = input.retry?.attempts ?? DEFAULT_META_ATTEMPTS;
  const delayMs = input.retry?.delay_ms ?? DEFAULT_META_DELAY_MS;
  const wait =
    input.retry?.wait ?? ((duration) => new Promise((resolve) => setTimeout(resolve, duration)));
  if (!Number.isInteger(attempts) || attempts < 1 || !Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error("canonical model 的 Cube /meta 重试配置无效");
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await input.cube.meta(input.service_context);
    } catch (error) {
      if (attempt >= attempts) throw error;
      await wait(delayMs);
    }
  }
}

/** 从一个版本化语义包及其 Cube 编译结果生成进程级 canonical model。 */
export async function loadCanonicalSemanticModel(input: {
  semantic_package: SemanticPackage;
  cube: Pick<CubeGateway, "meta">;
  service_context: CubeSecurityContext;
  retry?: {
    attempts?: number;
    delay_ms?: number;
    wait?: (delayMs: number) => Promise<void>;
  };
}): Promise<CanonicalSemanticModel> {
  const capabilities = await loadSemanticModelCatalog(input.semantic_package);
  const views = await loadCanonicalViews(input);
  return buildCanonicalSemanticModel({
    capabilities,
    views,
    taxonomy: input.semantic_package.taxonomy,
    time_sources: input.semantic_package.time_sources,
  });
}

function memberNames(view: CubeView, kind: "measures" | "dimensions"): Set<string> {
  const internal = kind === "measures" ? view.internalMeasures : view.internalDimensions;
  return new Set([...view[kind], ...(internal ?? [])].map((member) => member.name));
}

function assertUnique(values: readonly string[], owner: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`权限可见性投影包含重复${owner}`);
  }
}

function projectView(canonical: CatalogViewDocument, visible: CubeView): CatalogViewDocument {
  const measures = memberNames(visible, "measures");
  const dimensions = memberNames(visible, "dimensions");
  const recordProjectionMembers = new Set(recordProjectionTargetsOf(visible).keys());
  const base = {
    ...canonical,
    measures: canonical.measures.filter((member) => measures.has(member.name)),
    dimensions: canonical.dimensions.filter((member) => dimensions.has(member.name)),
    hierarchies: canonical.hierarchies.filter((chain) =>
      chain.every((member) => dimensions.has(member)),
    ),
    record_projection_members: canonical.record_projection_members.filter((member) =>
      recordProjectionMembers.has(member),
    ),
    calculation_input_titles: Object.fromEntries(
      Object.entries(canonical.calculation_input_titles).filter(([member]) => measures.has(member)),
    ),
  };
  return canonical.surface === "detail"
    ? { ...base, surface: "detail" }
    : { ...base, surface: "metric_source" };
}

function projectCubeView(canonical: CubeView, visible: CubeView): CubeView {
  const visibleMeasures = memberNames(visible, "measures");
  const visibleDimensions = memberNames(visible, "dimensions");
  const project = <T extends { name: string }>(
    members: T[] | undefined,
    visibleNames: Set<string>,
  ) => members?.filter((member) => visibleNames.has(member.name));
  const assertKnown = (
    visibleMembers: CubeView["measures"],
    canonicalMembers: CubeView["measures"],
  ) => {
    const known = new Set(canonicalMembers.map((member) => member.name));
    for (const member of visibleMembers) {
      if (!known.has(member.name)) {
        throw new Error(`权限 /meta 暴露了 canonical model 中不存在的成员 ${member.name}`);
      }
    }
  };
  assertKnown(visible.measures, canonical.measures);
  assertKnown(visible.dimensions, canonical.dimensions);
  assertKnown(visible.internalMeasures ?? [], canonical.internalMeasures ?? []);
  assertKnown(visible.internalDimensions ?? [], canonical.internalDimensions ?? []);
  const recordProjected = projectRecordMetadata(
    canonical,
    new Set([...visibleMeasures, ...visibleDimensions]),
  );
  const projected = {
    ...recordProjected,
    measures: project(recordProjected.measures, visibleMeasures) ?? [],
    dimensions: project(recordProjected.dimensions, visibleDimensions) ?? [],
    internalMeasures: project(recordProjected.internalMeasures, visibleMeasures),
    internalDimensions: project(recordProjected.internalDimensions, visibleDimensions),
    hierarchies: recordProjected.hierarchies?.filter((hierarchy) =>
      hierarchy.levels.every((member) => visibleDimensions.has(member)),
    ),
  };
  return projected;
}

function assertVisibleView(view: CubeView): void {
  const members = [
    ...view.measures,
    ...view.dimensions,
    ...(view.internalMeasures ?? []),
    ...(view.internalDimensions ?? []),
  ].map((member) => member.name);
  assertUnique(members, `成员（${view.name}）`);
}

/** 将 Cube access policy 的成员可见性投影到 canonical 执行面。 */
export function projectAuthorizedSemanticViews(
  canonical: CanonicalSemanticModel,
  visibleViews: CubeView[],
): CubeView[] {
  if (!visibleViews.length) {
    throw new Error(
      "当前账号在 Cube 中没有可见数据视图；查询参数无需修改，请停止重试并让管理员检查账号角色、组织范围与 access_policy",
    );
  }
  assertUnique(
    visibleViews.map((view) => view.name),
    "视图",
  );
  const canonicalViews = new Map(canonical.views.map((view) => [view.name, view]));
  return visibleViews.map((visible) => {
    assertVisibleView(visible);
    const modelView = canonicalViews.get(visible.name);
    if (!modelView) {
      throw new Error(`权限 /meta 暴露了 canonical model 中不存在的视图 ${visible.name}`);
    }
    return projectCubeView(modelView, visible);
  });
}

/**
 * 把 Cube access policy 的结果作为纯可见性遮罩叠加到 canonical model。
 * 标题、说明、分类、时间合同、公式和记录能力一律取 canonical model；未知公开成员 fail-closed。
 */
export function authorizeCanonicalSemanticModel(
  canonical: CanonicalSemanticModel,
  visibleViews: CubeView[],
): AuthorizedSemanticModel {
  const authorizedViews = projectAuthorizedSemanticViews(canonical, visibleViews);
  const canonicalViews = new Map(canonical.document.views.map((view) => [view.name, view]));
  const projected = authorizedViews.map((visible) => {
    const modelView = canonicalViews.get(visible.name);
    if (!modelView) {
      throw new Error(`权限 /meta 暴露了 canonical model 中不存在的视图 ${visible.name}`);
    }
    return projectView(modelView, visible);
  });
  const visibleDomainIds = new Set(
    projected
      .filter((view) => view.surface === "metric_source")
      .flatMap((view) => view.measures.flatMap((member) => member.metric_domain_id ?? [])),
  );
  const document: CatalogDocument = {
    default_population_scope: canonical.document.default_population_scope,
    views: projected.sort((a, b) => a.name.localeCompare(b.name)),
    metric_domains: canonical.document.metric_domains.filter((domain) =>
      visibleDomainIds.has(domain.id),
    ),
  };
  return {
    views: authorizedViews,
    document,
    compiler: toCompilerCatalog(document),
    time_sources: canonical.time_sources,
  };
}

/** 让 CubeView 消费方共享 canonical 语义与权限投影。 */
export function withCanonicalSemanticModel(
  gateway: CubeGateway,
  canonical: CanonicalSemanticModel,
): CubeGateway {
  return {
    ...gateway,
    async meta(context) {
      return projectAuthorizedSemanticViews(canonical, await gateway.meta(context));
    },
  };
}
