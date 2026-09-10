/** Canonical 执行目录及其服务端/公开投影。公开投影不含物理成员绑定。 */
import { hitCount, memberFallbackTokens, memberHit, rankMembers } from "./catalog_search.js";
import type {
  PublicCatalogDimension,
  PublicCatalogDocument,
  PublicCatalogMeasure,
} from "../contracts/catalog_contract.js";
import type {
  CompilerCatalog,
  CompilerCatalogDimension,
  CompilerCatalogMeasure,
  CompilerCatalogMember,
} from "../semantic_core/compiler_catalog.js";
import type { CubeMember, CubeView } from "../ports/cube_gateway.js";
import { recordProjectionTargetsOf } from "./record_metadata.js";
import { memberDisplayTitle } from "./member_presentation.js";
import { dimensionKind, memberSemanticId, type DimensionKind } from "./model_contract.js";
import { memberShortName } from "../semantic_core/member_name.js";
import { parseIncompatibleDimensions } from "./incompatible_dimensions.js";
import {
  parseKnownTimeSourceId,
  timeSourceDefinition,
  timeSourceLabel,
  type TimeComparisonPolicy,
  type TimeSourceRegistry,
} from "../semantic_core/time_source.js";
import type { MetricDomainId } from "../semantic_core/metric_domain_id.js";
import {
  dimensionGroupDefinition,
  parseKnownMetricDomainId,
  type SemanticTaxonomy,
} from "../semantic_core/semantic_taxonomy.js";
import {
  sameMetricTimeContract,
  type MetricTimeResolution,
} from "../semantic_core/metric_time_contract.js";
import { metricTimeCapabilities } from "../semantic_core/time_contract.js";
import { resolveMetricTime } from "./metric_time.js";
import type { ReportCalculationKind } from "../semantic_core/report_calculation.js";
import type { AccessScopeDefinition } from "../contracts/access_scope.js";
import type { MeasureQueryCapabilities } from "../semantic_core/query_feasibility.js";

export type CatalogComponents = { numerator: string; denominator: string };

const SCOPE_DENOMINATOR = "scope_denominator";

export type CatalogMember = {
  name: string;
  kind: "measure" | "dimension";
  metric_domain_id?: MetricDomainId;
  title: string;
  display_title: string;
  alias: string;
  value_type: string;
  description: string;
  format?: string;
  ai_context?: string;
  sensitivity?: string;
  dimension_kind?: DimensionKind;
  dimension_group?: { id: string; title: string };
  /** 指标的时间面：合同与由它解析出的求值基准；只有指标有，不手写。 */
  time?: MetricTimeResolution;
  calculation_role?: string;
  components?: CatalogComponents;
  incompatible_dimensions?: string[];
  report_calculations?: ReportCalculationKind[];
};

export type CatalogAvailability = { view: string; member: string; detail?: true };

export type CanonicalCatalogMember = Omit<
  CatalogMember,
  "alias" | "display_title" | "value_type"
> & {
  id: string;
  name: string;
  available_in: CatalogAvailability[];
};

export type CanonicalCatalog = {
  measures: CanonicalCatalogMember[];
  dimensions: CanonicalCatalogMember[];
};

type CatalogViewDocumentBase = {
  name: string;
  title: string;
  time_source: string;
  time_source_title: string;
  comparison_policy: TimeComparisonPolicy;
  measures: CatalogMember[];
  dimensions: CatalogMember[];
  hierarchies: string[][];
  record_projection_members: string[];
  calculation_input_titles: Record<string, string>;
};

export type CatalogMetricSourceViewDocument = CatalogViewDocumentBase & {
  surface: "metric_source";
};

export type CatalogDetailViewDocument = CatalogViewDocumentBase & {
  surface: "detail";
};

export type CatalogViewDocument = CatalogMetricSourceViewDocument | CatalogDetailViewDocument;

function isMetricSource(view: CatalogViewDocument): view is CatalogMetricSourceViewDocument {
  return view.surface === "metric_source";
}

export type CatalogMetricDomainDocument = {
  id: MetricDomainId;
  title: string;
  description: string;
  time_source: string;
  time_source_title: string;
  synonyms: string[];
};

export type CatalogDocument = {
  access_scope: AccessScopeDefinition;
  observation_scopes: string[];
  views: CatalogViewDocument[];
  metric_domains: CatalogMetricDomainDocument[];
};

export type CatalogMetricDomainRow = {
  id: MetricDomainId;
  title: string;
  query_contract?: string;
  measure_ids: string[];
  dimension_ids: string[];
};

