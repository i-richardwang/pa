import { observationScopes } from "../engine/catalog_document.js";
import type { Principal } from "../contracts/principal.js";
import type { CubeSecurityContext, CubeView, TimeContext } from "../ports/cube_gateway.js";
import type { ExportService } from "./export_service.js";
import { memberDisplayTitle } from "../engine/member_presentation.js";
import { AGGREGATE_MODEL_ROWS, modelSampleNote } from "../engine/result_limit.js";
import { isDerivedViewSpec, type QueryViewSpec } from "../semantic_core/analysis_spec.js";
import { memberShortName } from "../semantic_core/member_name.js";
import type { ExecutionPlan, OutputDelivery } from "../semantic_core/execution_plan.js";
import type { PresentationSpec } from "../presentation_core/presentation_spec.js";
import type {
  ExportResourceLink,
  FullRowsBlock,
  OutputCapabilities,
  QueryPayload,
  ViewBlock,
} from "../semantic_core/query_payload.js";
import { QUERY_PAYLOAD_SCHEMA } from "../semantic_core/query_payload.js";
import type { ChartDecl } from "../presentation_core/chart_decl.js";
import { projectPresentation } from "../presentation_core/presentation_projection.js";
import type { MetricQueryPlan } from "../engine/metric_planner.js";
import {
  transformDerivedView,
  type DerivedSourceSemantics,
  type EngineViewBlock,
} from "../engine/transform.js";
import { publicTimeContext, timeSourced, viewsForMembers } from "./time_context.js";
import type { AuthorizedSemanticContext } from "./catalog_service.js";

export type ExecutedViewResult = {
  block: EngineViewBlock;
  sampleForModel: boolean;
  sourceSemantics?: DerivedSourceSemantics;
  /** 按执行结果解析出的公共列 id，覆盖 plan.output.columns 中的同名映射。 */
  resolvedDeliveryColumns?: Record<string, string>;
  exportPlan?: MetricQueryPlan;
};

export type QueryRunResult = {
  payload: QueryPayload;
  /** 未按模型样本截断的完整行块。 */
  fullRowViewBlock: ViewBlock;
  /** 呈现声明，列引用已换成公共列 id。 */
  decl: ChartDecl;
  fullRows?: FullRowsBlock;
  exportResource?: ExportResourceLink;
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
  deps: {
    executeView: ExecuteView;
    exports: Pick<ExportService, "createDelivery">;
  },
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
  const caller = principal.email;
  const specs = plan.nodes;
  const queryEntries = specs.flatMap((spec) =>
    isDerivedViewSpec(spec) ? [] : [{ id: spec.id, spec }],
  );
  const outputSpec = specs.find((spec) => spec.id === plan.output.id);
  if (!outputSpec) throw new Error(`结果视图 ${plan.output.id} 不存在`);
  const summarySources = new Set(
    outputSpec.summary ? (isDerivedViewSpec(outputSpec) ? outputSpec.from : [outputSpec.id]) : [],
  );
  // 只有交付视图计算合计；交付视图是派生视图时没有合计。
  const queryResults = await Promise.all(
    queryEntries.map(({ spec }) =>
      deps.executeView(
        { principal, cubeContext },
        spec,
        authViews,
        context,
        summarySources.has(spec.id),
        spec.id === plan.output.id,
        access.compiler.access_scope.title,
      ),
    ),
  );
  const resultById = new Map<string, ExecutedViewResult>();
  queryEntries.forEach(({ id }, resultIndex) => {
    resultById.set(id, queryResults[resultIndex]);
  });
  const sourceBlocks = new Map<string, EngineViewBlock>(
    queryEntries.flatMap(({ id }) => {
      const result = resultById.get(id);
      return result ? [[id, result.block] as const] : [];
    }),
  );
  const sourceSemantics = new Map<string, DerivedSourceSemantics>(
    queryEntries.flatMap(({ id }) => {
      const result = resultById.get(id);
      return result?.sourceSemantics ? [[id, result.sourceSemantics] as const] : [];
    }),
  );
  const standardMeasureTitles = new Set(
    authViews.flatMap((view) =>
      view.measures.map((measure) => memberDisplayTitle(authViews, measure.name, measure.title)),
    ),
  );
  specs.forEach((spec) => {
    if (!isDerivedViewSpec(spec)) return;
    resultById.set(spec.id, {
      block: transformDerivedView(spec, sourceBlocks, standardMeasureTitles, sourceSemantics),
      sampleForModel: spec.limit === undefined,
    });
  });
  specs.forEach((spec) => {
    if (!resultById.get(spec.id)) throw new Error(`视图 ${spec.id} 未产生执行结果`);
  });
  const queriedViews = viewsForMembers(
    authViews,
    queryEntries.flatMap(({ spec }) => [
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
  // 中间视图只参与计算，不进入交付结果，也不发给模型。
  const outputId = plan.output.id;
  const deliveredResult = resultById.get(outputId);
  if (!deliveredResult) throw new Error(`结果视图 ${outputId} 未产生执行结果`);
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
  let capabilities: OutputCapabilities | undefined;
  let exportResource: ExportResourceLink | undefined;
  if (deliveredResult.exportPlan) {
    const delivery = await deps.exports.createDelivery(deliveredResult.exportPlan, caller);
    capabilities = { export: delivery.link };
    exportResource = delivery.resource;
  }
  const payload = QUERY_PAYLOAD_SCHEMA.parse({
    ...shared,
    view: deliveredSampled,
    ...(capabilities ? { capabilities } : {}),
  });
  return {
    payload,
    fullRowViewBlock: deliveredFull,
    decl,
    ...(fullRows ? { fullRows } : {}),
    ...(exportResource ? { exportResource } : {}),
  };
}
