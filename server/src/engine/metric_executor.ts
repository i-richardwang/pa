/**
 * 正式指标 Executor：执行 Planner 产生的单事实查询腿，并把结果交给 Calculator。
 * Top-N 的选择粒度与展示粒度也在此统一编排，预览与导出共享同一路径。
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
import { metricLegPlan, planMetricQuery, type MetricQueryPlan } from "./metric_planner.js";
import { isBoundedResultComplete } from "./result_limit.js";
import { executeBoundedPlanned, executeCompletePlanned } from "./time_executor.js";

export type PreparedMetricQueryExecution = {
  plan: MetricQueryPlan;
  /** 选择粒度与展示粒度相同时，排名结果本身就是最终结果。 */
  precomputed?: ResolvedMetricLoad;
  /** 展示粒度更细时，把独立排名结果附回展示结果。 */
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
  if (!selection) {
    return { plan: planMetricQuery(query, time, context, views, timeView) };
  }
  const rankingQuery = completeHierarchy(
    {
      ...query,
      dimensions: selection.dimensions,
      order: undefined,
    },
    views,
  ).query;
  const rankingPlan = planMetricQuery(rankingQuery, time, context, views, timeView, selection);
  const ranking = await executeMetricQuery(cube, rankingPlan, securityContext, views);
  if (!ranking.selection || !ranking.selectionFilter) {
    throw new Error("Top-N 结果缺少选中分组过滤，无法安全继续");
  }
  if (JSON.stringify(rankingQuery.dimensions ?? []) === JSON.stringify(query.dimensions ?? [])) {
    return { plan: rankingPlan, precomputed: ranking };
  }
  return {
    plan: planMetricQuery(
      {
        ...query,
        filters: [...(query.filters ?? []), ranking.selectionFilter],
      },
      time,
      context,
      views,
      timeView,
    ),
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
