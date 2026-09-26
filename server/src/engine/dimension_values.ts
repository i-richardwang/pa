/**
 * 查询维度候选值，供 Agent 在过滤前确认标准全名。
 * 成员与行权限由 Cube access_policy 执行，返回值只在授权范围内。
 */
import type { CubeMember, CubeQuery, CubeView } from "../ports/cube_gateway.js";
import { memberDisplayTitle } from "./member_presentation.js";
import { isSearchableDimension } from "./model_contract.js";

/** 单次候选值查询的返回上限；超出时提示用 contains 缩小范围。 */
export const DIMENSION_VALUES_CAP = 200;
/** distinct 结果至多包含一个 null 和一个空串，多取三行才能准确判断有效值是否截断。 */
export const DIMENSION_VALUES_SCAN_LIMIT = DIMENSION_VALUES_CAP + 3;

/** 在已按成员权限裁剪的目录中查找可搜索维度；不可搜索时报错并说明改法。 */
export function findSearchableDimension(
  views: CubeView[],
  member: string,
): CubeMember & { displayTitle: string } {
  for (const v of views) {
    const d = v.dimensions.find((x) => x.name === member);
    if (!d) continue;
    const displayTitle = memberDisplayTitle(views, member, d.title);
    if (!isSearchableDimension(d)) {
      throw new Error(`「${displayTitle}」不是可搜索的分类维度；数值和时间维度不提供候选值清单`);
    }
    return { ...d, displayTitle };
  }
  throw new Error(
    `维度「${member}」不在当前可搜索目录中；values_of 只接受 catalog 返回的语义维度 id`,
  );
}

export function dimensionValuesQuery(member: string, contains?: string): CubeQuery {
  return {
    dimensions: [member],
    ...(contains ? { filters: [{ member, operator: "contains", values: [contains] }] } : {}),
    order: [[member, "asc"]],
    limit: DIMENSION_VALUES_SCAN_LIMIT,
  };
}
