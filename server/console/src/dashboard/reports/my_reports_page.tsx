/**
 * 我的报告清单：titlebar + 灰控制条 + 全宽裸铺表。
 * 「报告 / 查询记录」进控制条分面片（hash 分面）；「新建分析」挂 titlebar。
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArchiveIcon, ChartBarIcon, CircleAlertIcon, PlusIcon } from "lucide-react";
import { REPORT_DETAIL_SCHEMA, type ReportRow } from "@contracts/report_contract";
import { LoadingMark } from "pa-result-view";
import { Alert, AlertTitle } from "@/components/ui/alert";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { MenuItem } from "@/components/ui/menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toastManager } from "@/components/ui/toast";
import { ApiError, formatAt, patchJson } from "../api";
import { dashboardKeys, errorText, useReportsList } from "../dashboard_queries";
import {
  ListCategoryPill,
  ListControlBar,
  ListControlSearch,
  ListPageBody,
  ListScrollBody,
  ListSegment,
  ListSegmentGroup,
  useSetListChromeActions,
} from "../layout/layout_chrome";
import { HeaderTextAction } from "../layout/view_chrome";
import { PRESENTATION_TYPE_LABELS } from "../analyses/presentation_labels";
import { QueryHistoryTab } from "./query_history_tab";
import { analysisNewHash, reportHash, reportsHash, reportsHistoryHash } from "../router";
import {
  DaysRangeChips,
  ResourceName,
  RowMenu,
  SortableHead,
  useTableSort,
} from "../kit/table_kit";

export type ReportsTab = "reports" | "history";

const REPORT_SORT: Record<
  "name" | "type" | "updated",
  (row: ReportRow) => string | number | null | undefined
> = {
  name: (row) => row.name,
  type: (row) => PRESENTATION_TYPE_LABELS[row.presentation_type],
  updated: (row) => row.updated_at,
};

export function MyReportsPage({ tab }: { tab: ReportsTab }) {
  const [days, setDays] = useState<number>(30);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");

  useSetListChromeActions(
    () => (
      <HeaderTextAction render={<a href={analysisNewHash()} />}>
        <PlusIcon aria-hidden="true" />
        新建分析
      </HeaderTextAction>
    ),
    [],
  );

  return (
    <ListPageBody>
      <ListControlBar
        left={
          <ListSegmentGroup label="看哪一批">
            <ListSegment
              selected={tab === "reports"}
              onClick={() => {
                window.location.hash = reportsHash();
              }}
            >
              报告
            </ListSegment>
            <ListSegment
              selected={tab === "history"}
              onClick={() => {
                window.location.hash = reportsHistoryHash();
              }}
            >
              查询记录
            </ListSegment>
          </ListSegmentGroup>
        }
        right={
          <>
            {tab === "history" && (
              <DaysRangeChips
                days={days}
                onDays={(next) => {
                  setDays(next);
                  setOffset(0);
                }}
              />
            )}
            {tab === "reports" && (
              <ListControlSearch aria-label="搜索报告" value={query} onValueChange={setQuery} />
            )}
          </>
        }
      />
      <ListScrollBody>
        {tab === "reports" ? (
          <ReportsList query={query} />
        ) : (
          <div className="mt-5">
            <QueryHistoryTab days={days} offset={offset} onOffset={setOffset} />
          </div>
        )}
      </ListScrollBody>
    </ListPageBody>
  );
}

function ReportsList({ query }: { query: string }) {
  const queryClient = useQueryClient();
  const reportsQuery = useReportsList();
  const data = reportsQuery.data ?? null;
  const error = errorText(reportsQuery.error);
  const filtered = useMemo(() => {
    const rows = data?.rows ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const typeLabel = PRESENTATION_TYPE_LABELS[row.presentation_type];
      return row.name.toLowerCase().includes(q) || typeLabel.includes(q);
    });
  }, [data?.rows, query]);
  const { rows, sort, toggle } = useTableSort(filtered, REPORT_SORT);

  const archiveReport = useMutation({
    mutationFn: (row: ReportRow) =>
      patchJson(
        `/dashboard/api/reports/${encodeURIComponent(row.id)}`,
        { action: { type: "archive" }, if_revision: row.revision },
        REPORT_DETAIL_SCHEMA,
      ),
    onSuccess: (_updated, row) => {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.reports });
      toastManager.add({ type: "success", title: `已归档「${row.name}」` });
    },
    onError: (reason) => {
      if (reason instanceof ApiError && reason.status === 401) return;
      const conflict = reason instanceof ApiError && reason.status === 409;
      toastManager.add({
        type: "error",
        title: conflict ? "报告已被其他操作更新" : "归档失败",
        description: conflict
          ? "请刷新后再归档。"
          : reason instanceof Error
            ? reason.message
            : String(reason),
      });
    },
  });

  if (error) {
    return (
      <Alert className="mt-5" variant="error">
        <CircleAlertIcon />
        <AlertTitle>{error}</AlertTitle>
      </Alert>
    );
  }
  if (!data) {
    return (
      <div className="mt-5">
        <LoadingMark className="py-16" />
      </div>
    );
  }
  if (data.rows.length === 0) {
    return (
      <div className="mt-5">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartBarIcon />
            </EmptyMedia>
            <EmptyTitle>还没有保存的报告</EmptyTitle>
            <EmptyDescription>在「查询记录」里把分析保存为报告后，会显示在这里。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="mt-5">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>没有匹配的报告</EmptyTitle>
            <EmptyDescription>换个关键词试试。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="mt-5">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead label="名称" k="name" sort={sort} onToggle={toggle} />
            <SortableHead
              label="图型"
              k="type"
              sort={sort}
              onToggle={toggle}
              className="min-w-[120px]"
            />
            <SortableHead
              label="更新时间"
              k="updated"
              sort={sort}
              onToggle={toggle}
              className="min-w-[120px]"
            />
            <TableHead className="min-w-[30px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <ResourceName href={reportHash(row.id)}>{row.name}</ResourceName>
              </TableCell>
              <TableCell>
                <ListCategoryPill className="pointer-events-none cursor-default">
                  {PRESENTATION_TYPE_LABELS[row.presentation_type]}
                </ListCategoryPill>
              </TableCell>
              <TableCell className="text-pa-muted tabular-nums">
                {formatAt(row.updated_at)}
              </TableCell>
              <TableCell className="relative p-2 text-right">
                <RowMenu label="报告操作">
                  <MenuItem
                    disabled={archiveReport.isPending}
                    onClick={() => archiveReport.mutate(row)}
                  >
                    <ArchiveIcon aria-hidden="true" />
                    归档
                  </MenuItem>
                </RowMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
