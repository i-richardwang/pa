/** 语义查询可行性：只消费公开成员身份与能力，不接触物理 View 或 Cube 成员名。 */
import { canonicalJson } from "./canonical_json.js";
import type { ReportCalculationKind } from "./report_calculation.js";
import type { SemanticQueryView } from "./semantic_analysis.js";
import {
  metricTimeComparisonIssue,
  metricTimeSelectionIssue,
  timeSelectionIssueMessage,
  type ResolvedTimeSelection,
  type MetricTime,
  type TimeSelectionIssue,
} from "./time_contract.js";

export type MeasureQueryCapabilities = {
  /** 可用于分组、筛选与排序的全部语义维度。 */
  dimension_ids: string[];
  /** 该指标执行空间中的语义层级链，从粗到细。 */
  hierarchies?: string[][];
  /** 指标成立所需的分组形态；省略表示没有额外要求。 */
  grouping?: { minimum_varying_dimensions: number };
};

type QueryFeasibilityMemberBase = {
  id: string;
  title: string;
};

type QueryFeasibilityMeasure = QueryFeasibilityMemberBase & {
  kind: "measure";
  query_capabilities: MeasureQueryCapabilities;
  report_calculations?: ReportCalculationKind[];
  time: MetricTime;
};

type QueryFeasibilityDimension = QueryFeasibilityMemberBase & {
  kind: "dimension";
  dimension_kind?: "categorical" | "overlapping";
};

type QueryFeasibilityCatalog = {
  measures: QueryFeasibilityMeasure[];
  dimensions: QueryFeasibilityDimension[];
};

type QueryDimensionUsage = "group" | "filter";

export type QueryFeasibilityIssue =
  | TimeSelectionIssue
  | {
      code: "query_member_unknown";
      reference: string;
      field: string;
      expected_kind: "measure" | "dimension";
      actual_kind?: "measure" | "dimension";
      title_match_id?: string;
    }
  | {
      code: "query_dimension_unsupported";
      measure_id: string;
      measure_title: string;
      dimension_id: string;
      dimension_title: string;
      usage: QueryDimensionUsage;
    }
  | {
      code: "query_dimensions_unavailable";
      dimension_ids: string[];
      dimension_titles: string[];
    }
  | {
      code: "query_sort_dimension_missing";
      dimension_id: string;
      dimension_title: string;
    }
  | {
      code: "query_grouping_requirement_unsatisfied";
      measure_id: string;
      measure_title: string;
      minimum_varying_dimensions: number;
    }
  | {
      code: "query_calculation_unsupported";
      calculation_id: string;
      measure_id: string;
      measure_title: string;
    }
  | {
      code: "query_calculation_overlapping_dimension";
      calculation_id: string;
      dimension_id: string;
      dimension_title: string;
    }
  | {
      code: "query_calculation_top_n_conflict";
      calculation_id: string;
      calculation_title: string;
    }
  | {
      code: "query_calculation_hierarchy_conflict";
      calculation_id: string;
      calculation_title: string;
      category_dimension: string;
      category_title: string;
      descendant_dimensions: string[];
      descendant_titles: string[];
    };

type DimensionReference = { id: string; usage: QueryDimensionUsage };
/** 成员引用可以接受的成员类型；either 表示两种都成立。 */
export type MemberKind = "measure" | "dimension" | "either";

type ReferenceRequirement = {
  reference: string;
  kind: Exclude<MemberKind, "either">;
  field: string;
};

function candidates(catalog: QueryFeasibilityCatalog, kind: MemberKind) {
  if (kind === "measure") return catalog.measures;
  if (kind === "dimension") return catalog.dimensions;
  return [...catalog.measures, ...catalog.dimensions];
}

