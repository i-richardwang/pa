/**
 * 极简 hash 路由：控制台整棵 /dashboard 子树是单文件服务端整页返回，
 * hash 路由无需服务端 catch-all，且保留浏览器前进后退与书签能力。
 * 看板与报告详情使用带参路由，使资产可被保存为书签和直接转发。
 * 页面分面（看哪一批东西）各占一个 hash 段，切分面同样可书签、可前进后退；
 * 筛选（看多大范围）留在页内状态。
 * 非法或空 hash 归一到默认页（reports，业务首屏）。
 */
import { useEffect, useRef, useState } from "react";
import { TIME_INTENT_INPUT, type TimeIntent } from "@time";

/** 侧栏导航项，也是各清单页的 hash 首段。 */
export type RouteKey = "boards" | "reports" | "catalog" | "model" | "usage" | "feedback";

export type ReportsFacet = "reports" | "history";
export type UsageFacet = "titles" | "stats" | "unanswered";

export type Route =
  | { page: "boards" | "catalog" | "model" | "feedback" }
  | { page: "reports"; facet: ReportsFacet }
  | { page: "usage"; facet: UsageFacet }
  | { page: "board"; id: string; time?: TimeIntent }
  | { page: "board_report_edit"; boardId: string; reportId: string }
  | { page: "report"; id: string }
  | { page: "analysis_new" }
  | { page: "analysis"; id: string };

const PLAIN_PAGES: ReadonlyArray<"boards" | "catalog" | "model" | "feedback"> = [
  "boards",
  "catalog",
  "model",
  "feedback",
];

/** 形似看板 id 即进看板页——id 是否有效由服务端裁决，无效在页内得到明确报错而非静默回默认页 */
const BOARD_HASH = /^board\/([^/]+)$/;
const BOARD_REPORT_EDIT_HASH = /^board\/([^/]+)\/report\/([^/]+)\/edit$/;
const REPORTS_HASH = /^reports(?:\/(history))?$/;
const USAGE_HASH = /^usage(?:\/(stats|unanswered))?$/;
const REPORT_HASH = /^report\/([^/]+)$/;
/** `new` 是 analysis 命名空间下的保留段，必须先于 `analysis/:id` 匹配，否则会被当成分析 id */
const ANALYSIS_NEW_HASH = /^analysis\/new$/;
const ANALYSIS_HASH = /^analysis\/([^/]+)$/;

/** 应用内唯一的 hash 写入口：目标一律由本文件的 `*Hash()` 拼出。 */
export function navigateTo(hash: string): void {
  window.location.hash = hash;
}

/** 看板页的 hash（含 #），供导航与链接共用一个拼写落点；可选 `?t=` 编码板级时间覆盖。 */
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
  return facet === "reports" ? "#/reports" : "#/reports/history";
}

/** 我的报告页「查询记录」分面 */
export function reportsHistoryHash(): string {
  return reportsHash("history");
}

/** 使用日志页；默认分面「业务问题」不占 hash 段。 */
export function usageHash(facet: UsageFacet = "titles"): string {
  return facet === "titles" ? "#/usage" : `#/usage/${facet}`;
}

/** 空白新建分析页的 hash：尚未铸出快照，故以保留段 `new` 占位于 analysis/ 命名空间 */
export function analysisNewHash(): string {
  return "#/analysis/new";
}

/** 分析详情页（按 view_id 重放）的 hash */
export function analysisHash(id: string): string {
  return `#/analysis/${id}`;
}

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "");
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
  if (reports) return { page: "reports", facet: reports[1] ? "history" : "reports" };
  const usage = USAGE_HASH.exec(path);
  if (usage) return { page: "usage", facet: (usage[1] as UsageFacet | undefined) ?? "titles" };
  const report = REPORT_HASH.exec(path);
  if (report) return { page: "report", id: report[1] };
  if (ANALYSIS_NEW_HASH.test(path)) return { page: "analysis_new" };
  const analysis = ANALYSIS_HASH.exec(path);
  if (analysis) return { page: "analysis", id: analysis[1] };
  const plain = PLAIN_PAGES.find((page) => page === path);
  return plain ? { page: plain } : { page: "reports", facet: "reports" };
}

/**
 * 导航离开守卫：编辑态有未保存草稿时，
 * 拦截离开当前页的一切路径——浏览器级刷新/关闭走 beforeunload 原生确认，应用内导航
 * （侧栏 navigate 改 hash、logo/返回 anchor 均汇于 hashchange）由 useHashRoute 在 hashchange
 * 时回滚 hash 并跑异步确认，确认通过再放行。守卫状态为模块级单例：控制台同时至多一个编辑态。
 * 只有 hash 的 path 段变化才算离开；同页仅 query 段变化（如看板 `?t=` 时间覆盖）是
 * 页内状态变更，不拦。
 */
let blockerActive = false;
let blockerConfirm: (() => Promise<boolean>) | null = null;

export function useLeaveBlocker(active: boolean, confirm: () => Promise<boolean>): void {
  // confirm 每次渲染换引用，用 ref 稳定身份，避免 effect 反复重挂
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  useEffect(() => {
    if (!active) return;
    blockerActive = true;
    blockerConfirm = () => confirmRef.current();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      blockerActive = false;
      blockerConfirm = null;
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [active]);
}

export function useHashRoute(): [Route, (r: RouteKey) => void] {
  const [route, setRoute] = useState<Route>(parseHash);
  // 当前生效的 hash：回滚拦截时不更新它，使回滚触发的 hashchange 回声被早退吞掉
  const currentRef = useRef<string>(window.location.hash);
  useEffect(() => {
    const pathOf = (hash: string) => hash.replace(/^#\/?/, "").split("?")[0];
    const onHash = () => {
      const to = window.location.hash;
      if (to === currentRef.current) return;
      if (blockerActive && blockerConfirm && pathOf(to) !== pathOf(currentRef.current)) {
        const target = to;
        navigateTo(currentRef.current); // 回滚，阻止应用切页
        void blockerConfirm().then((ok) => {
          if (ok) {
            blockerActive = false; // 已确认的目标只放行一次，后续导航仍需重新建立守卫。
            navigateTo(target);
          }
        });
        return;
      }
      currentRef.current = to;
      setRoute(parseHash());
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
