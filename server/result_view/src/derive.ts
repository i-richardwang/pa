
import { isTimeColumn } from "../../src/presentation_core/view_format.js";
import { memberShortName } from "../../src/semantic_core/member_name.js";
import { detectRoles, makeTitleOf, primaryMeasureIndices } from "../../src/presentation_core/view_shape.js";
import type { QueryPayload, ViewBlock } from "../../src/semantic_core/query_payload.js";

export { makeTitleOf };

const FALLBACK_TITLE = "查询结果";

/**
 * 卡片标题：调用方在查询时声明的业务问题（payload.title）优先——它带着用户的措辞与
 * 过滤/时间窗限定，是结果列反推不出来的；缺省时退结果结构派生的标题。
 */
export function cardTitle(
  payload: QueryPayload,
  view: ViewBlock,
  titleOf: (c: string) => string,
): string {
  return payload.title ?? headerTitle(view, titleOf);
}

/**
 * 结构式副标题：标题为调用方声明时，机器派生的结构式仍作为口径锚点展示在副标题——
 * 标题说意图、副标题说事实，声明与数据错位时读者有对照。无信息量（派生失败）时不展示。
 */
export function headerSubtitle(
  payload: QueryPayload,
  view: ViewBlock,
  titleOf: (c: string) => string,
): string | null {
  if (!payload.title) return null;
  const derived = headerTitle(view, titleOf);
  return derived === FALLBACK_TITLE ? null : derived;
}

/**
 * 派生标题 = 度量 · 按分类维度 · 趋势粒度，如"在职人数 · 按职级 · 月度趋势"——
 * 列角色取自 shape.detectRoles，与图型判定同源：图上画了什么，标题就说什么。
 * 占比派生列与取值唯一的分类列（过滤条件回显）循 shape 同规不进标题；
 * 时间列有 ≥2 个时点才算趋势（单时点是过滤回显），带 month 列即月度、否则年度。
 */
export function headerTitle(view: ViewBlock, titleOf: (c: string) => string): string {
  const roles = detectRoles(view);
  const measures = primaryMeasureIndices(view, roles.measureIdx).map((i) =>
    titleOf(view.columns[i]),
  );
  const cats = roles.catIdx.map((i) => titleOf(view.columns[i]));
  if (!measures.length) return cats.length ? cats.join("、") : FALLBACK_TITLE;
  const parts = [measures.slice(0, 3).join("、") + (measures.length > 3 ? " 等" : "")];
  if (cats.length) parts.push(`按${cats.join(" × ")}`);
  if (roles.timePoints.length >= 2) {
    const monthly = view.columns.some((c) => isTimeColumn(c) && memberShortName(c) === "month");
    parts.push(monthly ? "月度趋势" : "年度趋势");
  }
  return parts.join(" · ");
}