export type CatalogQueryResult = {
  metric_domains: CatalogMetricDomainRow[];
  measures: PublicCatalogMeasure[];
  dimensions: PublicCatalogDimension[];
  matched_terms: string[];
  unmatched_terms: string[];
};

export function observationScopes(views: CubeView[]): string[] {
  if (!views.length) {
    throw new Error(
      "当前账号在 Cube 中没有可见数据视图；查询参数无需修改，请停止重试并让管理员检查账号角色、数据范围与 access_policy",
    );
  }
  const scopes: string[] = [];
  for (const view of views) {
    const value = view.meta?.observation_scope;
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`公开视图 ${view.name} 的 meta.observation_scope 必须存在且非空`);
    }
    const trimmed = value.trim();
    const normalized = /[。.!?！？]$/.test(trimmed) ? trimmed : `${trimmed}。`;
    if (!scopes.includes(normalized)) scopes.push(normalized);
  }
  return scopes;
}

function memberDocument(
  views: CubeView[],
  member: CubeMember,
  kind: "measure" | "dimension",
  taxonomy: SemanticTaxonomy,
  metricTimes: ReadonlyMap<string, MetricTimeResolution>,
): CatalogMember {
  const rawDimensionGroup = member.meta?.dimension_group;
  const dimensionGroup =
    kind === "dimension" && typeof rawDimensionGroup === "string"
      ? dimensionGroupDefinition(rawDimensionGroup, taxonomy.dimension_groups)
      : undefined;
  if (kind === "dimension" && rawDimensionGroup !== undefined && !dimensionGroup) {
    throw new Error(`维度 ${member.title} 引用了未登记的维度构件`);
  }
  const rawComponents = member.meta?.components as
    | { numerator?: unknown; denominator?: unknown }
    | undefined;
  const view = member.name.split(".")[0];
  const qualify = (name: unknown) =>
    typeof name === "string" ? (name.includes(".") ? name : `${view}.${name}`) : undefined;
  const numerator = qualify(rawComponents?.numerator);
  const denominator = qualify(rawComponents?.denominator);
  const reportCalculations = member.meta?.report_calculations;
  if (
    reportCalculations !== undefined &&
    (!Array.isArray(reportCalculations) ||
      reportCalculations.some((value) => value !== "percent_of_total"))
  ) {
    throw new Error(`指标 ${member.title} 的 report_calculations 声明无效`);
  }
  return {
    name: member.name,
    kind,
    ...(kind === "measure" && member.meta?.metric_domain_id !== undefined
      ? {
          metric_domain_id: parseKnownMetricDomainId(
            member.meta.metric_domain_id,
            `指标 ${member.title}`,
            taxonomy.metric_domains,
          ),
        }
      : {}),
    title: member.title,
    display_title: memberDisplayTitle(views, member.name, member.title),
    alias: member.aliasMember ?? member.name,
    value_type: member.type,
    description: member.description ?? "",
    ...(member.format ? { format: member.format } : {}),
    ...(typeof member.meta?.ai_context === "string" ? { ai_context: member.meta.ai_context } : {}),
    ...(member.meta?.sensitivity ? { sensitivity: String(member.meta.sensitivity) } : {}),
    ...(dimensionKind(member) ? { dimension_kind: dimensionKind(member) } : {}),
    ...(dimensionGroup
      ? { dimension_group: { id: dimensionGroup.name, title: dimensionGroup.title } }
      : {}),
    ...(kind === "measure" ? { time: requiredMetricTime(metricTimes, member) } : {}),
    ...(member.meta?.incompatible_dimensions === undefined
      ? {}
      : {
          incompatible_dimensions: parseIncompatibleDimensions(
            member.meta.incompatible_dimensions,
            `指标 ${member.title}`,
          ).map(({ member: incompatible }) => incompatible),
        }),
    ...(reportCalculations?.length
      ? { report_calculations: [...new Set(reportCalculations)] as ReportCalculationKind[] }
      : {}),
    ...(member.meta?.calculation_role
      ? { calculation_role: String(member.meta.calculation_role) }
      : {}),
    ...(numerator && denominator ? { components: { numerator, denominator } } : {}),
  };
}

