import type { Principal } from "../engine/cube_security.js";
import type { QueryRunResult } from "./query_pipeline.js";
import type { ExecutionPlan } from "../semantic_core/execution_plan.js";
import type { PresentationSpec } from "../presentation_core/presentation_spec.js";
import {
  parseAnalysisDefinition,
  SEMANTIC_VIEW_INTENT_INPUT,
  type AnalysisDefinition,
  type SemanticViewIntent,
} from "../semantic_core/semantic_analysis.js";
import type { CompiledAnalysisView } from "../engine/semantic_analysis_compiler.js";
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
import type { ChartDecl } from "../presentation_core/view_shape.js";

/** Run 只消费编译工件，不认识持久化身份。 */
type ExecuteAnalysis = (
  principal: Principal,
  plan: ExecutionPlan,
  presentation: PresentationSpec,
) => Promise<QueryRunResult>;

type CompileAnalysisView = (
  principal: Principal,
  definition: AnalysisDefinition,
  intent: SemanticViewIntent,
  preferences?: ViewPreferences,
) => Promise<CompiledAnalysisView>;

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
  compile: CompileAnalysisView;
  usage: Pick<UsageLog, "log">;
}) {
  async function executeAndLog(input: {
    principal: Principal;
    definition: AnalysisDefinition;
    intent: SemanticViewIntent;
    preferences: ViewPreferences;
    compiled: CompiledAnalysisView;
    tool: "run_analysis" | "rerun_analysis" | "report_replay" | "replay";
    analysis?: AnalysisRecord;
    identity?: OwnedAnalysisView;
    createIdentity: "analysis" | "view" | "none";
    args: unknown;
  }): Promise<ExecutedAnalysis> {
    const started = performance.now();
    const title = input.definition.title;
    try {
      const result = await deps.execute(
        input.principal,
        input.compiled.plan,
        input.compiled.presentation,
      );
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
        args: input.args,
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
        presentation: input.compiled.presentation,
        record_projection_bindings: input.compiled.record_projection_bindings,
      };
    } catch (error) {
      await deps.usage.log({
        caller: input.principal.email,
        tool: input.tool,
        ...(title ? { title } : {}),
        args: input.args,
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
    const intent = SEMANTIC_VIEW_INTENT_INPUT.parse(rawIntent);
    const preferences = EMPTY_VIEW_PREFERENCES;
    const compiled = await deps.compile(principal, definition, intent, preferences);
    return executeAndLog({
      principal,
      definition,
      intent,
      preferences,
      compiled,
      tool: "run_analysis",
      createIdentity: "analysis",
      args: { analysis: definition, view: intent },
    });
  }

  async function rerun(
    principal: Principal,
    analysisId: string,
    rawIntent: SemanticViewIntent,
  ): Promise<ExecutedAnalysis> {
    const analysis = await deps.repository.resolveOwnedAnalysis(analysisId, principal.email);
    const intent = SEMANTIC_VIEW_INTENT_INPUT.parse(rawIntent);
    const preferences = EMPTY_VIEW_PREFERENCES;
    const compiled = await deps.compile(principal, analysis.definition, intent, preferences);
    return executeAndLog({
      principal,
      definition: analysis.definition,
      intent,
      preferences,
      compiled,
      tool: "rerun_analysis",
      analysis,
      createIdentity: "view",
      args: { analysis_id: analysisId, view: intent },
    });
  }

  async function materializeView(
    principal: Principal,
    analysisId: string,
    rawIntent: SemanticViewIntent,
    rawPreferences: ViewPreferences,
  ): Promise<MaterializedAnalysisView> {
    const analysis = await deps.repository.resolveOwnedAnalysis(analysisId, principal.email);
    const intent = SEMANTIC_VIEW_INTENT_INPUT.parse(rawIntent);
    const preferences = validateViewPreferences(intent, rawPreferences);
    const compiled = await deps.compile(principal, analysis.definition, intent, preferences);
    const identity = await deps.repository.createView(
      principal.email,
      analysis.id,
      intent,
      preferences,
    );
    return {
      ...identity,
      render_decl: compiled.render_decl,
      presentation: compiled.presentation,
      record_projection_bindings: compiled.record_projection_bindings,
    };
  }

  async function preview(
    principal: Principal,
    rawDefinition: AnalysisDefinition,
    rawIntent: SemanticViewIntent,
    rawPreferences: ViewPreferences,
    compiled?: CompiledAnalysisView,
  ): Promise<ExecutedAnalysis> {
    const definition = parseAnalysisDefinition(rawDefinition);
    const intent = SEMANTIC_VIEW_INTENT_INPUT.parse(rawIntent);
    const preferences = validateViewPreferences(intent, rawPreferences);
    const planned = compiled ?? (await deps.compile(principal, definition, intent, preferences));
    return executeAndLog({
      principal,
      definition,
      intent,
      preferences,
      compiled: planned,
      tool: "run_analysis",
      createIdentity: "analysis",
      args: { analysis: definition, source: "editor" },
    });
  }

  async function replay(principal: Principal, viewId: string): Promise<ExecutedAnalysis> {
    const identity = await deps.repository.resolveOwnedView(viewId, principal.email);
    const compiled = await deps.compile(
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
      compiled,
      tool: "replay",
      identity,
      createIdentity: "none",
      args: { view_id: viewId },
    });
  }

  async function ensureOwned(principal: Principal, viewId: string): Promise<void> {
    await deps.repository.resolveOwnedView(viewId, principal.email);
  }

  async function executeReferenced(
    principal: Principal,
    identity: OwnedAnalysisView,
    compiled: CompiledAnalysisView,
    reportId: string,
  ): Promise<ExecutedAnalysis> {
    return executeAndLog({
      principal,
      definition: identity.analysis.definition,
      intent: identity.view.intent,
      preferences: identity.view.preferences,
      compiled,
      tool: "report_replay",
      identity,
      createIdentity: "none",
      args: { report_id: reportId },
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
