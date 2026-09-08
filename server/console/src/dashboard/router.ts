/**
 * 极简 hash 路由：分面各占一个 hash 段，筛选留在页内状态；
 * 设置是浮在当前页上的弹层，`#/settings`、`#/users` 两个深链落在报告列表之上打开它。
 * 非法或空 hash 归一到默认页 reports。
 */
import { useEffect, useRef, useState } from "react";
import { TIME_INTENT_INPUT, type TimeIntent } from "@time";

/** 侧栏导航项，也是各清单页的 hash 首段。 */
export type RouteKey =
  | "boards"
  | "reports"
  | "metrics"
  | "dimensions"
  | "terms"
  | "model"
  | "usage"
  | "feedback";

export type ReportsFacet = "reports" | "history" | "archived";
export type SettingsTab = "account" | "api" | "users";
export type UsageFacet = "titles" | "stats" | "unanswered";

export type Route =
  | { page: "boards" | "metrics" | "dimensions" | "terms" | "model" | "feedback" }
  | { page: "reports"; facet: ReportsFacet }
  | { page: "usage"; facet: UsageFacet }
  | { page: "settings"; tab: SettingsTab }
  | { page: "board"; id: string; time?: TimeIntent }
  | { page: "board_report_edit"; boardId: string; reportId: string }
  | { page: "report"; id: string }
  | { page: "analysis_new" }
  | { page: "analysis"; id: string };

const PLAIN_PAGES: ReadonlyArray<
  "boards" | "metrics" | "dimensions" | "terms" | "model" | "feedback"
> = ["boards", "metrics", "dimensions", "terms", "model", "feedback"];

/** 形似看板 id 即进看板页；id 有效性由服务端裁决。 */
const BOARD_HASH = /^board\/([^/]+)$/;
const BOARD_REPORT_EDIT_HASH = /^board\/([^/]+)\/report\/([^/]+)\/edit$/;
const REPORTS_HASH = /^reports(?:\/(history|archived))?$/;
const USAGE_HASH = /^usage(?:\/(stats|unanswered))?$/;
const SETTINGS_HASH = /^(settings|users)$/;
const REPORT_HASH = /^report\/([^/]+)$/;
/** `new` 保留段必须先于 `analysis/:id` 匹配。 */
const ANALYSIS_NEW_HASH = /^analysis\/new$/;
const ANALYSIS_HASH = /^analysis\/([^/]+)$/;

/** 应用内唯一的 hash 写入口：目标一律由本文件的 `*Hash()` 拼出。 */
export function navigateTo(hash: string): void {
  window.location.hash = hash;
}

/** 看板页 hash；可选 `?t=` 编码板级时间覆盖。 */
export function boardHash(id: string, time?: TimeIntent | null): string {
  if (!time) return `#/board/${id}`;
  return `#/board/${id}?t=${encodeURIComponent(JSON.stringify(time))}`;
}

function parseBoardTimeParam(raw: string | null): TimeIntent | undefined {
  if (!raw) return undefined;
  try {
    const checked = TIME_INTENT_INPUT.safeParse(JSON.parse(raw));
    return checked.success ? checked.data : undefined;
  } catch {
    return undefined;
  }
}

export function boardReportEditHash(boardId: string, reportId: string): string {
  return `#/board/${boardId}/report/${reportId}/edit`;
}

export function reportHash(id: string): string {
  return `#/report/${id}`;
}

/** 我的报告页；默认分面「报告」不占 hash 段。 */
export function reportsHash(facet: ReportsFacet = "reports"): string {
  return facet === "reports" ? "#/reports" : `#/reports/${facet}`;
}

export function reportsHistoryHash(): string {
  return reportsHash("history");
}

/** 使用日志页；默认分面「业务问题」不占 hash 段。 */
export function usageHash(facet: UsageFacet = "titles"): string {
  return facet === "titles" ? "#/usage" : `#/usage/${facet}`;
}

