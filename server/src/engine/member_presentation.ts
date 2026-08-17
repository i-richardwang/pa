import type { CubeMember, CubeView } from "../ports/cube_gateway.js";
import { dimensionKind } from "./model_contract.js";

/**
 * 成员展示名的唯一规范化入口。Cube 的 title 可能带 view 标题前缀，shortTitle 才是
 * 面向用户的成员名；shortTitle 缺失时只剥精确匹配的所属 view 前缀。
 */
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

/** 重叠分类天然需要解释；其余维度只在模型显式声明时展示口径说明。 */
export function showDimensionNote(member: CubeMember | undefined): boolean {
  return (
    member?.meta?.user_note === true || (member ? dimensionKind(member) === "overlapping" : false)
  );
}
