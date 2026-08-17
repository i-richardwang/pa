import { z } from "zod";
import {
  isPresentationBlock,
  type PresentationBlock,
  type PresentationFallback,
} from "../presentation_core/chart_config.js";
import type { RenderShape } from "../presentation_core/view_shape.js";
import { QUERY_PAYLOAD_SCHEMA, type QueryPayload } from "../semantic_core/query_payload.js";
import {
  SEMANTIC_ANALYSIS_SPEC_INPUT,
  type SemanticAnalysisSpec,
} from "../semantic_core/semantic_analysis.js";
import {
  RECORD_PROJECTION_BINDINGS_SCHEMA,
  type RecordProjectionBindings,
} from "./record_projection_contract.js";
import { WEB_REPORT_UPDATE_ACTION } from "./report_action.js";
export {
  CATALOG_DIMENSION_VALUES_SCHEMA as CATALOG_VALUES_PAYLOAD_SCHEMA,
  isSearchableCatalogDimension,
  PUBLIC_CATALOG_DOCUMENT_SCHEMA as CATALOG_PAYLOAD_SCHEMA,
} from "./catalog_contract.js";
export {
  BUSINESS_TERM_LIMITS,
  BUSINESS_TERM_SCHEMA,
  BUSINESS_TERMS_PAYLOAD_SCHEMA,
  CREATE_BUSINESS_TERM_BODY,
  UPDATE_BUSINESS_TERM_BODY,
} from "./business_term_contract.js";
export { RECORD_PROJECTION_PAYLOAD_SCHEMA } from "./record_projection_contract.js";
export type {
  RecordProjectionPayload,
  RecordProjectionRequestBody,
} from "./record_projection_contract.js";

export const BOARD_GRID_COLUMNS = 24;
export const BOARD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DASHBOARD_PAGE_SIZE = 20;
export const USAGE_ERROR_GROUP_TEXT_LIMIT = 200;
export const FEEDBACK_LIMITS = {
  ask: 500,
  detail: 1000,
  note: 1000,
} as const;

export type {
  CatalogDimensionValues as CatalogValuesPayload,
  PublicCatalogDocument as CatalogPayload,
  PublicCatalogMember as CatalogMemberPayload,
  PublicMetricDomain as MetricDomainPayload,
} from "./catalog_contract.js";
export type {
  BusinessTermsPayload,
  CreateBusinessTermBody,
  PublicBusinessTerm,
  UpdateBusinessTermBody,
} from "./business_term_contract.js";
export type { RenderShape } from "../presentation_core/view_shape.js";

export type MePayload = {
  email: string;
  name: string;
  role: string;
  is_admin: boolean;
  /** 行权限：有权组织的 organization_name 清单原值——"*"=全部组织、""=未授权、否则逗号分隔 */
  org_scope: string;
};

export const SET_ORG_SCOPE_BODY = z
  .object({ userId: z.string().trim().min(1), org_scope: z.string() })
  .strict();
export type SetOrgScopeBody = z.infer<typeof SET_ORG_SCOPE_BODY>;

export type UsageOverviewCell = {
  tool: string;
  outcome: "ok" | "error";
  n: number;
  truncated: number;
};

export type UsageCallerCell = { caller: string; n: number; last_at: string };

export type UsageOverviewPayload = {
  days: number;
  cells: UsageOverviewCell[];
  callers: UsageCallerCell[];
};

export type UsageTitleRow = {
  id: number;
  at: string;
  caller: string;
  title: string;
  row_count: number | null;
};

export type UsageTitlesPayload = { days: number; rows: UsageTitleRow[]; total: number };

export type MyAnalysisRow = {
  id: number;
  analysis_id: string | null;
  at: string;
  title: string;
  row_count: number | null;
};

export type MyAnalysesPayload = { days: number; rows: MyAnalysisRow[]; total: number };

export type ReportRow = {
  id: string;
  name: string;
  analysis_id: string;
  result_view_id: string;
  presentation_type: "table" | "kpi" | "line" | "bar" | "pie";
  render_shape: RenderShape | null;
  revision: number;
  updated_at: string;
};
export type ReportsPayload = { rows: ReportRow[]; total: number };
export const CREATE_REPORT_BODY = z
  .object({
    analysis_id: z.string().min(1),
    name: z.string().trim().min(1),
  })
  .strict();
export type CreateReportBody = z.infer<typeof CREATE_REPORT_BODY>;

export type ReportDetail = ReportRow & {
  owner: string;
  spec: SemanticAnalysisSpec;
};

