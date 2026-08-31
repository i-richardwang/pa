import {
  compilePresentationBlock,
  presentationFallbacks,
} from "../presentation_core/chart_config.js";
import type { QueryRunResult } from "./query_pipeline.js";
import type { RenderShape } from "../presentation_core/render_shape.js";
import { renderShapeOfView } from "../presentation_core/view_shape.js";

export function createPresentationService() {
  function compile(result: QueryRunResult) {
    return compilePresentationBlock(result.fullRowViewBlock, result.decl);
  }

  function renderShape(result: QueryRunResult): RenderShape | null {
    return renderShapeOfView(result.fullRowViewBlock, result.decl);
  }

  function runtimeFallbacks(result: QueryRunResult) {
    return presentationFallbacks(result.payload.view.id, result.fullRowViewBlock, result.decl);
  }

  return { compile, renderShape, runtimeFallbacks };
}

export type PresentationService = ReturnType<typeof createPresentationService>;
