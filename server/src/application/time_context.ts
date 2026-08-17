import type { CubeView, TimeContext } from "../ports/cube_gateway.js";
import type { PublicTimeContext } from "../semantic_core/query_payload.js";
import { timeSourceLabel } from "../semantic_core/time_source.js";

/** 时间可用性以内部时间源 key 去重后投影为有序展示数组；对外只出现业务标签，key 绝不上线。 */
type TimeSourcedView = { time_source?: string };

export function timeSourced(views: CubeView[]): TimeSourcedView[] {
  return views.map((view) => ({
    ...(typeof view.meta?.time_source === "string" ? { time_source: view.meta.time_source } : {}),
  }));
}

export function publicTimeContext(
  views: TimeSourcedView[],
  context: TimeContext | null,
): PublicTimeContext {
  if (!context) return [];
  const bySource = new Map<string, PublicTimeContext[number]>();
  for (const view of views) {
    const key = view.time_source;
    // 内部 source key 去重：重复标题不会互相覆盖，因为身份是 source key 而不是标题。
    if (!key || bySource.has(key)) continue;
    const source = context.sources[key];
    if (!source) continue;
    bySource.set(key, {
      title: timeSourceLabel(key),
      actual_through: source.actualThrough,
      available_through: source.availableThrough,
      ...(source.planThrough ? { plan_through: source.planThrough } : {}),
    });
  }
  return [...bySource.values()];
}

export function viewsForMembers(views: CubeView[], members: string[]): CubeView[] {
  const names = new Set(members.map((member) => member.split(".")[0]).filter(Boolean));
  return views.filter((view) => names.has(view.name));
}
