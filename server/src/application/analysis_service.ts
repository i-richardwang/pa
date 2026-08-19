import type { Principal } from "../contracts/principal.js";
import type { QueryRunResult } from "./query_pipeline.js";
import {
  parseAnalysisDefinition,
  parseSemanticViewIntent,
  type AnalysisDefinition,
  type SemanticViewIntent,
} from "../semantic_core/semantic_analysis.js";
import type {
  AnalysisRecord,
  AnalysisRepository,
  OwnedAnalysisView,
} from "../ports/analysis_repository.js";
import type { UsageLog } from "../ports/usage_log.js";
import type { RecordProjectionBindings } from "../contracts/record_projection_contract.js";
import {
  EMPTY_VIEW_PREFERENCES,
  validateViewPreferences,
  type ViewPreferences,
} from "../presentation_core/view_preferences.js";
import type { ChartDecl } from "../presentation_core/chart_decl.js";
import type { PresentationSpec } from "../presentation_core/presentation_spec.js";
import { derivedFormulaSummaries, queryFingerprint } from "../engine/query_fingerprint.js";
import type { AuthorizedAnalysisPlan } from "./semantic_planning_service.js";

/** Run 只消费编译工件，不认识持久化身份。 */
type ExecuteAnalysis = (planned: AuthorizedAnalysisPlan) => Promise<QueryRunResult>;

type PlanAnalysisView = (
  principal: Principal,
  definition: AnalysisDefinition,
  intent: SemanticViewIntent,
  preferences?: ViewPreferences,
) => Promise<AuthorizedAnalysisPlan>;

export type MaterializedAnalysisView = OwnedAnalysisView & {
  render_decl: ChartDecl;
  presentation: PresentationSpec;
  record_projection_bindings: RecordProjectionBindings;
};

/** 一次瞬态 Run 的结果；数据库只保存其 analysis/view 引用，不保存此对象。 */
export type ExecutedAnalysis = QueryRunResult & {
  analysis_id: string;
  view_id: string;
  definition: AnalysisDefinition;
  intent: SemanticViewIntent;
  preferences: ViewPreferences;
  presentation: PresentationSpec;
  record_projection_bindings: RecordProjectionBindings;
};

