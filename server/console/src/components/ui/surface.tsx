import type * as React from "react";
import { BlockedHint } from "@/components/ui/inspector";
import { cn } from "@/lib/utils";

export const GLASS_POPUP_SURFACE = "pa-popup-surface";

export const GLASS_STAGE_SURFACE = "pa-popup-surface pa-popup-surface-stage";

/** 浮层宽度只有这几档；锚定浮层按用途取档，不在调用点写像素。 */
export const POPUP_WIDTH = {
  /** 动作菜单：几行动词，窄一档 */
  menu: "w-45",
  /** 取值清单：按内容撑开，短于一行名字时仍保住最小宽 */
  list: "w-max min-w-60 max-w-120",
  /** 设置面：装控件行的固定宽 */
  settings: "w-64",
  /** 可搜索选择面：比设置面再宽一档，放得下搜索行与分组题 */
  picker: "w-75",
} as const;

export type PopupWidth = keyof typeof POPUP_WIDTH;

export const POPUP_ROW = "min-h-8 gap-2.5 rounded-md py-2 pr-2.5 pl-3 text-sm leading-4";

export const POPUP_TITLE = "truncate px-3 py-2 font-semibold text-md text-pa-ink leading-4";

/**
 * 浮层里的组题：取值清单的分组、设置面的小节都用它。`blocked` 是这一组此刻不可用的原因，
 * 题转淡并就地印一枚提示钮。
 */
export function PopupTitle({
  blocked,
  children,
}: {
  blocked?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <p className={cn(POPUP_TITLE, "min-w-0", blocked && "text-pa-faint")} data-slot="popup-title">
        {children}
      </p>
      {blocked ? <BlockedHint reason={blocked} /> : null}
    </div>
  );
}

/**
 * 浮层里的分节：上缘一道通栏细线，可带组题；首节不画线。
 * 它假定所在浮层正文的内衬是 1.5 格（菜单、取值清单、下拉与字段选择面的正文同取这一档），
 * 线从内衬里探出去贴到浮层边。
 */
export function PopupSection({
  label,
  blocked,
  children,
}: {
  label?: React.ReactNode;
  blocked?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className="-mx-1.5 mt-1.5 border-pa-line border-t px-1.5 pt-1.5 first:mt-0 first:border-t-0 first:pt-0"
      data-slot="popup-section"
    >
      {label ? <PopupTitle blocked={blocked}>{label}</PopupTitle> : null}
      {children}
    </div>
  );
}
