/**
 * 语义查询意图到正式指标查询规格的纯编译层。
 *
 * 业务指标域只负责发现；每个指标绑定一个执行 View，维度可被多个执行 View 复用。
 * 编译器按指标解析物理来源，校验所选维度属于各事实的共同语义空间，再生成一份逻辑查询。
 * 后续 Metric Planner 会把指标图展开为事实内 Cube 查询，并在聚合结果上按完整业务键对齐。
 */
import type { CompilerCatalog, CompilerCatalogMember } from "./compiler_catalog.js";
import type { QueryViewSpec } from "./analysis_spec.js";
import { completeHierarchyDimensions } from "./hierarchy_completion.js";
import type { SemanticQueryView } from "./semantic_analysis.js";
import { compileTimeIntent } from "./time_contract.js";

export type PlannedGroupDimension = {
  id: string;
  title: string;
  member: string;
};

export type QueryIntentResolution = {
  status: "direct";
  /** 输出时间列与规范维度命名使用的确定性锚点 View。 */
  view: string;
  /** 本次查询实际涉及的物理执行 View。 */
  views: string[];
  query: QueryViewSpec;
  group_dimensions: PlannedGroupDimension[];
};

export type IncompatibleQueryResolution = {
  status: "incompatible";
  reason: string;
};

export type QueryIntentPlan = QueryIntentResolution | IncompatibleQueryResolution;

type MemberKind = "measure" | "dimension" | "either";

export function bindSemanticFilter(
  filter: NonNullable<SemanticQueryView["filters"]>[number],
  member: string,
): NonNullable<QueryViewSpec["filters"]>[number] {
  return {
    member,
    operator: filter.relation === "one_of" ? "equals" : "notEquals",
    values: filter.values,
  };
}

function candidates(catalog: CompilerCatalog, kind: MemberKind): CompilerCatalogMember[] {
  if (kind === "measure") return catalog.measures;
  if (kind === "dimension") return catalog.dimensions;
  return [...catalog.measures, ...catalog.dimensions];
}

type ReferenceRequirement = {
  reference: string;
  kind: MemberKind;
  field: string;
};

function invalidReferenceReason(
  catalog: CompilerCatalog,
  intent: SemanticQueryView,
): string | undefined {
  const requirements: ReferenceRequirement[] = [
    ...(intent.measures ?? []).map((reference) => ({
      reference,
      kind: "measure" as const,
      field: "measures",
    })),
    ...(intent.dimensions ?? []).map((reference) => ({
      reference,
      kind: "dimension" as const,
      field: "dimensions",
    })),
    ...(intent.filters ?? []).map((filter) => ({
      reference: filter.member,
      kind: "dimension" as const,
      field: "filters.member",
    })),
    ...(intent.group_sort
      ? [
          {
            reference: intent.group_sort.dimension,
            kind: "dimension" as const,
            field: "group_sort.dimension",
          },
          ...(intent.group_sort.by === "name"
            ? []
            : [
                {
                  reference: intent.group_sort.by,
                  kind: "measure" as const,
                  field: "group_sort.by",
                },
              ]),
        ]
      : []),
  ];
  const invalid = requirements.filter(
    ({ reference, kind }) => !catalogMember(catalog, reference, kind),
  );
  if (!invalid.length) return undefined;

  const kindTitle = (kind: Exclude<MemberKind, "either">) => (kind === "measure" ? "指标" : "维度");
  const details = invalid.map(({ reference, kind, field }) => {
    const sameId = catalogMember(catalog, reference);
    if (sameId && kind !== "either") {
      return `${field} 中的 ${reference} 是${kindTitle(sameId.kind)}，此处需要${kindTitle(kind)} id`;
    }
    const titleMatch = candidates(catalog, kind).find((member) => member.title === reference);
    if (titleMatch) {
      return `${field} 使用了标题「${reference}」，应改为语义 id ${titleMatch.id}`;
    }
    return `${field} 中的「${reference}」不在当前可见目录`;
  });
  return (
    `分析成员引用无效：${[...new Set(details)].join("；")}。` +
    "成员必须使用 catalog(terms=[业务概念]) 返回的语义 id，不能使用中文标题、物理字段名或猜测值"
  );
}

