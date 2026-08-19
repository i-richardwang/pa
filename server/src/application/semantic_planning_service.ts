/** 当前主体可见语义目录上的唯一分析与视图规划入口。 */
import type { Principal } from "../engine/cube_security.js";
import { compileAnalysisView } from "../engine/semantic_analysis_compiler.js";
import type { AnalysisDefinition, SemanticViewIntent } from "../semantic_core/semantic_analysis.js";
import type { CatalogService } from "./catalog_service.js";
import {
  EMPTY_VIEW_PREFERENCES,
  type ViewPreferences,
} from "../presentation_core/view_preferences.js";

/**
 * 服务端规划是查询兼容性与呈现绑定的唯一权威，只编译纯工件。
 * AnalysisService 负责执行与身份创建；Web 可用同一规划入口创建新 View。
 */
export function createSemanticPlanningService(deps: { catalog: Pick<CatalogService, "compiler"> }) {
  async function compile(
    principal: Principal,
    definition: AnalysisDefinition,
    intent: SemanticViewIntent,
    preferences: ViewPreferences = EMPTY_VIEW_PREFERENCES,
  ) {
    return compileAnalysisView(
      await deps.catalog.compiler(principal),
      { analysis: definition, view: intent },
      preferences,
    );
  }

  return { compile };
}

export type SemanticPlanningService = ReturnType<typeof createSemanticPlanningService>;
