import { z } from "zod";
import { PRESENTED_ACCESS_SCOPE_SCHEMA, type PresentedAccessScope } from "./access_scope.js";

export type MePayload = {
  email: string;
  name: string;
  role: string;
  is_admin: boolean;
  access_scope: PresentedAccessScope;
};

export const ME_PAYLOAD_SCHEMA: z.ZodType<MePayload> = z.strictObject({
  email: z.string(),
  name: z.string(),
  role: z.string(),
  is_admin: z.boolean(),
  access_scope: PRESENTED_ACCESS_SCOPE_SCHEMA,
});
