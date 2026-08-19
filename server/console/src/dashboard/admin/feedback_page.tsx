/**
 * 反馈审核页（admin）：消费 Agent 主动提报的数据能力缺口。接受只表示认可该缺口值得补，
 * 指标、口径与数据范围仍以模型 YAML 的 Git 变更为准。
 * 业务术语不走本通道——术语在指标字典页直接维护，未登记的叫法经使用日志的零命中检索浮现。
 */
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CircleAlertIcon, InboxIcon, XIcon } from "lucide-react";
import { DASHBOARD_PAGE_SIZE } from "@contracts/pagination_contract";
import {
  FEEDBACK_LIMITS,
  FEEDBACK_GROUP_PAYLOAD_SCHEMA,
  FEEDBACK_LIST_PAYLOAD_SCHEMA,
  type FeedbackGroup,
} from "@contracts/feedback_contract";
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
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
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
import { ApiError, formatAt, getJson, patchJson } from "../api";
import { errorText } from "../dashboard_queries";
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
  const queryClient = useQueryClient();
  const feedbackQuery = useQuery({
    queryKey: ["feedback", offset],
    placeholderData: keepPreviousData,
    queryFn: () =>
      getJson(
        `/dashboard/api/feedback?limit=${DASHBOARD_PAGE_SIZE}&offset=${offset}`,
        FEEDBACK_LIST_PAYLOAD_SCHEMA,
      ),
  });
  const data = feedbackQuery.data ?? null;
  const loading = feedbackQuery.isFetching;
  const error = errorText(feedbackQuery.error);
  const { rows, sort, toggle } = useTableSort(data?.rows, FEEDBACK_SORT);

  return (
    <>
      <ListPageBody>
        <ListScrollBody>
          {error && (
            <Alert className="mt-5" variant="error">
              <CircleAlertIcon />
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )}
          {loading && !data ? (
            <div className="mt-5">
              <LoadingMark className="py-16" />
            </div>
          ) : (
            <div className={loading ? "mt-5 opacity-60" : "mt-5"}>
              {!data?.rows.length ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <InboxIcon />
                    </EmptyMedia>
                    <EmptyTitle>暂无反馈</EmptyTitle>
                  </EmptyHeader>
                </Empty>
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
      <ReviewDialog
        row={selected}
        onClose={() => setSelected(null)}
        onResolved={() => {
          setSelected(null);
          void queryClient.invalidateQueries({ queryKey: ["feedback"] });
        }}
      />
    </>
  );
}

function ReviewDialog({
  row,
  onClose,
  onResolved,
}: {
  row: FeedbackGroup | null;
  onClose: () => void;
  onResolved: () => void | Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNote(row?.note ?? "");
    setError(null);
  }, [row]);

  async function resolve(status: "accepted" | "rejected") {
    if (!row || !note.trim()) {
      setError("请填写处置备注");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await patchJson(
        `/dashboard/api/feedback/${encodeURIComponent(row.topic_key)}`,
        { status, note },
        FEEDBACK_GROUP_PAYLOAD_SCHEMA,
      );
      await onResolved();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
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
                <CircleAlertIcon />
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
