import type { AnalysisDefinition } from "../semantic_core/semantic_analysis.js";
import type { TimeIntent } from "../semantic_core/time_contract.js";

export type BoardTimeOverrideStatus = "applied" | "unsupported";

/** 看板时间覆盖整体替换查询的时间输入；带派生计算的分析不支持覆盖。报告重放与看板明细都调用这里。 */
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
