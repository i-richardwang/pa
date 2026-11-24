import type { Principal } from "../contracts/principal.js";
import type { ExportResourceLink } from "../semantic_core/query_payload.js";
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
import type { UsageService } from "./usage_service.js";
import type { RecordProjectionBindings } from "../contracts/record_projection_contract.js";
import {
  EMPTY_VIEW_PREFERENCES,
  validateViewPreferences,
  type ViewPreferences,
} from "../presentation_core/view_preferences.js";
import type { ChartDecl } from "../presentation_core/chart_decl.js";
import type { PresentationSpec } from "../presentation_core/presentation_spec.js";
import { derivedFormulaSummaries, queryFingerprint } from "../engine/query_fingerprint.js";
import type { ExportService } from "./export_service.js";
import { needsReplayExport, type AuthorizedAnalysisPlan } from "./semantic_planning_service.js";

/** 执行只接收编译结果，不接触持久化的 Analysis/View 身份。 */
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

/** 数据库只保存 analysis/view 引用，不保存执行结果本身。 */
export type ExecutedAnalysis = Omit<QueryRunResult, "exportPlan"> & {
  exportResource?: ExportResourceLink;
  analysis_id: string;
  view_id: string;
  definition: AnalysisDefinition;
  intent: SemanticViewIntent;
  preferences: ViewPreferences;
  presentation: PresentationSpec;
  record_projection_bindings: RecordProjectionBindings;
};

type IdentityStrategy =
  | { kind: "create_analysis" }
  | { kind: "create_view"; analysis: AnalysisRecord }
  | { kind: "reuse"; identity: OwnedAnalysisView };