function invalidReferenceIssues(
  catalog: QueryFeasibilityCatalog,
  view: SemanticQueryView,
): QueryFeasibilityIssue[] {
  const requirements: ReferenceRequirement[] = [
    ...(view.measures ?? []).map((reference) => ({
      reference,
      kind: "measure" as const,
      field: "measures",
    })),
    ...(view.dimensions ?? []).map((reference) => ({
      reference,
      kind: "dimension" as const,
      field: "dimensions",
    })),
    ...(view.filters ?? []).map(({ member: reference }) => ({
      reference,
      kind: "dimension" as const,
      field: "filters.member",
    })),
    ...(view.group_sort
      ? [
          {
            reference: view.group_sort.dimension,
            kind: "dimension" as const,
            field: "group_sort.dimension",
          },
          ...(view.group_sort.by === "name"
            ? []
            : [
                {
                  reference: view.group_sort.by,
                  kind: "measure" as const,
                  field: "group_sort.by",
                },
              ]),
        ]
      : []),
    ...(view.calculations ?? []).flatMap((calculation) => [
      {
        reference: calculation.measure,
        kind: "measure" as const,
        field: "calculations.measure",
      },
      {
        reference: calculation.category_dimension,
        kind: "dimension" as const,
        field: "calculations.category_dimension",
      },
    ]),
  ];
  return requirements.flatMap((invalid) => {
    if (candidates(catalog, invalid.kind).some(({ id }) => id === invalid.reference)) return [];
    const sameId = candidates(catalog, "either").find(({ id }) => id === invalid.reference);
    const titleMatch = candidates(catalog, invalid.kind).find(
      ({ title }) => title === invalid.reference,
    );
    return [
      {
        code: "query_member_unknown" as const,
        reference: invalid.reference,
        field: invalid.field,
        expected_kind: invalid.kind,
        ...(sameId ? { actual_kind: sameId.kind } : {}),
        ...(titleMatch ? { title_match_id: titleMatch.id } : {}),
      },
    ];
  });
}

function dimensionReferences(view: SemanticQueryView): DimensionReference[] {
  return [
    ...(view.dimensions ?? []).map((id) => ({ id, usage: "group" as const })),
    ...(view.filters ?? []).map(({ member: id }) => ({ id, usage: "filter" as const })),
  ];
}

const usageLabel = (usage: QueryDimensionUsage) => (usage === "group" ? "分组" : "筛选");

export function queryFeasibilityIssueMessage(issue: QueryFeasibilityIssue): string {
  switch (issue.code) {
    case "query_member_unknown":
      if (issue.actual_kind) {
        return `查询字段 ${issue.field} 引用了${issue.actual_kind === "measure" ? "指标" : "维度"} ${issue.reference}，此处需要${issue.expected_kind === "measure" ? "指标" : "维度"} id`;
      }
      if (issue.title_match_id) {
        return `查询字段 ${issue.field} 使用了标题「${issue.reference}」，应改为语义 id ${issue.title_match_id}`;
      }
      return `查询字段 ${issue.field} 引用了当前目录中不存在的语义成员 ${issue.reference}；请重新读取 catalog 后改用返回的 id`;
    case "query_dimension_unsupported":
      return (
        `指标「${issue.measure_title}」不能将维度「${issue.dimension_title}」用于${usageLabel(issue.usage)}；` +
        "请移除该维度，或改选支持该维度的指标"
      );
    case "query_dimensions_unavailable":
      return `当前可用的数据来源都不能同时支持维度「${issue.dimension_titles.join("、")}」；请去掉其中部分维度`;
    case "query_sort_dimension_missing":
      return `分组最大项数所作用的维度「${issue.dimension_title}」不在查询分组中`;
    case "query_grouping_requirement_unsatisfied":
      return (
        `指标「${issue.measure_title}」至少需要 ${issue.minimum_varying_dimensions} 个未被单值筛选的分组维度；` +
        "请先添加分组并保留多个分类值"
      );
    case "query_calculation_unsupported":
      return `指标「${issue.measure_title}」不支持报告级构成占比`;
    case "query_calculation_overlapping_dimension":
      return `维度「${issue.dimension_title}」不是互斥分类，不能计算合计为 100% 的构成占比`;
    case "query_calculation_top_n_conflict":
      return (
        `计算「${issue.calculation_title}」需要完整分类，不能同时限制分组最大项数；` +
        "请展示全部分组，或移除构成占比"
      );
    case "query_calculation_hierarchy_conflict":
      return (
        `计算「${issue.calculation_title}」不能移除层级中间维度「${issue.category_title}」，` +
        `因为查询仍按其下级「${issue.descendant_titles.join("、")}」分组；` +
        "请移除下级分组，或改为计算下级在上级内的占比"
      );
    default:
      return timeSelectionIssueMessage(issue);
  }
}

