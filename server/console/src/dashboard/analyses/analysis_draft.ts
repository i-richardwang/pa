import type { PublicCatalogDocument as CatalogPayload } from "@contracts/catalog_contract";
import type { ReplayPayload } from "@contracts/replay_contract";
import {
  isSemanticDerivedView,
  semanticAnalysisSink,
  type SemanticAnalysisView,
  type SemanticViewIntent,
  type SemanticQueryView,
  type AnalysisDefinition,
} from "@semantic-analysis";
import type { ViewPreferences } from "@view-preferences";
import {
  compileTimeIntent,
  resolveTimeOutputGrain,
  type TimeCapabilities,
  type TimeIntent,
} from "@time";

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

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * 空白起点：从零建分析就是「种子为空的 create」，同样进统一编辑器、
 * 同样经预览铸不可变快照。空查询本身不可执行（无成员），
 * 由 isAnalysisRunnable 把住预览与保存两个出口，编译合法性仍归服务端裁定。
 */
export function blankAnalysisDefinition(title: string): AnalysisDefinition {
  return {
    title,
    views: [{ id: "result", time: { window: { kind: "current_month" } } }],
  };
}

/** 结果视图是否已具备可执行的成员；空查询无法编译，预览与保存都不给出口。 */
export function isAnalysisRunnable(draft: Pick<AnalysisEditState, "analysis">): boolean {
  const viewId = semanticAnalysisSink(draft.analysis.views);
  const view = draft.analysis.views.find((candidate) => candidate.id === viewId);
  if (!view) return false;
  if (isSemanticDerivedView(view)) return true;
  const hasMembers = (view.measures?.length ?? 0) + (view.dimensions?.length ?? 0) > 0;
  const filtersComplete = (view.filters ?? []).every(
    (filter) => filter.values.length > 0 && filter.values.every((value) => value.trim().length > 0),
  );
  return hasMembers && filtersComplete;
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
  /**
   * 这份规格有没有落定结果。传的是**判定**不是结果字节：报告页规格先到、结果后到，
   * 播种那一刻就已经知道稍后会有一份对位的结果，此时把草稿记成「改过但没预览」是错的。
   */
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
  return JSON.stringify(draft.analysis) !== JSON.stringify(draft.baseline_analysis);
}

export function hasViewChanges(draft: AnalysisEditState): boolean {
  return (
    JSON.stringify(draft.view) !== JSON.stringify(draft.baseline_view) ||
    JSON.stringify(draft.view_preferences) !== JSON.stringify(draft.baseline_view_preferences)
  );
}

export function isPreviewCurrent(draft: AnalysisEditState): boolean {
  return (
    JSON.stringify(draft.previewed_analysis) === JSON.stringify(draft.analysis) &&
    JSON.stringify(draft.previewed_view) === JSON.stringify(draft.view) &&
    JSON.stringify(draft.previewed_view_preferences) === JSON.stringify(draft.view_preferences)
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
    JSON.stringify(draft.analysis) !== JSON.stringify(draft.baseline_analysis) ||
    JSON.stringify(draft.view) !== JSON.stringify(draft.baseline_view) ||
    JSON.stringify(draft.view_preferences) !== JSON.stringify(draft.baseline_view_preferences)
  );
}

export function renameAnalysisDraft(draft: AnalysisEditState, name: string): AnalysisEditState {
  return draft.name === name ? draft : { ...draft, name };
}

export function semanticSummaryEnabled(draft: Pick<AnalysisEditState, "analysis">): boolean {
  const viewId = semanticAnalysisSink(draft.analysis.views);
  return draft.analysis.views.find((view) => view.id === viewId)?.summary?.mode === "grand_total";
}

