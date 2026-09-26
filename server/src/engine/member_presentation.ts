import type { CubeMember, CubeView } from "../ports/cube_gateway.js";
import { dimensionKind } from "./model_contract.js";

/** Cube 的 title 可能带 view 标题前缀；优先用 shortTitle，缺失时只去掉与所属 view 标题完全匹配的前缀。 */
export function memberDisplayTitle(
  views: CubeView[],
  memberName: string,
  fallback: string,
): string {
  const view = views.find((v) => v.name === memberName.split(".")[0]);
  const member = view
    ? [...view.measures, ...view.dimensions].find((m) => m.name === memberName)
    : undefined;
  if (member?.shortTitle) return member.shortTitle;
  const title = member?.title ?? fallback;
  const prefix = view ? `${view.title} ` : "";
  return prefix && title.startsWith(prefix) ? title.slice(prefix.length) : title;
}

/** overlapping 维度总是展示口径说明；其他维度只在声明 user_note 时展示。 */
export function showDimensionNote(member: CubeMember | undefined): boolean {
  return (
    member?.meta?.user_note === true || (member ? dimensionKind(member) === "overlapping" : false)
  );
}
