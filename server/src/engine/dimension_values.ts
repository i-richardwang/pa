/**
 * 维度值核实（翻值）：catalog 的查前核实能力——"这个维度在数据里都有哪些值"。
 * 供 Agent 在过滤分类名录值前确认标准全名，代替猜测简称；
 * 只读不改写，查询本身仍是查什么给什么。
 *
 * 公开字符串维度天然可翻；数值/时间维度只有显式声明 dimension_kind: categorical 才可翻。
 * 受控记录字段属于 internal 成员，在进入本模块前已从公开目录剥离。
 * 成员权限由 Cube /meta 的 access_policy 裁剪结果承担（无权维度不可见即不可翻）；
 * 行权限由 /load 的同一 access_policy 执行（受限账号只能翻到授权范围内出现的值）。
 */
import type { CubeMember, CubeQuery, CubeView } from "../ports/cube_gateway.js";
import { memberDisplayTitle } from "./member_presentation.js";
import { isSearchableDimension } from "./model_contract.js";

/** 单次翻值返回的值数上限；超出提示用 contains 缩小范围 */
export const DIMENSION_VALUES_CAP = 200;
/** distinct 结果至多包含一个 null 和一个空串，多取三行才能准确判断有效值是否截断。 */
export const DIMENSION_VALUES_SCAN_LIMIT = DIMENSION_VALUES_CAP + 3;

/**
 * 在（已按成员权限裁剪的）目录视图中定位可翻维度；不可翻时抛出面向 Agent 的改法指引。
 */
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

/** 翻值查询（纯组装）：取维度 distinct 值 + 可选子串过滤；为 null/空串预留探测行。 */
export function dimensionValuesQuery(member: string, contains?: string): CubeQuery {
  return {
    dimensions: [member],
    ...(contains ? { filters: [{ member, operator: "contains", values: [contains] }] } : {}),
    order: [[member, "asc"]],
    limit: DIMENSION_VALUES_SCAN_LIMIT,
  };
}
