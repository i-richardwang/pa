import { useEffect, useState } from "react";
import { CircleAlertIcon, XIcon } from "lucide-react";
import {
  RECORD_PROJECTION_PAYLOAD_SCHEMA,
  type RecordProjectionPayload,
  type RecordProjectionRequestBody,
} from "@contracts/record_projection_contract";
import type { TimeIntent } from "@time";
import { LoadingMark } from "pa-result-view";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogTitle,
  DialogPopup,
  OverlayCloseButton,
  stageDialogClass,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ChartStageHeading } from "../analyses/chart_stage";
import { Titlebar } from "@/components/ui/titlebar";
import { postJson } from "../api";
import { EchoPill } from "../kit/echo_pill";
import { HeaderTextAction } from "../layout/view_chrome";
import { RecordRowSheet } from "./record_row_sheet";

export type RecordProjectionCoordinateDisplay = {
  metric_title: string;
  dimensions: { title: string; value: string | number | null }[];
  time_label: string;
};

export type RecordProjectionDialogTarget =
  | { kind: "report"; report_id: string }
  | { kind: "board"; board_id: string; report_id: string; time_override?: TimeIntent };

export type RecordProjectionDialogRequest = Omit<
  RecordProjectionRequestBody,
  "offset" | "limit"
> & {
  target: RecordProjectionDialogTarget;
  /** 客户端已构造的格点坐标回显；与请求体同源，零服务端往返。 */
  display: RecordProjectionCoordinateDisplay;
};

const PAGE_SIZE = 50;

function CoordinateBar({ display }: { display: RecordProjectionCoordinateDisplay }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="records-coordinate-bar">
      <EchoPill label={display.metric_title} />
      {display.dimensions.map((dimension) => (
        <EchoPill
          key={`${dimension.title}:${String(dimension.value)}`}
          label={`${dimension.title}=${dimension.value === null ? "空" : String(dimension.value)}`}
        />
      ))}
      <EchoPill label={display.time_label} />
    </div>
  );
}

export function RecordProjectionDialog({
  request,
  onClose,
}: {
  request: RecordProjectionDialogRequest | null;
  onClose: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<RecordProjectionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedRow, setSelectedRow] = useState<(string | number | null)[] | null>(null);

  useEffect(() => {
    setOffset(0);
    setData(null);
    setError(null);
    setSelectedRow(null);
  }, [request]);

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const { target, display: _display, ...body } = request;
    const endpoint =
      target.kind === "report"
        ? `/dashboard/api/reports/${encodeURIComponent(target.report_id)}/records`
        : `/dashboard/api/boards/${encodeURIComponent(target.board_id)}/items/${encodeURIComponent(target.report_id)}/records${
            target.time_override
              ? `?time=${encodeURIComponent(JSON.stringify(target.time_override))}`
              : ""
          }`;
    postJson(endpoint, { ...body, offset, limit: PAGE_SIZE }, RECORD_PROJECTION_PAYLOAD_SCHEMA)
      .then((payload) => !cancelled && setData(payload))
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [request, offset]);

  const start = data && data.rows.length ? data.offset + 1 : 0;
  const end = data ? data.offset + data.rows.length : 0;
  const title = data?.metric_title ?? request?.display.metric_title ?? "人员明细";
  const pageLabel = data ? (data.rows.length ? `第 ${start}–${end} 条` : "当前页没有记录") : "";

  return (
    <>
      <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogPopup
          bottomStickOnMobile={false}
          className={cn(stageDialogClass, "overflow-hidden")}
          showCloseButton={false}
        >
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:h-full">
            {/* 题条：与报告内 Edit / Explore 同一根基线；分页与关闭住动作槽 */}
            <Titlebar align="between" as="div" className="pr-2.5">
              <span className="truncate text-sm font-medium text-pa-fg">人员明细</span>
              <div className="flex shrink-0 items-center gap-1">
                {pageLabel ? (
                  <span className="mr-1 hidden text-sm text-pa-muted sm:inline">{pageLabel}</span>
                ) : null}
                <HeaderTextAction
                  disabled={offset === 0 || loading}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  上一页
                </HeaderTextAction>
                <HeaderTextAction
                  disabled={!data?.has_more || loading}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  下一页
                </HeaderTextAction>
                <DialogClose aria-label="关闭" render={<OverlayCloseButton />}>
                  <XIcon aria-hidden="true" />
                </DialogClose>
              </div>
            </Titlebar>

            <DialogTitle className="sr-only">{title}</DialogTitle>
            <DialogDescription className="sr-only">人员明细列表</DialogDescription>

            <ChartStageHeading
              className="px-6"
              extra={request ? <CoordinateBar display={request.display} /> : null}
              title={title}
            />

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-auto px-6 pb-8">
              {data?.data_changed && (
                <Alert className="mb-3" variant="warning">
                  <CircleAlertIcon />
                  <AlertDescription>
                    数据已从结果显示时的截至点更新，以下名单按当前数据重新计算。
                  </AlertDescription>
                </Alert>
              )}
              {data?.limit_reached && (
                <Alert className="mb-3" variant="warning">
                  <CircleAlertIcon />
                  <AlertDescription>
                    人员数量超过交互查看上限；请回到报告添加筛选条件，缩小范围后再查看。
                  </AlertDescription>
                </Alert>
              )}
              {error ? (
                <Alert variant="error">
                  <CircleAlertIcon />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : loading && !data ? (
                <div className="flex min-h-48 items-center justify-center">
                  <LoadingMark className="py-16" />
                </div>
              ) : data && !data.rows.length && !data.offset ? (
                // 零值格同样可点，空名单是对「0 个人是谁」的诚实回答——须明说，不能只留一张空表头。
                <div className="flex min-h-48 items-center justify-center text-sm text-pa-muted">
                  该口径下没有人员记录。
                </div>
              ) : data ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {data.columns.map((column) => (
                        <TableHead key={column}>{column}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((row, rowIndex) => (
                      <TableRow
                        className="cursor-pointer"
                        key={`${data.offset}-${rowIndex}`}
                        onClick={() => setSelectedRow(row)}
                      >
                        {row.map((value, columnIndex) => (
                          <TableCell key={columnIndex}>{value ?? ""}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
            </div>
          </div>
        </DialogPopup>
      </Dialog>
      <RecordRowSheet
        columns={data?.columns ?? []}
        onOpenChange={(open) => !open && setSelectedRow(null)}
        open={selectedRow !== null}
        row={selectedRow}
        title={data?.record_set_title ?? "记录详情"}
      />
    </>
  );
}
