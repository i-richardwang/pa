import type { PublicCatalogDocument as CatalogPayload } from "@contracts/catalog_contract";
import type { ReplayPayload } from "@contracts/replay_contract";
import {
  semanticResultView,
  type SemanticAnalysisView,
  type PlottedIntentType,
  type SemanticViewIntent,
  type SemanticQueryView,
  type AnalysisDefinition,
} from "@semantic-analysis";
import type { ViewPreferences } from "@view-preferences";
import { assignChannels } from "@channels";
import { memberShortName } from "@member";
import type { ViewBlock } from "@payload";
import { proposeChartDecl } from "@shape";
import { canonicalJson } from "@canonical-json";
import {
  mergeTimeCapabilities,
  resolveTimeIntentSelection,
  timeSelectionIssueMessage,
  type TimeCapabilities,
  type TimeIntent,
  type TimeSelectionIssue,
  type TimeSelectionResult,
} from "@time";
import {
  queryFeasibilityIssue,
  queryFeasibilityIssueMessage,
  type QueryFeasibilityIssue,
} from "@query-feasibility";

export type AnalysisEditState = {
  name: string;
  analysis: AnalysisDefinition;
  view: SemanticViewIntent;
  view_preferences: ViewPreferences;
  baseline_name: string;
  baseline_analysis: AnalysisDefinition;
  baseline_view: SemanticViewIntent;
  baseline_view_preferences: ViewPreferences;
  previewed_analysis: AnalysisDefinition | null;
  previewed_view: SemanticViewIntent | null;
  previewed_view_preferences: ViewPreferences | null;
};

const clone = <T>(value: T): T => structuredClone(value);
const sameJson = (left: unknown, right: unknown): boolean =>
  canonicalJson(left) === canonicalJson(right);

export const DEFAULT_TIME_WINDOW = {
  current_month: { kind: "current_month" },
  trailing_months: { kind: "trailing", count: 12, unit: "month", grain: "month" },
  trailing_years: { kind: "trailing", count: 3, unit: "year", grain: "year" },
} as const satisfies Record<string, TimeIntent["window"]>;

export function blankAnalysisDefinition(title: string): AnalysisDefinition {
  return {
    title,
    query: { time: { window: DEFAULT_TIME_WINDOW.current_month } },
  };
}

export function blankAnalysisSeed(name: string): {
  name: string;
  analysis: AnalysisDefinition;
  view: SemanticViewIntent;
  hasSavedResult: false;
} {
  return {
    name,
    analysis: blankAnalysisDefinition(name),
    view: { type: "table" },
    hasSavedResult: false,
  };
}

export type AnalysisReadinessIssue =
  | { code: "analysis_empty" | "analysis_unavailable" | "filter_incomplete"; message: string }
  | (QueryFeasibilityIssue & { message: string });

const presentTimeIssue = (issue: TimeSelectionIssue): TimeSelectionIssue & { message: string } => ({
  ...issue,
  message: timeSelectionIssueMessage(issue),
});

const presentQueryIssue = (
  issue: QueryFeasibilityIssue,
): QueryFeasibilityIssue & { message: string } => ({
  ...issue,
  message: queryFeasibilityIssueMessage(issue),
});

/** 返回草稿无法执行的原因和时间解析结果；服务端规划时会再校验一次。 */
export function analysisReadiness(
  draft: Pick<AnalysisEditState, "analysis">,
  catalog: CatalogPayload,
): { issues: AnalysisReadinessIssue[]; time?: TimeSelectionResult } {
  const view = semanticEditableQuery(draft.analysis);
  if (!view) return { issues: [] };
  const issues: AnalysisReadinessIssue[] = [];
  const hasMembers = (view.measures?.length ?? 0) + (view.dimensions?.length ?? 0) > 0;
  if (!hasMembers) {
    issues.push({ code: "analysis_empty", message: "至少选择一个指标或分组维度" });
  }
  const filtersComplete = (view.filters ?? []).every(
    (filter) => filter.values.length > 0 && filter.values.every((value) => value.trim().length > 0),
  );
  if (!filtersComplete) {
    issues.push({ code: "filter_incomplete", message: "请先为筛选选择至少一个值" });
  }
  const time = resolveTimeIntentSelection(view.time, catalog.data_as_of);
  if (time.status === "invalid") {
    issues.push(presentTimeIssue(time.issue));
  } else {
    const issue = queryFeasibilityIssue(catalog, view, time.selection);
    if (issue) issues.push(presentQueryIssue(issue));
  }
  return { issues, time };
}

