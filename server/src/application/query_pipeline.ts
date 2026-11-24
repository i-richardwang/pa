import { composeColumnResults } from "./composition_result.js";
import { observationScopes } from "../engine/catalog_document.js";
import type { Principal } from "../contracts/principal.js";
import type { CubeSecurityContext, CubeView, TimeContext } from "../ports/cube_gateway.js";
import { memberDisplayTitle } from "../engine/member_presentation.js";
import { AGGREGATE_MODEL_ROWS, modelSampleNote } from "../engine/result_limit.js";
import type { QueryViewSpec } from "../semantic_core/analysis_spec.js";
import { memberShortName } from "../semantic_core/member_name.js";
import type { ExecutionPlan, OutputDelivery } from "../semantic_core/execution_plan.js";
import type { PresentationSpec } from "../presentation_core/presentation_spec.js";
import type { FullRowsBlock, QueryPayload, ViewBlock } from "../semantic_core/query_payload.js";
import { QUERY_PAYLOAD_SCHEMA } from "../semantic_core/query_payload.js";
import type { ChartDecl } from "../presentation_core/chart_decl.js";
import { projectPresentation } from "../presentation_core/presentation_projection.js";
import type { MetricSelectionOutcome } from "../engine/metric_calculator.js";
import type { CubeFilter } from "../ports/cube_gateway.js";
import type { MetricQueryPlan } from "../engine/metric_planner.js";
import {
  transformDerivedView,
  type DerivedSourceSemantics,
  type EngineViewBlock,
} from "../engine/transform.js";
import { publicTimeContext, timeSourced, viewsForMembers } from "./time_context.js";
import type { AuthorizedSemanticContext } from "./catalog_service.js";

export type BoundGroupSelection = {
  outcome: MetricSelectionOutcome;
  filter: CubeFilter;
  groups: (string | null)[][];
};

export type ExecutedViewResult = {
  block: EngineViewBlock;
  sampleForModel: boolean;
  sourceSemantics?: DerivedSourceSemantics;
  /** 按执行结果解析出的公共列 id，覆盖 plan.output.columns 中的同名映射。 */
  resolvedDeliveryColumns?: Record<string, string>;
  exportPlan?: MetricQueryPlan;
  groupSelection?: BoundGroupSelection;
};

export type QueryRunResult = {
  payload: QueryPayload;
  /** 未按模型样本截断的完整行块。 */
  fullRowViewBlock: ViewBlock;
  /** 呈现声明，列引用已换成公共列 id。 */
  decl: ChartDecl;
  fullRows?: FullRowsBlock;
  exportPlan?: MetricQueryPlan;
};

type ExecuteView = (
  context: {
    principal: Principal;
    cubeContext: CubeSecurityContext;
  },
  spec: QueryViewSpec,
  authViews: CubeView[],
  time: TimeContext,
  includeSummary: boolean,
  includeTotals: boolean,
  accessScopeTitle: string,
) => Promise<ExecutedViewResult>;

function publicColumnId(delivery: OutputDelivery, internal: string): string | undefined {
  return delivery.columns[internal] ?? delivery.columns[memberShortName(internal)];
}

function requiredPublicColumnId(
  delivery: OutputDelivery,
  internal: string,
  outputId: string,
): string {
  const id = publicColumnId(delivery, internal);
  if (!id) {
    throw new Error(`结果 ${outputId} 的内部列 ${internal} 没有对应的公开语义 id`);
  }
  return id;
}

function projectNotes(notes: EngineViewBlock["query_notes"] | undefined, delivery: OutputDelivery) {
  return (notes ?? []).map((note, index) => ({
    ...note,
    member: publicColumnId(delivery, note.member) ?? `notice:${index + 1}`,
  }));
}

