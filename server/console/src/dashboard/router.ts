/** 设置是弹层：`#/settings`、`#/users` 在报告列表上打开它。 */
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

/** 看板 id 是否存在由服务端校验。 */
const BOARD_HASH = /^board\/([^/]+)$/;
const BOARD_REPORT_EDIT_HASH = /^board\/([^/]+)\/report\/([^/]+)\/edit$/;
const REPORTS_HASH = /^reports(?:\/(history|archived))?$/;
const USAGE_HASH = /^usage(?:\/(stats|unanswered))?$/;
const SETTINGS_HASH = /^(settings|users)$/;
const REPORT_HASH = /^report\/([^/]+)$/;
/** `analysis/new` 必须在 `analysis/:id` 之前匹配。 */
const ANALYSIS_NEW_HASH = /^analysis\/new$/;
const ANALYSIS_HASH = /^analysis\/([^/]+)$/;

/** 应用内写 hash 都经过这里，目标用本文件的 `*Hash()` 生成。 */
export function navigateTo(hash: string): void {
  window.location.hash = hash;
}

/** `?t=` 编码看板级时间覆盖。 */
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

export function reportsHash(facet: ReportsFacet = "reports"): string {
  return facet === "reports" ? "#/reports" : `#/reports/${facet}`;
}

export function reportsHistoryHash(): string {
  return reportsHash("history");
}

export function usageHash(facet: UsageFacet = "titles"): string {
  return facet === "titles" ? "#/usage" : `#/usage/${facet}`;
}

export function settingsHash(tab: SettingsTab = "account"): string {
  return tab === "users" ? "#/users" : "#/settings";
}

export function analysisNewHash(): string {
  return "#/analysis/new";
}

export function analysisHash(id: string): string {
  return `#/analysis/${id}`;
}

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
 * 离开守卫是模块级单例，控制台同时最多一个编辑页。只有 hash 的 path 段变化才算离开，
 * 只改 query（如看板 `?t=`）不拦截。是否拦截只看 dirty()，不提供跳过守卫的开关。
 */
let leaveGuard: { dirty: () => boolean; confirm: () => Promise<boolean> } | null = null;

/** `dirty` 在每次导航时调用，必须反映当前状态：保存完成后立即返回 false。 */
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
  // 拦截回滚时不更新它，回滚触发的 hashchange 会在相等判断处直接返回
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
