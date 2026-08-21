/**
 * 结果提示：inline 截行引导全屏（环境支持才出入口，经 CardActions 注入；行数与截行
 * 事实本身由表格行数条陈述，本组件只承载动作与例外提示）；
 * 服务端截断（卡片交付上限触顶）引导下载完整结果。
 * 导出入口 = export 限时票据；环境只注入真实可用的
 * 下载、外链或剪贴板动作，未注入时不呈现失效退路。
 */
import { useState } from "react";
import { Check, Download, ExternalLink, Link2, Maximize2 } from "lucide-react";
import { INLINE_ROWS } from "./data_table.js";
import type { CardActions } from "./view_actions.js";
import type {
  ExportLink,
  ExportResourceLink,
  ViewBlock,
} from "../../../src/semantic_core/query_payload.js";

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-pa-line bg-pa-surface px-2 py-0.5 text-pa-muted text-xs">
      {children}
    </span>
  );
}

function ActionButton({
  onClick,
  pending,
  children,
}: {
  onClick: () => void;
  pending?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onClick}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-pa-line-strong bg-pa-bg px-2.5 py-1 font-medium text-pa-fg text-xs hover:bg-pa-surface disabled:cursor-default disabled:opacity-50 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

/** 浏览器复制导出链接；运行时失败时保留手动复制退路。MCP Preview 不注入此动作。 */
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

/** 是否有提示可显示：调用方据此决定是否渲染承载的 footer（空垫不出现）。
 * 截行由行数条陈述；只有环境支持全屏时才为截行提供动作入口。 */
export function noticesVisible(
  view: ViewBlock,
  rowCount: number,
  fullscreen: boolean,
  canFullscreen: boolean,
): boolean {
  return (!fullscreen && rowCount > INLINE_ROWS && canFullscreen) || !!view.truncated;
}

export function Notices({
  view,
  exportLink,
  exportResource,
  rowCount,
  actions,
  fullscreen,
}: {
  view: ViewBlock;
  /** 完整结果下载入口（聚合在卡片上限截断时随附） */
  exportLink?: ExportLink;
  /** Widget 下载使用的 MCP ResourceLink */
  exportResource?: ExportResourceLink;
  /** 表格实际展示的行数（交叉表转置后少于返回行数） */
  rowCount: number;
  actions: CardActions;
  fullscreen: boolean;
}) {
  const hiddenRows = !fullscreen && rowCount > INLINE_ROWS;
  const [pendingAction, setPendingAction] = useState<"export" | "fullscreen" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = async (kind: "export" | "fullscreen", action: () => Promise<void>) => {
    setPendingAction(kind);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "宿主未能完成此操作。");
    } finally {
      setPendingAction(null);
    }
  };

  if (!noticesVisible(view, rowCount, fullscreen, !!actions.requestFullscreen)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-pa-muted text-xs">
      {hiddenRows && actions.requestFullscreen && (
        <ActionButton
          pending={pendingAction === "fullscreen"}
          onClick={() => void runAction("fullscreen", actions.requestFullscreen!)}
        >
          <Maximize2 />
          全屏查看全部
        </ActionButton>
      )}
      {view.truncated && (
        <>
          <Chip>{`结果超出上限，已展示前 ${view.rows.length} 行`}</Chip>
          {!exportLink && <span>可下载完整结果（让助手导出），或缩小查询范围</span>}
        </>
      )}
      {exportLink && view.truncated && (actions.exportAction || actions.copyText) && (
        <>
          {actions.exportAction && (
            <ActionButton
              pending={pendingAction === "export"}
              onClick={() =>
                void runAction("export", () =>
                  actions.exportAction!.run(exportLink, exportResource),
                )
              }
            >
              {actions.exportAction.kind === "download_file" ? <Download /> : <ExternalLink />}
              {actions.exportAction.kind === "download_file" ? "下载完整结果" : "打开下载链接"}
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
