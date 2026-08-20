import { z } from "zod";

/** Report 的稳定身份与名称值合同；Web、MCP 与 Application 共用。 */
export const REPORT_ID_SCHEMA = z.string().uuid();
export const REPORT_NAME_SCHEMA = z.string().trim().min(1).max(100);