export function createAnalysisService(deps: {
  repository: AnalysisRepository;
  execute: ExecuteAnalysis;
  plan: PlanAnalysisView;
  usage: Pick<UsageLog, "log">;
}) {
  async function executeAndLog(input: {
    principal: Principal;
    definition: AnalysisDefinition;
    intent: SemanticViewIntent;
    preferences: ViewPreferences;
    planned: AuthorizedAnalysisPlan;
    tool: "run_analysis" | "rerun_analysis" | "report_replay" | "replay";
    analysis?: AnalysisRecord;
    identity?: OwnedAnalysisView;
    createIdentity: "analysis" | "view" | "none";
    usage: {
      query_fingerprint?: string;
      derived_formulas?: string[];
    };
  }): Promise<ExecutedAnalysis> {
    const started = performance.now();
    const title = input.definition.title;
    try {
      const result = await deps.execute(input.planned);
      const identity =
        input.createIdentity === "analysis"
          ? await deps.repository.create(
              input.principal.email,
              input.definition,
              input.intent,
              input.preferences,
            )
          : input.createIdentity === "view"
            ? await deps.repository.createView(
                input.principal.email,
                input.analysis?.id ?? input.identity?.analysis.id ?? "",
                input.intent,
                input.preferences,
              )
            : input.identity;
      if (!identity) throw new Error("执行结果缺少分析视图身份");
      const payload = {
        ...result.payload,
        analysis_id: identity.analysis.id,
        view_id: identity.view.id,
      };
      await deps.usage.log({
        caller: input.principal.email,
        tool: input.tool,
        ...(title ? { title } : {}),
        ...input.usage,
        outcome: "ok",
        row_count: payload.view.row_count,
        has_more: payload.view.has_more,
        duration_ms: performance.now() - started,
        analysis_id: identity.analysis.id,
        view_id: identity.view.id,
      });
      return {
        ...result,
        payload,
        analysis_id: identity.analysis.id,
        view_id: identity.view.id,
        definition: identity.analysis.definition,
        intent: identity.view.intent,
        preferences: identity.view.preferences,
        presentation: input.planned.presentation,
        record_projection_bindings: input.planned.record_projection_bindings,
      };
    } catch (error) {
      await deps.usage.log({
        caller: input.principal.email,
        tool: input.tool,
        ...(title ? { title } : {}),
        ...input.usage,
        outcome: "error",
        error: error instanceof Error ? error.message : String(error),
        duration_ms: performance.now() - started,
        ...(input.identity || input.analysis
          ? {
              analysis_id: input.analysis?.id ?? input.identity!.analysis.id,
              ...(input.identity ? { view_id: input.identity.view.id } : {}),
            }
          : {}),
      });
      throw error;
    }
  }

  async function run(
    principal: Principal,
    rawDefinition: AnalysisDefinition,
    rawIntent: SemanticViewIntent,
  ): Promise<ExecutedAnalysis> {
    const definition = parseAnalysisDefinition(rawDefinition);
    const intent = parseSemanticViewIntent(rawIntent);
    const preferences = EMPTY_VIEW_PREFERENCES;
    const planned = await deps.plan(principal, definition, intent, preferences);
    return executeAndLog({
      principal,
      definition,
      intent,
      preferences,
      planned,
      tool: "run_analysis",
      createIdentity: "analysis",
      usage: {
        query_fingerprint: queryFingerprint(definition),
        derived_formulas: derivedFormulaSummaries(definition),
      },
    });
  }

  async function rerun(
    principal: Principal,
    analysisId: string,
    rawIntent: SemanticViewIntent,
  ): Promise<ExecutedAnalysis> {
    const analysis = await deps.repository.resolveOwnedAnalysis(analysisId, principal.email);
    const intent = parseSemanticViewIntent(rawIntent);
    const preferences = EMPTY_VIEW_PREFERENCES;
    const planned = await deps.plan(principal, analysis.definition, intent, preferences);
    return executeAndLog({
      principal,
      definition: analysis.definition,
      intent,
      preferences,
      planned,
      tool: "rerun_analysis",
      analysis,
      createIdentity: "view",
      usage: {},
    });
  }

  async function materializeView(
    principal: Principal,
    analysisId: string,
    rawIntent: SemanticViewIntent,
    rawPreferences: ViewPreferences,
  ): Promise<MaterializedAnalysisView> {
    const analysis = await deps.repository.resolveOwnedAnalysis(analysisId, principal.email);
    const intent = parseSemanticViewIntent(rawIntent);
    const preferences = validateViewPreferences(intent, rawPreferences);
    const planned = await deps.plan(principal, analysis.definition, intent, preferences);
    const identity = await deps.repository.createView(
      principal.email,
      analysis.id,
      intent,
      preferences,
    );
    return {
      ...identity,
      render_decl: planned.render_decl,
      presentation: planned.presentation,
      record_projection_bindings: planned.record_projection_bindings,
    };
  }

  async function preview(
    principal: Principal,
    rawDefinition: AnalysisDefinition,
    rawIntent: SemanticViewIntent,
    rawPreferences: ViewPreferences,
  ): Promise<ExecutedAnalysis> {
    const definition = parseAnalysisDefinition(rawDefinition);
    const intent = parseSemanticViewIntent(rawIntent);
    const preferences = validateViewPreferences(intent, rawPreferences);
    const planned = await deps.plan(principal, definition, intent, preferences);
    return executeAndLog({
      principal,
      definition,
      intent,
      preferences,
      planned,
      tool: "run_analysis",
      createIdentity: "analysis",
      usage: {
        query_fingerprint: queryFingerprint(definition),
        derived_formulas: derivedFormulaSummaries(definition),
      },
    });
  }

  async function replay(principal: Principal, viewId: string): Promise<ExecutedAnalysis> {
    const identity = await deps.repository.resolveOwnedView(viewId, principal.email);
    const planned = await deps.plan(
      principal,
      identity.analysis.definition,
      identity.view.intent,
      identity.view.preferences,
    );
    return executeAndLog({
      principal,
      definition: identity.analysis.definition,
      intent: identity.view.intent,
      preferences: identity.view.preferences,
      planned,
      tool: "replay",
      identity,
      createIdentity: "none",
      usage: {},
    });
  }

  async function ensureOwned(principal: Principal, viewId: string): Promise<void> {
    await deps.repository.resolveOwnedView(viewId, principal.email);
  }

  async function executeReferenced(
    principal: Principal,
    identity: OwnedAnalysisView,
    planned: AuthorizedAnalysisPlan,
  ): Promise<ExecutedAnalysis> {
    return executeAndLog({
      principal,
      definition: identity.analysis.definition,
      intent: identity.view.intent,
      preferences: identity.view.preferences,
      planned,
      tool: "report_replay",
      identity,
      createIdentity: "none",
      usage: {},
    });
  }

  return {
    run,
    rerun,
    materializeView,
    preview,
    replay,
    ensureOwned,
    executeReferenced,
  };
}

export type AnalysisService = ReturnType<typeof createAnalysisService>;
