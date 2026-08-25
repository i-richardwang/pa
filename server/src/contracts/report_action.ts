import { z } from "zod";
import { REPORT_NAME_SCHEMA } from "./report_identity.js";

export const RENAME_REPORT_ACTION = z
  .object({ type: z.literal("rename"), name: REPORT_NAME_SCHEMA })
  .strict();

export const REPLACE_REPORT_VIEW_ACTION = z
  .object({
    type: z.literal("replace_view"),
    view_id: z.string().uuid(),
    name: REPORT_NAME_SCHEMA.optional(),
  })
  .strict();

export const RESTORE_REPORT_ACTION = z
  .object({ type: z.literal("restore"), revision: z.number().int().positive() })
  .strict();

export const ARCHIVE_REPORT_ACTION = z.object({ type: z.literal("archive") }).strict();

export const UNARCHIVE_REPORT_ACTION = z.object({ type: z.literal("unarchive") }).strict();

/** 应用服务的完整领域动作；各呈现面只从这些成员组装自己的公开子集。 */
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