/** 编辑基线取种子规格，不受运行时图表降级影响；有改动时须重新预览才能保存。 */
export function beginAnalysisEdit(
  seed: {
    name: string;
    analysis: AnalysisDefinition;
    view: SemanticViewIntent;
    view_preferences?: ViewPreferences;
  },
  hasSavedResult: boolean,
): AnalysisEditState {
  const analysis = clone(seed.analysis);
  const view = clone(seed.view);
  const preferences = clone(seed.view_preferences ?? {});
  return {
    name: seed.name,
    analysis,
    view,
    view_preferences: preferences,
    baseline_name: seed.name,
    baseline_analysis: clone(analysis),
    baseline_view: clone(view),
    baseline_view_preferences: clone(preferences),
    previewed_analysis: hasSavedResult ? clone(analysis) : null,
    previewed_view: hasSavedResult ? clone(view) : null,
    previewed_view_preferences: hasSavedResult ? clone(preferences) : null,
  };
}

export function hasAnalysisChanges(draft: AnalysisEditState): boolean {
  return !sameJson(draft.analysis, draft.baseline_analysis);
}

export function hasViewChanges(draft: AnalysisEditState): boolean {
  return (
    !sameJson(draft.view, draft.baseline_view) ||
    !sameJson(draft.view_preferences, draft.baseline_view_preferences)
  );
}

export function isPreviewCurrent(draft: AnalysisEditState): boolean {
  return (
    sameJson(draft.previewed_analysis, draft.analysis) &&
    sameJson(draft.previewed_view, draft.view) &&
    sameJson(draft.previewed_view_preferences, draft.view_preferences)
  );
}

export function settleSaved(draft: AnalysisEditState): AnalysisEditState {
  return {
    ...draft,
    baseline_name: draft.name,
    baseline_analysis: clone(draft.analysis),
    baseline_view: clone(draft.view),
    baseline_view_preferences: clone(draft.view_preferences),
  };
}

export function settlePreview(draft: AnalysisEditState, replay: ReplayPayload): AnalysisEditState {
  const analysis = clone(replay.analysis);
  const view = clone(replay.view);
  const preferences = clone(replay.view_preferences);
  return {
    ...draft,
    analysis,
    view,
    view_preferences: preferences,
    previewed_analysis: clone(analysis),
    previewed_view: clone(view),
    previewed_view_preferences: clone(preferences),
  };
}

export function isAnalysisEditDirty(draft: AnalysisEditState): boolean {
  return (
    draft.name !== draft.baseline_name ||
    !sameJson(draft.analysis, draft.baseline_analysis) ||
    !sameJson(draft.view, draft.baseline_view) ||
    !sameJson(draft.view_preferences, draft.baseline_view_preferences)
  );
}

export function renameAnalysisDraft(draft: AnalysisEditState, name: string): AnalysisEditState {
  return draft.name === name ? draft : { ...draft, name };
}

export function semanticSummaryEnabled(draft: Pick<AnalysisEditState, "analysis">): boolean {
  return semanticResultView(draft.analysis).summary?.mode === "grand_total";
}

export function setSemanticSummary(
  draft: AnalysisEditState,
  enabled: boolean,
  catalog: CatalogPayload,
): AnalysisEditState {
  const current = semanticEditableQuery(draft.analysis);
  if (!current) return draft;
  const { summary: _summary, ...withoutSummary } = current;
  const resultView: SemanticQueryView = enabled
    ? { ...current, summary: { mode: "grand_total" as const } }
    : withoutSummary;
  const viewIntent = normalizeViewIntent(draft.view, resultView, catalog);
  const preferences = normalizeViewPreferences(draft.view_preferences, viewIntent);
  return {
    ...draft,
    analysis: { ...draft.analysis, query: resultView },
    view: viewIntent,
    view_preferences: preferences,
    previewed_analysis: null,
    previewed_view: null,
    previewed_view_preferences: null,
  };
}

