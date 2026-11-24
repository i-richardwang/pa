import { z } from "zod";

const PUBLIC_ERROR_CODES = [
  "unauthorized",
  "invalid_request",
  "forbidden",
  "not_found",
  "conflict",
  "limit_exceeded",
  "unavailable",
  "internal",
] as const;

export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];

export type PublicErrorPayload = {
  code: PublicErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

const PUBLIC_ERROR_PAYLOAD_SCHEMA: z.ZodType<PublicErrorPayload> = z.strictObject({
  code: z.enum(PUBLIC_ERROR_CODES),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const PUBLIC_ERROR_RESPONSE_SCHEMA = z.strictObject({ error: PUBLIC_ERROR_PAYLOAD_SCHEMA });
