/**
 * terms 数组逐项独立命中，成员按命中词数排序，不得拼成一个 substring 检索。
 * 成员主检索键只有 title；description 与 ai_context 只对全部成员 title 零命中的词兜底。
 * 业务同义词由全局指标域分类表达，不靠物理成员名兼容。
 * 视图级回退裁决在 catalog_document.ts，本模块只提供匹配原语。
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
