import { useState } from "react";
import { FileTextIcon, PlusIcon, WaypointsIcon } from "lucide-react";
import type { ReportRow } from "@contracts/report_contract";
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
  AutocompleteSearch,
  AutocompleteTrigger,
} from "@/components/ui/autocomplete";
import { POPUP_ROW } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { PRESENTATION_TYPE_LABELS } from "../analyses/presentation_labels";
import { LoadingMark } from "pa-result-view";
import { errorText } from "../api";
import { useReportsList } from "../dashboard_queries";

const FOOTER_ACTION_CLASS = cn(
  POPUP_ROW,
  "flex w-full cursor-pointer items-center text-left text-pa-fg hover:bg-pa-surface",
);

export function AddBoardWidget({
  addedIds,
  onPickReport,
  onAddText,
  onFromAnalysis,
}: {
  addedIds: Set<string>;
  onPickReport: (report: ReportRow) => void;
  onAddText: () => void;
  onFromAnalysis: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const reportsQuery = useReportsList(open);
  const reports = reportsQuery.data?.rows ?? null;
  const error = errorText(reportsQuery.error);

  return (
    <Autocomplete
      items={reports ?? []}
      itemToStringValue={(item: unknown) => (item as ReportRow).name}
      onOpenChange={setOpen}
      onOpenChangeComplete={() => setQuery("")}
      onValueChange={(next, details) => {
        if (details.reason !== "item-press") setQuery(next);
      }}
      open={open}
      value={query}
    >
      {/* combobox 角色不从内容计算可访问名称，需要显式 aria-label。 */}
      <AutocompleteTrigger
        aria-label="添加瓦片"
        className="pa-focus flex h-16 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-pa-wash font-normal text-base text-pa-muted hover:bg-pa-surface hover:text-pa-fg"
      >
        <PlusIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />
        添加瓦片
      </AutocompleteTrigger>
      <AutocompletePopup
        align="center"
        className="w-[min(calc(100vw-2rem),360px)] min-w-0"
        side="top"
        sideOffset={8}
      >
        <AutocompleteSearch aria-label="搜索报告" placeholder="搜索…" />
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {/* Empty 根节点需一直渲染，读屏器靠它播报结果数量的变化。 */}
          <AutocompleteEmpty className="not-empty:px-2.5 not-empty:py-6 text-center text-sm text-pa-faint">
            {error ?? (reports === null ? <LoadingMark size="small" /> : "没有匹配的报告")}
          </AutocompleteEmpty>
          <AutocompleteList className="not-empty:p-0">
            {(report: ReportRow) => {
              const added = addedIds.has(report.id);
              return (
                <AutocompleteItem
                  disabled={added}
                  key={report.id}
                  onClick={() => onPickReport(report)}
                  value={report}
                >
                  <span className="min-w-0 flex-1 truncate">{report.name}</span>
                  <span className="shrink-0 text-2xs text-pa-faint">
                    {added ? "已在看板中" : PRESENTATION_TYPE_LABELS[report.presentation_type]}
                  </span>
                </AutocompleteItem>
              );
            }}
          </AutocompleteList>
        </div>
        {/* 这两个操作放在列表外，方向键只在报告候选之间移动。 */}
        <div className="flex shrink-0 flex-col gap-0.5 border-t border-pa-line p-1.5">
          <button
            className={FOOTER_ACTION_CLASS}
            onClick={() => {
              setOpen(false);
              onFromAnalysis();
            }}
            type="button"
          >
            <WaypointsIcon aria-hidden="true" className="size-4 text-pa-fg-soft" />
            从分析添加
          </button>
          <button
            className={FOOTER_ACTION_CLASS}
            onClick={() => {
              setOpen(false);
              onAddText();
            }}
            type="button"
          >
            <FileTextIcon aria-hidden="true" className="size-4 text-pa-fg-soft" />
            添加文本
          </button>
        </div>
      </AutocompletePopup>
    </Autocomplete>
  );
}
