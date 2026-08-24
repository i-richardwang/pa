/** 本组件只选择记录；命名、归属与持久化由 SaveReportDialog 负责。 */
import type { MyAnalysisRow } from "@contracts/analysis_contract";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  type CommandFinalFocus,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
} from "@/components/ui/command";
import { LoadingMark } from "pa-result-view";
import { errorText, formatAt } from "../api";
import { useMyAnalyses } from "../dashboard_queries";

/** 选材窗口覆盖近三个月本人分析；更早记录可从「我的报告 · 查询记录」保存。 */
const LOOKBACK_DAYS = 90;
const MAX_ROWS = 200;

export function AddFromAnalysisDialog({
  open,
  onOpenChange,
  finalFocus,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 关掉后焦点还给谁：这一面没有触发件，由开它的那一处交代（见 board_page）。 */
  finalFocus?: CommandFinalFocus;
  onPick: (row: MyAnalysisRow) => void;
}) {
  const analysesQuery = useMyAnalyses(LOOKBACK_DAYS, MAX_ROWS, 0, open);
  const rows = analysesQuery.data?.rows ?? null;
  const error = errorText(analysesQuery.error);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup finalFocus={finalFocus}>
        <Command items={rows ?? []} itemToStringValue={(r: unknown) => (r as MyAnalysisRow).title}>
          <CommandInput placeholder="搜索查询记录…" />
          <CommandPanel>
            <CommandEmpty>
              {error ??
                (rows === null ? (
                  <LoadingMark size="small" />
                ) : (
                  `近 ${LOOKBACK_DAYS} 天没有匹配的分析`
                ))}
            </CommandEmpty>
            <CommandList>
              {(row: MyAnalysisRow) => (
                <CommandItem key={row.id} value={row} onClick={() => onPick(row)}>
                  <span className="min-w-0 flex-1 truncate">{row.title}</span>
                  <span className="text-pa-muted/80 shrink-0 text-2xs tabular-nums">
                    {formatAt(row.at)}
                  </span>
                  <span className="text-pa-muted/80 shrink-0 text-2xs tabular-nums">
                    {row.row_count ?? "—"} 行
                  </span>
                </CommandItem>
              )}
            </CommandList>
          </CommandPanel>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