export function setSemanticSummary(
  draft: AnalysisEditState,
  enabled: boolean,
  catalog: CatalogPayload,
): AnalysisEditState {
  const viewId = semanticAnalysisSink(draft.analysis.views);
  const views = draft.analysis.views.map((view) => {
    if (view.id !== viewId) return view;
    if (enabled) return { ...view, summary: { mode: "grand_total" as const } };
    const { summary: _summary, ...rest } = view;
    return rest;
  });
  const resultView = views.find((view) => view.id === viewId);
  const viewIntent = resultView ? repairedViewIntent(draft.view, resultView, catalog) : draft.view;
  const preferences = repairedViewPreferences(draft.view_preferences, viewIntent);
  return {
    ...draft,
    analysis: { ...draft.analysis, views },
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
): { measures: string[]; dimensions: string[]; time?: SemanticQueryView["time"] } {
  if (!isSemanticDerivedView(view)) {
    return {
      measures: [...(view.measures ?? []), ...(view.calculations ?? []).map(({ id }) => id)],
      dimensions: view.dimensions ?? [],
      time: view.time,
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

function repairedViewIntent(
  chart: SemanticViewIntent,
  view: SemanticAnalysisView,
  catalog: CatalogPayload,
): SemanticViewIntent {
  const { measures, dimensions, time } = semanticViewContext(view, catalog);
  if (chart.type === "table") {
    const temporal =
      !isSemanticDerivedView(view) &&
      !!time &&
      resolveTimeOutputGrain(compileTimeIntent(time), catalog.data_as_of, {
        grouped: dimensions.length > 0,
      }) !== "total";
    const columns = chart.columns?.filter((axis) => {
      if (axis === "time") return temporal;
      if (axis === "metrics") return measures.length > 0;
      return dimensions.includes(axis) && !view.summary;
    });
    return {
      type: "table",
      ...(columns?.length ? { columns } : {}),
    };
  }
  if (chart.type === "kpi") {
    return measures.length > 0 && dimensions.length === 0 ? chart : { type: "table" };
  }
  const retainedSeries = (chart.series ?? measures).filter((member) => measures.includes(member));
  const selectedSeries = retainedSeries.length ? retainedSeries : measures;
  const annotations =
    chart.type === "bar" && !isSemanticDerivedView(view)
      ? measures.filter((member) => {
          const local = view.calculations?.find((calculation) => calculation.id === member);
          const relation = local
            ? { kind: "structure_share" as const, numerator_id: local.measure }
            : catalog.measures.find((candidate) => candidate.id === member)?.relation;
          return (
            relation?.kind === "structure_share" && selectedSeries.includes(relation.numerator_id)
          );
        })
      : [];
  const auxiliary = new Set(annotations);
  const series = selectedSeries.filter((member) => !auxiliary.has(member));
  const category =
    chart.type === "line"
      ? undefined
      : chart.category && dimensions.includes(chart.category)
        ? chart.category
        : dimensions[0];
  const groupBy =
    chart.group_by && dimensions.includes(chart.group_by) && chart.group_by !== category
      ? chart.group_by
      : undefined;
  const grain = time
    ? resolveTimeOutputGrain(compileTimeIntent(time), catalog.data_as_of, {
        grouped: dimensions.length > 0,
      })
    : undefined;
  if (
    !series.length ||
    ((chart.type === "bar" || chart.type === "pie") && !category) ||
    (chart.type === "line" && grain !== "month" && grain !== "year")
  ) {
    return { type: "table" };
  }
  return {
    ...chart,
    category,
    series: chart.type === "pie" || groupBy ? series.slice(0, 1) : series,
    ...(annotations.length ? { annotations } : { annotations: undefined }),
    group_by: groupBy,
  };
}

function repairedViewPreferences(
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
  const selected = intent.series ? new Set(intent.series) : null;
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
    view_preferences: repairedViewPreferences(clone(style), draft.view),
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
  const viewId = semanticAnalysisSink(draft.analysis.views);
  const view = draft.analysis.views.find((candidate) => candidate.id === viewId);
  if (!view) return draft;
  const normalized = repairedViewIntent(chart, view, catalog);
  return {
    ...draft,
    view_preferences: repairedViewPreferences(draft.view_preferences, normalized),
    view: clone(normalized),
    previewed_analysis: null,
    previewed_view: null,
    previewed_view_preferences: null,
  };
}

export function setSemanticQueryView(
  draft: AnalysisEditState,
  viewId: string,
  nextView: SemanticQueryView,
  catalog: CatalogPayload,
): AnalysisEditState {
  const current = draft.analysis.views.find((view) => view.id === viewId);
  if (!current || isSemanticDerivedView(current)) return draft;
  const views = draft.analysis.views.map((view) => (view.id === viewId ? clone(nextView) : view));
  const resultId = semanticAnalysisSink(views);
  const viewIntent =
    resultId === viewId ? repairedViewIntent(draft.view, nextView, catalog) : draft.view;
  return {
    ...draft,
    analysis: { ...draft.analysis, views },
    view: viewIntent,
    view_preferences: repairedViewPreferences(draft.view_preferences, viewIntent),
    previewed_analysis: null,
    previewed_view: null,
    previewed_view_preferences: null,
  };
}

/**
 * 语义收敛点的查询视图：存在任何派生视图即整体只读（null）——与查询分区同一严格规则，
 * 时间栏与 Inspector 对「可编辑」的判定不允许分叉。
 */
export function semanticSinkQueryView(analysis: AnalysisDefinition): SemanticQueryView | null {
  if (analysis.views.some(isSemanticDerivedView)) return null;
  const sinkId = semanticAnalysisSink(analysis.views);
  const view = analysis.views.find((candidate) => candidate.id === sinkId);
  return view && !isSemanticDerivedView(view) ? view : null;
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
  return {
    ...(members.some((member) => member.time_constraints?.multi_month_display === "month")
      ? { multi_month_display: "month" as const }
      : {}),
    ...(members.some((member) => member.time_constraints?.year_scoped)
      ? { year_scoped: true as const }
      : {}),
  };
}

/** 时间栏落草稿的唯一入口：写入收敛点查询视图，失效与呈现修复同 setSemanticQueryView。 */
export function setDraftTime(
  draft: AnalysisEditState,
  time: TimeIntent,
  catalog: CatalogPayload,
): AnalysisEditState {
  const view = semanticSinkQueryView(draft.analysis);
  if (!view) return draft;
  return setSemanticQueryView(draft, view.id, { ...view, time }, catalog);
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
 * 分组维度就地换绑：位次不动，指着它的分组排序跟着改指新维度——
 * 「换一个维度」和「删掉再加一个」在用户那里是两件事，后者会把这一维度上已配好的排名规格
 * 连带清掉，还会把它甩到列尾。已在查询里的维度不可重复出现，故换成已选者即为删除。
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

export function defaultSemanticViewIntent(
  draft: AnalysisEditState,
  type: SemanticViewIntent["type"],
  catalog: CatalogPayload,
): SemanticViewIntent {
  const viewId = semanticAnalysisSink(draft.analysis.views);
  const view = draft.analysis.views.find((candidate) => candidate.id === viewId);
  if (!view || type === "table") return { type: "table" };
  if (type === "kpi") return repairedViewIntent({ type }, view, catalog);
  const { measures, dimensions } = semanticViewContext(view, catalog);
  if (type === "line") {
    return repairedViewIntent({ type, series: measures }, view, catalog);
  }
  if (type === "pie") {
    return repairedViewIntent(
      { type, category: dimensions[0], series: measures.slice(0, 1) },
      view,
      catalog,
    );
  }
  return repairedViewIntent({ type, category: dimensions[0], series: measures }, view, catalog);
}
