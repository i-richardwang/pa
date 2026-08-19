import { z } from "zod";
import { SEMANTIC_ANALYSIS_SPEC_INPUT } from "../semantic_core/semantic_analysis.js";

export type MyAnalysisRow = {
  id: number;
  analysis_id: string | null;
  at: string;
  title: string;
  row_count: number | null;
};

export type MyAnalysesPayload = { days: number; rows: MyAnalysisRow[]; total: number };

const MY_ANALYSIS_ROW_SCHEMA: z.ZodType<MyAnalysisRow> = z
  .object({
    id: z.number(),
    analysis_id: z.string().nullable(),
    at: z.string(),
    title: z.string(),
    row_count: z.number().nullable(),
  })
  .strict();

export const MY_ANALYSES_PAYLOAD_SCHEMA: z.ZodType<MyAnalysesPayload> = z
  .object({ days: z.number(), rows: z.array(MY_ANALYSIS_ROW_SCHEMA), total: z.number() })
  .strict();

export const PREVIEW_ANALYSIS_BODY = z.object({ spec: SEMANTIC_ANALYSIS_SPEC_INPUT }).strict();