/** 一次遍历解出全部指标的时间面；顺带守住「声明的 window 与解析结果不得背离」。 */
function resolveMetricTimes(views: CubeView[]): ReadonlyMap<string, MetricTimeResolution> {
  const members = new Map<string, CubeMember>();
  for (const view of views) {
    for (const member of [...view.measures, ...(view.internalMeasures ?? [])]) {
      members.set(member.name, member);
    }
  }
  // 公开指标必须有合同；内部零件只在自己声明了合同时受同一守卫，否则只作为组件被引用。
  const contracted = views.flatMap((view) => [
    ...view.measures,
    ...(view.internalMeasures ?? []).filter((member) => member.meta?.time_contract !== undefined),
  ]);
  const times = new Map<string, MetricTimeResolution>();
  for (const member of contracted) {
    const resolved = resolveMetricTime(member, members);
    if (
      resolved.basis === "year_start_to_bucket_end" &&
      resolved.contract.window !== "year_to_date"
    ) {
      throw new Error(
        `指标「${member.title ?? member.name}」的时间聚合组件按年初累计求值，` +
          "但 time_contract 声明 window: selected；声明与求值不得背离，" +
          "请显式声明 window: year_to_date",
      );
    }
    times.set(member.name, resolved);
  }
  return times;
}

function requiredMetricTime(
  times: ReadonlyMap<string, MetricTimeResolution>,
  member: CubeMember,
): MetricTimeResolution {
  const time = times.get(member.name);
  if (!time) throw new Error(`指标「${member.title}」缺少已解析的时间面`);
  return time;
}

/** 输入是已完成权限裁剪的 Cube meta；本函数不重复裁剪权限。 */
export function buildCatalogDocument(
  views: CubeView[],
  taxonomy: SemanticTaxonomy,
  timeSources: TimeSourceRegistry,
  accessScope: AccessScopeDefinition,
): CatalogDocument {
  const metricTimes = resolveMetricTimes(views);
  const modelViews: CatalogViewDocument[] = [...views]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((view) => {
      const projectionTargets = recordProjectionTargetsOf(view);
      const detail = view.meta?.query_surface === "detail";
      if (view.meta?.metric_domain_id !== undefined) {
        throw new Error(
          `Cube View ${view.name} 不得声明 meta.metric_domain_id；业务域归属必须声明在指标上`,
        );
      }
      const timeSource = parseKnownTimeSourceId(
        view.meta?.time_source,
        `Cube View ${view.name}`,
        timeSources,
      );
      const timeSourceContract = timeSourceDefinition(timeSources, timeSource);
      const base: CatalogViewDocumentBase = {
        name: view.name,
        title: view.title,
        time_source: timeSource,
        time_source_title: timeSourceContract.title,
        comparison_policy: timeSourceContract.comparison_policy,
        measures: view.measures.map((member) =>
          memberDocument(views, member, "measure", taxonomy, metricTimes),
        ),
        dimensions: view.dimensions.map((member) =>
          memberDocument(views, member, "dimension", taxonomy, metricTimes),
        ),
        hierarchies: (view.hierarchies ?? []).map((hierarchy) => hierarchy.levels),
        record_projection_members: [...projectionTargets.keys()],
        calculation_input_titles: Object.fromEntries(
          (view.internalMeasures ?? []).flatMap((member) => {
            const declared = member.shortTitle ?? member.title;
            return declared
              ? [[member.name, memberDisplayTitle(views, member.name, declared)] as const]
              : [];
          }),
        ),
      };
      if (detail) return { ...base, surface: "detail" };
      for (const measure of base.measures) {
        if (!measure.metric_domain_id) {
          throw new Error(
            `执行 View ${view.name} 的指标 ${measure.name} 缺少 meta.metric_domain_id`,
          );
        }
      }
      return { ...base, surface: "metric_source" };
    });
  const visibleDomainIds = new Set(
    modelViews
      .filter(isMetricSource)
      .flatMap((view) => view.measures.flatMap((measure) => measure.metric_domain_id ?? [])),
  );
  return {
    access_scope: accessScope,
    observation_scopes: observationScopes(views),
    views: modelViews,
    metric_domains: taxonomy.metric_domains
      .filter((domain) => visibleDomainIds.has(domain.id))
      .map((domain) => ({
        id: domain.id,
        title: domain.title,
        description: domain.description,
        time_source: domain.time_source,
        time_source_title: timeSourceLabel(timeSources, domain.time_source),
        synonyms: [...domain.synonyms],
      })),
  };
}

function dimensionSemanticId(member: CatalogMember): string {
  return memberSemanticId("dimension", member.name);
}

function viewDimensionResolvers(document: CatalogDocument): Map<string, Map<string, Set<string>>> {
  const byView = new Map<string, Map<string, Set<string>>>();
  for (const view of document.views) {
    const tokens = new Map<string, Set<string>>();
    const register = (token: string, id: string) => {
      const set = tokens.get(token) ?? new Set<string>();
      set.add(id);
      tokens.set(token, set);
    };
    for (const dimension of view.dimensions) {
      const id = dimensionSemanticId(dimension);
      for (const token of [
        dimension.name,
        memberShortName(dimension.name),
        dimension.alias,
        memberShortName(dimension.alias),
      ]) {
        register(token, id);
      }
    }
    byView.set(view.name, tokens);
  }
  return byView;
}

