/**
 * 查询记录：本人经此账号发起的分析履历（title 原文 + 结果规模）。
 * 纵向可见——只含自己，caller 由服务端锁定，仅记问题与结果规模。
 * 带 analysis handle 的记录可重放，也可升格为独立报告；审计日志本身不承载资产恢复职责。
 * 时间窗是我的报告页题条上的页级控件，本件只按给定窗口取数并翻页。
 */
import { useState } from "react";
import { CircleAlertIcon, HistoryIcon, SaveIcon } from "lucide-react";
import { DASHBOARD_PAGE_SIZE } from "@contract";
import { LoadingMark } from "pa-result-view";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { MenuItem } from "@/components/ui/menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAt } from "../api";
import { errorText, useMyAnalyses } from "../dashboard_queries";
import { analysisHash } from "../router";
import { SaveReportDialog, type SaveReportTarget } from "./save_report_dialog";
import { RowMenu } from "../kit/table_kit";
import { TablePager } from "../kit/table_pager";

export function QueryHistoryTab({
  days,
  offset,
  onOffset,
}: {
  days: number;
  offset: number;
  onOffset: (offset: number) => void;
}) {
  const [saveTarget, setSaveTarget] = useState<SaveReportTarget | null>(null);

  // 翻页走服务端切片：日志无界，前端不持全量。
  const analysesQuery = useMyAnalyses(days, DASHBOARD_PAGE_SIZE, offset);
  const data = analysesQuery.data ?? null;
  const loading = analysesQuery.isFetching;
  const error = errorText(analysesQuery.error);

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="error">
          <CircleAlertIcon />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}
      {loading && !data && <LoadingMark className="py-16" />}
      {data && (
        <div className={loading ? "opacity-60" : undefined}>
          {data.rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HistoryIcon />
                </EmptyMedia>
                <EmptyTitle>窗口内暂无查询记录</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">时间</TableHead>
                    <TableHead>问题</TableHead>
                    <TableHead className="w-24 text-right">结果</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r, i) => (
                    <TableRow key={`${r.at}-${i}`}>
                      <TableCell className="text-sm text-pa-muted tabular-nums">
                        {formatAt(r.at)}
                      </TableCell>
                      <TableCell>
                        {r.analysis_id ? (
                          <a
                            href={analysisHash(r.analysis_id)}
                            className="inline-block max-w-full truncate align-bottom font-medium transition-colors duration-150"
                          >
                            {r.title}
                          </a>
                        ) : (
                          r.title
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-sm text-pa-muted tabular-nums">
                          {r.row_count ?? "—"} 行
                        </span>
                      </TableCell>
                      <TableCell className="py-0 text-right">
                        {r.analysis_id && (
                          <RowMenu label="分析操作">
                            <MenuItem
                              onClick={() =>
                                r.analysis_id &&
                                setSaveTarget({ id: r.analysis_id, title: r.title })
                              }
                            >
                              <SaveIcon aria-hidden="true" />
                              保存为报告
                            </MenuItem>
                          </RowMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePager total={data.total} offset={offset} onOffset={onOffset} />
            </>
          )}
        </div>
      )}
      <SaveReportDialog target={saveTarget} onClose={() => setSaveTarget(null)} />
    </div>
  );
}
