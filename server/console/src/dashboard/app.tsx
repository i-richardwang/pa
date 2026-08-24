/** 访问边界始终是各端点的服务端守卫，导航按角色分层不构成授权。 */
import { useState } from "react";
import { LoadingMark } from "pa-result-view";
import { authClient } from "../auth_client";
import { errorText, useMe } from "./dashboard_queries";
import { BoardPage } from "./boards/board_page";
import { BoardReportEditPage } from "./boards/board_report_edit_page";
import { CatalogPage } from "./catalog/catalog_page";
import { BoardsPage } from "./boards/boards_page";
import { MyReportsPage } from "./reports/my_reports_page";
import { AnalysisNewPage } from "./analyses/analysis_new_page";
import { AnalysisPage } from "./analyses/analysis_page";
import { ReportPage } from "./reports/report_page";
import { DataCapabilityMapPage } from "./catalog/data_capability_map_page";
import { type Route, type RouteKey, useHashRoute } from "./router";
import { DashboardShell, resolveRoute } from "./layout/shell";
import { FeedbackPage } from "./admin/feedback_page";
import { UsagePage } from "./admin/usage_page";

/**
 * 详情页是列表的带参子页：导航高亮与角色守卫都落在对应列表项上；
 * 报告、查询记录与分析详情同属「我的报告」这一个导航项。
 */
function navKeyOf(route: Route): RouteKey {
  switch (route.page) {
    case "board":
    case "board_report_edit":
      return "boards";
    case "report":
    case "analysis":
    case "analysis_new":
    case "settings":
      return "reports";
    default:
      return route.page;
  }
}

function isDetailRoute(route: Route): boolean {
  return (
    route.page === "board" ||
    route.page === "board_report_edit" ||
    route.page === "report" ||
    route.page === "analysis" ||
    route.page === "analysis_new"
  );
}

export function DashboardApp() {
  const meQuery = useMe();
  const me = meQuery.data ?? null;
  const error = errorText(meQuery.error);
  const [route, navigate] = useHashRoute();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRoute = route.page === "settings" ? route : null;
  function onSettingsOpenChange(open: boolean) {
    setSettingsOpen(open);
    if (!open && settingsRoute) navigate("reports");
  }

  async function signOut() {
    await authClient.signOut();
    window.location.assign("/login");
  }

  if (error) {
    return (
      <main className="grid min-h-svh place-items-center p-6">
        <p className="text-pa-danger-fg">{error}</p>
      </main>
    );
  }
  if (!me) {
    return (
      <main className="h-svh">
        <LoadingMark />
      </main>
    );
  }

  const active = resolveRoute(navKeyOf(route), me.is_admin);
  const page: Route =
    navKeyOf(route) === active && route.page !== "settings"
      ? route
      : { page: "reports", facet: "reports" };

  return (
    <DashboardShell
      me={me}
      route={active}
      navigate={navigate}
      onSignOut={signOut}
      listChrome={!isDetailRoute(page)}
      mainSurface={page.page === "board" ? "canvas" : "card"}
      settingsOpen={settingsOpen || settingsRoute !== null}
      settingsTab={settingsRoute?.tab}
      onSettingsOpenChange={onSettingsOpenChange}
    >
      {page.page === "board_report_edit" ? (
        <BoardReportEditPage boardId={page.boardId} reportId={page.reportId} />
      ) : page.page === "board" ? (
        <BoardPage me={me} id={page.id} timeOverride={page.time ?? null} />
      ) : page.page === "report" ? (
        <ReportPage key={page.id} id={page.id} />
      ) : page.page === "analysis_new" ? (
        <AnalysisNewPage />
      ) : page.page === "analysis" ? (
        <AnalysisPage id={page.id} />
      ) : page.page === "boards" ? (
        <BoardsPage me={me} />
      ) : page.page === "reports" ? (
        <MyReportsPage facet={page.facet} />
      ) : page.page === "catalog" ? (
        <CatalogPage />
      ) : page.page === "model" ? (
        <DataCapabilityMapPage />
      ) : page.page === "usage" ? (
        <UsagePage facet={page.facet} />
      ) : (
        <FeedbackPage />
      )}
    </DashboardShell>
  );
}
