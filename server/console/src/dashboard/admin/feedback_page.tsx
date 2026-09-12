/**
 * 接受只表示认可该缺口值得补；指标、口径与数据范围仍以模型 YAML 的 Git 变更为准。
 */
import { useEffect, useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { FEEDBACK_LIMITS, type FeedbackGroup } from "@contracts/feedback_contract";
import { LoadingMark } from "pa-result-view";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EmptyPanel } from "../kit/empty_panel";
import { errorText, formatAt } from "../api";
import { useFeedbackPage, useResolveFeedback } from "../dashboard_queries";
import { ListPageBody, ListScrollBody } from "../layout/layout_chrome";
import { SheetSection } from "../kit/sheet_kit";
import { SortableHead, useTableSort } from "../kit/table_kit";
import { TablePager } from "../kit/table_pager";

const STATUS_LABEL = { open: "待处理", accepted: "已接受", rejected: "已拒绝" } as const;
const STATUS_VARIANT = { open: "warning", accepted: "success", rejected: "default" } as const;

const FEEDBACK_SORT: Record<
  "status" | "last",
  (row: FeedbackGroup) => string | number | null | undefined
> = {
  status: (row) => row.status,
  last: (row) => row.last_at,
};

export function FeedbackPage() {
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<FeedbackGroup | null>(null);
  const feedbackQuery = useFeedbackPage(offset);
  const data = feedbackQuery.data ?? null;
  const loading = feedbackQuery.isFetching;
  const error = errorText(feedbackQuery.error);
  const { rows, sort, toggle } = useTableSort(data?.rows, FEEDBACK_SORT);

  return (
    <>
      <ListPageBody>
        <ListScrollBody>
          {error && (
            <Alert variant="error">
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )}
          {loading && !data ? (
            <LoadingMark className="py-16" />
          ) : (
            <div className={loading ? "opacity-60" : undefined}>
              {!data?.rows.length ? (
                <EmptyPanel text="暂无反馈" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>用户诉求</TableHead>
                      <TableHead className="min-w-[120px] text-right">次数</TableHead>
                      <SortableHead
                        label="最近"
                        k="last"
                        sort={sort}
                        onToggle={toggle}
                        className="min-w-[120px]"
                      />
                      <SortableHead
                        label="状态"
                        k="status"
                        sort={sort}
                        onToggle={toggle}
                        className="min-w-[120px]"
                      />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.topic_key}>
                        <TableCell className="max-w-xl">
                          <button
                            type="button"
                            className="max-w-full cursor-pointer truncate text-left font-medium transition-colors duration-150"
                            onClick={() => setSelected(row)}
                          >
                            {row.ask}
                          </button>
                        </TableCell>
                        <TableCell className="text-right text-pa-muted tabular-nums">
                          {row.occurrences}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-pa-muted">
                          {formatAt(row.last_at)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[row.status]}>
                            {STATUS_LABEL[row.status]}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {data && data.total > 0 && (
                <TablePager total={data.total} offset={offset} onOffset={setOffset} />
              )}
            </div>
          )}
        </ListScrollBody>
      </ListPageBody>
      <ReviewDialog row={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function ReviewDialog({ row, onClose }: { row: FeedbackGroup | null; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [noteMissing, setNoteMissing] = useState(false);
  const resolveFeedback = useResolveFeedback();
  const { reset: resetResolve } = resolveFeedback;
  const error = noteMissing ? "请填写处置备注" : errorText(resolveFeedback.error);
  const pending = resolveFeedback.isPending;

  useEffect(() => {
    setNote(row?.note ?? "");
    setNoteMissing(false);
    resetResolve();
  }, [row, resetResolve]);

  function resolve(status: "accepted" | "rejected") {
    if (!row) return;
    if (!note.trim()) {
      setNoteMissing(true);
      return;
    }
    setNoteMissing(false);
    resolveFeedback.mutate({ topicKey: row.topic_key, status, note }, { onSuccess: onClose });
  }

  return (
    <Dialog open={row != null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>审核数据缺口</DialogTitle>
        </DialogHeader>
        {row && (
          <DialogPanel className="grid gap-6">
            {error && (
              <Alert variant="error">
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )}
            <SheetSection title="用户原话">
              <p className="text-sm">{row.ask}</p>
            </SheetSection>
            <SheetSection title="缺口说明">
              <p className="text-sm">{row.detail}</p>
            </SheetSection>
            <SheetSection title="提报">
              <p className="text-sm">
                共 {row.occurrences} 次；调用者：{row.callers.join("、")}
              </p>
            </SheetSection>
            <Field>
              <FieldLabel htmlFor="feedback-note">处置备注</FieldLabel>
              <Textarea
                id="feedback-note"
                maxLength={FEEDBACK_LIMITS.note}
                placeholder="记录核实结论、后续登记位置或拒绝原因"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </DialogPanel>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="subtle" />}>关闭</DialogClose>
          {row?.status === "open" && (
            <>
              <Button
                loading={pending}
                variant="danger-subtle"
                onClick={() => void resolve("rejected")}
              >
                <XIcon />
                拒绝
              </Button>
              <Button variant="filled" loading={pending} onClick={() => void resolve("accepted")}>
                <CheckIcon />
                接受
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
