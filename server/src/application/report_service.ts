import type { Principal } from "../contracts/principal.js";
import type { AnalysisService } from "./analysis_service.js";
import type { PresentationService } from "./presentation_service.js";
import type { AnalysisRepository, OwnedAnalysisView } from "../ports/analysis_repository.js";
import type { UsageService } from "./usage_service.js";
import type { RenderShape } from "../presentation_core/render_shape.js";
import {
  semanticResultViewId,
  type AnalysisDefinition,
  type SemanticViewIntent,
} from "../semantic_core/semantic_analysis.js";
import type { TimeIntent } from "../semantic_core/time_contract.js";
import type { SemanticPlanningService } from "./semantic_planning_service.js";
import { REPORT_UPDATE_ACTION, type ReportUpdateAction } from "../contracts/report_action.js";
import { REPORT_NAME_SCHEMA } from "../contracts/report_identity.js";
import {
  ReportNotFoundError,
  type ReportListScope,
  type ReportRecord,
  type ReportRepository,
  type ReportRevision,
} from "../ports/report_repository.js";
import { applyBoardTimeOverride, type BoardTimeOverrideStatus } from "./board_time_override.js";
import type { ViewPreferences } from "../presentation_core/view_preferences.js";
import { InvalidRequestError } from "./errors.js";

/** Report 元数据与当前 View 的读取投影；定义与视图只物化在各自事实表。 */
export type ReportDocument = ReportRecord & {
  analysis_id: string;
  definition: AnalysisDefinition;
  intent: SemanticViewIntent;
  view_preferences: ViewPreferences;
};

type ResolvedReport = {
  report: ReportDocument;
  identity: OwnedAnalysisView;
};

export function createReportService(deps: {
  reports: ReportRepository;
  analyses: AnalysisRepository;
  execution: Pick<AnalysisService, "executeReferenced">;
  presentation: Pick<PresentationService, "renderShape">;
  semanticPlanning: SemanticPlanningService;
  usage: Pick<UsageService, "log">;
}) {
  function reportName(value: string): string {
    const parsed = REPORT_NAME_SCHEMA.safeParse(value);
    if (!parsed.success) throw new InvalidRequestError("报告名称不能为空且最长 100 个字符");
    return parsed.data;
  }

  async function identity(report: ReportRecord): Promise<OwnedAnalysisView> {
    const view = await deps.analyses.getView(report.view_id);
    if (!view) throw new Error(`报告引用的视图不存在：${report.view_id}`);
    const analysis = await deps.analyses.getAnalysis(view.analysis_id);
    if (!analysis) throw new Error(`报告引用的分析不存在：${view.analysis_id}`);
    return { analysis, view };
  }

  function document(report: ReportRecord, current: OwnedAnalysisView): ReportDocument {
    return {
      ...report,
      analysis_id: current.analysis.id,
      definition: current.analysis.definition,
      intent: current.view.intent,
      view_preferences: current.view.preferences,
    };
  }

  async function resolve(report: ReportRecord): Promise<ResolvedReport> {
    const current = await identity(report);
    return { report: document(report, current), identity: current };
  }

  async function get(id: string): Promise<ReportDocument | null> {
    const report = await deps.reports.get(id);
    return report ? (await resolve(report)).report : null;
  }

  async function resolveOwned(principal: Principal, id: string): Promise<ReportDocument> {
    return (await resolve(await deps.reports.resolveOwned(id, principal.email))).report;
  }

  async function ensureOwned(principal: Principal, id: string): Promise<void> {
    await deps.reports.resolveOwned(id, principal.email);
  }

  async function listOwned(
    principal: Principal,
    query?: string,
    scope: ReportListScope = "active",
  ): Promise<ReportDocument[]> {
    return Promise.all(
      (await deps.reports.listOwned(principal.email, query, scope)).map(
        async (report) => (await resolve(report)).report,
      ),
    );
  }

  async function listRevisions(principal: Principal, id: string): Promise<ReportRevision[]> {
    return deps.reports.listRevisions(id, principal.email);
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
    const report = document(
      await deps.reports.create({
        owner: input.principal.email,
        name: reportName(input.name),
        viewId: input.viewId,
      }),
      current,
    );
    await deps.usage.log({
      caller: input.principal.email,
      tool: "save_report",
      title: report.name,
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
    const parsedAction = REPORT_UPDATE_ACTION.safeParse(action);
    if (!parsedAction.success) throw new InvalidRequestError("报告修改动作无效");
    const normalizedAction = parsedAction.data;
    let report: ReportDocument;
    if (normalizedAction.type === "rename") {
      report = (
        await resolve(
          await deps.reports.update(
            id,
            principal.email,
            { name: normalizedAction.name },
            ifRevision,
          ),
        )
      ).report;
    } else if (normalizedAction.type === "replace_view") {
      await deps.reports.resolveOwned(id, principal.email);
      await deps.analyses.resolveOwnedView(normalizedAction.view_id, principal.email);
      report = (
        await resolve(
          await deps.reports.update(
            id,
            principal.email,
            {
              viewId: normalizedAction.view_id,
              ...(normalizedAction.name !== undefined ? { name: normalizedAction.name } : {}),
            },
            ifRevision,
          ),
        )
      ).report;
    } else if (normalizedAction.type === "restore") {
      report = (
        await resolve(
          await deps.reports.restore(id, principal.email, normalizedAction.revision, ifRevision),
        )
      ).report;
    } else {
      const archivedAt = normalizedAction.type === "archive" ? new Date().toISOString() : null;
      report = (
        await resolve(await deps.reports.update(id, principal.email, { archivedAt }, ifRevision))
      ).report;
    }
    await deps.usage.log({
      caller: principal.email,
      tool: "update_report",
      title: report.name,
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
    resolved: ResolvedReport,
    timeOverride?: TimeIntent,
  ) {
    const { report, identity: current } = resolved;
    const overridden = timeOverride
      ? applyBoardTimeOverride(current.analysis.definition, timeOverride)
      : {
          definition: current.analysis.definition,
          status: undefined as BoardTimeOverrideStatus | undefined,
        };
    const planned = await deps.semanticPlanning.plan(
      principal,
      overridden.definition,
      current.view.intent,
      current.view.preferences,
    );
    const effectiveIdentity: OwnedAnalysisView = {
      analysis: { ...current.analysis, definition: overridden.definition },
      view: current.view,
    };
    const executed = await deps.execution.executeReferenced(principal, effectiveIdentity, planned);
    if (principal.email === report.owner && !timeOverride) {
      await cacheRenderShape(report, deps.presentation.renderShape(executed));
    }
    return {
      report:
        timeOverride && overridden.status === "applied"
          ? { ...report, definition: overridden.definition }
          : report,
      executed,
      ...(overridden.status ? { time_override: overridden.status } : {}),
    };
  }

  async function runOwned(principal: Principal, id: string) {
    return runRecord(
      principal,
      await resolve(await deps.reports.resolveOwned(id, principal.email)),
    );
  }

  async function runShared(principal: Principal, id: string, timeOverride?: TimeIntent) {
    const record = await deps.reports.get(id);
    if (!record) throw new ReportNotFoundError("报告不存在");
    return runRecord(principal, await resolve(record), timeOverride);
  }

  return {
    get,
    resolveOwned,
    ensureOwned,
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
