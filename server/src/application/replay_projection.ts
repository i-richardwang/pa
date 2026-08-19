import type { ReplayPayload } from "../contracts/replay_contract.js";
import type { ExecutedAnalysis } from "./analysis_service.js";
import type { PresentationService } from "./presentation_service.js";

/** Web 重放的唯一投影边界；MCP 继续使用独立的 Agent 能力投影。 */
export function projectReplayPayload(
  presentation: Pick<PresentationService, "compile" | "runtimeFallbacks">,
  executed: ExecutedAnalysis,
  metadata: {
    at: string;
    caller: string;
    revision?: number;
    time_override?: "applied" | "unsupported";
  },
): ReplayPayload {
  const notes = presentation.runtimeFallbacks(executed, executed.presentation);
  return {
    ...metadata,
    analysis_id: executed.analysis_id,
    view_id: executed.view_id,
    analysis: executed.definition,
    view: executed.intent,
    view_preferences: executed.preferences,
    record_projection_bindings: executed.record_projection_bindings,
    payload: executed.payload,
    render_bundle: { view: executed.fullRowViewBlock, decl: executed.decl },
    presentation: presentation.compile(executed),
    ...(notes.length ? { presentation_notes: notes } : {}),
  };
}
