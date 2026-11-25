import { z } from "zod";
import { REPORT_NAME_SCHEMA } from "./report_identity.js";

export const RENAME_REPORT_ACTION = z.strictObject({
  type: z.literal("rename"),
  name: REPORT_NAME_SCHEMA,
});

export const REPLACE_REPORT_VIEW_ACTION = z.strictObject({
  type: z.literal("replace_view"),
  view_id: z.uuid(),
  name: REPORT_NAME_SCHEMA.optional(),
});

export const RESTORE_REPORT_ACTION = z.strictObject({
  type: z.literal("restore"),
  revision: z.int().positive(),
});

export const ARCHIVE_REPORT_ACTION = z.strictObject({ type: z.literal("archive") });

export const UNARCHIVE_REPORT_ACTION = z.strictObject({ type: z.literal("unarchive") });

/** 报告的全部更新动作；Web 与 MCP 各自从中选取公开子集。 */
export const REPORT_UPDATE_ACTION = z.discriminatedUnion("type", [
  RENAME_REPORT_ACTION,
  REPLACE_REPORT_VIEW_ACTION,
  RESTORE_REPORT_ACTION,
  ARCHIVE_REPORT_ACTION,
  UNARCHIVE_REPORT_ACTION,
]);
export type ReportUpdateAction = z.infer<typeof REPORT_UPDATE_ACTION>;

export const WEB_REPORT_UPDATE_ACTION = REPORT_UPDATE_ACTION;

export const MCP_REPORT_UPDATE_ACTION = z.discriminatedUnion("type", [
  RENAME_REPORT_ACTION,
  REPLACE_REPORT_VIEW_ACTION,
  ARCHIVE_REPORT_ACTION,
]);
