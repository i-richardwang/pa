import { z } from "zod";

export const REPORT_ID_SCHEMA = z.string().uuid();
export const REPORT_NAME_SCHEMA = z.string().trim().min(1).max(100);
