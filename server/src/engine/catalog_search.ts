/**
 * catalog 检索 = 购物单契约：Agent 把一次答数所需的全部业务概念作为 terms 数组一次报出，
 * 各术语独立命中，成员按命中词数排序；不得把数组拼成一个 substring 检索。
 *
 * 成员主检索键只有 title——物理成员名（Cube view.member）不是公共成员语言，绝不进检索键；
 * description 与 ai_context 都只在某词对全部成员 title 零命中时参与兜底，避免常见业务词经口径或
 * Agent 教学过度召回，同时让“Band C+”这类只存在于成员教学中的业务写法仍能发现权威维度。
 * 业务同义词由全局指标域分类表达，不靠物理成员名兼容。
 *
 * 命中成员精确返回；指标域命中（业务标题/说明/同义词）且无任何成员命中时才回退全量成员
 * （目录页浏览语义）——回退裁决在 catalog_document.ts，本模块只提供匹配原语。
 */
import type { CubeMember } from "../ports/cube_gateway.js";

export type SearchableMember = Pick<CubeMember, "title" | "description"> & {
  ai_context?: string;
};
export type SearchableView = {
  measures: SearchableMember[];
  dimensions: SearchableMember[];
};

function titleHit(token: string, m: SearchableMember): boolean {
  return m.title.toLowerCase().includes(token.toLowerCase());
}

/** 单成员命中判定：title 恒参与，业务口径与 Agent 教学仅对兜底词开放；物理成员名不参与。 */
export function memberHit(token: string, m: SearchableMember, withFallback: boolean): boolean {
  const term = token.toLowerCase();
  return (
    titleHit(term, m) ||
    (withFallback &&
      [(m.description ?? "").toLowerCase(), (m.ai_context ?? "").toLowerCase()].some((text) =>
        text.includes(term),
      ))
  );
}

/** 允许口径与 Agent 教学兜底召回的词：在全部视图任何成员的 title 上零命中。 */
export function memberFallbackTokens(tokens: string[], views: SearchableView[]): Set<string> {
  const members = views.flatMap((v) => [...v.measures, ...v.dimensions]);
  return new Set(tokens.filter((t) => !members.some((m) => titleHit(t, m))));
}

export function hitCount(tokens: string[], haystack: string[]): number {
  return tokens.filter((t) => {
    const term = t.toLowerCase();
    return haystack.some((s) => s.includes(term));
  }).length;
}

/** 命中词数降序、同分保持目录原序（稳定排序），零命中成员剔除 */
export function rankMembers<T extends SearchableMember>(
  tokens: string[],
  members: T[],
  fallbackTokens: Set<string>,
): T[] {
  return members
    .map((m, i) => ({
      m,
      i,
      score: tokens.filter((t) => memberHit(t, m, fallbackTokens.has(t))).length,
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((s) => s.m);
}
