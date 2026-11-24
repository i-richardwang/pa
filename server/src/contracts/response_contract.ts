import { z } from "zod";

export const OK_PAYLOAD_SCHEMA = z.strictObject({ ok: z.literal(true) });
