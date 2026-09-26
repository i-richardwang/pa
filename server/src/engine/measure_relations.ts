import { memberViewName } from "../semantic_core/member_name.js";
import type { CubeMember } from "../ports/cube_gateway.js";
import type { StructureShare } from "../semantic_core/query_payload.js";

/** 分子不在同一查询中时不生成配对。 */
export function structureSharesOf(
  memberKeys: string[],
  columns: string[],
  visibleMembers: CubeMember[],
): StructureShare[] {
  const columnForMember = new Map(memberKeys.map((key, index) => [key, columns[index]]));
  const memberByName = new Map(visibleMembers.map((member) => [member.name, member]));
  const qualify = (measure: string, component: string) =>
    component.includes(".") ? component : `${memberViewName(measure)}.${component}`;

  return memberKeys.flatMap((key) => {
    const member = memberByName.get(key);
    if (member?.meta?.calculation_role !== "structure_share") return [];
    const components = member.meta.components;
    if (typeof components !== "object" || components === null || Array.isArray(components))
      return [];
    const numerator = (components as Record<string, unknown>).numerator;
    const denominator = (components as Record<string, unknown>).denominator;
    if (typeof numerator !== "string" || typeof denominator !== "string") return [];

    const numeratorColumn = columnForMember.get(qualify(key, numerator));
    const measureColumn = columnForMember.get(key);
    if (!numeratorColumn || !measureColumn) return [];
    return [
      {
        measure: measureColumn,
        numerator: numeratorColumn,
      },
    ];
  });
}
