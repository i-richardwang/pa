import { useState } from "react";
import { CircleAlertIcon, HistoryIcon } from "lucide-react";
import type { ReportDetail } from "@contracts/report_contract";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { EmptyPanel } from "../kit/empty_panel";
import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadingMark } from "pa-result-view";
import { ApiError, formatAt } from "../api";
import { useReportRevisions, useUpdateReport } from "../editor_queries";

export function ReportHistoryDialog({
  open,
  onOpenChange,
  reportId,
  currentRevision,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportId: string;
  currentRevision: number;
  onRestored: (report: ReportDetail) => Promise<void>;
}) {
  const [actionError, setActionError] = useState<string | null>(null);
  // 关着不取数：历史是偶发动作，没打开时它连一次请求都不该发。
  const revisions = useReportRevisions(reportId, open);
  const restoreReport = useUpdateReport(reportId);
  const data = revisions.data;
  const error = revisions.error ?? actionError;

  const changeOpen = (next: boolean) => {
    if (!next) setActionError(null);
    onOpenChange(next);
  };

  const restoreTarget =
    restoreReport.isPending && restoreReport.variables?.action.type === "restore"
      ? restoreReport.variables.action.revision
      : null;

  async function restore(revision: number) {
    setActionError(null);
    try {
      const report = await restoreReport.mutateAsync({
        action: { type: "restore", revision },
        if_revision: currentRevision,
      });
      await onRestored(report);
      changeOpen(false);
      toastManager.add({ title: `已恢复版本 ${revision}` });
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) return;
      setActionError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>版本历史</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-2">
          {error && (
            <Alert variant="error">
              <CircleAlertIcon />
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )}
          {!data && !error && <LoadingMark className="py-6" />}
          {data?.rows.length === 0 && <EmptyPanel text="尚无历史版本" />}
          {data?.rows.map((row) => (
            <div
              key={row.revision}
              className="flex items-center gap-3 rounded-md border border-pa-line p-3"
            >
              <HistoryIcon aria-hidden="true" className="size-4 shrink-0 text-pa-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-sm">{row.name}</p>
                <p className="text-pa-muted text-xs">
                  版本 {row.revision} · {formatAt(row.saved_at)} · {row.saved_by}
                </p>
              </div>
              <Button
                loading={restoreTarget === row.revision}
                disabled={restoreReport.isPending}
                variant="subtle"
                onClick={() => void restore(row.revision)}
              >
                恢复
              </Button>
            </div>
          ))}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
