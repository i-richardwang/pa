import { z } from "zod";

const ACCESS_SCOPE_ID_SCHEMA = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]*$/);

export const ACCESS_SCOPE_DEFINITION_SCHEMA = z.strictObject({
  id: ACCESS_SCOPE_ID_SCHEMA,
  title: z.string().trim().min(1),
});

export type AccessScopeDefinition = z.infer<typeof ACCESS_SCOPE_DEFINITION_SCHEMA>;
