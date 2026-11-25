import { z } from "zod";

const INCOMPATIBLE_DIMENSION_SCHEMA = z.strictObject({
  member: z.string().regex(/^[a-z][a-z0-9_]*$/),
  reason: z.string().trim().min(1),
});

const INCOMPATIBLE_DIMENSIONS_SCHEMA = z.array(INCOMPATIBLE_DIMENSION_SCHEMA);

export type IncompatibleDimension = z.infer<typeof INCOMPATIBLE_DIMENSION_SCHEMA>;

export function parseIncompatibleDimensions(
  value: unknown,
  owner: string,
): IncompatibleDimension[] {
  if (value === undefined) return [];
  const parsed = INCOMPATIBLE_DIMENSIONS_SCHEMA.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${owner} 的 incompatible_dimensions 声明无效：${parsed.error.message}`);
  }
  return parsed.data;
}
