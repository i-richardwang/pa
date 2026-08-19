import { z } from "zod";
import {
  isPresentationBlock,
  type PresentationBlock,
  type PresentationFallback,
} from "../presentation_core/chart_config.js";
import { QUERY_PAYLOAD_SCHEMA, type QueryPayload } from "../semantic_core/query_payload.js";
import {
  SEMANTIC_ANALYSIS_SPEC_INPUT,
  type SemanticAnalysisSpec,
} from "../semantic_core/semantic_analysis.js";
import {
  RECORD_PROJECTION_BINDINGS_SCHEMA,
  type RecordProjectionBindings,
} from "./record_projection_contract.js";

export type ReplayPayload = {
  at: string;
  caller: string;
  analysis_id: string;
  /** 报告重放时用于检测版本竞态。 */
  revision?: number;
  spec: SemanticAnalysisSpec;
  record_projection_bindings?: RecordProjectionBindings;
  payload: QueryPayload;
  presentation: PresentationBlock;
  presentation_notes?: PresentationFallback[];
  time_override?: "applied" | "unsupported";
};

export const REPLAY_PAYLOAD_SCHEMA: z.ZodType<ReplayPayload, z.ZodTypeDef, unknown> = z
  .object({
    at: z.string(),
    caller: z.string(),
    analysis_id: z.string(),
    revision: z.number().int().positive().optional(),
    spec: SEMANTIC_ANALYSIS_SPEC_INPUT,
    record_projection_bindings: RECORD_PROJECTION_BINDINGS_SCHEMA.optional(),
    payload: QUERY_PAYLOAD_SCHEMA,
    presentation: z.custom<PresentationBlock>(isPresentationBlock),
    presentation_notes: z
      .array(
        z
          .object({
            view_id: z.string(),
            kind: z.enum(["empty_result", "unsupported_shape"]),
            note: z.string(),
          })
          .strict(),
      )
      .optional(),
    time_override: z.enum(["applied", "unsupported"]).optional(),
  })
  .strict();