function selectedMeasures(
  catalog: QueryFeasibilityCatalog,
  view: SemanticQueryView,
): QueryFeasibilityMeasure[] {
  const measures = new Set(view.measures ?? []);
  return catalog.measures.filter((member) => measures.has(member.id));
}

function unsupportedDimensionIssues(
  catalog: QueryFeasibilityCatalog,
  view: SemanticQueryView,
  measures: QueryFeasibilityMeasure[],
): QueryFeasibilityIssue[] {
  const dimensions = new Map(catalog.dimensions.map((member) => [member.id, member]));
  return measures.flatMap((measure) => {
    const allowedSet = new Set(measure.query_capabilities.dimension_ids);
    return dimensionReferences(view).flatMap((unsupported) => {
      const dimension = dimensions.get(unsupported.id);
      if (!dimension || allowedSet.has(unsupported.id)) return [];
      return [
        {
          code: "query_dimension_unsupported" as const,
          measure_id: measure.id,
          measure_title: measure.title,
          dimension_id: unsupported.id,
          dimension_title: dimension.title,
          usage: unsupported.usage,
        },
      ];
    });
  });
}

function sortDimensionIssue(
  catalog: QueryFeasibilityCatalog,
  view: SemanticQueryView,
): QueryFeasibilityIssue | undefined {
  if (!view.group_sort || (view.dimensions ?? []).includes(view.group_sort.dimension)) {
    return undefined;
  }
  const dimension = catalog.dimensions.find(({ id }) => id === view.group_sort?.dimension);
  if (!dimension) return undefined;
  return {
    code: "query_sort_dimension_missing",
    dimension_id: view.group_sort.dimension,
    dimension_title: dimension.title,
  };
}

function comparisonIssue(
  view: SemanticQueryView,
  measures: QueryFeasibilityMeasure[],
): QueryFeasibilityIssue | undefined {
  const comparison = !view.time.comparison
    ? "none"
    : view.time.comparison.kind === "custom"
      ? "custom"
      : "relative";
  return metricTimeComparisonIssue(
    measures.map((member) => ({
      title: member.title,
      capabilities: member.time.constraints ?? {},
    })),
    comparison,
  );
}

function groupingRequirementIssues(
  view: SemanticQueryView,
  measures: QueryFeasibilityMeasure[],
): QueryFeasibilityIssue[] {
  const fixed = new Set(
    (view.filters ?? [])
      .filter((filter) => filter.relation === "one_of" && filter.values.length === 1)
      .map((filter) => filter.member),
  );
  const varyingDimensions = (view.dimensions ?? []).filter((id) => !fixed.has(id)).length;
  return measures.flatMap((measure) => {
    const minimum = measure.query_capabilities.grouping?.minimum_varying_dimensions;
    if (minimum === undefined || varyingDimensions >= minimum) return [];
    return [
      {
        code: "query_grouping_requirement_unsatisfied" as const,
        measure_id: measure.id,
        measure_title: measure.title,
        minimum_varying_dimensions: minimum,
      },
    ];
  });
}

