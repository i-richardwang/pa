import { z } from "zod";

export const USAGE_ERROR_GROUP_TEXT_LIMIT = 200;

type UsageOverviewCell = {
  tool: string;
  outcome: "ok" | "error";
  n: number;
  truncated: number;
};

type UsageCallerCell = { caller: string; n: number; last_at: string };

export type UsageOverviewPayload = {
  days: number;
  cells: UsageOverviewCell[];
  callers: UsageCallerCell[];
};

type UsageTitleRow = {
  id: number;
  at: string;
  caller: string;
  title: string;
  row_count: number | null;
};

export type UsageTitlesPayload = { days: number; rows: UsageTitleRow[]; total: number };

export type ZeroHitRow = { term: string; n: number; last_at: string };

export type ErrorRow = {
  tool: string;
  error: string;
  n: number;
  last_at: string;
  example_title: string | null;
};

export type UnansweredPayload = { days: number; zero_hits: ZeroHitRow[]; errors: ErrorRow[] };

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
