import { z } from "zod";

export const OK_PAYLOAD_SCHEMA = z.object({ ok: z.literal(true) }).strict();