export function semanticViewContext(
  view: SemanticAnalysisView,
  catalog: CatalogPayload,
): { measures: string[]; dimensions: string[] } {
  if (!("columns" in view)) {
    return {
      measures: [...(view.measures ?? []), ...(view.calculations ?? []).map(({ id }) => id)],
      dimensions: view.dimensions ?? [],
    };
  }
  const measures: string[] = [];
  const dimensions: string[] = [];
  for (const column of view.columns) {
    if ("expr" in column) {
      measures.push(column.as);
      continue;
    }
    const member = [...catalog.measures, ...catalog.dimensions].find(
      (candidate) => candidate.id === column.member,
    );
    if (member?.kind === "measure") measures.push(column.as);
    else dimensions.push(column.as);
  }
  return { measures, dimensions };
}

/** 结构占比作为分子指标的辅助标注，不占用值通道；仅柱状图使用，派生视图查不到口径关系。 */
function shareAnnotations(
  type: SemanticViewIntent["type"],
  view: SemanticAnalysisView,
  catalog: CatalogPayload,
  series: string[],
): string[] {
  if (type !== "bar" || "columns" in view) return [];
  return semanticViewContext(view, catalog).measures.filter((member) => {
    const local = view.calculations?.find((calculation) => calculation.id === member);
    const relation = local
      ? { kind: "structure_share" as const, numerator_id: local.measure }
      : catalog.measures.find((candidate) => candidate.id === member)?.relation;
    return relation?.kind === "structure_share" && series.includes(relation.numerator_id);
  });
}

function chartIntent(
  type: PlottedIntentType,
  channels: {
    category?: string;
    series: string[];
    secondary?: string[];
    groupBy?: string;
    annotations?: string[];
    stack?: boolean;
  },
): SemanticViewIntent {
  const category = channels.category ? { category: channels.category } : {};
  const groupBy = channels.groupBy ? { group_by: channels.groupBy } : {};
  const secondary = channels.secondary?.length ? { secondary_series: channels.secondary } : {};
  if (type === "line") return { type, series: channels.series, ...secondary, ...groupBy };
  if (type === "pie") return { type, series: channels.series, ...category };
  return {
    type,
    series: channels.series,
    ...secondary,
    ...category,
    ...groupBy,
    ...(channels.annotations?.length ? { annotations: channels.annotations } : {}),
    ...(channels.groupBy && channels.stack !== undefined ? { stack: channels.stack } : {}),
  };
}

function normalizeViewIntent(
  chart: SemanticViewIntent,
  view: SemanticAnalysisView,
  catalog: CatalogPayload,
): SemanticViewIntent {
  const { measures, dimensions } = semanticViewContext(view, catalog);
  if (chart.type === "table") {
    // 列轴里的 time 始终保留，结果是否实际带时间列由结果里解析后的时间信息决定。
    const columns = chart.columns?.filter((axis) => {
      if (axis === "time") return true;
      if (axis === "metrics") return measures.length > 0;
      return dimensions.includes(axis) && !view.summary;
    });
    return {
      type: "table",
      ...(columns?.length ? { columns } : {}),
    };
  }
  if (chart.type === "kpi") {
    return assignChannels("kpi", { dimensions, measures }) ? chart : { type: "table" };
  }
  const secondary = chart.type === "pie" ? [] : (chart.secondary_series ?? []);
  const retainedSeries = (chart.series ?? measures).filter(
    (member) => measures.includes(member) && !secondary.includes(member),
  );
  const selectedSeries = retainedSeries.length ? retainedSeries : measures;
  const annotations = shareAnnotations(chart.type, view, catalog, selectedSeries);
  const auxiliary = new Set(annotations);
  const assignment = assignChannels(
    chart.type,
    {
      dimensions,
      measures: measures.filter((member) => !auxiliary.has(member)),
      scales: measureScales(catalog),
    },
    {
      ...(chart.type !== "line" && chart.category ? { x: chart.category } : {}),
      y: selectedSeries.filter((member) => !auxiliary.has(member)),
      y2: secondary.filter((member) => measures.includes(member)),
      ...(chart.type !== "pie" && chart.group_by ? { groupBy: chart.group_by } : {}),
    },
  );
  if (!assignment) return { type: "table" };
  return chartIntent(chart.type, {
    ...(assignment.x ? { category: assignment.x } : {}),
    series: assignment.y,
    ...(assignment.y2 ? { secondary: assignment.y2 } : {}),
    ...(assignment.groupBy ? { groupBy: assignment.groupBy } : {}),
    annotations,
    ...(chart.type === "bar" && chart.stack !== undefined ? { stack: chart.stack } : {}),
  });
}

