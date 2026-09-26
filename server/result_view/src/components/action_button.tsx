import type { ReactNode } from "react";

/** 结果区域里的小操作按钮（全屏、下载、翻页、复制），控制台和 MCP widget 的结果卡与名单共用。 */
export function ActionButton({
  onClick,
  disabled = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-pa-line-strong bg-pa-bg px-2.5 py-1 font-medium text-pa-fg text-xs hover:bg-pa-surface pa-focus disabled:cursor-default disabled:opacity-50 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}