/**
 * 在声明成员所属视图内把互斥维度引用解析为语义维度 id 集合。
 * 零命中（引用不是本视图维度）、多命中（歧义）均在目录装配阶段抛错——不静默丢弃，不做全局短名猜测。
 */
function resolveIncompatibleInView(
  view: string,
  references: string[],
  resolvers: Map<string, Map<string, Set<string>>>,
): Set<string> {
  const tokens = resolvers.get(view);
  const ids = new Set<string>();
  for (const reference of references) {
    const matches = tokens?.get(reference);
    if (!matches || matches.size === 0) {
      throw new Error(`视图 ${view} 声明了未知的互斥维度「${reference}」`);
    }
    if (matches.size > 1) {
      throw new Error(
        `视图 ${view} 声明的互斥维度「${reference}」在该视图内命中多个维度，存在歧义，无法唯一解析`,
      );
    }
    for (const id of matches) ids.add(id);
  }
  return ids;
}

/** 按规范短名归并成员，并 fail-closed 校验跨来源公开契约。 */
export function canonicalCatalog(document: CatalogDocument): CanonicalCatalog {
  const resolvers = viewDimensionResolvers(document);
  const analysisViews = new Set(document.views.filter(isMetricSource).map((view) => view.name));
  const merge = (pick: (view: CatalogViewDocument) => CatalogMember[]) => {
    const byIdentity = new Map<string, CanonicalCatalogMember>();
    const declarations = new Map<string, CatalogMember>();
    const incompatibleByIdentity = new Map<string, Set<string> | null>();
    for (const view of document.views) {
      for (const member of pick(view)) {
        const key = memberShortName(member.name);
        const resolved = member.incompatible_dimensions
          ? resolveIncompatibleInView(view.name, member.incompatible_dimensions, resolvers)
          : null;
        const seen = byIdentity.get(key);
        if (seen) {
          const declared = declarations.get(key);
          if (
            !declared ||
            declared.kind !== member.kind ||
            (declared.metric_domain_id ?? "") !== (member.metric_domain_id ?? "") ||
            declared.display_title !== member.display_title ||
            declared.value_type !== member.value_type ||
            declared.description !== member.description ||
            (declared.format ?? "") !== (member.format ?? "") ||
            (declared.ai_context ?? "") !== (member.ai_context ?? "") ||
            (declared.sensitivity ?? "") !== (member.sensitivity ?? "") ||
            (declared.time === undefined) !== (member.time === undefined) ||
            (declared.time !== undefined &&
              member.time !== undefined &&
              (!sameMetricTimeContract(declared.time.contract, member.time.contract) ||
                declared.time.basis !== member.time.basis)) ||
            (declared.dimension_kind ?? "") !== (member.dimension_kind ?? "") ||
            JSON.stringify(declared.dimension_group ?? null) !==
              JSON.stringify(member.dimension_group ?? null) ||
            (declared.calculation_role ?? "") !== (member.calculation_role ?? "") ||
            JSON.stringify(declared.report_calculations ?? []) !==
              JSON.stringify(member.report_calculations ?? []) ||
            JSON.stringify(
              declared.components
                ? {
                    numerator: memberShortName(declared.components.numerator),
                    denominator: memberShortName(declared.components.denominator),
                  }
                : null,
            ) !==
              JSON.stringify(
                member.components
                  ? {
                      numerator: memberShortName(member.components.numerator),
                      denominator: memberShortName(member.components.denominator),
                    }
                  : null,
              )
          ) {
            throw new Error(
              `同名成员「${key}」在多个数据来源上的公开契约不一致；不同语义必须使用不同成员名`,
            );
          }
          if (
            member.kind === "measure" &&
            view.surface !== "detail" &&
            seen.available_in.some((binding) =>
              document.views.some(
                (candidate) => candidate.name === binding.view && candidate.surface !== "detail",
              ),
            )
          ) {
            throw new Error(
              `指标「${key}」只能归属一个普通执行 View；请移除重复投影，受控明细绑定不受此限制`,
            );
          }
          seen.available_in.push({
            view: view.name,
            member: member.name,
            ...(view.surface === "detail" ? { detail: true as const } : {}),
          });
          const accumulated = incompatibleByIdentity.get(key) ?? new Set<string>();
          for (const id of resolved ?? []) accumulated.add(id);
          incompatibleByIdentity.set(key, accumulated);
          if (accumulated.size) seen.incompatible_dimensions = [...accumulated].sort();
          continue;
        }
        declarations.set(key, member);
        incompatibleByIdentity.set(key, resolved);
        const {
          alias: _alias,
          display_title,
          value_type: _valueType,
          title: _title,
          incompatible_dimensions: _incompatible,
          ...rest
        } = member;
        byIdentity.set(key, {
          ...rest,
          id: memberSemanticId(member.kind, member.name),
          title: display_title,
          available_in: [
            {
              view: view.name,
              member: member.name,
              ...(view.surface === "detail" ? { detail: true as const } : {}),
            },
          ],
          ...(resolved && resolved.size ? { incompatible_dimensions: [...resolved].sort() } : {}),
        });
      }
    }
    return [...byIdentity.values()].filter((member) =>
      member.available_in.some(({ view }) => analysisViews.has(view)),
    );
  };
  return {
    measures: merge((view) => view.measures),
    dimensions: merge((view) => view.dimensions),
  };
}

