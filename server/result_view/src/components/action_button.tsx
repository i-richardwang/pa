import type { ReactNode } from "react";

/**
 * 结果面里的小动作钮（全屏、下载、翻页、复制）：描边、正文色、带图标。
 * 两个宿主的结果卡与名单卡共用这一件，停用态只降可用性，不另加边框或底色。
 */
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
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-pa-line-strong bg-pa-bg px-2.5 py-1 font-medium text-pa-fg text-xs outline-none hover:bg-pa-surface focus-visible:ring-[3px] focus-visible:ring-pa-focus-ring disabled:cursor-default disabled:opacity-50 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}