/** 把执行列名换成公共列 id；QueryPayload 中不能出现物理成员名。 */
function projectOutputBlock(
  block: EngineViewBlock,
  delivery: OutputDelivery,
  outputId: string,
): ViewBlock {
  const columns = block.columns.map((column) => requiredPublicColumnId(delivery, column, outputId));
  if (new Set(columns).size !== columns.length) {
    throw new Error(`结果 ${outputId} 中有多列对应同一个公开语义 id`);
  }
  const projectRecord = <T>(
    record: Record<string, T> | undefined,
  ): Record<string, T> | undefined =>
    record
      ? Object.fromEntries(
          Object.entries(record).map(([key, value]) => [
            requiredPublicColumnId(delivery, key, outputId),
            value,
          ]),
        )
      : undefined;
  const columnPeriods = projectRecord(block.column_periods);
  const columnFormats = projectRecord(block.column_formats);
  const columnDecimals = projectRecord(block.column_decimals);
  const columnTimeBasis = projectRecord(block.column_time_basis);
  const columnRoles = Object.fromEntries(
    Object.entries(block.column_roles).map(([key, value]) => [
      requiredPublicColumnId(delivery, key, outputId),
      value,
    ]),
  );
  const time = block.time ? { ...block.time } : undefined;
  const totals = block.totals
    ? {
        metrics: block.totals.metrics.map((metric) => ({
          ...metric,
          column: requiredPublicColumnId(delivery, metric.column, outputId),
        })),
      }
    : undefined;
  const structureShares = block.structure_shares?.map((share) => ({
    measure: requiredPublicColumnId(delivery, share.measure, outputId),
    numerator: requiredPublicColumnId(delivery, share.numerator, outputId),
  }));
  const selectionScope = block.selection_scope
    ? {
        ...block.selection_scope,
        grain: block.selection_scope.grain.map((member) =>
          requiredPublicColumnId(delivery, member, outputId),
        ),
        by: requiredPublicColumnId(delivery, block.selection_scope.by, outputId),
      }
    : undefined;
  if (block.derived && !delivery.provenance) {
    throw new Error(`派生结果 ${outputId} 缺少来源和关联键信息`);
  }
  return {
    id: block.id,
    ...(block.view_title ? { view_title: block.view_title } : {}),
    ...(block.derived && delivery.provenance
      ? {
          provenance: {
            ...delivery.provenance,
            formula: block.derived.formula,
          },
        }
      : {}),
    columns,
    ...(columnPeriods ? { column_periods: columnPeriods } : {}),
    ...(block.observations
      ? {
          observations: block.observations.map((period) =>
            period.columns
              ? {
                  ...period,
                  columns: period.columns.map((id) =>
                    requiredPublicColumnId(delivery, id, outputId),
                  ),
                }
              : period,
          ),
        }
      : {}),
    ...(block.observation_axis
      ? {
          observation_axis: {
            id_column: requiredPublicColumnId(delivery, block.observation_axis.id_column, outputId),
            date_column: requiredPublicColumnId(
              delivery,
              block.observation_axis.date_column,
              outputId,
            ),
          },
        }
      : {}),
    ...(columnFormats && Object.keys(columnFormats).length
      ? { column_formats: columnFormats }
      : {}),
    ...(columnDecimals && Object.keys(columnDecimals).length
      ? { column_decimals: columnDecimals }
      : {}),
    column_roles: columnRoles,
    ...(columnTimeBasis && Object.keys(columnTimeBasis).length
      ? { column_time_basis: columnTimeBasis }
      : {}),
    ...(structureShares?.length ? { structure_shares: structureShares } : {}),
    rows: block.rows,
    ...(block.summary ? { summary: block.summary } : {}),
    ...(totals ? { totals } : {}),
    row_count: block.row_count,
    ...(block.has_more !== undefined ? { has_more: block.has_more } : {}),
    ...(block.truncated ? { truncated: block.truncated } : {}),
    ...(block.sampled ? { sampled: block.sampled } : {}),
    ...(selectionScope ? { selection_scope: selectionScope } : {}),
    ...(time ? { time } : {}),
    query_notes: projectNotes(block.query_notes, delivery),
    ...(block.display_notes ? { display_notes: projectNotes(block.display_notes, delivery) } : {}),
  };
}

