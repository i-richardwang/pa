/**
 * 控制台应用壳：拉取 /api/me，套应用壳（AppBar + 侧栏导航，见 layout/shell.tsx），按 hash 路由渲染分页。
 * 导航按角色分层（见 layout/shell.tsx），但访问边界始终是各端点的服务端守卫。
 */
import { useEffect, useState } from "react";
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
import { useHashRoute } from "./router";
import { DashboardShell, resolveRoute } from "./layout/shell";
import { FeedbackPage } from "./admin/feedback_page";
import { UsagePage } from "./admin/usage_page";

export function DashboardApp() {
  const meQuery = useMe();
  const me = meQuery.data ?? null;
  const error = errorText(meQuery.error);
  const [route, navigate] = useHashRoute();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 成员迁进设置弹层后，`#/users` 这条老深链继续可用——它开的是弹层的成员节。
  const settingsTab = route.page === "users" ? "users" : "account";

  async function signOut() {
    await authClient.signOut();
    window.location.assign("/login");
  }

  // `#/settings` 与 `#/users` 深链都打开弹层；关闭后回到报告列表，不把设置当整页。
  useEffect(() => {
    if (route.page === "settings" || route.page === "users") setSettingsOpen(true);
  }, [route.page]);

  function onSettingsOpenChange(open: boolean) {
    setSettingsOpen(open);
    if (!open && (route.page === "settings" || route.page === "users")) navigate("reports");
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

  // 详情页是列表的带参子页：导航高亮与角色守卫都落在对应列表项上；
  // 报告、查询记录与分析详情同属「我的报告」这一个导航项。
  const board = route.page === "board" ? route.id : null;
  const boardReportEdit = route.page === "board_report_edit" ? route : null;
  const report = route.page === "report" ? route.id : null;
  const analysis = route.page === "analysis" ? route.id : null;
  const analysisNew = route.page === "analysis_new";
  const active = resolveRoute(
    route.page === "board" || route.page === "board_report_edit"
      ? "boards"
      : route.page === "report" ||
          route.page === "reports_history" ||
          route.page === "analysis" ||
          route.page === "analysis_new"
        ? "reports"
        : route.page === "settings" || route.page === "users"
          ? "reports"
          : route.page,
    me.is_admin,
  );
  const isDetail = Boolean(board || boardReportEdit || report || analysis || analysisNew);
  const listChrome =
    !isDetail &&
    (active === "boards" ||
      active === "reports" ||
      active === "catalog" ||
      active === "model" ||
      active === "usage" ||
      active === "feedback");

  return (
    <DashboardShell
      me={me}
      route={active}
      navigate={navigate}
      onSignOut={signOut}
      listChrome={listChrome}
      settingsOpen={settingsOpen}
      settingsTab={settingsTab}
      onSettingsOpenChange={onSettingsOpenChange}
    >
      {boardReportEdit && active === "boards" ? (
        <BoardReportEditPage
          boardId={boardReportEdit.boardId}
          reportId={boardReportEdit.reportId}
        />
      ) : board && active === "boards" ? (
        <BoardPage
          me={me}
          id={board}
          timeOverride={route.page === "board" ? (route.time ?? null) : null}
        />
      ) : report && active === "reports" ? (
        <ReportPage id={report} />
      ) : analysisNew && active === "reports" ? (
        <AnalysisNewPage />
      ) : analysis && active === "reports" ? (
        <AnalysisPage id={analysis} />
      ) : (
        <>
          {active === "boards" && <BoardsPage me={me} />}
          {active === "reports" && (
            <MyReportsPage tab={route.page === "reports_history" ? "history" : "reports"} />
          )}
          {active === "catalog" && <CatalogPage />}
          {active === "model" && me.is_admin && <DataCapabilityMapPage />}
          {active === "usage" && me.is_admin && <UsagePage />}
          {active === "feedback" && me.is_admin && <FeedbackPage />}
        </>
      )}
    </DashboardShell>
  );
}
