import { z } from "zod";

export const FEEDBACK_LIMITS = {
  ask: 500,
  detail: 1000,
  note: 1000,
} as const;

const FEEDBACK_STATUSES = ["open", "accepted", "rejected"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const FEEDBACK_TOPIC_KEY_SCHEMA = z.string().regex(/^[0-9a-f]{20}$/);

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

export const RESOLVE_FEEDBACK_BODY = z.strictObject({
  status: z.enum(["accepted", "rejected"]),
  note: z.string().trim().min(1).max(FEEDBACK_LIMITS.note),
});

const FEEDBACK_GROUP_SCHEMA: z.ZodType<FeedbackGroup> = z.strictObject({
  topic_key: FEEDBACK_TOPIC_KEY_SCHEMA,
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
});

export const FEEDBACK_GROUP_PAYLOAD_SCHEMA = FEEDBACK_GROUP_SCHEMA;
export const FEEDBACK_LIST_PAYLOAD_SCHEMA: z.ZodType<FeedbackListPayload> = z.strictObject({
  rows: z.array(FEEDBACK_GROUP_SCHEMA),
  total: z.number(),
});
