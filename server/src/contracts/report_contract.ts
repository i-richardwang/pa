import { z } from "zod";
import { RENDER_SHAPE_SCHEMA, type RenderShape } from "../presentation_core/render_shape.js";
import {
  PRESENTATION_TYPE_SCHEMA,
  type PresentationType,
} from "../semantic_core/presentation_type.js";
import {
  ANALYSIS_DEFINITION_INPUT,
  SEMANTIC_VIEW_INTENT_INPUT,
  type AnalysisDefinition,
  type SemanticViewIntent,
} from "../semantic_core/semantic_analysis.js";
import { WEB_REPORT_UPDATE_ACTION } from "./report_action.js";
import { REPORT_ID_SCHEMA, REPORT_NAME_SCHEMA } from "./report_identity.js";
import {
  VIEW_PREFERENCES_INPUT,
  type ViewPreferences,
} from "../presentation_core/view_preferences.js";

export type ReportRow = {
  id: string;
  name: string;
  analysis_id: string;
  view_id: string;
  result_view_id: string;
  presentation_type: PresentationType;
  render_shape: RenderShape | null;
  revision: number;
  updated_at: string;
};

export type ReportsPayload = { rows: ReportRow[]; total: number };

export const CREATE_REPORT_BODY = z.strictObject({
  view_id: z.uuid(),
  name: REPORT_NAME_SCHEMA,
});
export type CreateReportBody = z.infer<typeof CREATE_REPORT_BODY>;

export type ReportDetail = ReportRow & {
  owner: string;
  analysis: AnalysisDefinition;
  view: SemanticViewIntent;
  view_preferences: ViewPreferences;
};

export const UPDATE_REPORT_BODY = z.strictObject({
  action: WEB_REPORT_UPDATE_ACTION,
  if_revision: z.int().positive().optional(),
});
export type UpdateReportBody = z.infer<typeof UPDATE_REPORT_BODY>;

type ReportRevisionRow = {
  revision: number;
  name: string;
  saved_by: string;
  saved_at: string;
};
export type ReportRevisionsPayload = { rows: ReportRevisionRow[] };

const REPORT_ROW_FIELDS = {
  id: REPORT_ID_SCHEMA,
  name: z.string(),
  analysis_id: z.uuid(),
  view_id: z.uuid(),
  result_view_id: z.string(),
  presentation_type: PRESENTATION_TYPE_SCHEMA,
  render_shape: RENDER_SHAPE_SCHEMA.nullable(),
  revision: z.int().positive(),
  updated_at: z.string(),
} satisfies z.core.$ZodShape;

const REPORT_ROW_SCHEMA: z.ZodType<ReportRow> = z.strictObject(REPORT_ROW_FIELDS);

export const REPORTS_PAYLOAD_SCHEMA: z.ZodType<ReportsPayload> = z.strictObject({
  rows: z.array(REPORT_ROW_SCHEMA),
  total: z.number(),
});
export const REPORT_ROW_PAYLOAD_SCHEMA = REPORT_ROW_SCHEMA;

export const REPORT_DETAIL_SCHEMA: z.ZodType<ReportDetail> = z.strictObject({
  ...REPORT_ROW_FIELDS,
  owner: z.string(),
  analysis: ANALYSIS_DEFINITION_INPUT,
  view: SEMANTIC_VIEW_INTENT_INPUT,
  view_preferences: VIEW_PREFERENCES_INPUT,
});

export const REPORT_REVISIONS_PAYLOAD_SCHEMA: z.ZodType<ReportRevisionsPayload> = z.strictObject({
  rows: z.array(
    z.strictObject({
      revision: z.int().positive(),
      name: z.string(),
      saved_by: z.string(),
      saved_at: z.string(),
    }),
  ),
});
