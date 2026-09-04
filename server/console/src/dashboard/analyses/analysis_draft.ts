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
  /** 进入编辑时的落定基线：脏判定与离开拦截以此为准。 */
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

/**
 * 各种窗口的默认取值：空白分析、换窗口种类、看板时间覆盖都从这里取。
 * 相对窗口不带端点，随数据滚动；序列粒度是窗口的一部分，回看几年就按年、几个月就按月。
 */
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

/** 当前草稿的执行阻断及其唯一时间解析；服务端仍在权威规划后复验。 */
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

/**
 * 进入编辑：报告当前 Analysis 就是不可变基线。运行期降级不改写它；
 * 用户真的修改规格后，必须经预览创建新 Analysis 才能保存。
 */
export function beginAnalysisEdit(
  seed: {
    name: string;
    analysis: AnalysisDefinition;
    view: SemanticViewIntent;
    view_preferences?: ViewPreferences;
  },
  /** 传的是判定不是结果字节：报告页规格先到、结果后到。 */
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

/** 保存成功：当前草稿就地成为新的落定基线，脏判定从此以它为准。 */
export function settleSaved(draft: AnalysisEditState): AnalysisEditState {
  return {
    ...draft,
    baseline_name: draft.name,
    baseline_analysis: clone(draft.analysis),
    baseline_view: clone(draft.view),
    baseline_view_preferences: clone(draft.view_preferences),
  };
}

/** 预览返回的 canonical Analysis、View 与作者偏好成为可保存真相。 */
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

/** 结构占比是分子指标的辅助标注，不占值通道；只有柱状读它，派生视图没有口径关系可查。 */
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

/** 按图型只挂它声明过的通道：哪个通道属于哪个图型出自意图联合，这里不另立一套。 */
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
    // 堆叠是拆分通道的读法：没拆出系列就没有可堆叠的段。
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
    // time 是条件列轴优先序；结果是否实际带时间成员由已解析时间签名裁决。
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
  // 通道装箱是唯一判据：已有绑定装得下就沿用，装不下按容量重排，一个维度都装不下即无此形态。
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

/** 量纲键即目录声明的显示格式；未声明按普通数值——与结果侧 `column_formats` 的缺省同义。 */
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
  // 省略 series 表示“使用该结果的默认指标通道”，不是空集合；此时保留已有偏好，
  // 由服务端编译器用实际结果成员做最终 fail-closed 绑定。
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

/**
 * 编辑器只处理直接交付的查询：声明了 derived 即整体只读（null）——
 * 时间栏与 Inspector 对「可编辑」的判定不允许分叉。
 */
export function semanticEditableQuery(analysis: AnalysisDefinition): SemanticQueryView | null {
  return analysis.derived ? null : analysis.query;
}

/**
 * 视图的时间能力：选中指标能力卡的并集——任一指标带某位即整视图带该位，
 * 与编译器「任一指标命中即拒绝」的逐指标断言同语义。
 */
export function timeCapabilitiesOf(
  view: SemanticQueryView,
  catalog: CatalogPayload,
): TimeCapabilities {
  const measures = view.measures ?? [];
  const members = catalog.measures.filter((member) => measures.includes(member.id));
  return mergeTimeCapabilities(members.map((member) => member.time.constraints ?? {}));
}

/** 时间栏写入收敛点查询视图，并由 setSemanticQueryView 统一归一呈现状态。 */
export function setDraftTime(
  draft: AnalysisEditState,
  time: TimeIntent,
  catalog: CatalogPayload,
): AnalysisEditState {
  const view = semanticEditableQuery(draft.analysis);
  if (!view) return draft;
  return setSemanticQueryView(draft, { ...view, time }, catalog);
}

/** 删除查询成员时原子清理依赖它的分组排序；筛选是独立人群约束，不随分组列删除。 */
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

/**
 * 分组维度就地换绑：位次不动，指着它的分组排序跟着改指新维度；
 * 换成已在查询里的维度即为删除。
 */
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
 * 切图型时的默认绑定：取结果侧那一次装箱的候选（就是让这个图型可选的同一份），
 * 再翻回语义成员名。结果缺席或翻不回来时退到声明侧装箱。
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
  // 结果侧装箱是最终判据：只有一个取值的维度无法拆分系列。
  const annotations = shareAnnotations(type, view, catalog, series);
  return chartIntent(type, {
    ...(category ? { category } : {}),
    series,
    secondary,
    ...(groupBy ? { groupBy } : {}),
    annotations,
  });
}