function titleIndex(document: CatalogDocument, catalog: CanonicalCatalog): Map<string, string> {
  const index = new Map<string, string>();
  for (const view of document.views) {
    for (const [name, title] of Object.entries(view.calculation_input_titles)) {
      index.set(name, title);
      index.set(memberShortName(name), title);
    }
  }
  for (const member of [...catalog.measures, ...catalog.dimensions]) {
    for (const available of member.available_in) {
      index.set(available.member, member.title);
      index.set(memberShortName(available.member), member.title);
    }
  }
  return index;
}

type ProjectionMaps = {
  titles: Map<string, string>;
  ids: Map<string, string>;
  shortIds: Map<string, string>;
  recordProjectionBindings: Set<string>;
};

function projectionMaps(document: CatalogDocument, catalog: CanonicalCatalog): ProjectionMaps {
  const titles = titleIndex(document, catalog);
  const ids = new Map<string, string>();
  const shortIds = new Map<string, string>();
  for (const member of [...catalog.measures, ...catalog.dimensions]) {
    for (const available of member.available_in) {
      ids.set(available.member, member.id);
      shortIds.set(memberShortName(available.member), member.id);
    }
  }
  const recordProjectionBindings = new Set(
    document.views.flatMap((view) => view.record_projection_members),
  );
  return { titles, ids, shortIds, recordProjectionBindings };
}

/** 装配中途的成员：公共查询能力与时间面还没算出来，引擎侧的时间解析已随文档带上。 */
type CompilerCatalogSeedMember = Omit<CompilerCatalogMember, "query_capabilities" | "time"> & {
  time?: MetricTimeResolution;
};

function compilerMember(
  member: CanonicalCatalogMember,
  { titles, ids, shortIds, recordProjectionBindings }: ProjectionMaps,
): CompilerCatalogSeedMember {
  const named = (component: string) =>
    titles.get(component) ?? titles.get(memberShortName(component));
  const identified = (component: string) =>
    ids.get(component) ?? shortIds.get(memberShortName(component));
  // 内部零件没有公开名称时省略公式行，避免回退到物理成员名。
  const formula = member.components
    ? {
        numerator: named(member.components.numerator),
        denominator: named(member.components.denominator),
      }
    : undefined;
  const namedFormula =
    formula?.numerator && formula.denominator
      ? {
          numerator: formula.numerator,
          denominator: formula.denominator,
          ...(identified(member.components?.numerator ?? "")
            ? { numerator_id: identified(member.components?.numerator ?? "") as string }
            : {}),
          ...(identified(member.components?.denominator ?? "")
            ? { denominator_id: identified(member.components?.denominator ?? "") as string }
            : {}),
        }
      : undefined;
  const structureShareNumerator =
    member.calculation_role === "structure_share"
      ? ids.get(member.components?.numerator ?? "")
      : undefined;
  if (member.calculation_role === "structure_share" && !structureShareNumerator) {
    throw new Error(`结构占比指标「${member.title}」的分子必须具有公共语义身份`);
  }
  return {
    id: member.id,
    name: member.name,
    kind: member.kind,
    ...(member.metric_domain_id ? { metric_domain_id: member.metric_domain_id } : {}),
    title: member.title,
    description: member.description,
    ...(member.format ? { format: member.format } : {}),
    ...(member.ai_context ? { ai_context: member.ai_context } : {}),
    ...(member.sensitivity ? { sensitivity: member.sensitivity } : {}),
    ...(member.dimension_kind ? { dimension_kind: member.dimension_kind } : {}),
    ...(member.dimension_group ? { dimension_group: member.dimension_group } : {}),
    ...(member.time ? { time: member.time } : {}),
    ...(member.available_in.some(({ member: physical }) => recordProjectionBindings.has(physical))
      ? { records_available: true as const }
      : {}),
    ...(member.incompatible_dimensions?.length
      ? { incompatible_dimensions: member.incompatible_dimensions }
      : {}),
    ...(member.report_calculations?.length
      ? { report_calculations: member.report_calculations }
      : {}),
    ...(namedFormula ? { formula: namedFormula } : {}),
    ...(structureShareNumerator
      ? {
          relation: {
            kind: "structure_share" as const,
            numerator_id: structureShareNumerator,
          },
        }
      : {}),
    available_in: member.available_in.map(({ view, member: availableMember, detail }) => ({
      view,
      member: availableMember,
      ...(detail ? { detail: true as const } : {}),
      ...(recordProjectionBindings.has(availableMember)
        ? { records_available: true as const }
        : {}),
    })),
  };
}

