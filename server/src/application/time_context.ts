import type { CubeView, TimeContext } from "../ports/cube_gateway.js";
import type { PublicTimeContext } from "../semantic_core/query_payload.js";
import { timeSourceLabel, type TimeSourceRegistry } from "../semantic_core/time_source.js";

/** 对外只输出时间源的业务标签，不输出内部时间源 key。 */
type TimeSourcedView = { time_source?: string };

export function timeSourced(views: CubeView[]): TimeSourcedView[] {
  return views.map((view) => ({
    ...(typeof view.meta?.time_source === "string" ? { time_source: view.meta.time_source } : {}),
  }));
}

export function publicTimeContext(
  views: TimeSourcedView[],
  context: TimeContext | null,
  timeSources: TimeSourceRegistry,
): PublicTimeContext {
  if (!context) return [];
  const bySource = new Map<string, PublicTimeContext[number]>();
  for (const view of views) {
    const key = view.time_source;
    // 按时间源 key 去重，不同 key 可能有相同标题。
    if (!key || bySource.has(key)) continue;
    const source = context.sources[key];
    if (!source) continue;
    bySource.set(key, {
      title: timeSourceLabel(timeSources, key),
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
