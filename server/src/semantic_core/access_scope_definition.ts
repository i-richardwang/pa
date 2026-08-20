import { z } from "zod";

const ACCESS_SCOPE_ID_SCHEMA = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]*$/);

export const ACCESS_SCOPE_DEFINITION_SCHEMA = z
  .object({
    id: ACCESS_SCOPE_ID_SCHEMA,
    title: z.string().trim().min(1),
  })
  .strict();

export type AccessScopeDefinition = z.infer<typeof ACCESS_SCOPE_DEFINITION_SCHEMA>;
