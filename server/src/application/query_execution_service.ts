import type {
  CubeGateway,
  CubeQuery,
  CubeSecurityContext,
  CubeView,
  TimeContext,
} from "../ports/cube_gateway.js";
import type { Principal } from "../contracts/principal.js";
import type { ExportService } from "./export_service.js";
import { completeHierarchy } from "../engine/hierarchy.js";
import { assertPhysicalQueryInvariants, filterMembers } from "../engine/query_contract.js";
import { AGGREGATE_CARD_ROWS, ResultLimitExceededError } from "../engine/result_limit.js";
import {
  runQueryPipeline,
  type ExecutedViewResult,
  type QueryRunResult,
} from "./query_pipeline.js";
import type { QueryViewSpec } from "../semantic_core/analysis_spec.js";
import { executeMetricQuery, prepareMetricQueryExecution } from "../engine/metric_executor.js";
import { applyGroupingSets } from "../engine/grouping_set_executor.js";
import { planGroupingSets } from "../engine/grouping_set_planner.js";
import { computeMetricTotals } from "./view_totals.js";
import { memberSemanticId } from "../engine/model_contract.js";
import type { AuthorizedAnalysisPlan } from "./semantic_planning_service.js";
import { buildResultNotes } from "./query_result_notes.js";
import { encodeQueryResult } from "./query_result_block.js";

type OrderInput = { member: string; direction: "asc" | "desc" }[] | undefined;
function toOrderTuples(order: OrderInput): CubeQuery["order"] {
  return order?.map(({ member, direction }): [string, "asc" | "desc"] => [member, direction]);
}

/**
 * 执行单个查询视图：授权、层级补全、时间规划、Cube 投影、序数归位与列式编码。
 * 受控记录字段不属于公开查询面，只能经 Record Projection 端点投影。
 */
async function executeView(
  deps: QueryExecutionDependencies,
  ctx: {
    principal: Principal;
    cubeContext: CubeSecurityContext;
  },
  spec: QueryViewSpec,
  authViews: CubeView[],
  context: TimeContext,
  includeSummary: boolean,
  includeTotals: boolean,
  accessScopeTitle: string,
): Promise<ExecutedViewResult> {
  const { principal, cubeContext } = ctx;
  const inputQuery: CubeQuery = {
    measures: spec.measures,
    dimensions: spec.grouping_sets?.base.map((dimension) => dimension.member) ?? spec.dimensions,
    filters: spec.filters,
    order: toOrderTuples(spec.order),
  };
  const { measures, dimensions, filters, order } = inputQuery;
  const publicMembers = new Set(
    authViews
      .flatMap((view) => [...view.measures, ...view.dimensions])
      .map((member) => member.name),
  );
  const requestedMembers = [
    ...(measures ?? []),
    ...(dimensions ?? []),
    ...filterMembers(filters),
    ...(order ?? []).map(([member]) => member),
    ...(spec.selection ? [spec.selection.by, ...spec.selection.dimensions] : []),
  ];
  if (requestedMembers.some((member) => !publicMembers.has(member))) {
    throw new Error("执行计划引用了当前授权目录中不存在的物理成员");
  }
  assertPhysicalQueryInvariants({ measures, dimensions, filters, order }, authViews);
  const { query: shaped, added: hierarchyDimensions } = completeHierarchy(
    { measures, dimensions, filters, order },
    authViews,
  );
  const prepared = await prepareMetricQueryExecution({
    cube: deps.cube,
    query: shaped,
    time: spec.time,
    context,
    views: authViews,
    securityContext: cubeContext,
    timeView: spec.time_view,
    selection: spec.selection,
  });
  const queryPlan = prepared.plan;
  const selectionState = prepared.selection;
  const selection = selectionState?.outcome;
  const effectiveQuery: CubeQuery = selection
    ? {
        ...shaped,
        filters: [...(shaped.filters ?? []), selectionState.filter],
      }
    : shaped;
  const groupingPlan = planGroupingSets({
    viewId: spec.id,
    baseQuery: effectiveQuery,
    baseGroupingSet:
      spec.grouping_sets?.base.map((dimension) => dimension.id) ??
      (spec.dimensions ?? []).map((dimension) => memberSemanticId("dimension", dimension)),
    basePlan: queryPlan,
    timePlanning: prepared.timePlanning,
    baselineFilters: shaped.filters,
    grouping: spec.grouping_sets,
    includeSummary,
    views: authViews,
    timeView: spec.time_view,
  });
  const [displayResolved, groupingLoads, metricTotals] = await Promise.all([
    prepared.precomputed
      ? Promise.resolve(prepared.precomputed)
      : executeMetricQuery(deps.cube, queryPlan, cubeContext, authViews),
    Promise.all(
      groupingPlan.legs.map((leg) =>
        executeMetricQuery(deps.cube, leg.plan, cubeContext, authViews),
      ),
    ),
    includeTotals
      ? computeMetricTotals({
          cube: deps.cube,
          query: shaped,
          context,
          views: authViews,
          securityContext: cubeContext,
          timeView: spec.time_view,
          businessTime: queryPlan.business_time,
        })
      : Promise.resolve([]),
  ]);
  const resolved = prepared.selection
    ? {
        ...displayResolved,
        selection: prepared.selection.outcome,
        selectionFilter: prepared.selection.filter,
      }
    : displayResolved;
  const groupingResolved = applyGroupingSets(
    groupingPlan,
    resolved,
    new Map(
      groupingPlan.legs.map((leg, index) => {
        const load = groupingLoads[index];
        if (!load) throw new Error(`分组腿 ${leg.id} 未返回执行结果`);
        return [leg.id, load];
      }),
    ),
  );
  const finalResolved = groupingResolved.load;
  if (selection && finalResolved.data.length > AGGREGATE_CARD_ROWS) {
    throw new ResultLimitExceededError(
      `Top-N 分组的完整结果共 ${finalResolved.data.length} 行，超过交付上限 ${AGGREGATE_CARD_ROWS}；` +
        "请减少 Top-N 数量或分组维度",
      { limit: AGGREGATE_CARD_ROWS, row_count: finalResolved.data.length },
    );
  }
  if (groupingPlan.calculations.length && finalResolved.data.length > AGGREGATE_CARD_ROWS) {
    throw new ResultLimitExceededError(
      `构成占比结果共 ${finalResolved.data.length} 行，超过交付上限 ${AGGREGATE_CARD_ROWS}；` +
        "请增加筛选条件或减少分组维度",
      { limit: AGGREGATE_CARD_ROWS, row_count: finalResolved.data.length },
    );
  }
  const { queryNotes: notes, displayNotes } = buildResultNotes({
    views: authViews,
    principal,
    accessScopeTitle,
    load: finalResolved,
    selection,
    hierarchyAdditions: hierarchyDimensions,
  });
  return encodeQueryResult({
    spec,
    views: authViews,
    shapedQuery: shaped,
    queryPlan,
    groupingPlan,
    grouping: groupingResolved,
    totals: metricTotals,
    selection,
    queryNotes: notes,
    displayNotes,
  });
}

export type QueryExecutionDependencies = {
  cube: CubeGateway;
  exports: Pick<ExportService, "createDelivery">;
};

export function createQueryExecutionService(deps: QueryExecutionDependencies) {
  const execute = (planned: AuthorizedAnalysisPlan): Promise<QueryRunResult> =>
    runQueryPipeline(
      {
        executeView: (...args) => executeView(deps, ...args),
        exports: deps.exports,
      },
      planned.access,
      planned.plan,
      planned.presentation,
    );
  return { execute };
}
