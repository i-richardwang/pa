import { completeHierarchy } from "../engine/hierarchy.js";
import type { Principal } from "../contracts/principal.js";
import type {
  CubeGateway,
  CubeFilter,
  CubeQuery,
  CubeSecurityContext,
  CubeView,
  TimeContext,
} from "../ports/cube_gateway.js";
import { memberShortName } from "../semantic_core/member_name.js";
import { memberDisplayTitle } from "../engine/member_presentation.js";
import type {
  RecordProjectionAudit,
  RecordProjectionAuditSource,
} from "../ports/record_projection_audit.js";
import {
  resolveRecordProjectionTarget,
  type RecordProjectionTarget,
  type RecordField,
  type RecordSetDefinition,
} from "../engine/record_metadata.js";
import { executePlanned, type ResolvedLoad } from "../engine/time_executor.js";
import { planTimeQuery, resultBuckets, withPlannedLimit } from "../engine/time_plan.js";
import { catalogMember } from "../semantic_core/query_intent.js";
import { planMetricRecordProjection } from "../semantic_core/record_projection_planner.js";
import {
  RECORD_PROJECTION_MAX_ROWS,
  type RecordProjectionPayload,
  type RecordProjectionRequestBody,
} from "../contracts/record_projection_contract.js";
import {
  semanticResultViewId,
  type AnalysisDefinition,
  type SemanticViewIntent,
} from "../semantic_core/semantic_analysis.js";
import type { TimeIntent } from "../semantic_core/time_contract.js";
import type { SemanticPlanningService } from "./semantic_planning_service.js";
import { applyBoardTimeOverride } from "./board_time_override.js";
import type { ViewPreferences } from "../presentation_core/view_preferences.js";
import type { AuthorizedAnalysisPlan } from "./semantic_planning_service.js";
import { ConflictError, InvalidRequestError, NotFoundError } from "./errors.js";
import type { ReportDocument, ReportService } from "./report_service.js";
import type { BoardService } from "./board_service.js";
import type { AnalysisService } from "./analysis_service.js";

/** 可安全原样返回浏览器的业务请求错误；引擎与模型异常由路由统一收口。 */
export class RecordProjectionRequestError extends InvalidRequestError {
  override name = "RecordProjectionRequestError";
}

const qualify = (view: string, member: string) =>
  member.includes(".") ? member : `${view}.${member}`;
const ENTITY_DETAIL_MAX_ROWS = 10_000;

function uniqueMembers(members: string[]): string[] {
  return [...new Set(members)];
}

function entityValue(row: Record<string, unknown>, member: string): string {
  const value = row[member];
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("明细记录结果缺少有效的实体键");
  }
  return String(value);
}

function selectedTime(
  target: RecordProjectionTarget,
  coordinate: RecordProjectionRequestBody["time_coordinate"],
) {
  const { from, to } = coordinate;
  if (from > to) throw new RecordProjectionRequestError("明细时间范围无效，请刷新报告后重试");
  if (target.basis === "whole_bucket" && from !== to) {
    return { range: { from, to }, grain: "total" as const };
  }
  return { cutoff: to };
}

