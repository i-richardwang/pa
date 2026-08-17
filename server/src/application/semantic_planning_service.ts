/** 当前主体可见语义目录上的唯一报告规划入口。 */
import { toCompilerCatalog } from "../engine/catalog_document.js";
import type { Principal } from "../engine/cube_security.js";
import { compileSemanticAnalysis } from "../engine/semantic_analysis_compiler.js";
import type { SemanticAnalysisSpec } from "../semantic_core/semantic_analysis.js";
import type { CatalogService } from "./catalog_service.js";

/**
 * 服务端语义规划是查询兼容性的唯一权威：编译发生在预览/run 路径上，不可行的字段组合在此
 * 抛 SemanticQueryIncompatibleError，其 routes/reason 只讲业务血缘（direct/composed/incompatible），
 * 物理执行绑定留在编译器内。Web 走 validate-on-commit：编辑落草稿、提交时经预览编译校验。
 */
export function createSemanticPlanningService(deps: { catalog: Pick<CatalogService, "document"> }) {
  const compilerCatalog = async (principal: Principal) =>
    toCompilerCatalog(await deps.catalog.document(principal));

  async function compile(principal: Principal, spec: SemanticAnalysisSpec) {
    return compileSemanticAnalysis(await compilerCatalog(principal), spec);
  }

  return { compile };
}

export type SemanticPlanningService = ReturnType<typeof createSemanticPlanningService>;
