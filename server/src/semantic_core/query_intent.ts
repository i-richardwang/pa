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
import { queryFeasibilityIssue, type QueryFeasibilityIssue } from "./query_feasibility.js";

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
  issue: QueryFeasibilityIssue;
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
  viewId: string,
): QueryIntentPlan {
  const feasibilityIssue = queryFeasibilityIssue(catalog, intent);
  if (feasibilityIssue) return { status: "incompatible", issue: feasibilityIssue };

  const measures = membersOf(catalog, intent.measures ?? [], "measure");
  const owners = measures.map(measureOwner);
  const ownerViews = [...new Set(owners.map((owner) => owner.view))];
  const dimensions = dimensionMembers(catalog, intent);

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
      issue: {
        code: "query_dimensions_unavailable",
        dimension_ids: dimensions.map(({ id }) => id),
        dimension_titles: dimensions.map(({ title }) => title),
      },
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
    throw new Error(
      `可行性规划放行了不在结果分组中的排序维度「${missingSelectionDimension.title}」`,
    );
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
      id: viewId,
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