export const UPDATE_REPORT_BODY = z
  .object({
    action: WEB_REPORT_UPDATE_ACTION,
    if_revision: z.number().int().positive().optional(),
  })
  .strict();
export type UpdateReportBody = z.infer<typeof UPDATE_REPORT_BODY>;

export type ReportRevisionRow = {
  revision: number;
  name: string;
  saved_by: string;
  saved_at: string;
};
export type ReportRevisionsPayload = { rows: ReportRevisionRow[] };

export const PREVIEW_REPORT_BODY = z.object({ spec: SEMANTIC_ANALYSIS_SPEC_INPUT }).strict();

export type ZeroHitRow = { term: string; n: number; last_at: string };

export type ErrorRow = {
  tool: string;
  error: string;
  n: number;
  last_at: string;
  example_title: string | null;
};

export type UnansweredPayload = { days: number; zero_hits: ZeroHitRow[]; errors: ErrorRow[] };

export const FEEDBACK_STATUSES = ["open", "accepted", "rejected"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export type FeedbackGroup = {
  topic_key: string;
  ask: string;
  detail: string;
  status: FeedbackStatus;
  note?: string;
  resolved_by?: string;
  resolved_at?: string;
  occurrences: number;
  first_at: string;
  last_at: string;
  callers: string[];
};

export type FeedbackListPayload = { rows: FeedbackGroup[]; total: number };

export const RESOLVE_FEEDBACK_BODY = z
  .object({
    status: z.enum(["accepted", "rejected"]),
    note: z.string().trim().min(1).max(FEEDBACK_LIMITS.note),
  })
  .strict();

/** 看板读取受成员权限约束，编辑仅限创建者。 */
export type BoardRow = {
  id: string;
  name: string;
  count: number;
  created_by: string;
  updated_at: string;
};
export type BoardsPayload = { rows: BoardRow[] };

export type Place = { x: number; y: number; w: number; h: number };

export type BoardTile =
  | {
      kind: "report";
      tile_id: string;
      report_id: string;
      place: Place;
      name: string;
      presentation_type: ReportRow["presentation_type"];
      render_shape: ReportRow["render_shape"];
    }
  | { kind: "text"; tile_id: string; md: string; place: Place };

export type BoardPayload = {
  id: string;
  name: string;
  created_by: string;
  revision: number;
  updated_at: string;
  tiles: BoardTile[];
};

export const CREATE_BOARD_BODY = z.object({ name: z.string() }).strict();
export type UpdateBoardBody = {
  if_revision: number;
  name?: string;
  tiles?: BoardTile[];
};
export type AddBoardItemBody = { report_id: string; if_revision: number };
export type AddBoardItemPayload = { added: boolean; board: BoardPayload };
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

const RENDER_SHAPE_SCHEMA = z.enum(["kpi", "line", "bar", "pie", "crosstab", "table"]);
const REPORT_ROW_FIELDS = {
  id: z.string(),
  name: z.string(),
  analysis_id: z.string(),
  result_view_id: z.string(),
  presentation_type: z.enum(["table", "kpi", "line", "bar", "pie"]),
  render_shape: RENDER_SHAPE_SCHEMA.nullable(),
  revision: z.number().int().positive(),
  updated_at: z.string(),
} satisfies z.ZodRawShape;

const REPORT_ROW_SCHEMA: z.ZodType<ReportRow> = z.object(REPORT_ROW_FIELDS).strict();

const PLACE_SCHEMA: z.ZodType<Place> = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    w: z.number().int(),
    h: z.number().int(),
  })
  .strict();

const BOARD_TILE_SCHEMA: z.ZodType<BoardTile> = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("report"),
      tile_id: z.string(),
      report_id: z.string(),
      place: PLACE_SCHEMA,
      name: z.string(),
      presentation_type: z.enum(["table", "kpi", "line", "bar", "pie"]),
      render_shape: RENDER_SHAPE_SCHEMA.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      tile_id: z.string(),
      md: z.string(),
      place: PLACE_SCHEMA,
    })
    .strict(),
]);

export const UPDATE_BOARD_BODY: z.ZodType<UpdateBoardBody> = z
  .object({
    if_revision: z.number().int().positive(),
    name: z.string().optional(),
    tiles: z.array(BOARD_TILE_SCHEMA).optional(),
  })
  .strict();
export const ADD_BOARD_ITEM_BODY: z.ZodType<AddBoardItemBody> = z
  .object({ report_id: z.string(), if_revision: z.number().int().positive() })
  .strict();
