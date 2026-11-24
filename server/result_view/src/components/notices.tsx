/**
 * 表格只显示了前几行时提供全屏入口，服务端截断结果时提供下载入口；行数本身由表格的行数栏显示。
 * 操作按钮只在宿主通过 CardActions 注入对应能力时显示。
 */
import { useState } from "react";
import { Check, Download, ExternalLink, Link2, Maximize2 } from "lucide-react";
import { ActionButton } from "./action_button.js";
import { Badge } from "./badge.js";
import { INLINE_ROWS } from "./data_table.js";
import type { CardActions } from "./view_actions.js";
import type { ExportLink, ViewBlock } from "../../../src/semantic_core/query_payload.js";

/** 复制导出链接；剪贴板写入失败时改为显示链接供手动复制。MCP widget 不注入此操作。 */
function CopyLinkButton({
  url,
  copyText,
}: {
  url: string;
  copyText: (text: string) => Promise<void>;
}) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");

  const copy = async () => {
    try {
      await copyText(url);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("manual");
    }
  };

  if (state === "manual") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={url}
          aria-label="导出链接（手动复制）"
          className="max-w-72 rounded-md border border-pa-line-strong bg-pa-bg px-2 py-1 text-xs"
          onFocus={(e) => e.currentTarget.select()}
          // biome-ignore lint/a11y/noAutofocus: The fallback field must receive focus so keyboard users can copy immediately.
          autoFocus
        />
        <span>请全选上方链接后按 ⌘C / Ctrl+C 复制</span>
      </div>
    );
  }
  return (
    <ActionButton onClick={() => void copy()}>
      {state === "copied" ? <Check /> : <Link2 />}
      {state === "copied" ? "已复制" : "复制链接"}
    </ActionButton>
  );
}

/** 是否有提示要显示；调用方据此决定是否渲染外层 footer，避免出现空白区域。 */
export function noticesVisible(
  view: ViewBlock,
  rowCount: number,
  allRows: boolean,
  canFullscreen: boolean,
): boolean {
  return (
    (!allRows && rowCount > INLINE_ROWS && canFullscreen) ||
    !!(view.truncated || view.column_periods || view.observations)
  );
}

export function Notices({
  view,
  exportLink,
  rowCount,
  actions,
  allRows,
}: {
  view: ViewBlock;
  /** 完整结果的下载链接（结果超出卡片行数上限被截断时提供） */
  exportLink?: ExportLink;
  /** 表格实际显示的行数（交叉表会少于返回的行数） */
  rowCount: number;
  actions: CardActions;
  /** 表格是否已渲染全部行；否则提示可全屏查看 */
  allRows: boolean;
}) {
  const hiddenRows = !allRows && rowCount > INLINE_ROWS;
  const downloadable = exportLink && (view.truncated || view.column_periods || view.observations);
  const [pendingAction, setPendingAction] = useState<"export" | "fullscreen" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = async (kind: "export" | "fullscreen", action: () => Promise<void>) => {
    setPendingAction(kind);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "当前环境无法完成此操作。");
    } finally {
      setPendingAction(null);
    }
  };

  if (!noticesVisible(view, rowCount, allRows, !!actions.requestFullscreen)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-pa-muted text-xs">
      {hiddenRows && actions.requestFullscreen && (
        <ActionButton
          disabled={pendingAction === "fullscreen"}
          onClick={() => void runAction("fullscreen", actions.requestFullscreen!)}
        >
          <Maximize2 />
          全屏查看全部
        </ActionButton>
      )}
      {view.truncated && (
        <>
          <Badge>{`结果超出上限，已展示前 ${view.rows.length} 行`}</Badge>
          {!exportLink && <span>可下载完整结果（让助手导出），或缩小查询范围</span>}
        </>
      )}
      {downloadable && exportLink && (actions.exportAction || actions.copyText) && (
        <>
          {actions.exportAction && (
            <ActionButton
              disabled={pendingAction === "export"}
              onClick={() => void runAction("export", () => actions.exportAction!.run(exportLink))}
            >
              {actions.exportAction.kind === "download_file" ? <Download /> : <ExternalLink />}
              {actions.exportAction.kind === "download_file" ? "下载 CSV" : "打开下载链接"}
            </ActionButton>
          )}
          {actions.copyText && <CopyLinkButton url={exportLink.url} copyText={actions.copyText} />}
        </>
      )}
      {exportLink && view.truncated && !actions.exportAction && !actions.copyText && (
        <span>可让助手提供完整结果下载链接，或缩小查询范围</span>
      )}
      {actionError && (
        <span role="alert" className="text-pa-danger">
          {actionError}
        </span>
      )}
    </div>
  );
}
