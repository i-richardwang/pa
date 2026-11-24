/** 分析与视图规划的唯一入口：查询是否可行、结果如何呈现都由这里判定，客户端不另行判断。 */
import { memberViewName } from "../semantic_core/member_name.js";
import type { Principal } from "../contracts/principal.js";
import { compileAnalysisView } from "../engine/semantic_analysis_compiler.js";
import type { AnalysisDefinition, SemanticViewIntent } from "../semantic_core/semantic_analysis.js";
import type { AuthorizedSemanticContext, CatalogService } from "./catalog_service.js";
import type { CompiledAnalysisView } from "../engine/semantic_analysis_compiler.js";
import {
  EMPTY_VIEW_PREFERENCES,
  type ViewPreferences,
} from "../presentation_core/view_preferences.js";

export type AuthorizedAnalysisPlan = CompiledAnalysisView & {
  access: AuthorizedSemanticContext;
};

/** 通过当前分析视图重放导出时，期次选择和列期间由同一份计划重新求值。 */
export function needsReplayExport({ plan, access }: AuthorizedAnalysisPlan): boolean {
  const { operation } = plan.output;
  if (operation.kind !== "query") return operation.kind === "composition";
  const output = operation.view;
  const viewNames = new Set([output.time_view, ...(output.measures ?? []).map(memberViewName)]);
  return access.views.some((view) => {
    const source = view.meta?.time_source;
    return (
      viewNames.has(view.name) &&
      typeof source === "string" &&
      Boolean(access.time_sources.by_id.get(source)?.observation)
    );
  });
}

export function createSemanticPlanningService(deps: { catalog: Pick<CatalogService, "context"> }) {
  async function plan(
    principal: Principal,
    definition: AnalysisDefinition,
    intent: SemanticViewIntent,
    preferences: ViewPreferences = EMPTY_VIEW_PREFERENCES,
  ) {
    const access = await deps.catalog.context(principal);
    return {
      ...compileAnalysisView(access.compiler, { analysis: definition, view: intent }, preferences),
      access,
    };
  }

  return { plan };
}

export type SemanticPlanningService = ReturnType<typeof createSemanticPlanningService>;
