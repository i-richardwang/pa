import {
  isSemanticDerivedView,
  type SemanticAnalysisSpec,
} from "../semantic_core/semantic_analysis.js";
import type { TimeIntent } from "../semantic_core/time_contract.js";

export type BoardTimeOverrideStatus = "applied" | "unsupported";

/**
 * 板级时间覆盖整体替换唯一 query view 的时间输入；多视图与派生结果保持自身口径。
 * Report 重放与 Board Record Projection 共用这里，禁止各自重建时间合成规则。
 */
export function applyBoardTimeOverride(
  spec: SemanticAnalysisSpec,
  time: TimeIntent,
): { spec: SemanticAnalysisSpec; status: BoardTimeOverrideStatus } {
  const views = spec.analysis.views;
  if (views.length !== 1 || isSemanticDerivedView(views[0])) {
    return { spec, status: "unsupported" };
  }
  const view = views[0];
  return {
    status: "applied",
    spec: {
      ...spec,
      analysis: {
        ...spec.analysis,
        views: [{ ...view, time }],
      },
    },
  };
}
