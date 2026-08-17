import { z } from "zod";

export const RENAME_REPORT_ACTION = z
  .object({ type: z.literal("rename"), name: z.string().trim().min(1).max(100) })
  .strict();

export const REPLACE_REPORT_ANALYSIS_ACTION = z
  .object({
    type: z.literal("replace_analysis"),
    analysis_id: z.string().uuid(),
    name: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const RESTORE_REPORT_ACTION = z
  .object({ type: z.literal("restore"), revision: z.number().int().positive() })
  .strict();

export const ARCHIVE_REPORT_ACTION = z.object({ type: z.literal("archive") }).strict();

/** 应用服务的完整领域动作；各呈现面只从这些成员组装自己的公开子集。 */
export const REPORT_UPDATE_ACTION = z.discriminatedUnion("type", [
  RENAME_REPORT_ACTION,
  REPLACE_REPORT_ANALYSIS_ACTION,
  RESTORE_REPORT_ACTION,
  ARCHIVE_REPORT_ACTION,
]);
export type ReportUpdateAction = z.infer<typeof REPORT_UPDATE_ACTION>;

export const WEB_REPORT_UPDATE_ACTION = REPORT_UPDATE_ACTION;

export const MCP_REPORT_UPDATE_ACTION = z.discriminatedUnion("type", [
  RENAME_REPORT_ACTION,
  REPLACE_REPORT_ANALYSIS_ACTION,
  ARCHIVE_REPORT_ACTION,
]);