/** 客户端只引用 catalog 的稳定语义 id，物理 Cube 成员名在此边界 fail-closed。 */
export function catalogMember(
  catalog: CompilerCatalog,
  reference: string,
  kind: MemberKind = "either",
): CompilerCatalogMember | undefined {
  return candidates(catalog, kind).find((member) => member.id === reference);
}

function bindMember(member: CompilerCatalogMember, view: string): string {
  const binding = member.available_in.find(
    (available) => available.view === view && !available.detail,
  );
  if (!binding) throw new Error(`指标或维度「${member.title}」不能在执行来源 ${view} 中使用`);
  return binding.member;
}

function analysisBindings(member: CompilerCatalogMember) {
  return member.available_in.filter((available) => !available.detail);
}

function measureOwner(member: CompilerCatalogMember): { view: string; member: string } {
  const bindings = analysisBindings(member);
  if (bindings.length !== 1) {
    throw new Error(
      `指标「${member.title}」必须且只能绑定一个普通执行 View；当前为 ${bindings.length} 个`,
    );
  }
  return bindings[0];
}

function membersOf(
  catalog: CompilerCatalog,
  references: string[],
  kind: MemberKind,
): CompilerCatalogMember[] {
  return references.map((reference) => {
    const member = catalogMember(catalog, reference, kind);
    if (!member) throw new Error(`catalog 中不存在成员 ${reference}`);
    return member;
  });
}

function effectiveGroupDimensions(
  catalog: CompilerCatalog,
  grouped: CompilerCatalogMember[],
  filters: SemanticQueryView["filters"],
  view: string,
): CompilerCatalogMember[] {
  const chains = catalog.views.find((candidate) => candidate.name === view)?.hierarchies ?? [];
  const completed = completeHierarchyDimensions(
    grouped.map((member) => member.id),
    (filters ?? []).map((filter) => ({
      member: filter.member,
      includes: filter.relation === "one_of",
      values: filter.values,
    })),
    chains,
  );
  return completed.dimensions.map((id) => {
    const member = catalogMember(catalog, id, "dimension");
    if (!member) throw new Error(`catalog 层级引用的维度 ${id} 不存在`);
    return member;
  });
}

function incompatibleDimensionReason(
  catalog: CompilerCatalog,
  intent: SemanticQueryView,
): string | undefined {
  const dimensions = membersOf(catalog, intent.dimensions ?? [], "dimension");
  for (const measure of membersOf(catalog, intent.measures ?? [], "measure")) {
    const conflict = dimensions.find((dimension) =>
      measure.incompatible_dimensions?.includes(dimension.id),
    );
    if (conflict) return `指标「${measure.title}」不能按「${conflict.title}」分组`;
  }
  return undefined;
}

function dimensionMembers(
  catalog: CompilerCatalog,
  intent: SemanticQueryView,
): CompilerCatalogMember[] {
  const ids = [
    ...(intent.dimensions ?? []),
    ...(intent.filters ?? []).map((filter) => filter.member),
    ...(intent.group_sort ? [intent.group_sort.dimension] : []),
  ];
  return membersOf(catalog, [...new Set(ids)], "dimension");
}

function sourceTitle(catalog: CompilerCatalog, name: string): string {
  return catalog.views.find((view) => view.name === name)?.title ?? name;
}

function supports(member: CompilerCatalogMember, view: string): boolean {
  return analysisBindings(member).some((binding) => binding.view === view);
}

/**
 * 指标来源自动规划：指标各自绑定唯一执行 View；所选维度、筛选与分组必须存在于
 * 每个相关执行来源；维度统一绑定到一个确定性锚点，Metric Planner 再映射到每条事实查询腿。
 */