function calculationIssues(
  catalog: QueryFeasibilityCatalog,
  view: SemanticQueryView,
  selected: QueryFeasibilityMeasure[],
): QueryFeasibilityIssue[] {
  const issues: QueryFeasibilityIssue[] = [];
  const firstCalculation = view.calculations?.[0];
  if (firstCalculation && view.group_sort?.max_items) {
    issues.push({
      code: "query_calculation_top_n_conflict",
      calculation_id: firstCalculation.id,
      calculation_title: firstCalculation.title,
    });
  }
  const measures = new Map(selected.map((member) => [member.id, member]));
  const dimensions = new Map(catalog.dimensions.map((member) => [member.id, member]));
  const grouped = new Set(view.dimensions ?? []);
  for (const calculation of view.calculations ?? []) {
    const measure = measures.get(calculation.measure);
    if (!measure) continue;
    if (!measure.report_calculations?.includes("percent_of_total")) {
      issues.push({
        code: "query_calculation_unsupported",
        calculation_id: calculation.id,
        measure_id: calculation.measure,
        measure_title: measure.title,
      });
      continue;
    }
    const category = dimensions.get(calculation.category_dimension);
    if (!category) continue;
    if (category.dimension_kind === "overlapping") {
      issues.push({
        code: "query_calculation_overlapping_dimension",
        calculation_id: calculation.id,
        dimension_id: calculation.category_dimension,
        dimension_title: category.title,
      });
      continue;
    }
    const descendants = (measure.query_capabilities.hierarchies ?? []).flatMap((chain) => {
      const index = chain.indexOf(calculation.category_dimension);
      return index < 0 ? [] : chain.slice(index + 1).filter((id) => grouped.has(id));
    });
    const uniqueDescendants = [...new Set(descendants)];
    if (uniqueDescendants.length) {
      issues.push({
        code: "query_calculation_hierarchy_conflict",
        calculation_id: calculation.id,
        calculation_title: calculation.title,
        category_dimension: calculation.category_dimension,
        category_title: category.title,
        descendant_dimensions: uniqueDescendants,
        descendant_titles: uniqueDescendants.map((id) => dimensions.get(id)?.title ?? id),
      });
    }
  }
  return issues;
}

function queryFeasibilityIssues(
  catalog: QueryFeasibilityCatalog,
  view: SemanticQueryView,
  timeSelection?: ResolvedTimeSelection,
): QueryFeasibilityIssue[] {
  const measures = selectedMeasures(catalog, view);
  const sortIssue = sortDimensionIssue(catalog, view);
  const structural = [...invalidReferenceIssues(catalog, view), ...(sortIssue ? [sortIssue] : [])];
  const capabilities = [
    ...unsupportedDimensionIssues(catalog, view, measures),
    ...groupingRequirementIssues(view, measures),
    ...calculationIssues(catalog, view, measures),
  ];
  if (!timeSelection) {
    const time = comparisonIssue(view, measures);
    return [...structural, ...capabilities, ...(time ? [time] : [])];
  }
  const timeRequirements = measures.map((member) => ({
    capabilities: member.time.constraints ?? {},
    title: member.title,
  }));
  const time = metricTimeSelectionIssue(timeRequirements, timeSelection);
  return [...structural, ...capabilities, ...(time ? [time] : [])];
}

/** 可预测的查询冲突只在这里判定；物理 Planner 对同一事实保留不可变量断言。 */
export function queryFeasibilityIssue(
  catalog: QueryFeasibilityCatalog,
  view: SemanticQueryView,
  timeSelection?: ResolvedTimeSelection,
): QueryFeasibilityIssue | undefined {
  return queryFeasibilityIssues(catalog, view, timeSelection)[0];
}

/** 候选只为自己新增的冲突负责；当前草稿已有的同一冲突不应锁住无关编辑。 */
export function queryCandidateFeasibilityIssue(
  catalog: QueryFeasibilityCatalog,
  current: SemanticQueryView,
  candidate: SemanticQueryView,
  timeSelection?: ResolvedTimeSelection,
): QueryFeasibilityIssue | undefined {
  const currentIssues = new Set(
    queryFeasibilityIssues(catalog, current, timeSelection).map(canonicalJson),
  );
  return queryFeasibilityIssues(catalog, candidate, timeSelection).find(
    (issue) => !currentIssues.has(canonicalJson(issue)),
  );
}
