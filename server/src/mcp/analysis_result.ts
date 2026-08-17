import type { ExecutedAnalysis } from "../application/analysis_service.js";
import type { ApplicationRuntime } from "../application/runtime.js";
import { PRESENTATION_META_KEY } from "../presentation_core/chart_config.js";
import { EXPORT_RESOURCE_META_KEY, FULL_ROWS_META_KEY } from "../semantic_core/query_payload.js";

export function analysisResult(
  runtime: ApplicationRuntime,
  executed: ExecutedAnalysis,
  options: { includeSpec?: boolean } = {},
) {
  const presentation = runtime.presentation.compile(executed);
  // 降级说明据本次编译解析出的物理呈现（executed.presentation）判定，与所渲图表同源。
  const fallbacks = runtime.presentation.runtimeFallbacks(executed, executed.presentation);
  const meta = {
    ...(executed.fullRows ? { [FULL_ROWS_META_KEY]: executed.fullRows } : {}),
    ...(executed.exportResource ? { [EXPORT_RESOURCE_META_KEY]: executed.exportResource } : {}),
    [PRESENTATION_META_KEY]: presentation,
  };
  const payload = {
    ...executed.payload,
    ...(fallbacks.length ? { presentation_notes: fallbacks } : {}),
    ...(options.includeSpec ? { spec: executed.spec } : {}),
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
    ...(Object.keys(meta).length ? { _meta: meta } : {}),
  };
}