export function planQueryIntent(
  catalog: CompilerCatalog,
  intent: SemanticQueryView,
): QueryIntentPlan {
  const invalidReference = invalidReferenceReason(catalog, intent);
  if (invalidReference) return { status: "incompatible", reason: invalidReference };
  const conflict = incompatibleDimensionReason(catalog, intent);
  if (conflict) return { status: "incompatible", reason: conflict };

  const measures = membersOf(catalog, intent.measures ?? [], "measure");
  let owners: { view: string; member: string }[];
  try {
    owners = measures.map(measureOwner);
  } catch (error) {
    return {
      status: "incompatible",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const ownerViews = [...new Set(owners.map((owner) => owner.view))];
  const comparison = intent.time.comparison;
  if (comparison && comparison.kind !== "custom") {
    const explicitOnlyView = ownerViews.find(
      (view) =>
        catalog.views.find((candidate) => candidate.name === view)?.comparison_policy ===
        "explicit_only",
    );
    if (explicitOnlyView) {
      return {
        status: "incompatible",
        reason:
          `指标来源「${sourceTitle(catalog, explicitOnlyView)}」只允许显式对照，` +
          "日历相对对照可能匹配到错误的数据时点；" +
          "请改用明确的自定义对照期间",
      };
    }
  }
  const dimensions = dimensionMembers(catalog, intent);
  for (const view of ownerViews) {
    const unsupported = dimensions.find((dimension) => !supports(dimension, view));
    if (unsupported) {
      return {
        status: "incompatible",
        reason: `指标来源「${sourceTitle(catalog, view)}」不支持维度「${unsupported.title}」；请移除该维度或拆成独立分析`,
      };
    }
  }

  let anchorView = ownerViews[0];
  if (!anchorView) {
    const candidates = catalog.views.filter((view) =>
      dimensions.every((dimension) => supports(dimension, view.name)),
    );
    anchorView = candidates[0]?.name;
  }
  if (!anchorView) {
    return {
      status: "incompatible",
      reason: "没有一个当前可见的执行来源能够承载所选维度、筛选与排序",
    };
  }

  const bindDimension = (member: CompilerCatalogMember) => bindMember(member, anchorView);
  const bind = (reference: string, kind: MemberKind) => {
    const member = catalogMember(catalog, reference, kind);
    if (!member) throw new Error(`catalog 中不存在成员 ${reference}`);
    return member.kind === "measure" ? measureOwner(member).member : bindDimension(member);
  };
  const groupDimensions = effectiveGroupDimensions(
    catalog,
    membersOf(catalog, intent.dimensions ?? [], "dimension"),
    intent.filters,
    anchorView,
  );
  const selectionDimensions = intent.group_sort?.max_items
    ? effectiveGroupDimensions(
        catalog,
        membersOf(catalog, [intent.group_sort.dimension], "dimension"),
        intent.filters,
        anchorView,
      )
    : [];
  const groupedIds = new Set(groupDimensions.map((member) => member.id));
  const missingSelectionDimension = selectionDimensions.find(
    (dimension) => !groupedIds.has(dimension.id),
  );
  if (missingSelectionDimension) {
    return {
      status: "incompatible",
      reason: `分组最大项数所作用的维度「${missingSelectionDimension.title}」不在查询分组中`,
    };
  }
  return {
    status: "direct",
    view: anchorView,
    views: ownerViews.length ? ownerViews : [anchorView],
    group_dimensions: groupDimensions.map((member) => ({
      id: member.id,
      title: member.title,
      member: bindDimension(member),
    })),
    query: {
      id: intent.id,
      ...(intent.view_title ? { view_title: intent.view_title } : {}),
      time_view: anchorView,
      time: compileTimeIntent(intent.time),
      grouping_sets: {
        base: membersOf(catalog, intent.dimensions ?? [], "dimension").map((dimension) => ({
          id: dimension.id,
          member: bindDimension(dimension),
        })),
      },
      ...(intent.measures
        ? { measures: intent.measures.map((member) => bind(member, "measure")) }
        : {}),
      ...(groupDimensions.length ? { dimensions: groupDimensions.map(bindDimension) } : {}),
      ...(intent.filters
        ? {
            filters: intent.filters.map((filter) =>
              bindSemanticFilter(filter, bind(filter.member, "dimension")),
            ),
          }
        : {}),
      ...(intent.group_sort && !intent.group_sort.max_items
        ? {
            order: [
              {
                member:
                  intent.group_sort.by === "name"
                    ? bind(intent.group_sort.dimension, "dimension")
                    : bind(intent.group_sort.by, "measure"),
                direction: intent.group_sort.direction,
              },
            ],
          }
        : {}),
      ...(intent.group_sort?.max_items
        ? {
            selection: {
              type: "top_n" as const,
              dimensions: selectionDimensions.map(bindDimension),
              by:
                intent.group_sort.by === "name"
                  ? bind(intent.group_sort.dimension, "dimension")
                  : bind(intent.group_sort.by, "measure"),
              window: "anchor" as const,
              count: intent.group_sort.max_items,
              direction: intent.group_sort.direction,
            },
          }
        : {}),
    },
  };
}
