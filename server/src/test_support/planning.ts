import type { CubeQuery, CubeView, TimeContext } from "../ports/cube_gateway.js";
import type { TopNSelectionSpec } from "../semantic_core/analysis_spec.js";
import type { TimeInput } from "../semantic_core/time_contract.js";
import { planMetricQuery as planMetricQueryResolved } from "../engine/metric_planner.js";
import { planTimeQuery as planTimeQueryResolved } from "../engine/time_plan.js";

const defaultOutput = (query: CubeQuery) =>
  (query.dimensions ?? []).length ? ("total" as const) : ("series" as const);

export function planMetricQuery(
  query: CubeQuery,
  time: TimeInput | undefined,
  context: TimeContext,
  views: CubeView[],
  timeView?: string,
  selection?: TopNSelectionSpec,
) {
  return planMetricQueryResolved(query, time, context, views, {
    defaultOutput: defaultOutput(query),
    ...(timeView ? { timeView } : {}),
    ...(selection ? { selection } : {}),
  });
}

export function planTimeQuery(
  query: CubeQuery,
  time: TimeInput | undefined,
  context: TimeContext,
  views: CubeView[],
  preferredView?: string,
) {
  return planTimeQueryResolved(query, time, context, views, {
    defaultOutput: defaultOutput(query),
    ...(preferredView ? { preferredView } : {}),
  });
}