function measureScales(catalog: CatalogPayload): Record<string, string> {
  return Object.fromEntries(
    catalog.measures.map((member) => [member.id, member.format ?? "number"]),
  );
}

function normalizeViewPreferences(
  style: ViewPreferences,
  intent: SemanticViewIntent,
): ViewPreferences {
  if (intent.type === "table") {
    return style.table_shading ? { table_shading: clone(style.table_shading) } : {};
  }
  if (intent.type === "kpi" || intent.type === "pie") return {};
  if (intent.group_by) {
    return style.value_labels === "all" ? { value_labels: "all" } : {};
  }
  // 省略 series 表示使用结果的默认指标，此时保留全部系列偏好，由服务端编译器按实际结果成员校验。
  const selected = intent.series
    ? new Set([...intent.series, ...(intent.secondary_series ?? [])])
    : null;
  const series = style.series
    ? Object.fromEntries(
        Object.entries(style.series).filter(([member]) => !selected || selected.has(member)),
      )
    : undefined;
  return {
    ...(series && Object.keys(series).length ? { series } : {}),
    ...(style.value_labels ? { value_labels: style.value_labels } : {}),
  };
}

export function setViewPreferences(
  draft: AnalysisEditState,
  style: ViewPreferences,
): AnalysisEditState {
  return {
    ...draft,
    view_preferences: normalizeViewPreferences(clone(style), draft.view),
    previewed_analysis: null,
    previewed_view: null,
    previewed_view_preferences: null,
  };
}

export function setSemanticViewIntent(
  draft: AnalysisEditState,
  chart: SemanticViewIntent,
  catalog: CatalogPayload,
): AnalysisEditState {
  const normalized = normalizeViewIntent(chart, semanticResultView(draft.analysis), catalog);
  return {
    ...draft,
    view_preferences: normalizeViewPreferences(draft.view_preferences, normalized),
    view: clone(normalized),
    previewed_analysis: null,
    previewed_view: null,
    previewed_view_preferences: null,
  };
}

export function setSemanticQueryView(
  draft: AnalysisEditState,
  nextView: SemanticQueryView,
  catalog: CatalogPayload,
): AnalysisEditState {
  if (!semanticEditableQuery(draft.analysis)) return draft;
  const viewIntent = normalizeViewIntent(draft.view, nextView, catalog);
  return {
    ...draft,
    analysis: { ...draft.analysis, query: clone(nextView) },
    view: viewIntent,
    view_preferences: normalizeViewPreferences(draft.view_preferences, viewIntent),
    previewed_analysis: null,
    previewed_view: null,
    previewed_view_preferences: null,
  };
}

/** 声明了 derived 的分析整体只读，返回 null；时间栏和右栏共用此函数判断能否编辑。 */
export function semanticEditableQuery(analysis: AnalysisDefinition): SemanticQueryView | null {
  return analysis.derived ? null : analysis.query;
}

/** 视图的时间能力取所选指标时间约束的并集，与编译器逐指标拒绝的规则一致。 */
export function timeCapabilitiesOf(
  view: SemanticQueryView,
  catalog: CatalogPayload,
): TimeCapabilities {
  const measures = view.measures ?? [];
  const members = catalog.measures.filter((member) => measures.includes(member.id));
  return mergeTimeCapabilities(members.map((member) => member.time.constraints ?? {}));
}