function publicMemberBase(member: CompilerCatalogMember) {
  return {
    id: member.id,
    title: member.title,
    description: member.description,
    ...(member.format ? { format: member.format } : {}),
    ...(member.ai_context ? { ai_context: member.ai_context } : {}),
    ...(member.sensitivity ? { sensitivity: member.sensitivity } : {}),
  };
}

function stripMeasure(member: CompilerCatalogMeasure): PublicCatalogMeasure {
  return {
    ...publicMemberBase(member),
    kind: "measure",
    query_capabilities: member.query_capabilities,
    ...(member.records_available ? { records_available: true } : {}),
    ...(member.report_calculations?.length
      ? { report_calculations: member.report_calculations }
      : {}),
    ...(member.formula ? { formula: member.formula } : {}),
    ...(member.relation ? { relation: member.relation } : {}),
    time: member.time,
  };
}

function stripDimension(member: CompilerCatalogDimension): PublicCatalogDimension {
  if (!member.dimension_group) {
    throw new Error(`维度「${member.title}」缺少业务属性组归属，不能上线`);
  }
  return {
    ...publicMemberBase(member),
    kind: "dimension",
    ...(member.dimension_kind ? { dimension_kind: member.dimension_kind } : {}),
    dimension_group: member.dimension_group,
  };
}

function measureExecutionView(member: CompilerCatalogSeedMember): string {
  const views = member.available_in
    .filter((binding) => !binding.detail)
    .map((binding) => binding.view);
  if (views.length !== 1) {
    throw new Error(
      `指标「${member.title}」必须且只能绑定一个普通执行 View；当前为 ${views.length} 个`,
    );
  }
  return views[0];
}

function measureQueryCapabilities(
  member: CompilerCatalogSeedMember,
  catalog: {
    views: CompilerCatalog["views"];
    dimensions: CompilerCatalogSeedMember[];
  },
): MeasureQueryCapabilities {
  const ownerView = measureExecutionView(member);
  const incompatible = new Set(member.incompatible_dimensions ?? []);
  const dimensionIds = catalog.dimensions
    .filter(
      (dimension) =>
        !incompatible.has(dimension.id) &&
        dimension.available_in.some((binding) => !binding.detail && binding.view === ownerView),
    )
    .map(({ id }) => id)
    .sort();
  const allowed = new Set(dimensionIds);
  const seenHierarchies = new Set<string>();
  const hierarchies = catalog.views
    .filter((view) => view.name === ownerView)
    .flatMap(({ hierarchies: chains }) => chains ?? [])
    .map((chain) => chain.filter((dimension) => allowed.has(dimension)))
    .filter((chain) => chain.length > 1)
    .filter((chain) => {
      const key = JSON.stringify(chain);
      if (seenHierarchies.has(key)) return false;
      seenHierarchies.add(key);
      return true;
    });
  return {
    dimension_ids: dimensionIds,
    ...(hierarchies.length ? { hierarchies } : {}),
    ...(member.relation?.kind === "structure_share"
      ? { grouping: { minimum_varying_dimensions: 1 } }
      : {}),
  };
}

function requiresExplicitComparison(
  member: CompilerCatalogSeedMember,
  views: CompilerCatalog["views"],
): boolean {
  const ownerView = measureExecutionView(member);
  return views.some(
    (view) => view.name === ownerView && view.comparison_policy === "explicit_only",
  );
}

