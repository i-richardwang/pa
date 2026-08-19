/** 把本人 analysis handle 保存为独立报告。 */
import { useEffect, useState } from "react";
import type { CreateReportBody, ReportRow } from "@contracts/report_contract";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toastManager } from "@/components/ui/toast";
import { ApiError } from "../api";
import { useCreateReport } from "../dashboard_queries";

export type SaveReportTarget = { id: string; title: string };

export function SaveReportDialog({
  target,
  onClose,
  onSaved,
}: {
  target: SaveReportTarget | null;
  onClose: () => void;
  /** 保存成功后回传新建报告；看板编辑器据此追加引用瓦片。 */
  onSaved?: (row: ReportRow) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const createReport = useCreateReport();

  useEffect(() => {
    if (!target) return;
    setName(target.title);
    setError(null);
  }, [target]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!target) return;
    setError(null);
    try {
      const body: CreateReportBody = {
        analysis_id: target.id,
        name,
      };
      const row = await createReport.mutateAsync(body);
      if (onSaved) {
        onSaved(row);
      } else {
        toastManager.add({
          type: "success",
          title: `已保存「${row.name}」`,
          description: "可在「我的报告」中查看并加入看板。",
        });
      }
      onClose();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) return;
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <Dialog open={target != null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>保存为报告</DialogTitle>
        </DialogHeader>
        <Form className="contents" onSubmit={submit}>
          <DialogPanel className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="saved-report-name">名称</FieldLabel>
              <Input
                id="saved-report-name"
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            {error && (
              <Field>
                <FieldError match>{error}</FieldError>
              </Field>
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="subtle" />}>取消</DialogClose>
            <Button
              variant="filled"
              type="submit"
              loading={createReport.isPending}
              disabled={!name.trim()}
            >
              保存
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}
