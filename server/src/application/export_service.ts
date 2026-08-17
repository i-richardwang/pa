import type { ExportAuditEvent } from "../ports/export_audit.js";
import { completeHierarchy } from "../engine/hierarchy.js";
import { filterMembers } from "../engine/query_contract.js";
import { publicTimeContext, timeSourced, viewsForMembers } from "./time_context.js";
import { EXPORT_MAX_ROWS, type ExportRuntime } from "../engine/export.js";
import { cubeSecurityContext, type Principal } from "../engine/cube_security.js";
import type { CubeGateway, CubeQuery } from "../ports/cube_gateway.js";
import { assertMeasureFilterCompatibility } from "../engine/query_contract.js";
import { prepareMetricQueryExecution } from "../engine/metric_executor.js";
import { exportableOutput } from "../semantic_core/execution_plan.js";
import type { AnalysisRepository } from "../ports/analysis_repository.js";
import type { UsageLog } from "../ports/usage_log.js";
import type { SemanticPlanningService } from "./semantic_planning_service.js";

export function createExportService(deps: {
  analyses: AnalysisRepository;
  semanticPlanning: Pick<SemanticPlanningService, "compile">;
  usage: Pick<UsageLog, "log">;
  cube: CubeGateway;
  exports: Pick<ExportRuntime, "createLink">;
  audit: (event: ExportAuditEvent) => Promise<void>;
}) {
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
      const link = await deps.exports.createLink(plan, principal.email, cubeContext);
      await deps.audit({
        event: "export_created",
        caller: principal.email,
        query: plan,
      });
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

  return { exportResult };
}
