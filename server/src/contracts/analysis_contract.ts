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

const MY_ANALYSIS_ROW_SCHEMA: z.ZodType<MyAnalysisRow> = z.strictObject({
  id: z.number(),
  analysis_id: z.uuid().nullable(),
  view_id: z.uuid().nullable(),
  at: z.string(),
  title: z.string(),
  row_count: z.number().nullable(),
});

export const MY_ANALYSES_PAYLOAD_SCHEMA: z.ZodType<MyAnalysesPayload> = z.strictObject({
  days: z.number(),
  rows: z.array(MY_ANALYSIS_ROW_SCHEMA),
  total: z.number(),
});

export const PREVIEW_ANALYSIS_BODY = z.strictObject({
  analysis: ANALYSIS_DEFINITION_INPUT,
  view: SEMANTIC_VIEW_INTENT_INPUT,
  view_preferences: VIEW_PREFERENCES_INPUT,
});

export const CREATE_ANALYSIS_VIEW_BODY = z.strictObject({
  analysis_id: z.uuid(),
  view: SEMANTIC_VIEW_INTENT_INPUT,
  view_preferences: VIEW_PREFERENCES_INPUT,
});
