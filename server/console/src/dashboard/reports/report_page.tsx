import { useEffect, useState } from "react";
import { ArchiveIcon, HistoryIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { MenuItem } from "@/components/ui/menu";
import { toastManager } from "@/components/ui/toast";
import { AnalysisWorkbench } from "../analyses/analysis_workbench";
import { ApiError } from "../api";
import { useCatalogQuery } from "../dashboard_queries";
import {
  RecordProjectionDialog,
  type RecordProjectionDialogRequest,
} from "./record_projection_dialog";
import { ReportHistoryDialog } from "./report_history_dialog";
import { useReportResource, useUpdateReport } from "../editor_queries";
import { useAnalysisEditSession } from "../analyses/use_analysis_edit_session";
import { HeaderMenu } from "../layout/view_chrome";
import { AddToBoardAction } from "./add_to_board_picker";
import { useRecordProjection } from "./use_record_projection";

export function ReportPage({ id }: { id: string }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [recordProjectionRequest, setRecordProjectionRequest] =
    useState<RecordProjectionDialogRequest | null>(null);
  const { report, savedReplay, reportError, replayError } = useReportResource(id);
  const archiveReport = useUpdateReport(id);
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
  const records = useRecordProjection({
    scope: "report",
    reportId: id,
    replay: savedReplay,
    // 明细只对报告当前保存的 View 开放，避免草稿坐标与报告 revision 交叉。
    disabled: !edit.showingSavedReplay,
    onRequest: setRecordProjectionRequest,
  });
  useEffect(() => setRecordProjectionRequest(null), [id]);

  async function archive() {
    if (!report) return;
    try {
      await archiveReport.mutateAsync({
        action: { type: "archive" },
        if_revision: report.revision,
      });
      setArchiveOpen(false);
      window.location.hash = "/reports";
      toastManager.add({ type: "success", title: `已归档「${report.name}」` });
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) return;
      const conflict = reason instanceof ApiError && reason.status === 409;
      toastManager.add({
        type: "error",
        title: conflict ? "报告已被其他操作更新" : "归档失败",
        description: conflict
          ? "请刷新后再归档，当前操作没有覆盖服务器上的新版本。"
          : reason instanceof Error
            ? reason.message
            : String(reason),
      });
    }
  }

  return (
    <>
      <AnalysisWorkbench
        catalog={catalog}
        crumb={{ href: "#/reports", label: "我的报告" }}
        error={reportError ?? replayError}
        records={records}
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
                <MenuItem disabled={archiveReport.isPending} onClick={() => setArchiveOpen(true)}>
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
      <RecordProjectionDialog
        request={recordProjectionRequest}
        onClose={() => setRecordProjectionRequest(null)}
      />
      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>归档「{report?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              归档后将从「我的报告」移除；已有看板引用与版本历史仍会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="subtle" />}>取消</AlertDialogClose>
            <Button
              loading={archiveReport.isPending}
              variant="danger"
              onClick={() => void archive()}
            >
              确认归档
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
