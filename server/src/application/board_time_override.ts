import type { AnalysisDefinition } from "../semantic_core/semantic_analysis.js";
import type { TimeIntent } from "../semantic_core/time_contract.js";

export type BoardTimeOverrideStatus = "applied" | "unsupported";

/**
 * 板级时间覆盖整体替换唯一查询的时间输入；派生结果保持自身口径。
 * Report 重放与 Board Record Projection 共用这里，禁止各自重建时间合成规则。
 */
export function applyBoardTimeOverride(
  definition: AnalysisDefinition,
  time: TimeIntent,
): { definition: AnalysisDefinition; status: BoardTimeOverrideStatus } {
  if (definition.derived) return { definition, status: "unsupported" };
  return {
    status: "applied",
    definition: { ...definition, query: { ...definition.query, time } },
  };
}