/** 编译器目录保留物理绑定，仅供服务端规划与记录投影使用。 */
export function toCompilerCatalog(document: CatalogDocument): CompilerCatalog {
  const catalog = canonicalCatalog(document);
  const maps = projectionMaps(document, catalog);
  const compiler: Omit<CompilerCatalog, "measures" | "dimensions"> & {
    measures: CompilerCatalogSeedMember[];
    dimensions: CompilerCatalogSeedMember[];
  } = {
    access_scope: document.access_scope,
    observation_scopes: document.observation_scopes,
    views: document.views.filter(isMetricSource).map((view) => ({
      name: view.name,
      title: view.title,
      time_source: view.time_source,
      comparison_policy: view.comparison_policy,
      ...(view.hierarchies.length
        ? {
            hierarchies: view.hierarchies.flatMap((chain) => {
              const semantic = chain.map((member) => maps.ids.get(member));
              return semantic.every((member): member is string => typeof member === "string")
                ? [semantic]
                : [];
            }),
          }
        : {}),
    })),
    metric_domains: document.metric_domains.map((domain) => ({
      id: domain.id,
      title: domain.title,
      query_contract: domain.description,
      time_source: domain.time_source,
      synonyms: domain.synonyms,
    })),
    measures: catalog.measures
      .filter((member) => member.calculation_role !== SCOPE_DENOMINATOR)
      .map((member) => compilerMember(member, maps)),
    dimensions: catalog.dimensions.map((member) => compilerMember(member, maps)),
  };
  const measures: CompilerCatalogMeasure[] = compiler.measures.map((member) => {
    if (member.kind !== "measure" || !member.time) {
      throw new Error(`指标目录成员 ${member.id} 的类型无效`);
    }
    const constraints = {
      ...metricTimeCapabilities(member.time.contract),
      ...(requiresExplicitComparison(member, compiler.views)
        ? { comparison: "explicit_only" as const }
        : {}),
    };
    return {
      ...member,
      kind: "measure",
      query_capabilities: measureQueryCapabilities(member, compiler),
      time: {
        value_basis: member.time.basis,
        ...(Object.keys(constraints).length ? { constraints } : {}),
      },
    };
  });
  const dimensions: CompilerCatalogDimension[] = compiler.dimensions.map((member) => {
    if (member.kind !== "dimension") throw new Error(`维度目录成员 ${member.id} 的类型无效`);
    return { ...member, kind: "dimension" };
  });
  return {
    ...compiler,
    measures,
    dimensions,
  };
}

/** 对外目录只暴露语义身份；查询选路与兼容性由服务端编译。 */
export function toSemanticCatalog(
  document: CatalogDocument,
  time: Pick<PublicCatalogDocument, "data_as_of" | "time_context"> = {
    data_as_of: "未知",
    time_context: [],
  },
): PublicCatalogDocument {
  const compiler = toCompilerCatalog(document);
  const links = new Map(
    catalogMetricDomains(compiler, compiler.measures, compiler.dimensions).map((row) => [
      row.id,
      row,
    ]),
  );
  return {
    access_scope: compiler.access_scope,
    observation_scopes: compiler.observation_scopes,
    ...time,
    metric_domains: compiler.metric_domains.map((domain) => ({
      id: domain.id,
      title: domain.title,
      query_contract: domain.query_contract,
      time_context_title: document.metric_domains.find((candidate) => candidate.id === domain.id)!
        .time_source_title,
      synonyms: domain.synonyms,
      measure_ids: links.get(domain.id)?.measure_ids ?? [],
      dimension_ids: links.get(domain.id)?.dimension_ids ?? [],
    })),
    measures: compiler.measures.map(stripMeasure),
    dimensions: compiler.dimensions.map(stripDimension),
  };
}

function catalogMetricDomains(
  catalog: CompilerCatalog,
  measures: CompilerCatalogMember[],
  dimensions: CompilerCatalogMember[],
  includedDomains?: ReadonlySet<MetricDomainId>,
): CatalogMetricDomainRow[] {
  const analysisViews = (member: CompilerCatalogMember) =>
    member.available_in.filter((binding) => !binding.detail).map((binding) => binding.view);
  return catalog.metric_domains
    .filter((domain) => !includedDomains || includedDomains.has(domain.id))
    .map((domain) => {
      const allDomainMeasures = catalog.measures.filter(
        (member) => member.metric_domain_id === domain.id,
      );
      const sourceViews = new Set(allDomainMeasures.flatMap(analysisViews));
      const supportsDomain = (dimension: CompilerCatalogMember) =>
        [...sourceViews].every((view) => analysisViews(dimension).includes(view));
      return {
        id: domain.id,
        title: domain.title,
        query_contract: domain.query_contract,
        measure_ids: measures
          .filter((member) => member.metric_domain_id === domain.id)
          .map(({ id }) => id),
        dimension_ids: dimensions.filter(supportsDomain).map(({ id }) => id),
      };
    });
}