export async function runQueryPipeline(
  executeView: ExecuteView,
  access: AuthorizedSemanticContext,
  plan: ExecutionPlan,
  presentation: PresentationSpec,
): Promise<QueryRunResult> {
  const {
    principal,
    cubeContext,
    views: authViews,
    timeContext: context,
    time_sources: timeSources,
  } = access;
  const { id: outputId, operation } = plan.output;
  const summarySources = new Set(
    operation.kind === "derived" && operation.view.summary ? operation.view.from : [],
  );
  const queryResults = new Map(
    await Promise.all(
      plan.queries.map(async (spec) => {
        const isOutput = operation.kind === "query" && spec.id === outputId;
        const result = await executeView(
          { principal, cubeContext },
          spec,
          authViews,
          context,
          (isOutput && Boolean(spec.summary)) || summarySources.has(spec.id),
          isOutput,
          access.compiler.access_scope.title,
        );
        return [spec.id, result] as const;
      }),
    ),
  );
  let deliveredResult: ExecutedViewResult;
  if (operation.kind === "query") {
    const result = queryResults.get(outputId);
    if (!result) throw new Error(`结果视图 ${outputId} 未产生执行结果`);
    deliveredResult = result;
  } else {
    const blocks = new Map(Array.from(queryResults, ([id, result]) => [id, result.block]));
    if (operation.kind === "composition") {
      deliveredResult = {
        block: composeColumnResults(outputId, operation.composition, blocks),
        sampleForModel: true,
      };
    } else {
      const semantics = new Map(
        [...queryResults].flatMap(([id, result]) =>
          result.sourceSemantics ? [[id, result.sourceSemantics] as const] : [],
        ),
      );
      const titles = new Set(
        authViews.flatMap((view) =>
          view.measures.map((measure) =>
            memberDisplayTitle(authViews, measure.name, measure.title),
          ),
        ),
      );
      deliveredResult = {
        block: transformDerivedView(operation.view, blocks, titles, semantics),
        sampleForModel: operation.view.limit === undefined,
      };
    }
  }
  const queriedViews = viewsForMembers(
    authViews,
    plan.queries.flatMap((spec) => [
      ...(spec.measures ?? []),
      ...(spec.dimensions ?? []),
      ...(spec.filters ?? []).map((filter) => filter.member),
      ...(spec.order ?? []).map((order) => order.member),
    ]),
  );
  const shared = {
    ...(plan.title ? { title: plan.title } : {}),
    observation_scopes: observationScopes(queriedViews.length ? queriedViews : authViews),
    data_as_of: context.dataAsOf,
    time_context: publicTimeContext(timeSourced(queriedViews), context, timeSources),
  };
  const resolvedOutput = {
    ...plan.output,
    columns: {
      ...plan.output.columns,
      ...(deliveredResult.resolvedDeliveryColumns ?? {}),
    },
  };
  const deliveredFull = projectOutputBlock(deliveredResult.block, resolvedOutput, outputId);
  const decl = projectPresentation(presentation, resolvedOutput, outputId);
  const deliveredSampled: ViewBlock =
    deliveredResult.sampleForModel && deliveredFull.rows.length > AGGREGATE_MODEL_ROWS
      ? {
          ...deliveredFull,
          rows: deliveredFull.rows.slice(0, AGGREGATE_MODEL_ROWS),
          sampled: modelSampleNote(deliveredFull.rows.length),
        }
      : deliveredFull;
  const fullRows: FullRowsBlock | undefined = deliveredSampled.sampled
    ? { rows: deliveredFull.rows }
    : undefined;
  const payload = QUERY_PAYLOAD_SCHEMA.parse({
    ...shared,
    view: deliveredSampled,
  });
  return {
    payload,
    fullRowViewBlock: deliveredFull,
    decl,
    ...(fullRows ? { fullRows } : {}),
    ...(deliveredResult.exportPlan ? { exportPlan: deliveredResult.exportPlan } : {}),
  };
}
