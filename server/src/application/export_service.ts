import type { ExportAuditEvent } from "../ports/export_audit.js";
import type { ExportTicketRepository } from "../ports/export_ticket_repository.js";
import { completeHierarchy } from "../engine/hierarchy.js";
import { filterMembers } from "../engine/query_contract.js";
import { publicTimeContext, timeSourced, viewsForMembers } from "./time_context.js";
import { EXPORT_MAX_ROWS, type MaterializedExport } from "../engine/export.js";
import { cubeSecurityContext, type Principal } from "../engine/cube_security.js";
import type { CubeGateway, CubeQuery, CubeSecurityContext } from "../ports/cube_gateway.js";
import { assertMeasureFilterCompatibility } from "../engine/query_contract.js";
import { prepareMetricQueryExecution } from "../engine/metric_executor.js";
import type { MetricQueryPlan } from "../engine/metric_planner.js";
import { exportableOutput } from "../semantic_core/execution_plan.js";
import type { AnalysisRepository } from "../ports/analysis_repository.js";
import type { UsageLog } from "../ports/usage_log.js";
import type { SemanticPlanningService } from "./semantic_planning_service.js";
import { EXPORT_RESOURCE_MIME_TYPE, exportResourceUri } from "../contracts/export_contract.js";
import type { ExportLink, ExportResourceLink } from "../semantic_core/query_payload.js";

export class ExportTicketUnavailableError extends Error {
  override name = "ExportTicketUnavailableError";
}

export class ExportIncompleteError extends Error {
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
  analyses: Pick<AnalysisRepository, "resolveOwned">;
  semanticPlanning: Pick<SemanticPlanningService, "compile">;
  usage: Pick<UsageLog, "log">;
  cube: CubeGateway;
  tickets: ExportTicketRepository<MetricQueryPlan>;
  baseUrl: string;
  audit: (event: ExportAuditEvent) => Promise<void>;
  runExport: (
    plan: MetricQueryPlan,
    securityContext: CubeSecurityContext,
  ) => Promise<MaterializedExport>;
}) {
  async function createDelivery(
    plan: MetricQueryPlan,
    caller: string,
    securityContext: CubeSecurityContext,
  ): Promise<ExportDelivery> {
    const ticket = await deps.tickets.create(plan, caller, securityContext);
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

  async function materialize(claims: {
    plan: MetricQueryPlan;
    caller: string;
    securityContext: CubeSecurityContext;
  }) {
    try {
      const result = await deps.runExport(claims.plan, claims.securityContext);
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

  async function download(ticket: string) {
    return materialize(await resolve(ticket));
  }

  async function readResource(principal: Principal, ticket: string) {
    const claims = await resolve(ticket);
    if (claims.caller !== principal.email) {
      throw new ExportTicketUnavailableError("下载资源无效、已过期或不属于当前用户，请重新查询。");
    }
    return materialize(claims);
  }

  async function exportResult(principal: Principal, requestedAnalysisId: string) {
    const started = performance.now();
    let analysisId: string | undefined;
    try {
      const analysis = await deps.analyses.resolveOwned(requestedAnalysisId, principal.email);
      analysisId = analysis.id;
      const semanticSpec = analysis.spec;
      const executionPlan = (await deps.semanticPlanning.compile(principal, semanticSpec)).plan;
      const view = exportableOutput(executionPlan);
      if (!view) {
        throw new Error("该分析结果不支持导出底层明细（组合或派生结果无底层明细可导）");
      }
      const cubeContext = cubeSecurityContext(principal);
      const authViews = await deps.cube.meta(cubeContext);
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
      assertMeasureFilterCompatibility(query, authViews);
      const shaped = completeHierarchy(query, authViews).query;
      const context = await deps.cube.timeContext();
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
      const { link } = await createDelivery(plan, principal.email, cubeContext);
      const members = [
        ...(view.measures ?? []),
        ...(view.dimensions ?? []),
        ...filterMembers(view.filters),
        ...(order ?? []).map(([member]) => member),
      ];
      const payload = {
        analysis_id: analysisId,
        ...link,
        max_rows: EXPORT_MAX_ROWS,
        data_as_of: context.dataAsOf,
        time_context: publicTimeContext(timeSourced(viewsForMembers(authViews, members)), context),
      };
      await deps.usage.log({
        caller: principal.email,
        tool: "export_result",
        args: { analysis_id: requestedAnalysisId },
        outcome: "ok",
        duration_ms: performance.now() - started,
        ...(analysisId ? { analysis_id: analysisId } : {}),
      });
      return payload;
    } catch (error) {
      await deps.usage.log({
        caller: principal.email,
        tool: "export_result",
        args: { analysis_id: requestedAnalysisId },
        outcome: "error",
        error: error instanceof Error ? error.message : String(error),
        duration_ms: performance.now() - started,
        ...(analysisId ? { analysis_id: analysisId } : {}),
      });
      throw error;
    }
  }

  return { createDelivery, exportResult, download, readResource };
}

export type ExportService = ReturnType<typeof createExportService>;