export function browseCatalogDocument(document: CatalogDocument): CatalogQueryResult {
  const compiler = toCompilerCatalog(document);
  return {
    metric_domains: catalogMetricDomains(compiler, compiler.measures, compiler.dimensions),
    measures: compiler.measures.map(stripMeasure),
    dimensions: compiler.dimensions.map(stripDimension),
    matched_terms: [],
    unmatched_terms: [],
  };
}

function domainHaystack(domain: CatalogMetricDomainDocument): string[] {
  return [domain.title, domain.description, ...domain.synonyms].map((value) => value.toLowerCase());
}

/** MCP 搜索投影：返回语义成员并隐藏物理绑定。 */
export function searchCatalogDocument(
  document: CatalogDocument,
  terms: string[],
  relatedMemberIds: ReadonlySet<string> = new Set(),
): CatalogQueryResult {
  const catalog = canonicalCatalog(document);
  const publicMeasures = catalog.measures.filter(
    (member) => member.calculation_role !== SCOPE_DENOMINATOR,
  );
  const fallbackTokens = memberFallbackTokens(terms, [
    { measures: publicMeasures, dimensions: catalog.dimensions },
  ]);
  const domainHit = (domain: CatalogMetricDomainDocument) =>
    hitCount(terms, domainHaystack(domain)) > 0;

  let measures = rankMembers(terms, publicMeasures, fallbackTokens);
  let dimensions = rankMembers(terms, catalog.dimensions, fallbackTokens);
  const appendRelated = <T extends CanonicalCatalogMember>(selected: T[], available: T[]): T[] => {
    const seen = new Set(selected.map(({ id }) => id));
    return [
      ...selected,
      ...available.filter(({ id }) => relatedMemberIds.has(id) && !seen.has(id)),
    ];
  };
  measures = appendRelated(measures, publicMeasures);
  dimensions = appendRelated(dimensions, catalog.dimensions);
  if (!measures.length && !dimensions.length) {
    const browsed = new Set(document.metric_domains.filter(domainHit).map((domain) => domain.id));
    measures = publicMeasures.filter(
      (member) => member.metric_domain_id && browsed.has(member.metric_domain_id),
    );
    const compiler = toCompilerCatalog(document);
    const domainRows = catalogMetricDomains(
      compiler,
      compiler.measures,
      compiler.dimensions,
      browsed,
    );
    const dimensionIds = new Set(domainRows.flatMap((domain) => domain.dimension_ids));
    dimensions = catalog.dimensions.filter((member) => dimensionIds.has(member.id));
  }

  const compiler = toCompilerCatalog(document);
  const compilerMeasureById = new Map(compiler.measures.map((member) => [member.id, member]));
  const compilerDimensionById = new Map(compiler.dimensions.map((member) => [member.id, member]));
  const compilerMeasures = measures.flatMap((member) => {
    const resolved = compilerMeasureById.get(member.id);
    return resolved ? [resolved] : [];
  });
  const compilerDimensions = dimensions.flatMap((member) => {
    const resolved = compilerDimensionById.get(member.id);
    return resolved ? [resolved] : [];
  });
  const directlyHitDomains = document.metric_domains.filter(domainHit).map((domain) => domain.id);
  const includedDomains = new Set<MetricDomainId>([
    ...directlyHitDomains,
    ...compilerMeasures.flatMap((member) => member.metric_domain_id ?? []),
  ]);
  if (!compilerMeasures.length && compilerDimensions.length) {
    for (const domain of catalogMetricDomains(compiler, compiler.measures, compiler.dimensions)) {
      if (compilerDimensions.every((dimension) => domain.dimension_ids.includes(dimension.id))) {
        includedDomains.add(domain.id);
      }
    }
  }

  const allMembers = [...publicMeasures, ...catalog.dimensions];
  const matched = terms.filter(
    (term) =>
      allMembers.some((member) => memberHit(term, member, fallbackTokens.has(term))) ||
      document.metric_domains.some((domain) => hitCount([term], domainHaystack(domain)) > 0),
  );
  return {
    metric_domains: catalogMetricDomains(
      compiler,
      compilerMeasures,
      compilerDimensions,
      includedDomains,
    ),
    measures: compilerMeasures.map(stripMeasure),
    dimensions: compilerDimensions.map(stripDimension),
    matched_terms: matched,
    unmatched_terms: terms.filter((term) => !matched.includes(term)),
  };
}
