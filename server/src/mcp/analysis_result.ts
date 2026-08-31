import type { ExecutedAnalysis } from "../application/analysis_service.js";
import type { PresentationService } from "../application/presentation_service.js";
import { PRESENTATION_META_KEY } from "../presentation_core/chart_config.js";
import { EXPORT_RESOURCE_META_KEY, FULL_ROWS_META_KEY } from "../semantic_core/query_payload.js";

export function analysisResult(
  presentationService: Pick<PresentationService, "compile" | "runtimeFallbacks">,
  executed: ExecutedAnalysis,
  options: { includeDefinition?: boolean } = {},
) {
  const presentation = presentationService.compile(executed);
  const fallbacks = presentationService.runtimeFallbacks(executed);
  const meta = {
    ...(executed.fullRows ? { [FULL_ROWS_META_KEY]: executed.fullRows } : {}),
    ...(executed.exportResource ? { [EXPORT_RESOURCE_META_KEY]: executed.exportResource } : {}),
    [PRESENTATION_META_KEY]: presentation,
  };
  const payload = {
    ...executed.payload,
    ...(fallbacks.length ? { presentation_notes: fallbacks } : {}),
    ...(options.includeDefinition
      ? { analysis: executed.definition, view_intent: executed.intent }
      : {}),
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
    ...(Object.keys(meta).length ? { _meta: meta } : {}),
  };
}
