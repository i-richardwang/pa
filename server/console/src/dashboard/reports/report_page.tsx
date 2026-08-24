import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArchiveIcon, HistoryIcon } from "lucide-react";
import type { ReportsPayload } from "@contracts/report_contract";
import { MenuItem } from "@/components/ui/menu";
import { toastManager } from "@/components/ui/toast";
import { AnalysisWorkbench } from "../analyses/analysis_workbench";
import { dashboardKeys, useCatalogQuery } from "../dashboard_queries";
import { performUndoable } from "../kit/undo";
import { ReportHistoryDialog } from "./report_history_dialog";
import { useArchiveReport, useReportResource } from "../editor_queries";
import { useAnalysisEditSession } from "../analyses/use_analysis_edit_session";
import { HeaderMenu } from "../layout/view_chrome";
import { navigateTo, reportsHash } from "../router";
import { AddToBoardAction } from "./add_to_board_picker";

export function ReportPage({ id }: { id: string }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const { report, savedReplay, reportError, replayError } = useReportResource(id);
  const queryClient = useQueryClient();
  const archiveReport = useArchiveReport();
  const catalog = useCatalogQuery().data ?? null;

  const seed = report
    ? {
        name: report.name,
        analysis: report.analysis,
        view: report.view,
        view_preferences: report.view_preferences,
        hasSavedResult: true,
        ownedViewId: report.view_id,
      }
    : null;
  const edit = useAnalysisEditSession({
    sessionKey: `report:${id}`,
    seed,
    savedReplay,
    target: { kind: "update", reportId: id, ifRevision: report?.revision ?? 1 },
  });
  /** 归档回到清单：清单先撤下这一行，回执关闭才提交；撤销把它放回清单。 */
  function archive() {
    if (!report) return;
    const { id: reportId, name, revision } = report;
    queryClient.setQueryData<ReportsPayload>(dashboardKeys.reports, (current) =>
      current ? { ...current, rows: current.rows.filter((row) => row.id !== reportId) } : current,
    );
    navigateTo(reportsHash());
    performUndoable({
      title: `已归档「${name}」`,
      failureTitle: "归档失败",
      revert: () => void queryClient.invalidateQueries({ queryKey: dashboardKeys.reports }),
      commit: () => archiveReport.mutateAsync({ id: reportId, ifRevision: revision }),
    });
  }

  return (
    <>
      <AnalysisWorkbench
        catalog={catalog}
        crumb={{ href: "#/reports", label: "我的报告" }}
        error={reportError ?? replayError}
        recordSource={{ kind: "report", reportId: id }}
        saveLabel="保存"
        session={edit}
        title={report?.name ?? "报告"}
        actions={
          <>
            {report && <AddToBoardAction reportId={report.id} />}
            {report && (
              <HeaderMenu label="报告操作">
                <MenuItem onClick={() => setHistoryOpen(true)}>
                  <HistoryIcon aria-hidden="true" />
                  版本历史…
                </MenuItem>
                <MenuItem onClick={archive}>
                  <ArchiveIcon aria-hidden="true" />
                  归档报告
                </MenuItem>
              </HeaderMenu>
            )}
          </>
        }
      />
      <ReportHistoryDialog
        currentRevision={report?.revision ?? 1}
        onOpenChange={setHistoryOpen}
        onRestored={async () => {
          toastManager.add({ type: "success", title: "已恢复为新版本" });
        }}
        open={historyOpen}
        reportId={id}
      />
    </>
  );
}
