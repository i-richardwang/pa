import type { Principal } from "../engine/cube_security.js";
import type { AnalysisService } from "./analysis_service.js";
import type { PresentationService } from "./presentation_service.js";
import type { AnalysisRepository } from "../ports/analysis_repository.js";
import type { UsageLog } from "../ports/usage_log.js";
import type { RenderShape } from "../presentation_core/render_shape.js";
import {
  semanticPresentationType,
  semanticResultViewId,
  type SemanticAnalysisSpec,
} from "../semantic_core/semantic_analysis.js";
import type { TimeIntent } from "../semantic_core/time_contract.js";
import type { SemanticPlanningService } from "./semantic_planning_service.js";
import type { ReportUpdateAction } from "../contracts/report_action.js";
import {
  ReportNotFoundError,
  type ReportRecord,
  type ReportRepository,
  type ReportRevision,
} from "../ports/report_repository.js";
import { applyBoardTimeOverride, type BoardTimeOverrideStatus } from "./board_time_override.js";

/** Report 元数据与其当前 Analysis 值的读取投影；spec 仍只物化在 analysis 表。 */
export type ReportDocument = ReportRecord & { spec: SemanticAnalysisSpec };

export function createReportService(deps: {
  reports: ReportRepository;
  analyses: AnalysisRepository;
  execution: Pick<AnalysisService, "executeReferenced">;
  presentation: Pick<PresentationService, "renderShape">;
  semanticPlanning: SemanticPlanningService;
  usage: Pick<UsageLog, "log">;
}) {
  async function document(report: ReportRecord): Promise<ReportDocument> {
    const analysis = await deps.analyses.get(report.analysis_id);
    if (!analysis) throw new Error(`报告引用的分析不存在：${report.analysis_id}`);
    return { ...report, spec: analysis.spec };
  }

  async function get(id: string): Promise<ReportDocument | null> {
    const report = await deps.reports.get(id);
    return report ? document(report) : null;
  }

  async function resolveOwned(id: string, owner: string): Promise<ReportDocument> {
    return document(await deps.reports.resolveOwned(id, owner));
  }

  async function listOwned(
    owner: string,
    query?: string,
    includeArchived = false,
  ): Promise<ReportDocument[]> {
    return Promise.all((await deps.reports.listOwned(owner, query, includeArchived)).map(document));
  }

  async function listRevisions(id: string, owner: string): Promise<ReportRevision[]> {
    return deps.reports.listRevisions(id, owner);
  }

  const summary = (report: ReportDocument) => ({
    id: report.id,
    name: report.name,
    analysis_id: report.analysis_id,
    result_view_id: semanticResultViewId(report.spec),
    presentation_type: semanticPresentationType(report.spec),
    revision: report.revision,
    updated_at: report.updated_at,
  });

  async function save(input: {
    principal: Principal;
    analysisId: string;
    name: string;
  }): Promise<ReportDocument> {
    await deps.analyses.resolveOwned(input.analysisId, input.principal.email);
    const report = await document(
      await deps.reports.create({
        owner: input.principal.email,
        name: input.name,
        analysisId: input.analysisId,
      }),
    );
    await deps.usage.log({
      caller: input.principal.email,
      tool: "save_report",
      title: report.name,
      args: { analysis_id: input.analysisId, name: input.name },
      outcome: "ok",
      duration_ms: 0,
      analysis_id: input.analysisId,
    });
    return report;
  }

  async function update(
    principal: Principal,
    id: string,
    action: ReportUpdateAction,
    ifRevision?: number,
  ): Promise<ReportDocument> {
    const started = performance.now();
    let report: ReportDocument;
    if (action.type === "rename") {
      report = await document(
        await deps.reports.update(id, principal.email, { name: action.name }, ifRevision),
      );
    } else if (action.type === "replace_analysis") {
      await deps.reports.resolveOwned(id, principal.email);
      await deps.analyses.resolveOwned(action.analysis_id, principal.email);
      report = await document(
        await deps.reports.update(
          id,
          principal.email,
          {
            analysisId: action.analysis_id,
            ...(action.name !== undefined ? { name: action.name } : {}),
          },
          ifRevision,
        ),
      );
    } else if (action.type === "restore") {
      report = await document(
        await deps.reports.restore(id, principal.email, action.revision, ifRevision),
      );
    } else {
      report = await document(
        await deps.reports.update(
          id,
          principal.email,
          { archivedAt: new Date().toISOString() },
          ifRevision,
        ),
      );
    }
    await deps.usage.log({
      caller: principal.email,
      tool: "update_report",
      title: report.name,
      args: {
        source: "editor",
        action: action.type,
        ...(action.type === "restore" ? { revision: action.revision } : {}),
        ...(ifRevision === undefined ? {} : { if_revision: ifRevision }),
      },
      outcome: "ok",
      duration_ms: performance.now() - started,
    });
    return report;
  }

  async function cacheRenderShape(report: ReportRecord, shape: RenderShape | null): Promise<void> {
    await deps.reports.cacheRenderShape(report.id, report.analysis_id, shape);
  }

  async function runRecord(
    principal: Principal,
    report: ReportDocument,
    timeOverride?: TimeIntent,
  ) {
    const analysis = await deps.analyses.get(report.analysis_id);
    if (!analysis) throw new Error(`报告引用的分析不存在：${report.analysis_id}`);
    const overridden = timeOverride
      ? applyBoardTimeOverride(analysis.spec, timeOverride)
      : { spec: analysis.spec, status: undefined as BoardTimeOverrideStatus | undefined };
    const compiled = await deps.semanticPlanning.compile(principal, overridden.spec);
    const executed = await deps.execution.executeReferenced(
      principal,
      analysis,
      compiled,
      report.id,
    );
    // 板级覆盖是阅读参数，不回写属主缓存的呈现形态。
    if (principal.email === report.owner && !timeOverride) {
      await cacheRenderShape(report, deps.presentation.renderShape(executed));
    }
    return {
      report:
        timeOverride && overridden.status === "applied"
          ? { ...report, spec: overridden.spec }
          : report,
      executed,
      presentation: compiled.presentation,
      recordProjectionBindings: compiled.record_projection_bindings,
      ...(overridden.status ? { time_override: overridden.status } : {}),
    };
  }

  async function runOwned(principal: Principal, id: string) {
    return runRecord(principal, await resolveOwned(id, principal.email));
  }

  async function runShared(principal: Principal, id: string, timeOverride?: TimeIntent) {
    const report = await get(id);
    if (!report) throw new ReportNotFoundError("报告不存在");
    return runRecord(principal, report, timeOverride);
  }

  return {
    get,
    resolveOwned,
    listOwned,
    listRevisions,
    summary,
    save,
    update,
    cacheRenderShape,
    runOwned,
    runShared,
  };
}

export type ReportService = ReturnType<typeof createReportService>;
