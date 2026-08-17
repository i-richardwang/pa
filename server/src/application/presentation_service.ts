import {
  compilePresentationBlock,
  presentationFallbacks,
} from "../presentation_core/chart_config.js";
import type { PresentationSpec } from "../presentation_core/presentation_spec.js";
import type { QueryRunResult } from "./query_pipeline.js";
import { renderShapeOfView, type RenderShape } from "../presentation_core/view_shape.js";

export function createPresentationService() {
  function compile(result: QueryRunResult) {
    return compilePresentationBlock(result.fullRowViewBlock, result.decl);
  }

  function renderShape(result: QueryRunResult): RenderShape | null {
    return renderShapeOfView(result.fullRowViewBlock, result.decl);
  }

  function runtimeFallbacks(result: QueryRunResult, presentation: PresentationSpec) {
    return presentationFallbacks(
      result.payload.view.id,
      compile(result),
      presentation,
      result.fullRowViewBlock.rows.length,
    );
  }

  return { compile, renderShape, runtimeFallbacks };
}

export type PresentationService = ReturnType<typeof createPresentationService>;