export function createAnalysisService(deps: {
  repository: AnalysisRepository;
  execute: ExecuteAnalysis;
  plan: PlanAnalysisView;
  usage: Pick<UsageService, "log">;
  createDelivery: ExportService["createDelivery"];
}) {
  /** 工具调用的解析、规划、执行和保存都在这里包裹执行；定义校验失败也要写入一条 error 使用记录。 */
  async function observed(
    input: {
      principal: Principal;
      tool: "run_analysis" | "rerun_analysis" | "report_replay" | "replay";
      title?: string;
      known?: { analysis_id?: string; view_id?: string };
      usage: { query_fingerprint?: string; derived_formulas?: string[] };
    },
    body: () => Promise<ExecutedAnalysis>,
  ): Promise<ExecutedAnalysis> {
    const started = performance.now();
    const base = {
      caller: input.principal.email,
      tool: input.tool,
      ...(input.title ? { title: input.title } : {}),
      ...input.usage,
    };
    try {
      const result = await body();
      await deps.usage.log({
        ...base,
        outcome: "ok",
        row_count: result.payload.view.row_count,
        has_more: result.payload.view.has_more,
        duration_ms: performance.now() - started,
        analysis_id: result.analysis_id,
        view_id: result.view_id,
      });
      return result;
    } catch (error) {
      await deps.usage.log({
        ...base,
        outcome: "error",
        error: error instanceof Error ? error.message : String(error),
        duration_ms: performance.now() - started,
        ...(input.known ?? {}),
      });
      throw error;
    }
  }

  async function executeAndPersist(input: {
    principal: Principal;
    definition: AnalysisDefinition;
    intent: SemanticViewIntent;
    preferences: ViewPreferences;
    planned: AuthorizedAnalysisPlan;
    identity: IdentityStrategy;
  }): Promise<ExecutedAnalysis> {
    const { exportPlan: metricPlan, ...result } = await deps.execute(input.planned);
    const identity =
      input.identity.kind === "create_analysis"
        ? await deps.repository.create(
            input.principal.email,
            input.definition,
            input.intent,
            input.preferences,
          )
        : input.identity.kind === "create_view"
          ? await deps.repository.createView(
              input.principal.email,
              input.identity.analysis.id,
              input.intent,
              input.preferences,
            )
          : input.identity.identity;
    const exportPlan = needsReplayExport(input.planned)
      ? { kind: "analysis_view" as const, view_id: identity.view.id }
      : metricPlan;
    const delivery = exportPlan && (await deps.createDelivery(exportPlan, input.principal.email));
    return {
      ...result,
      ...(delivery ? { exportResource: delivery.resource } : {}),
      payload: {
        ...result.payload,
        ...(delivery
          ? { capabilities: { ...result.payload.capabilities, export: delivery.link } }
          : {}),
        analysis_id: identity.analysis.id,
        view_id: identity.view.id,
      },
      analysis_id: identity.analysis.id,
      view_id: identity.view.id,
      definition: identity.analysis.definition,
      intent: identity.view.intent,
      preferences: identity.view.preferences,
      presentation: input.planned.presentation,
      record_projection_bindings: input.planned.record_projection_bindings,
    };
  }

  async function run(
    principal: Principal,
    rawDefinition: AnalysisDefinition,
    rawIntent: SemanticViewIntent,
  ): Promise<ExecutedAnalysis> {
    return observed(
      {
        principal,
        tool: "run_analysis",
        title: rawDefinition?.title,
        usage: {
          query_fingerprint: queryFingerprint(rawDefinition),
          derived_formulas: derivedFormulaSummaries(rawDefinition),
        },
      },
      async () => {
        const definition = parseAnalysisDefinition(rawDefinition);
        const intent = parseSemanticViewIntent(rawIntent);
        const preferences = EMPTY_VIEW_PREFERENCES;
        return executeAndPersist({
          principal,
          definition,
          intent,
          preferences,
          planned: await deps.plan(principal, definition, intent, preferences),
          identity: { kind: "create_analysis" },
        });
      },
    );
  }

  async function rerun(
    principal: Principal,
    analysisId: string,
    rawIntent: SemanticViewIntent,
  ): Promise<ExecutedAnalysis> {
    return observed(
      { principal, tool: "rerun_analysis", known: { analysis_id: analysisId }, usage: {} },
      async () => {
        const analysis = await deps.repository.resolveOwnedAnalysis(analysisId, principal.email);
        const intent = parseSemanticViewIntent(rawIntent);
        const preferences = EMPTY_VIEW_PREFERENCES;
        return executeAndPersist({
          principal,
          definition: analysis.definition,
          intent,
          preferences,
          planned: await deps.plan(principal, analysis.definition, intent, preferences),
          identity: { kind: "create_view", analysis },
        });
      },
    );
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
    return observed(
      {
        principal,
        tool: "run_analysis",
        title: rawDefinition?.title,
        usage: {
          query_fingerprint: queryFingerprint(rawDefinition),
          derived_formulas: derivedFormulaSummaries(rawDefinition),
        },
      },
      async () => {
        const definition = parseAnalysisDefinition(rawDefinition);
        const intent = parseSemanticViewIntent(rawIntent);
        const preferences = validateViewPreferences(intent, rawPreferences);
        return executeAndPersist({
          principal,
          definition,
          intent,
          preferences,
          planned: await deps.plan(principal, definition, intent, preferences),
          identity: { kind: "create_analysis" },
        });
      },
    );
  }

  async function replay(principal: Principal, viewId: string): Promise<ExecutedAnalysis> {
    return observed(
      { principal, tool: "replay", known: { view_id: viewId }, usage: {} },
      async () => {
        const identity = await deps.repository.resolveOwnedView(viewId, principal.email);
        return executeAndPersist({
          principal,
          definition: identity.analysis.definition,
          intent: identity.view.intent,
          preferences: identity.view.preferences,
          planned: await deps.plan(
            principal,
            identity.analysis.definition,
            identity.view.intent,
            identity.view.preferences,
          ),
          identity: { kind: "reuse", identity },
        });
      },
    );
  }

  async function resolveOwnedView(
    principal: Principal,
    viewId: string,
  ): Promise<OwnedAnalysisView> {
    return deps.repository.resolveOwnedView(viewId, principal.email);
  }

  async function ensureOwned(principal: Principal, viewId: string): Promise<void> {
    await resolveOwnedView(principal, viewId);
  }

  async function executeReferenced(
    principal: Principal,
    identity: OwnedAnalysisView,
    planned: AuthorizedAnalysisPlan,
  ): Promise<ExecutedAnalysis> {
    return observed(
      {
        principal,
        tool: "report_replay",
        known: { analysis_id: identity.analysis.id, view_id: identity.view.id },
        usage: {},
      },
      async () =>
        executeAndPersist({
          principal,
          definition: identity.analysis.definition,
          intent: identity.view.intent,
          preferences: identity.view.preferences,
          planned,
          identity: { kind: "reuse", identity },
        }),
    );
  }

  return {
    run,
    rerun,
    materializeView,
    preview,
    replay,
    ensureOwned,
    resolveOwnedView,
    executeReferenced,
  };
}

export type AnalysisService = ReturnType<typeof createAnalysisService>;
