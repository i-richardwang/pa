import { useState } from "react";
import { CircleAlertIcon, HistoryIcon } from "lucide-react";
import type { ReportDetail } from "@contracts/report_contract";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { EmptyPanel } from "../kit/empty_panel";
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
  const [target, setTarget] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // 关着不取数：历史是偶发动作，没打开时它连一次请求都不该发。
  const revisions = useReportRevisions(reportId, open);
  const restoreReport = useUpdateReport(reportId);
  const data = revisions.data;
  const error = revisions.error ?? actionError;

  async function restore() {
    if (target === null) return;
    setActionError(null);
    try {
      const report = await restoreReport.mutateAsync({
        action: { type: "restore", revision: target },
        if_revision: currentRevision,
      });
      await onRestored(report);
      setTarget(null);
      onOpenChange(false);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) return;
      setActionError(reason instanceof Error ? reason.message : String(reason));
      setTarget(null);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
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
              <div key={row.revision} className="flex items-center gap-3 rounded-md border p-3">
                <HistoryIcon aria-hidden="true" className="size-4 shrink-0 text-pa-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">{row.name}</p>
                  <p className="text-pa-muted text-xs">
                    版本 {row.revision} · {formatAt(row.saved_at)} · {row.saved_by}
                  </p>
                </div>
                <Button variant="subtle" onClick={() => setTarget(row.revision)}>
                  恢复
                </Button>
              </div>
            ))}
          </DialogPanel>
        </DialogPopup>
      </Dialog>

      <AlertDialog open={target !== null} onOpenChange={(next) => !next && setTarget(null)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>恢复版本 {target}？</AlertDialogTitle>
            <AlertDialogDescription>
              当前报告会替换为该版本的名称、查询与呈现，并作为一个新版本保存。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="subtle" />}>取消</AlertDialogClose>
            <Button loading={restoreReport.isPending} onClick={() => void restore()}>
              确认恢复
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
