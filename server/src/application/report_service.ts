import type { Principal } from "../engine/cube_security.js";
import type { AnalysisService } from "./analysis_service.js";
import type { PresentationService } from "./presentation_service.js";
import type { AnalysisRepository, OwnedAnalysisView } from "../ports/analysis_repository.js";
import type { UsageLog } from "../ports/usage_log.js";
import type { RenderShape } from "../presentation_core/render_shape.js";
import {
  semanticResultViewId,
  type AnalysisDefinition,
  type SemanticViewIntent,
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
import type { ViewPreferences } from "../presentation_core/view_preferences.js";

/** Report 元数据与当前 View 的读取投影；定义与视图只物化在各自事实表。 */
export type ReportDocument = ReportRecord & {
  analysis_id: string;
  definition: AnalysisDefinition;
  intent: SemanticViewIntent;
  view_preferences: ViewPreferences;
};

export function createReportService(deps: {
  reports: ReportRepository;
  analyses: AnalysisRepository;
  execution: Pick<AnalysisService, "executeReferenced">;
  presentation: Pick<PresentationService, "renderShape">;
  semanticPlanning: SemanticPlanningService;
  usage: Pick<UsageLog, "log">;
}) {
  async function identity(report: ReportRecord): Promise<OwnedAnalysisView> {
    const view = await deps.analyses.getView(report.view_id);
    if (!view) throw new Error(`报告引用的视图不存在：${report.view_id}`);
    const analysis = await deps.analyses.getAnalysis(view.analysis_id);
    if (!analysis) throw new Error(`报告引用的分析不存在：${view.analysis_id}`);
    return { analysis, view };
  }

  async function document(report: ReportRecord): Promise<ReportDocument> {
    const current = await identity(report);
    return {
      ...report,
      analysis_id: current.analysis.id,
      definition: current.analysis.definition,
      intent: current.view.intent,
      view_preferences: current.view.preferences,
    };
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
    view_id: report.view_id,
    result_view_id: semanticResultViewId(report.definition),
    presentation_type: report.intent.type,
    revision: report.revision,
    updated_at: report.updated_at,
  });

  async function save(input: {
    principal: Principal;
    viewId: string;
    name: string;
  }): Promise<ReportDocument> {
    const started = performance.now();
    const current = await deps.analyses.resolveOwnedView(input.viewId, input.principal.email);
    const report = await document(
      await deps.reports.create({
        owner: input.principal.email,
        name: input.name,
        viewId: input.viewId,
      }),
    );
    await deps.usage.log({
      caller: input.principal.email,
      tool: "save_report",
      title: report.name,
      args: { view_id: input.viewId, name: input.name },
      outcome: "ok",
      duration_ms: performance.now() - started,
      analysis_id: current.analysis.id,
      view_id: input.viewId,
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
    } else if (action.type === "replace_view") {
      await deps.reports.resolveOwned(id, principal.email);
      await deps.analyses.resolveOwnedView(action.view_id, principal.email);
      report = await document(
        await deps.reports.update(
          id,
          principal.email,
          {
            viewId: action.view_id,
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
      analysis_id: report.analysis_id,
      view_id: report.view_id,
    });
    return report;
  }

  async function cacheRenderShape(report: ReportRecord, shape: RenderShape | null): Promise<void> {
    await deps.reports.cacheRenderShape(report.id, report.view_id, shape);
  }

  async function runRecord(
    principal: Principal,
    report: ReportDocument,
    timeOverride?: TimeIntent,
  ) {
    const current = await identity(report);
    const overridden = timeOverride
      ? applyBoardTimeOverride(current.analysis.definition, timeOverride)
      : {
          definition: current.analysis.definition,
          status: undefined as BoardTimeOverrideStatus | undefined,
        };
    const compiled = await deps.semanticPlanning.compile(
      principal,
      overridden.definition,
      current.view.intent,
      current.view.preferences,
    );
    const effectiveIdentity: OwnedAnalysisView = {
      analysis: { ...current.analysis, definition: overridden.definition },
      view: current.view,
    };
    const executed = await deps.execution.executeReferenced(
      principal,
      effectiveIdentity,
      compiled,
      report.id,
    );
    if (principal.email === report.owner && !timeOverride) {
      await cacheRenderShape(report, deps.presentation.renderShape(executed));
    }
    return {
      report:
        timeOverride && overridden.status === "applied"
          ? { ...report, definition: overridden.definition }
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
