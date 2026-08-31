/** 私有执行计划；内部执行腿不得直接成为用户可见结果。 */
import {
  analysisSink,
  derivedColumnName,
  isDerivedViewSpec,
  parseAnalysisSpec,
  type AnalysisSpec,
  type AnalysisViewSpec,
  type QueryViewSpec,
} from "./analysis_spec.js";
import { memberShortName } from "./member_name.js";

export type OutputProvenance = {
  sources: { title: string }[];
  join_keys: { id: string; title: string }[];
};

export type OutputDelivery = {
  columns: Record<string, string>;
  provenance?: OutputProvenance;
};

export type ExecutionOutput = OutputDelivery & {
  id: string;
};

/** 计划带有不可伪造的类型品牌，只能由本模块的 planner 产生。 */
declare const executionPlanBrand: unique symbol;

export type ExecutionPlan = {
  readonly [executionPlanBrand]: true;
  title?: string;
  nodes: AnalysisViewSpec[];
  output: ExecutionOutput;
};

export type PlanOptions = {
  delivery: OutputDelivery | "identity";
};

const TIME_COLUMNS = ["year", "month", "period_month"] as const;

function identityDelivery(view: AnalysisViewSpec): OutputDelivery {
  const columns = isDerivedViewSpec(view)
    ? view.columns.map(derivedColumnName)
    : [...(view.dimensions ?? []), ...(view.measures ?? []), ...TIME_COLUMNS].map(memberShortName);
  return { columns: Object.fromEntries(columns.map((column) => [column, column])) };
}

/** 解析输入规格并产出唯一执行计划。 */
export function planExecution(input: AnalysisSpec, opts: PlanOptions): ExecutionPlan {
  const spec = parseAnalysisSpec(input);
  const outputId = analysisSink(spec.views);
  const view = spec.views.find((candidate) => candidate.id === outputId);
  if (!view) throw new Error(`交付结果 ${outputId} 没有对应执行节点`);
  const delivery = opts.delivery === "identity" ? identityDelivery(view) : opts.delivery;
  if (!Object.keys(delivery.columns).length) {
    throw new Error(`交付结果 ${outputId} 缺少公共列投影`);
  }
  return {
    ...(spec.title ? { title: spec.title } : {}),
    nodes: spec.views,
    output: { id: outputId, ...delivery },
  } as unknown as ExecutionPlan;
}

export function exportableOutput(plan: ExecutionPlan): QueryViewSpec | undefined {
  const node = plan.nodes.find((candidate) => candidate.id === plan.output.id);
  return node && !isDerivedViewSpec(node) ? node : undefined;
}
