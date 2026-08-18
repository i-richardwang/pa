import type { CatalogPayload, ReplayPayload } from "@contract";
import {
  isSemanticDerivedView,
  semanticAnalysisSink,
  type SemanticAnalysisView,
  type SemanticChart,
  type SemanticQueryView,
  type SemanticAnalysisSpec,
} from "@semantic-analysis";
import {
  compileTimeIntent,
  resolveTimeOutputGrain,
  type TimeCapabilities,
  type TimeIntent,
} from "@time";

export type AnalysisEditState = {
  name: string;
  spec: SemanticAnalysisSpec;
  baseline_name: string;
  /**
   * 进入编辑时的落定基线：脏判定与离开拦截以此为准。
   * 声明的自动落定（见 settledAgainst）不是用户改动，不该触发「放弃修改」拦截。
   */
  baseline: SemanticAnalysisSpec;
  previewed_spec: SemanticAnalysisSpec | null;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * 空白起点：从零建分析就是「种子为空的 create」，同样进统一编辑器、
 * 同样经预览铸不可变快照。空查询本身不可执行（无成员），
 * 由 isAnalysisRunnable 把住预览与保存两个出口，编译合法性仍归服务端裁定。
 */
export function blankAnalysisSpec(title: string): SemanticAnalysisSpec {
  return {
    version: 2,
    analysis: {
      title,
      views: [{ id: "result", time: { window: { kind: "current_month" } } }],
    },
    presentation: { type: "table" },
  };
}

/** 结果视图是否已具备可执行的成员；空查询无法编译，预览与保存都不给出口。 */
export function isAnalysisRunnable(draft: Pick<AnalysisEditState, "spec">): boolean {
  const viewId = semanticAnalysisSink(draft.spec.analysis.views);
  const view = draft.spec.analysis.views.find((candidate) => candidate.id === viewId);
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
  seed: { name: string; spec: SemanticAnalysisSpec },
  /**
   * 这份规格有没有落定结果。传的是**判定**不是结果字节：报告页规格先到、结果后到，
   * 播种那一刻就已经知道稍后会有一份对位的结果，此时把草稿记成「改过但没预览」是错的。
   */
  hasSavedResult: boolean,
): AnalysisEditState {
  const spec = clone(seed.spec);
  return {
    name: seed.name,
    spec,
    baseline_name: seed.name,
    baseline: clone(spec),
    previewed_spec: hasSavedResult ? clone(spec) : null,
  };
}

/** 草稿规格（含呈现）是否已偏离播种快照；单语言下呈现改动也需服务端重跑取图。 */
export function hasSpecChanges(draft: AnalysisEditState): boolean {
  return JSON.stringify(draft.spec) !== JSON.stringify(draft.baseline);
}

export function isPreviewCurrent(draft: AnalysisEditState): boolean {
  return JSON.stringify(draft.previewed_spec) === JSON.stringify(draft.spec);
}

/**
 * 保存成功：当前草稿即新的落定基线，脏判定从此以它为准。
 * 不靠「回读服务端再重播种」落定——那要等一次刷新往返，其间页面会先退回保存前的规格再跳回来。
 */
export function settleSaved(draft: AnalysisEditState): AnalysisEditState {
  return { ...draft, baseline_name: draft.name, baseline: clone(draft.spec) };
}

/** 预览返回的新 Analysis 规格就是可保存真相，包含服务端必要的呈现归一。 */
export function settlePreview(draft: AnalysisEditState, replay: ReplayPayload): AnalysisEditState {
  const spec = clone(replay.spec);
  return { ...draft, spec, previewed_spec: clone(spec) };
}

export function isAnalysisEditDirty(draft: AnalysisEditState): boolean {
  return (
    draft.name !== draft.baseline_name ||
    JSON.stringify(draft.spec) !== JSON.stringify(draft.baseline)
  );
}

export function renameAnalysisDraft(draft: AnalysisEditState, name: string): AnalysisEditState {
  return draft.name === name ? draft : { ...draft, name };
}

export function semanticChart(draft: Pick<AnalysisEditState, "spec">): SemanticChart {
  return draft.spec.presentation;
}

export function semanticSummaryEnabled(draft: Pick<AnalysisEditState, "spec">): boolean {
  const viewId = semanticAnalysisSink(draft.spec.analysis.views);
  return (
    draft.spec.analysis.views.find((view) => view.id === viewId)?.summary?.mode === "grand_total"
  );
}

export function setSemanticSummary(
  draft: AnalysisEditState,
  enabled: boolean,
  catalog: CatalogPayload,
): AnalysisEditState {
  const viewId = semanticAnalysisSink(draft.spec.analysis.views);
  const views = draft.spec.analysis.views.map((view) => {
    if (view.id !== viewId) return view;
    if (enabled) return { ...view, summary: { mode: "grand_total" as const } };
    const { summary: _summary, ...rest } = view;
    return rest;
  });
  const resultView = views.find((view) => view.id === viewId);
  const presentation = resultView
    ? repairedSemanticChart(draft.spec.presentation, resultView, catalog)
    : draft.spec.presentation;
  return {
    ...draft,
    spec: {
      ...draft.spec,
      analysis: { ...draft.spec.analysis, views },
      presentation,
    },
    previewed_spec: null,
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

function repairedSemanticChart(
  chart: SemanticChart,
  view: SemanticAnalysisView,
  catalog: CatalogPayload,
): SemanticChart {
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
      ...(chart.shading ? { shading: chart.shading } : {}),
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
  const displaySeries = chart.display?.series;
  const display = displaySeries
    ? {
        series: Object.fromEntries(
          Object.entries(displaySeries).filter(([member]) => series.includes(member)),
        ),
      }
    : undefined;
  return {
    ...chart,
    category,
    series: chart.type === "pie" || groupBy ? series.slice(0, 1) : series,
    ...(annotations.length ? { annotations } : { annotations: undefined }),
    group_by: groupBy,
    ...(display ? { display } : { display: undefined }),
  };
}

export function setSemanticChart(
  draft: AnalysisEditState,
  chart: SemanticChart,
  catalog: CatalogPayload,
): AnalysisEditState {
  const viewId = semanticAnalysisSink(draft.spec.analysis.views);
  const view = draft.spec.analysis.views.find((candidate) => candidate.id === viewId);
  if (!view) return draft;
  const normalized = repairedSemanticChart(chart, view, catalog);
  return {
    ...draft,
    spec: {
      ...draft.spec,
      presentation: clone(normalized),
    },
  };
}

export function setSemanticQueryView(
  draft: AnalysisEditState,
  viewId: string,
  nextView: SemanticQueryView,
  catalog: CatalogPayload,
): AnalysisEditState {
  const current = draft.spec.analysis.views.find((view) => view.id === viewId);
  if (!current || isSemanticDerivedView(current)) return draft;
  const views = draft.spec.analysis.views.map((view) =>
    view.id === viewId ? clone(nextView) : view,
  );
  const resultId = semanticAnalysisSink(views);
  const presentation =
    resultId === viewId
      ? repairedSemanticChart(draft.spec.presentation, nextView, catalog)
      : draft.spec.presentation;
  return {
    ...draft,
    spec: {
      ...draft.spec,
      analysis: { ...draft.spec.analysis, views },
      presentation,
    },
    previewed_spec: null,
  };
}

/**
 * 语义收敛点的查询视图：存在任何派生视图即整体只读（null）——与查询分区同一严格规则，
 * 时间栏与 Inspector 对「可编辑」的判定不允许分叉。
 */
export function semanticSinkQueryView(spec: SemanticAnalysisSpec): SemanticQueryView | null {
  if (spec.analysis.views.some(isSemanticDerivedView)) return null;
  const sinkId = semanticAnalysisSink(spec.analysis.views);
  const view = spec.analysis.views.find((candidate) => candidate.id === sinkId);
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
  const view = semanticSinkQueryView(draft.spec);
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

export function defaultSemanticChart(
  draft: AnalysisEditState,
  type: SemanticChart["type"],
  catalog: CatalogPayload,
): SemanticChart {
  const viewId = semanticAnalysisSink(draft.spec.analysis.views);
  const view = draft.spec.analysis.views.find((candidate) => candidate.id === viewId);
  if (!view || type === "table") return { type: "table" };
  if (type === "kpi") return repairedSemanticChart({ type }, view, catalog);
  const { measures, dimensions } = semanticViewContext(view, catalog);
  if (type === "line") {
    return repairedSemanticChart({ type, series: measures }, view, catalog);
  }
  if (type === "pie") {
    return repairedSemanticChart(
      { type, category: dimensions[0], series: measures.slice(0, 1) },
      view,
      catalog,
    );
  }
  return repairedSemanticChart({ type, category: dimensions[0], series: measures }, view, catalog);
}