async function executeRecordProjection(input: {
  cube: CubeGateway;
  cubeContext: CubeSecurityContext;
  authViews: CubeView[];
  sourceView: string;
  target: RecordProjectionTarget;
  records: RecordSetDefinition;
  filters: CubeFilter[];
  timeCoordinate: RecordProjectionRequestBody["time_coordinate"];
  context: TimeContext;
  offset: number;
  pageSize: number;
}): Promise<{
  displayFields: RecordField[];
  resolved: ResolvedLoad;
  page: Record<string, unknown>[];
  moreRowsExist: boolean;
}> {
  const {
    cube,
    cubeContext,
    authViews,
    sourceView,
    target,
    records,
    filters,
    timeCoordinate,
    context,
    offset,
    pageSize,
  } = input;
  const displayFields = records.fields;
  const execute = async (query: CubeQuery, limit: number) => {
    const shaped = completeHierarchy(query, authViews).query;
    const plan = withPlannedLimit(
      planTimeQuery(shaped, selectedTime(target, timeCoordinate), context, authViews),
      limit,
    );
    return executePlanned(cube, plan, cubeContext);
  };

  if (target.mode === "rows") {
    const rowKey = qualify(sourceView, records.rowKey);
    const resolved = await execute(
      {
        measures: [target.member],
        dimensions: uniqueMembers([
          rowKey,
          ...displayFields.map((field) => qualify(sourceView, field.member)),
          ...records.entityOrder.map((order) => qualify(sourceView, order.member)),
        ]),
        filters,
        order: records.entityOrder.map((order): [string, "asc" | "desc"] => [
          qualify(sourceView, order.member),
          order.direction,
        ]),
        offset,
      },
      pageSize + 1,
    );
    const page = resolved.data.slice(0, pageSize);
    return {
      displayFields,
      resolved,
      page,
      moreRowsExist: resolved.data.length > page.length,
    };
  }

  // countDistinct 的分页键只能是实体键；展示字段若参与首段分组，会把同一实体拆成多行。
  const entityKey = qualify(sourceView, records.entityKey);
  const membership = await execute(
    {
      measures: [target.member],
      dimensions: [entityKey],
      filters,
      order: [[entityKey, "asc"]],
      offset,
    },
    pageSize + 1,
  );
  const membershipKeys = membership.data.map((row) => entityValue(row, entityKey));
  if (new Set(membershipKeys).size !== membershipKeys.length) {
    throw new Error("明细记录实体分页键不唯一");
  }
  const entityKeys = membershipKeys.slice(0, pageSize);
  const moreRowsExist = membershipKeys.length > entityKeys.length;
  if (!entityKeys.length) {
    return { displayFields, resolved: membership, page: [], moreRowsExist };
  }

  const detailDimensions = uniqueMembers([
    qualify(sourceView, records.rowKey),
    ...displayFields.map((field) => qualify(sourceView, field.member)),
    ...records.entityOrder.map((order) => qualify(sourceView, order.member)),
  ]);
  const resolved = await execute(
    {
      measures: [target.member],
      dimensions: detailDimensions,
      filters: [...filters, { member: entityKey, operator: "equals", values: entityKeys }],
      order: [
        [entityKey, "asc"],
        ...records.entityOrder.map((order): [string, "asc" | "desc"] => [
          qualify(sourceView, order.member),
          order.direction,
        ]),
      ],
    },
    ENTITY_DETAIL_MAX_ROWS + 1,
  );
  if (resolved.data.length > ENTITY_DETAIL_MAX_ROWS) {
    throw new RecordProjectionRequestError("当前名单的候选记录过多，请缩小报告筛选范围后重试");
  }
  const representative = new Map<string, Record<string, unknown>>();
  for (const row of resolved.data) {
    const key = entityValue(row, entityKey);
    if (!representative.has(key)) representative.set(key, row);
  }
  const page = entityKeys.map((key) => {
    const row = representative.get(key);
    if (!row) throw new Error("明细记录结果与指标成员不一致");
    return row;
  });
  return { displayFields, resolved, page, moreRowsExist };
}

