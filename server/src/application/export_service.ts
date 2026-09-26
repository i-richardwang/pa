import type { ExportAuditEvent } from "../ports/export_audit.js";
import type { ExportTicketRepository } from "../ports/export_ticket_repository.js";
import { completeHierarchy } from "../engine/hierarchy.js";
import { filterMembers } from "../engine/query_contract.js";
import { publicTimeContext, timeSourced, viewsForMembers } from "./time_context.js";
import { EXPORT_MAX_ROWS, type MaterializedExport } from "../engine/export.js";
import type { Principal } from "../contracts/principal.js";
import { cubeSecurityContext } from "../engine/cube_security.js";
import type { CubeGateway, CubeQuery, CubeSecurityContext } from "../ports/cube_gateway.js";
import { assertPhysicalQueryInvariants } from "../engine/query_contract.js";
import { prepareMetricQueryExecution } from "../engine/metric_executor.js";
import type { MetricQueryPlan } from "../engine/metric_planner.js";
import { exportableOutput } from "../semantic_core/execution_plan.js";
import type { AnalysisRepository } from "../ports/analysis_repository.js";
import type { UsageService } from "./usage_service.js";
import type { SemanticPlanningService } from "./semantic_planning_service.js";
import { EXPORT_RESOURCE_MIME_TYPE, exportResourceUri } from "../contracts/export_contract.js";
import type { ExportLink, ExportResourceLink } from "../semantic_core/query_payload.js";
import { LimitExceededError, NotFoundError } from "./errors.js";

export class ExportTicketUnavailableError extends NotFoundError {
  override name = "ExportTicketUnavailableError";
}

export class ExportIncompleteError extends LimitExceededError {
  override name = "ExportIncompleteError";

  constructor(readonly rowCount: number) {
    super(`结果达到导出上限（${rowCount} 行），完整性无法确认`);
  }
}

type ExportDelivery = {
  link: ExportLink;
  resource: ExportResourceLink;
};

export function createExportService(deps: {
  analyses: Pick<AnalysisRepository, "resolveOwnedView">;
  semanticPlanning: Pick<SemanticPlanningService, "plan">;
  usage: Pick<UsageService, "log">;
  cube: CubeGateway;
  tickets: ExportTicketRepository<MetricQueryPlan>;
  baseUrl: string;
  audit: (event: ExportAuditEvent) => Promise<void>;
  runExport: (
    plan: MetricQueryPlan,
    securityContext: CubeSecurityContext,
  ) => Promise<MaterializedExport>;
}) {
  async function createDelivery(plan: MetricQueryPlan, caller: string): Promise<ExportDelivery> {
    const ticket = await deps.tickets.create(plan, caller);
    await deps.audit({ event: "export_created", caller, query: plan });
    return {
      link: {
        url: `${deps.baseUrl}/export/${ticket.id}`,
        expires_at: ticket.expires_at,
      },
      resource: {
        type: "resource_link",
        uri: exportResourceUri(ticket.id),
        name: "pa_export.csv",
        mimeType: EXPORT_RESOURCE_MIME_TYPE,
      },
    };
  }

  async function materialize(
    claims: { plan: MetricQueryPlan; caller: string },
    principal: Principal,
  ) {
    if (claims.caller !== principal.email) {
      throw new ExportTicketUnavailableError("下载资源无效、已过期或不属于当前用户，请重新查询。");
    }
    const securityContext = cubeSecurityContext(principal);
    try {
      const result = await deps.runExport(claims.plan, securityContext);
      if (!result.complete) {
        await deps
          .audit({
            event: "export_failed",
            caller: claims.caller,
            query: claims.plan,
            row_count: result.rowCount,
          })
          .catch(() => {});
        throw new ExportIncompleteError(result.rowCount);
      }
      await deps.audit({
        event: "export_downloaded",
        caller: claims.caller,
        query: claims.plan,
        row_count: result.rowCount,
      });
      return { csv: result.csv, rowCount: result.rowCount, asOf: result.asOf };
    } catch (error) {
      if (!(error instanceof ExportIncompleteError)) {
        await deps
          .audit({ event: "export_failed", caller: claims.caller, query: claims.plan })
          .catch(() => {});
      }
      throw error;
    }
  }

  async function resolve(ticket: string) {
    const claims = await deps.tickets.resolve(ticket);
    if (!claims) {
      throw new ExportTicketUnavailableError("下载资源无效或已过期，请重新查询。");
    }
    return claims;
  }

  async function readResource(principal: Principal, ticket: string) {
    const claims = await resolve(ticket);
    return materialize(claims, principal);
  }

  async function exportResult(principal: Principal, requestedViewId: string) {
    const started = performance.now();
    let analysisId: string | undefined;
    let viewId: string | undefined;
    try {
      const current = await deps.analyses.resolveOwnedView(requestedViewId, principal.email);
      analysisId = current.analysis.id;
      viewId = current.view.id;
      const planned = await deps.semanticPlanning.plan(
        principal,
        current.analysis.definition,
        current.view.intent,
        current.view.preferences,
      );
      const executionPlan = planned.plan;
      const view = exportableOutput(executionPlan);
      if (!view) {
        throw new Error("该分析结果包含报告计算或派生列，暂不支持导出");
      }
      const {
        cubeContext,
        views: authViews,
        timeContext: context,
        time_sources: timeSources,
      } = planned.access;
      const order = view.order?.map(({ member, direction }): [string, "asc" | "desc"] => [
        member,
        direction,
      ]);
      const query: CubeQuery = {
        measures: view.measures,
        dimensions: view.dimensions,
        filters: view.filters,
        order,
      };
      assertPhysicalQueryInvariants(query, authViews);
      const shaped = completeHierarchy(query, authViews).query;
      const { plan } = await prepareMetricQueryExecution({
        cube: deps.cube,
        query: shaped,
        time: view.time,
        context,
        views: authViews,
        securityContext: cubeContext,
        timeView: view.time_view,
        selection: view.selection,
      });
      const { link } = await createDelivery(plan, principal.email);
      const members = [
        ...(view.measures ?? []),
        ...(view.dimensions ?? []),
        ...filterMembers(view.filters),
        ...(order ?? []).map(([member]) => member),
      ];
      const payload = {
        analysis_id: analysisId,
        view_id: viewId,
        ...link,
        max_rows: EXPORT_MAX_ROWS,
        data_as_of: context.dataAsOf,
        time_context: publicTimeContext(
          timeSourced(viewsForMembers(authViews, members)),
          context,
          timeSources,
        ),
      };
      await deps.usage.log({
        caller: principal.email,
        tool: "export_result",
        outcome: "ok",
        duration_ms: performance.now() - started,
        ...(analysisId ? { analysis_id: analysisId } : {}),
        ...(viewId ? { view_id: viewId } : {}),
      });
      return payload;
    } catch (error) {
      await deps.usage.log({
        caller: principal.email,
        tool: "export_result",
        outcome: "error",
        error: error instanceof Error ? error.message : String(error),
        duration_ms: performance.now() - started,
        ...(analysisId ? { analysis_id: analysisId } : {}),
        ...(viewId ? { view_id: viewId } : {}),
      });
      throw error;
    }
  }

  return { createDelivery, exportResult, readResource };
}

export type ExportService = ReturnType<typeof createExportService>;