/** 设置弹层的深链；成员页有自己的入口 `#/users`。 */
export function settingsHash(tab: SettingsTab = "account"): string {
  return tab === "users" ? "#/users" : "#/settings";
}

export function analysisNewHash(): string {
  return "#/analysis/new";
}

export function analysisHash(id: string): string {
  return `#/analysis/${id}`;
}

/** hash（含或不含 `#/`）到路由：非法或空归默认页。 */
export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const params = new URLSearchParams(query);
  const boardReportEdit = BOARD_REPORT_EDIT_HASH.exec(path);
  if (boardReportEdit) {
    return { page: "board_report_edit", boardId: boardReportEdit[1], reportId: boardReportEdit[2] };
  }
  const board = BOARD_HASH.exec(path);
  if (board) {
    const time = parseBoardTimeParam(params.get("t"));
    return time ? { page: "board", id: board[1], time } : { page: "board", id: board[1] };
  }
  const reports = REPORTS_HASH.exec(path);
  if (reports) {
    return { page: "reports", facet: (reports[1] as ReportsFacet | undefined) ?? "reports" };
  }
  const usage = USAGE_HASH.exec(path);
  if (usage) return { page: "usage", facet: (usage[1] as UsageFacet | undefined) ?? "titles" };
  const settings = SETTINGS_HASH.exec(path);
  if (settings) return { page: "settings", tab: settings[1] === "users" ? "users" : "account" };
  const report = REPORT_HASH.exec(path);
  if (report) return { page: "report", id: report[1] };
  if (ANALYSIS_NEW_HASH.test(path)) return { page: "analysis_new" };
  const analysis = ANALYSIS_HASH.exec(path);
  if (analysis) return { page: "analysis", id: analysis[1] };
  const plain = PLAIN_PAGES.find((page) => page === path);
  return plain ? { page: plain } : { page: "reports", facet: "reports" };
}

/**
 * 导航离开守卫。守卫状态是模块级单例：控制台同时至多一个编辑态。
 * 只有 hash 的 path 段变化才算离开；同页仅 query 段变化（如看板 `?t=`）不拦。
 * 判据只有「这次离开会不会丢工作」一条，与谁发起导航无关：草稿落库即不脏，守卫自然放行，
 * 因此没有、也不该有「本次跳转豁免」之类的旁路。
 */
let leaveGuard: { dirty: () => boolean; confirm: () => Promise<boolean> } | null = null;

/** 传入的 `dirty` 每次导航都会被调用，必须现问现答：落库后的那一拍就要答「不脏」。 */
export function useLeaveBlocker(dirty: () => boolean, confirm: () => Promise<boolean>): void {
  const live = useRef({ dirty, confirm });
  live.current = { dirty, confirm };
  useEffect(() => {
    leaveGuard = { dirty: () => live.current.dirty(), confirm: () => live.current.confirm() };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!live.current.dirty()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      leaveGuard = null;
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);
}

export function useHashRoute(): [Route, (r: RouteKey) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  // 当前生效的 hash：回滚拦截时不更新它，使回滚触发的 hashchange 回声被早退吞掉
  const currentRef = useRef<string>(window.location.hash);
  useEffect(() => {
    const pathOf = (hash: string) => hash.replace(/^#\/?/, "").split("?")[0];
    const onHash = () => {
      const to = window.location.hash;
      if (to === currentRef.current) return;
      const guard = leaveGuard;
      if (guard?.dirty() && pathOf(to) !== pathOf(currentRef.current)) {
        const target = to;
        navigateTo(currentRef.current);
        void guard.confirm().then((ok) => {
          if (ok) navigateTo(target);
        });
        return;
      }
      currentRef.current = to;
      setRoute(parseRoute(to));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return [
    route,
    (r: RouteKey) => {
      navigateTo(`#/${r}`);
    },
  ];
}