export function createRecordProjectionService(deps: {
  reports: Pick<ReportService, "get" | "resolveOwned">;
  boards: Pick<BoardService, "get">;
  analyses: Pick<AnalysisService, "resolveOwnedView">;
  semanticPlanning: SemanticPlanningService;
  cube: CubeGateway;
  audit: RecordProjectionAudit;
}) {
  type ProjectionContext = {
    revision: number;
    definition: AnalysisDefinition;
    intent: SemanticViewIntent;
    preferences: ViewPreferences;
  };
  type ProjectionRequest = Omit<RecordProjectionRequestBody, "time_coordinate" | "data_as_of"> & {
    time_coordinate?: RecordProjectionRequestBody["time_coordinate"];
    data_as_of?: string;
  };

  function reportContext(report: ReportDocument): ProjectionContext {
    return {
      revision: report.revision,
      definition: report.definition,
      intent: report.intent,
      preferences: report.view_preferences,
    };
  }

  async function ownedContext(principal: Principal, reportId: string): Promise<ProjectionContext> {
    return reportContext(await deps.reports.resolveOwned(principal, reportId));
  }

  async function boardContext(
    boardId: string,
    reportId: string,
    timeOverride?: TimeIntent,
  ): Promise<ProjectionContext> {
    let board: Awaited<ReturnType<typeof deps.boards.get>>;
    try {
      board = await deps.boards.get(boardId);
    } catch (error) {
      if (error instanceof NotFoundError) throw new NotFoundError("看板或报告不存在");
      throw error;
    }
    if (!board.tiles.some((tile) => tile.kind === "report" && tile.report_id === reportId)) {
      throw new NotFoundError("看板或报告不存在");
    }
    const report = await deps.reports.get(reportId);
    if (!report) throw new NotFoundError("看板或报告不存在");
    const context = reportContext(report);
    return timeOverride
      ? {
          ...context,
          definition: applyBoardTimeOverride(context.definition, timeOverride).definition,
        }
      : context;
  }

  function directRequest(
    definition: AnalysisDefinition,
    planned: AuthorizedAnalysisPlan,
    options: { metricId?: string; offset?: number; limit?: number; dataAsOf?: string },
  ): ProjectionRequest {
    const resultViewId = semanticResultViewId(definition);
    const semanticView = definition.derived ? undefined : definition.query;
    if (!semanticView) {
      throw new RecordProjectionRequestError("当前分析没有可直接展开的指标结果");
    }
    if ((semanticView.dimensions?.length ?? 0) > 0) {
      throw new RecordProjectionRequestError(
        "直接查看名单不能声明分组维度；请把分类条件移入 filters 后重试",
      );
    }
    const binding = planned.record_projection_bindings.views.find(
      (item) => item.result_view_id === resultViewId,
    );
    const available = Object.values(binding?.metrics ?? {});
    const selected = options.metricId
      ? available.find((metric) => metric.metric_id === options.metricId)
      : available.length === 1
        ? available[0]
        : undefined;
    if (!selected) {
      throw new RecordProjectionRequestError(
        options.metricId
          ? "指定指标不属于当前分析或不提供构成记录"
          : "当前分析包含多个可查看构成记录的指标，请明确指定需要展开的指标",
      );
    }
    return {
      revision: 1,
      result_view_id: resultViewId,
      metric_id: selected.metric_id,
      coordinates: [],
      offset: options.offset ?? 0,
      limit: options.limit ?? 20,
      ...(options.dataAsOf ? { data_as_of: options.dataAsOf } : {}),
    };
  }

  function directTimeCoordinate(input: {
    sourceFilters?: CubeFilter[];
    sourceTime: Parameters<typeof planTimeQuery>[1];
    target: RecordProjectionTarget;
    context: TimeContext;
    authViews: CubeView[];
  }): RecordProjectionRequestBody["time_coordinate"] {
    const scopeQuery = completeHierarchy(
      {
        measures: [input.target.member],
        ...(input.sourceFilters?.length ? { filters: input.sourceFilters } : {}),
      },
      input.authViews,
    ).query;
    const resolution = planTimeQuery(
      scopeQuery,
      input.sourceTime,
      input.context,
      input.authViews,
    ).businessTime;
    const buckets = resultBuckets(resolution);
    if (resolution.outputGrain !== "total" || buckets.length !== 1) {
      throw new RecordProjectionRequestError(
        "直接查看名单的分析必须落在一个业务时间桶；请改为当月、单年或期间合计后重试",
      );
    }
    const bucket = buckets[0];
    return { from: bucket.from, to: bucket.to };
  }

  async function runWithContext(
    principal: Principal,
    auditSource: RecordProjectionAuditSource,
    input: ProjectionRequest,
    resolve: () => Promise<{
      access: ProjectionContext;
      planned?: AuthorizedAnalysisPlan;
    }>,
  ): Promise<RecordProjectionPayload> {
    const auditBase = {
      caller: principal.email,
      source: auditSource,
      metric_id: input.metric_id,
      coordinates: input.coordinates,
      offset: input.offset,
    };
    try {
      const prepared = await resolve();
      const access = prepared.access;
      if (access.revision !== input.revision) {
        throw new ConflictError("报告已更新，请刷新后重新查看明细");
      }
      if (input.result_view_id !== semanticResultViewId(access.definition)) {
        throw new RecordProjectionRequestError("当前结果列没有可追溯的基础指标");
      }
      const semanticView = access.definition.derived ? undefined : access.definition.query;
      if (!semanticView) {
        throw new RecordProjectionRequestError("当前结果列没有可追溯的基础指标");
      }
      const planned =
        prepared.planned ??
        (await deps.semanticPlanning.plan(
          principal,
          access.definition,
          access.intent,
          access.preferences,
        ));
      const binding = planned.record_projection_bindings.views.find(
        (view) => view.result_view_id === input.result_view_id,
      );
      const allowedMetrics = new Set(
        Object.values(binding?.metrics ?? {}).map((metric) => metric.metric_id),
      );
      const allowedDimensions = new Set(
        Object.values(binding?.dimensions ?? {}).map((dimension) => dimension.dimension_id),
      );
      if (!allowedMetrics.has(input.metric_id)) {
        throw new RecordProjectionRequestError("当前指标不提供构成记录");
      }
      const coordinateIds = input.coordinates.map((coordinate) => coordinate.dimension_id);
      if (
        coordinateIds.length !== allowedDimensions.size ||
        new Set(coordinateIds).size !== coordinateIds.length ||
        coordinateIds.some((id) => !allowedDimensions.has(id))
      ) {
        throw new RecordProjectionRequestError("明细坐标与当前报告不一致，请刷新后重试");
      }

      const compilerCatalog = planned.access.compiler;
      const source = planMetricRecordProjection(compilerCatalog, semanticView, input.metric_id);
      if (!source) throw new RecordProjectionRequestError("当前指标没有可用的构成记录来源");
      const metric = catalogMember(compilerCatalog, input.metric_id, "measure");
      const metricBinding = metric?.available_in.find((item) => item.view === source.view);
      if (!metric || !metricBinding) {
        throw new RecordProjectionRequestError("当前指标在该报告中已不可用");
      }

      const { cubeContext, views: authViews, timeContext: context } = planned.access;
      const sourceView = authViews.find((view) => view.name === source.view);
      if (!sourceView) throw new RecordProjectionRequestError("当前身份无权查看该指标的明细");
      const target = resolveRecordProjectionTarget(sourceView, metricBinding.member);
      if (!target) throw new Error("当前指标的构成记录契约不可用");
      const coordinateFilters: CubeFilter[] = input.coordinates.map((coordinate) => {
        const dimension = catalogMember(compilerCatalog, coordinate.dimension_id, "dimension");
        const physical = dimension?.available_in.find((item) => item.view === source.view)?.member;
        if (!physical) {
          throw new RecordProjectionRequestError(
            `分组「${dimension?.title ?? "未知字段"}」无法用于该明细`,
          );
        }
        return coordinate.value === null
          ? { member: physical, operator: "notSet" }
          : {
              member: physical,
              operator: "equals",
              values: [String(coordinate.value)],
            };
      });
      const timeCoordinate =
        input.time_coordinate ??
        directTimeCoordinate({
          sourceFilters: source.query.filters,
          sourceTime: source.query.time,
          target,
          context,
          authViews,
        });
      const remaining = RECORD_PROJECTION_MAX_ROWS - input.offset;
      const pageSize = Math.min(input.limit, remaining);
      const baseFilters: CubeFilter[] = [
        ...(source.query.filters ?? []),
        ...coordinateFilters,
        { member: target.member, operator: "gt", values: ["0"] },
      ];
      const { displayFields, resolved, page, moreRowsExist } = await executeRecordProjection({
        cube: deps.cube,
        cubeContext,
        authViews,
        sourceView: source.view,
        target,
        records: target.records,
        filters: baseFilters,
        timeCoordinate,
        context,
        offset: input.offset,
        pageSize,
      });
      const limitReached =
        input.offset + page.length >= RECORD_PROJECTION_MAX_ROWS && moreRowsExist;
      const qualifiedFields = displayFields.map((field) => qualify(source.view, field.member));
      const columns = qualifiedFields.map(
        (member, index) =>
          displayFields[index]?.title ??
          memberDisplayTitle(
            authViews,
            member,
            resolved.annotation.dimensions[member]?.title ?? memberShortName(member),
          ),
      );
      const payload: RecordProjectionPayload = {
        metric_id: input.metric_id,
        metric_title: metric.title,
        record_set_title: target.records.title,
        record_set_description: target.records.description,
        columns,
        column_keys: displayFields.map((field) => field.member),
        rows: page.map((row) =>
          qualifiedFields.map((member) => (row[member] ?? null) as string | number | null),
        ),
        offset: input.offset,
        page_size: input.limit,
        has_more: moreRowsExist && !limitReached,
        ...(limitReached ? { limit_reached: true as const } : {}),
        data_as_of: context.dataAsOf,
        data_changed: input.data_as_of ? context.dataAsOf !== input.data_as_of : false,
      };
      await deps.audit.log({
        ...auditBase,
        row_count: payload.rows.length,
        outcome: "ok",
      });
      return payload;
    } catch (error) {
      await deps.audit.log({
        ...auditBase,
        outcome: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async function runReport(
    principal: Principal,
    reportId: string,
    input: RecordProjectionRequestBody,
  ) {
    return runWithContext(
      principal,
      { kind: "report", id: reportId, revision: input.revision },
      input,
      async () => ({ access: await ownedContext(principal, reportId) }),
    );
  }

  async function runBoard(
    principal: Principal,
    boardId: string,
    reportId: string,
    input: RecordProjectionRequestBody,
    timeOverride?: TimeIntent,
  ) {
    return runWithContext(
      principal,
      { kind: "board", id: boardId, reference_id: reportId, revision: input.revision },
      input,
      async () => ({ access: await boardContext(boardId, reportId, timeOverride) }),
    );
  }

  async function runAnalysis(
    principal: Principal,
    viewId: string,
    options: {
      metricId?: string;
      offset?: number;
      limit?: number;
      dataAsOf?: string;
    } = {},
  ): Promise<RecordProjectionPayload> {
    const current = await deps.analyses.resolveOwnedView(principal, viewId);
    const access = {
      revision: 1,
      definition: current.analysis.definition,
      intent: current.view.intent,
      preferences: current.view.preferences,
    };
    const planned = await deps.semanticPlanning.plan(
      principal,
      access.definition,
      access.intent,
      access.preferences,
    );
    const request = directRequest(access.definition, planned, options);
    return runWithContext(
      principal,
      { kind: "analysis", id: viewId, revision: 1 },
      request,
      async () => ({ access, planned }),
    );
  }

  return { runAnalysis, runReport, runBoard };
}

export type RecordProjectionService = ReturnType<typeof createRecordProjectionService>;
