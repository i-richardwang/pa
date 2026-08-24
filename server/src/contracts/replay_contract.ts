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
  /** 报告重放时用于检测版本竞态。 */
  revision?: number;
  analysis: AnalysisDefinition;
  view: SemanticViewIntent;
  /** 人类作者视觉偏好；控制台编辑使用，不进入 Agent MCP 结果。 */
  view_preferences: ViewPreferences;
  record_projection_bindings: RecordProjectionBindings;
  payload: QueryPayload;
  /** 本次 Run 的完整聚合行与公共呈现声明；只随 Web 响应存在，不持久化。 */
  render_bundle: RenderBundle;
  presentation: PresentationBlock;
  presentation_notes?: PresentationFallback[];
  time_override?: "applied" | "unsupported";
};

export const REPLAY_PAYLOAD_SCHEMA: z.ZodType<ReplayPayload, z.ZodTypeDef, unknown> = z
  .object({
    at: z.string(),
    caller: z.string(),
    analysis_id: z.string().uuid(),
    view_id: z.string().uuid(),
    revision: z.number().int().positive().optional(),
    analysis: ANALYSIS_DEFINITION_INPUT,
    view: SEMANTIC_VIEW_INTENT_INPUT,
    view_preferences: VIEW_PREFERENCES_INPUT,
    record_projection_bindings: RECORD_PROJECTION_BINDINGS_SCHEMA,
    payload: QUERY_PAYLOAD_SCHEMA,
    render_bundle: z
      .object({
        view: VIEW_BLOCK_SCHEMA,
        decl: CHART_DECL_SCHEMA,
      })
      .strict(),
    presentation: z.custom<PresentationBlock>(isPresentationBlock),
    presentation_notes: z
      .array(
        z
          .object({
            result_view_id: z.string(),
            kind: z.enum(["empty_result", "unsupported_shape"]),
            note: z.string(),
          })
          .strict(),
      )
      .optional(),
    time_override: z.enum(["applied", "unsupported"]).optional(),
  })
  .strict();
