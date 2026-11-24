import { z } from "zod";
import type { PresentationBlock, PresentationFallback } from "../presentation_core/chart_config.js";
import { isPresentationBlock } from "../presentation_core/presentation_guard.js";
import {
  QUERY_PAYLOAD_SCHEMA,
  VIEW_BLOCK_SCHEMA,
  type QueryPayload,
  type ViewBlock,
} from "../semantic_core/query_payload.js";
import {
  ANALYSIS_DEFINITION_INPUT,
  SEMANTIC_VIEW_INTENT_INPUT,
  type AnalysisDefinition,
  type SemanticViewIntent,
} from "../semantic_core/semantic_analysis.js";
import {
  VIEW_PREFERENCES_INPUT,
  type ViewPreferences,
} from "../presentation_core/view_preferences.js";
import {
  RECORD_PROJECTION_BINDINGS_SCHEMA,
  type RecordProjectionBindings,
} from "./record_projection_contract.js";
import { CHART_DECL_SCHEMA, type ChartDecl } from "../presentation_core/chart_decl.js";

export { CHART_DECL_SCHEMA } from "../presentation_core/chart_decl.js";

export type RenderBundle = { view: ViewBlock; decl: ChartDecl };

export type ReplayPayload = {
  at: string;
  caller: string;
  analysis_id: string;
  view_id: string;
  /** 报告重放时用于检测并发修改。 */
  revision?: number;
  analysis: AnalysisDefinition;
  view: SemanticViewIntent;
  /** 用户在控制台设置的视觉偏好，不进入 MCP 结果。 */
  view_preferences: ViewPreferences;
  record_projection_bindings: RecordProjectionBindings;
  payload: QueryPayload;
  /** 本次运行的完整聚合行与图表声明；只在 Web 响应中返回，不持久化。 */
  render_bundle: RenderBundle;
  presentation: PresentationBlock;
  presentation_notes?: PresentationFallback[];
  time_override?: "applied" | "unsupported";
};

export const REPLAY_PAYLOAD_SCHEMA: z.ZodType<ReplayPayload> = z.strictObject({
  at: z.string(),
  caller: z.string(),
  analysis_id: z.uuid(),
  view_id: z.uuid(),
  revision: z.int().positive().optional(),
  analysis: ANALYSIS_DEFINITION_INPUT,
  view: SEMANTIC_VIEW_INTENT_INPUT,
  view_preferences: VIEW_PREFERENCES_INPUT,
  record_projection_bindings: RECORD_PROJECTION_BINDINGS_SCHEMA,
  payload: QUERY_PAYLOAD_SCHEMA,
  render_bundle: z.strictObject({
    view: VIEW_BLOCK_SCHEMA,
    decl: CHART_DECL_SCHEMA,
  }),
  presentation: z.custom<PresentationBlock>(isPresentationBlock),
  presentation_notes: z
    .array(
      z.strictObject({
        result_view_id: z.string(),
        kind: z.enum(["empty_result", "unsupported_shape"]),
        note: z.string(),
      }),
    )
    .optional(),
  time_override: z.enum(["applied", "unsupported"]).optional(),
});