export const ME_PAYLOAD_SCHEMA: z.ZodType<MePayload> = z
  .object({
    email: z.string(),
    name: z.string(),
    role: z.string(),
    is_admin: z.boolean(),
    org_scope: z.string(),
  })
  .strict();

export const USAGE_OVERVIEW_PAYLOAD_SCHEMA: z.ZodType<UsageOverviewPayload> = z
  .object({
    days: z.number(),
    cells: z.array(
      z
        .object({
          tool: z.string(),
          outcome: z.enum(["ok", "error"]),
          n: z.number(),
          truncated: z.number(),
        })
        .strict(),
    ),
    callers: z.array(z.object({ caller: z.string(), n: z.number(), last_at: z.string() }).strict()),
  })
  .strict();

const USAGE_TITLE_ROW_SCHEMA: z.ZodType<UsageTitleRow> = z
  .object({
    id: z.number(),
    at: z.string(),
    caller: z.string(),
    title: z.string(),
    row_count: z.number().nullable(),
  })
  .strict();
export const USAGE_TITLES_PAYLOAD_SCHEMA: z.ZodType<UsageTitlesPayload> = z
  .object({ days: z.number(), rows: z.array(USAGE_TITLE_ROW_SCHEMA), total: z.number() })
  .strict();

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

export const REPORTS_PAYLOAD_SCHEMA: z.ZodType<ReportsPayload> = z
  .object({ rows: z.array(REPORT_ROW_SCHEMA), total: z.number() })
  .strict();
export const REPORT_ROW_PAYLOAD_SCHEMA = REPORT_ROW_SCHEMA;
export const REPORT_DETAIL_SCHEMA: z.ZodType<ReportDetail, z.ZodTypeDef, unknown> = z
  .object({
    ...REPORT_ROW_FIELDS,
    owner: z.string(),
    spec: SEMANTIC_ANALYSIS_SPEC_INPUT,
  })
  .strict();
export const REPORT_REVISIONS_PAYLOAD_SCHEMA: z.ZodType<ReportRevisionsPayload> = z
  .object({
    rows: z.array(
      z
        .object({
          revision: z.number().int().positive(),
          name: z.string(),
          saved_by: z.string(),
          saved_at: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export const UNANSWERED_PAYLOAD_SCHEMA: z.ZodType<UnansweredPayload> = z
  .object({
    days: z.number(),
    zero_hits: z.array(z.object({ term: z.string(), n: z.number(), last_at: z.string() }).strict()),
    errors: z.array(
      z
        .object({
          tool: z.string(),
          error: z.string(),
          n: z.number(),
          last_at: z.string(),
          example_title: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

const FEEDBACK_GROUP_SCHEMA: z.ZodType<FeedbackGroup> = z
  .object({
    topic_key: z.string(),
    ask: z.string(),
    detail: z.string(),
    status: z.enum(FEEDBACK_STATUSES),
    note: z.string().optional(),
    resolved_by: z.string().optional(),
    resolved_at: z.string().optional(),
    occurrences: z.number(),
    first_at: z.string(),
    last_at: z.string(),
    callers: z.array(z.string()),
  })
  .strict();
export const FEEDBACK_GROUP_PAYLOAD_SCHEMA = FEEDBACK_GROUP_SCHEMA;
export const FEEDBACK_LIST_PAYLOAD_SCHEMA: z.ZodType<FeedbackListPayload> = z
  .object({ rows: z.array(FEEDBACK_GROUP_SCHEMA), total: z.number() })
  .strict();

const BOARD_ROW_SCHEMA: z.ZodType<BoardRow> = z
  .object({
    id: z.string(),
    name: z.string(),
    count: z.number(),
    created_by: z.string(),
    updated_at: z.string(),
  })
  .strict();
export const BOARDS_PAYLOAD_SCHEMA: z.ZodType<BoardsPayload> = z
  .object({ rows: z.array(BOARD_ROW_SCHEMA) })
  .strict();
export const BOARD_PAYLOAD_SCHEMA: z.ZodType<BoardPayload> = z
  .object({
    id: z.string(),
    name: z.string(),
    created_by: z.string(),
    revision: z.number().int().positive(),
    updated_at: z.string(),
    tiles: z.array(BOARD_TILE_SCHEMA),
  })
  .strict();
export const ADD_BOARD_ITEM_PAYLOAD_SCHEMA: z.ZodType<AddBoardItemPayload> = z
  .object({ added: z.boolean(), board: BOARD_PAYLOAD_SCHEMA })
  .strict();

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

export const OK_PAYLOAD_SCHEMA = z.object({ ok: z.literal(true) }).strict();
