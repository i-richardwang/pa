/**
 * 正式指标 Executor：执行 Planner 产生的单事实子查询，并把结果交给 Calculator。
 * Top-N 先按选择粒度排名、再按展示粒度查询，预览与导出都走这里。
 */
import type { TopNSelectionSpec } from "../semantic_core/analysis_spec.js";
import type { TimeInput } from "../semantic_core/time_contract.js";
import type {
  CubeGateway,
  CubeFilter,
  CubeQuery,
  CubeSecurityContext,
  CubeView,
  TimeContext,
} from "../ports/cube_gateway.js";
import { completeHierarchy } from "./hierarchy.js";
import {
  alignMetricLoads,
  type MetricSelectionOutcome,
  type ResolvedMetricLoad,
} from "./metric_calculator.js";
import {
  metricLegPlan,
  planMetricQueryWithPlanning,
  resolveMetricQueryPlanning,
  type MetricQueryPlan,
} from "./metric_planner.js";
import type { ResolvedTimePlanning } from "./time_plan.js";
import { isBoundedResultComplete } from "./result_limit.js";
import { executeBoundedPlanned, executeCompletePlanned } from "./time_executor.js";

export type PreparedMetricQueryExecution = {
  plan: MetricQueryPlan;
  timePlanning: ResolvedTimePlanning;
  /** 选择粒度与展示粒度相同时，排名结果本身就是最终结果。 */
  precomputed?: ResolvedMetricLoad;
  /** 排名结果及选中分组的过滤条件。 */
  selection?: {
    outcome: MetricSelectionOutcome;
    filter: CubeFilter;
  };
};

export async function executeMetricQuery(
  cube: Pick<CubeGateway, "load" | "loadMulti">,
  plan: MetricQueryPlan,
  context: CubeSecurityContext,
  views: CubeView[],
  perWindowLimit?: number,
): Promise<ResolvedMetricLoad> {
  const loads = await Promise.all(
    plan.legs.map((leg) =>
      executeCompletePlanned(cube, metricLegPlan(plan, leg), context, perWindowLimit),
    ),
  );
  return alignMetricLoads(plan, loads, views);
}

export async function prepareMetricQueryExecution(input: {
  cube: Pick<CubeGateway, "load" | "loadMulti">;
  query: CubeQuery;
  time: TimeInput | undefined;
  context: TimeContext;
  views: CubeView[];
  securityContext: CubeSecurityContext;
  timeView?: string;
  selection?: TopNSelectionSpec;
}): Promise<PreparedMetricQueryExecution> {
  const { cube, query, time, context, views, securityContext, timeView, selection } = input;
  const timePlanning = resolveMetricQueryPlanning(query, time, context, views, timeView);
  if (!selection) {
    return {
      plan: planMetricQueryWithPlanning(query, timePlanning, views, timeView),
      timePlanning,
    };
  }
  const rankingQuery = completeHierarchy(
    {
      ...query,
      dimensions: selection.dimensions,
      order: undefined,
    },
    views,
  ).query;
  const rankingPlan = planMetricQueryWithPlanning(
    rankingQuery,
    timePlanning,
    views,
    timeView,
    selection,
  );
  const ranking = await executeMetricQuery(cube, rankingPlan, securityContext, views);
  if (!ranking.selection || !ranking.selectionFilter) {
    throw new Error("Top-N 结果缺少选中分组过滤，无法安全继续");
  }
  if (JSON.stringify(rankingQuery.dimensions ?? []) === JSON.stringify(query.dimensions ?? [])) {
    return {
      plan: rankingPlan,
      timePlanning,
      precomputed: ranking,
      selection: {
        outcome: ranking.selection,
        filter: ranking.selectionFilter,
      },
    };
  }
  return {
    plan: planMetricQueryWithPlanning(
      {
        ...query,
        filters: [...(query.filters ?? []), ranking.selectionFilter],
      },
      timePlanning,
      views,
      timeView,
    ),
    timePlanning,
    selection: {
      outcome: ranking.selection,
      filter: ranking.selectionFilter,
    },
  };
}

export async function executeBoundedMetricQuery(
  cube: Pick<CubeGateway, "load" | "loadMulti">,
  plan: MetricQueryPlan,
  context: CubeSecurityContext,
  views: CubeView[],
  perWindowLimit: number,
): Promise<{ load: ResolvedMetricLoad; complete: boolean }> {
  const bounded = await Promise.all(
    plan.legs.map((leg) =>
      executeBoundedPlanned(cube, metricLegPlan(plan, leg), context, perWindowLimit),
    ),
  );
  const load = alignMetricLoads(
    plan,
    bounded.map((result) => result.load),
    views,
  );
  return {
    load,
    complete:
      bounded.every((result) => result.complete) &&
      isBoundedResultComplete(load.data.length, perWindowLimit),
  };
}
