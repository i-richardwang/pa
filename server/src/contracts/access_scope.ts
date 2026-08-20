import { z } from "zod";
import {
  ACCESS_SCOPE_DEFINITION_SCHEMA,
  type AccessScopeDefinition,
} from "../semantic_core/access_scope_definition.js";

export { ACCESS_SCOPE_DEFINITION_SCHEMA, type AccessScopeDefinition };

const ACCESS_SCOPE_ID_SCHEMA = ACCESS_SCOPE_DEFINITION_SCHEMA.shape.id;

const LIMITED_ACCESS_SCOPE_SCHEMA = z
  .object({
    kind: z.literal("limited"),
    values: z.array(z.string().trim().min(1)),
  })
  .strict();

export const ACCESS_SCOPE_SCHEMA = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("all") }).strict(),
    LIMITED_ACCESS_SCOPE_SCHEMA,
  ])
  .transform((scope) =>
    scope.kind === "all" ? scope : { ...scope, values: [...new Set(scope.values)] },
  );

export type AccessScope = z.infer<typeof ACCESS_SCOPE_SCHEMA>;

export type PresentedAccessScope = AccessScope & AccessScopeDefinition;

export const PRESENTED_ACCESS_SCOPE_SCHEMA: z.ZodType<PresentedAccessScope> = z
  .union([
    z
      .object({
        id: ACCESS_SCOPE_ID_SCHEMA,
        title: z.string().trim().min(1),
        kind: z.literal("all"),
      })
      .strict(),
    z
      .object({
        id: ACCESS_SCOPE_ID_SCHEMA,
        title: z.string().trim().min(1),
        kind: z.literal("limited"),
        values: z.array(z.string().trim().min(1)),
      })
      .strict(),
  ])
  .transform((scope) =>
    scope.kind === "all" ? scope : { ...scope, values: [...new Set(scope.values)] },
  );

const STORED_ACCESS_SCOPE_SCHEMA = z
  .discriminatedUnion("kind", [
    z.object({ scope_id: ACCESS_SCOPE_ID_SCHEMA, kind: z.literal("all") }).strict(),
    z
      .object({
        scope_id: ACCESS_SCOPE_ID_SCHEMA,
        kind: z.literal("limited"),
        values: z.array(z.string().trim().min(1)),
      })
      .strict(),
  ])
  .transform((scope) =>
    scope.kind === "all" ? scope : { ...scope, values: [...new Set(scope.values)] },
  );

const emptyScope = (): AccessScope => ({ kind: "limited", values: [] });

/** 持久化授权必须属于当前语义包；未知结构与其他包的授权均 fail-closed。 */
export function parseStoredAccessScope(value: unknown, expectedScopeId: string): AccessScope {
  if (typeof value !== "string" || !value.trim()) return { kind: "limited", values: [] };
  try {
    const parsed = STORED_ACCESS_SCOPE_SCHEMA.safeParse(JSON.parse(value));
    if (!parsed.success || parsed.data.scope_id !== expectedScopeId) return emptyScope();
    return parsed.data.kind === "all"
      ? { kind: "all" }
      : { kind: "limited", values: parsed.data.values };
  } catch {
    return emptyScope();
  }
}

export function serializeAccessScope(scope: AccessScope, scopeId: string): string {
  const definition = ACCESS_SCOPE_ID_SCHEMA.parse(scopeId);
  return JSON.stringify({ scope_id: definition, ...ACCESS_SCOPE_SCHEMA.parse(scope) });
}

export function accessScopeValues(scope: AccessScope): "*" | string[] {
  return scope.kind === "all" ? "*" : [...scope.values];
}