export function setDraftTime(
  draft: AnalysisEditState,
  time: TimeIntent,
  catalog: CatalogPayload,
): AnalysisEditState {
  const view = semanticEditableQuery(draft.analysis);
  if (!view) return draft;
  return setSemanticQueryView(draft, { ...view, time }, catalog);
}

/** 删除成员时同时清理引用它的分组排序和计算；筛选是独立的人群条件，不随分组维度删除。 */
export function removeSemanticQueryMember(
  view: SemanticQueryView,
  member: string,
  kind: "measure" | "dimension",
): SemanticQueryView {
  const groupSort =
    view.group_sort && (view.group_sort.by === member || view.group_sort.dimension === member)
      ? undefined
      : view.group_sort;
  const calculations = (view.calculations ?? []).filter((calculation) =>
    kind === "measure" ? calculation.measure !== member : calculation.category_dimension !== member,
  );
  return {
    ...view,
    ...(kind === "measure"
      ? { measures: view.measures?.filter((candidate) => candidate !== member) }
      : { dimensions: view.dimensions?.filter((candidate) => candidate !== member) }),
    group_sort: groupSort,
    ...(calculations.length ? { calculations } : { calculations: undefined }),
  };
}

/** 替换分组维度时位置不变，引用它的分组排序改指新维度；新维度已在查询中时等同删除原维度。 */
export function replaceSemanticQueryDimension(
  view: SemanticQueryView,
  member: string,
  next: string,
): SemanticQueryView {
  if (next === member) return view;
  const dimensions = view.dimensions ?? [];
  if (dimensions.includes(next)) return removeSemanticQueryMember(view, member, "dimension");
  return {
    ...view,
    dimensions: dimensions.map((candidate) => (candidate === member ? next : candidate)),
    group_sort:
      view.group_sort?.dimension === member
        ? { ...view.group_sort, dimension: next }
        : view.group_sort,
    calculations: view.calculations?.filter(
      (calculation) => calculation.category_dimension !== member,
    ),
  };
}

/**
 * 切换图型时的默认绑定取自按结果做的通道分配（与判断该图型是否可选的是同一次分配），再映射回语义成员；
 * 没有结果或无法映射时，改按声明的成员分配。
 */
export function defaultSemanticViewIntent(
  draft: AnalysisEditState,
  type: SemanticViewIntent["type"],
  catalog: CatalogPayload,
  result?: ViewBlock,
): SemanticViewIntent {
  const view = semanticResultView(draft.analysis);
  if (type === "table") return { type: "table" };
  if (type === "kpi") return normalizeViewIntent({ type }, view, catalog);
  const { measures, dimensions } = semanticViewContext(view, catalog);
  const proposal = result ? proposeChartDecl(result, type) : null;
  const semantic = (column: string, pool: string[]) =>
    pool.find((member) => memberShortName(member) === column);
  const axis = proposal && proposal.type !== "line" ? proposal.x : undefined;
  const split = proposal && proposal.type !== "pie" ? proposal.groupBy : undefined;
  const category = axis ? semantic(axis, dimensions) : undefined;
  const groupBy = split ? semantic(split, dimensions) : undefined;
  const series = proposal?.y.flatMap((column) => semantic(column, measures) ?? []) ?? [];
  const proposedY2 = proposal && proposal.type !== "pie" ? (proposal.y2 ?? []) : [];
  const secondary = proposedY2.flatMap((column) => semantic(column, measures) ?? []);
  if (
    !proposal ||
    (axis && !category) ||
    (split && !groupBy) ||
    series.length !== proposal.y.length ||
    secondary.length !== proposedY2.length
  ) {
    return normalizeViewIntent(
      chartIntent(type, { category: dimensions[0], series: measures }),
      view,
      catalog,
    );
  }
  // 以按结果做的通道分配为准：只有一个取值的维度不能用来拆分系列。
  const annotations = shareAnnotations(type, view, catalog, series);
  return chartIntent(type, {
    ...(category ? { category } : {}),
    series,
    secondary,
    ...(groupBy ? { groupBy } : {}),
    annotations,
  });
}
