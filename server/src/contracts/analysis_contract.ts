import { z } from "zod";
import {
  ANALYSIS_DEFINITION_INPUT,
  SEMANTIC_VIEW_INTENT_INPUT,
} from "../semantic_core/semantic_analysis.js";
import { VIEW_PREFERENCES_INPUT } from "../presentation_core/view_preferences.js";

export type MyAnalysisRow = {
  id: number;
  analysis_id: string | null;
  view_id: string | null;
  at: string;
  title: string;
  row_count: number | null;
};

export type MyAnalysesPayload = { days: number; rows: MyAnalysisRow[]; total: number };

const MY_ANALYSIS_ROW_SCHEMA: z.ZodType<MyAnalysisRow> = z
  .object({
    id: z.number(),
    analysis_id: z.string().nullable(),
    view_id: z.string().nullable(),
    at: z.string(),
    title: z.string(),
    row_count: z.number().nullable(),
  })
  .strict();

export const MY_ANALYSES_PAYLOAD_SCHEMA: z.ZodType<MyAnalysesPayload> = z
  .object({ days: z.number(), rows: z.array(MY_ANALYSIS_ROW_SCHEMA), total: z.number() })
  .strict();

export const PREVIEW_ANALYSIS_BODY = z
  .object({
    analysis: ANALYSIS_DEFINITION_INPUT,
    view: SEMANTIC_VIEW_INTENT_INPUT,
    view_preferences: VIEW_PREFERENCES_INPUT,
  })
  .strict();

export const CREATE_ANALYSIS_VIEW_BODY = z
  .object({
    analysis_id: z.string().uuid(),
    view: SEMANTIC_VIEW_INTENT_INPUT,
    view_preferences: VIEW_PREFERENCES_INPUT,
  })
  .strict();
