import { useState } from "react";
import { ArchiveIcon, HistoryIcon } from "lucide-react";
import { MenuItem } from "@/components/ui/menu";
import { toastManager } from "@/components/ui/toast";
import { AnalysisWorkbench } from "../analyses/analysis_workbench";
import { useCatalogQuery } from "../dashboard_queries";
import { toastWithUndo } from "../kit/undo";
import { ReportHistoryDialog } from "./report_history_dialog";
import { useArchiveReport, useReportResource, useUnarchiveReport } from "../editor_queries";
import { useAnalysisEditSession } from "../analyses/use_analysis_edit_session";
import { HeaderMenu } from "../layout/view_chrome";
import { navigateTo, reportHash, reportsHash } from "../router";
import { AddToBoardAction } from "./add_to_board_picker";

export function ReportPage({ id }: { id: string }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const { report, savedReplay, reportError, replayError } = useReportResource(id);
  const archiveReport = useArchiveReport();
  const unarchiveReport = useUnarchiveReport();
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
    // 原地保存留在本页；只有「另存为」产生新报告，才换向那份新报告。
    onCreated: (created) => navigateTo(reportHash(created.id)),
  });
  function archive() {
    if (!report) return;
    const { id: reportId, name, revision } = report;
    archiveReport.mutate(
      { id: reportId, ifRevision: revision },
      {
        onSuccess: (archived) =>
          toastWithUndo({
            title: `已归档「${name}」`,
            undo: () =>
              unarchiveReport.mutateAsync({ id: reportId, ifRevision: archived.revision }),
          }),
      },
    );
    navigateTo(reportsHash());
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
