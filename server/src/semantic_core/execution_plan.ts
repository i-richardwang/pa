/** 私有执行计划；只有 output 节点交付给用户，其余节点是内部子查询。 */
import {
  analysisSink,
  derivedColumnName,
  isDerivedViewSpec,
  parseAnalysisSpec,
  type AnalysisSpec,
  type AnalysisViewSpec,
  type DerivedViewSpec,
  type QueryViewSpec,
} from "./analysis_spec.js";
import type { ColumnTime } from "./time_contract.js";
import { memberShortName } from "./member_name.js";

export type OutputProvenance = {
  sources: { title: string }[];
  join_keys: { id: string; title: string }[];
};

export type OutputDelivery = {
  columns: Record<string, string>;
  provenance?: OutputProvenance;
};

type OutputOperation =
  | { kind: "query"; view: QueryViewSpec }
  | { kind: "derived"; view: DerivedViewSpec }
  | { kind: "composition"; composition: CompositionExecution };

const compiledPlan = Symbol("compiledPlan");

export type ExecutionPlan = {
  readonly [compiledPlan]: true;
  title?: string;
  queries: QueryViewSpec[];
  output: OutputDelivery & { id: string; operation: OutputOperation };
};

export type CompositionExecution = {
  group: { id: string; title: string; label?: { id: string; title: string } };
  baseline?: string;
  columns: {
    id: string;
    title: string;
    member: string;
    source?: { query: string; labels?: string };
    time: ColumnTime;
  }[];
};

export function planComposition(input: {
  title?: string;
  queries: QueryViewSpec[];
  composition: CompositionExecution;
}): ExecutionPlan {
  const { group, columns } = input.composition;
  return {
    [compiledPlan]: true,
    title: input.title,
    queries: input.queries,
    output: {
      operation: { kind: "composition", composition: input.composition },
      id: "result",
      columns: Object.fromEntries(
        [
          group.id,
          ...(group.label ? [group.label.id] : []),
          ...columns.map((column) => column.id),
        ].map((id) => [id, id]),
      ),
    },
  };
}

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
    [compiledPlan]: true,
    ...(spec.title ? { title: spec.title } : {}),
    queries: spec.views.filter((node): node is QueryViewSpec => !isDerivedViewSpec(node)),
    output: {
      id: outputId,
      operation: isDerivedViewSpec(view) ? { kind: "derived", view } : { kind: "query", view },
      ...delivery,
    },
  };
}

export function exportableOutput(plan: ExecutionPlan): QueryViewSpec | undefined {
  const { operation } = plan.output;
  return operation.kind === "query" && !operation.view.grouping_sets?.calculations?.length
    ? operation.view
    : undefined;
}
