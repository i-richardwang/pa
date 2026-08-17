"use client";

import { CheckIcon } from "lucide-react";
import type * as React from "react";
import { POPUP_GROUP_LABEL, POPUP_ROW, POPUP_SECTION } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

export const POPOVER_LIST_WIDTH = "w-max min-w-[240px] max-w-[480px]";

export function PopoverListPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "flex max-h-[min(400px,70vh)] min-h-0 flex-col overflow-y-auto p-1.5",
        className,
      )}
      data-slot="popover-list-panel"
    >
      {children}
    </div>
  );
}

export function PopoverListLabel({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <p className={cn(POPUP_GROUP_LABEL, "shrink-0")} data-slot="popover-list-label">
      {children}
    </p>
  );
}

export function PopoverListSeparator(): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      className="-mx-1.5 my-1.5 h-px w-[calc(100%+0.75rem)] shrink-0 bg-pa-line"
      data-slot="popover-list-separator"
    />
  );
}

export function PopoverListSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className={POPUP_SECTION} data-slot="popover-list-section">
      <PopoverListLabel>{label}</PopoverListLabel>
      {children}
    </div>
  );
}

export function popoverListCheck(selected: boolean): React.ReactNode {
  return selected ? <CheckIcon aria-hidden="true" className="size-3" /> : undefined;
}

/**
 * `detail` 是标题右侧的弱字说明，例如相对期间的实际起止月；
 * 同一列里两种口径的档名长得一样时，靠它把差别摆在读者眼前。
 *
 * `selected` 是**当前取值**，`unavailable` 是**这一档此刻选不了**（降透明不可点，理由归
 * 调用方的 Tooltip）。后者不叫 `inert`：HTML 的同名属性会把元素整个撤出无障碍树，
 * 而选不了的档正需要读屏念出来。
 */
export function PopoverListRow({
  children,
  icon,
  detail,
  trailing,
  selected = false,
  unavailable = false,
  onClick,
  className,
  ...props
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  detail?: React.ReactNode;
  trailing?: React.ReactNode;
  selected?: boolean;
  unavailable?: boolean;
  onClick?: () => void;
  className?: string;
} & Omit<React.ComponentProps<"button">, "onClick" | "children">): React.ReactElement {
  return (
    <button
      aria-disabled={unavailable || undefined}
      className={cn(
        POPUP_ROW,
        "group/row flex w-full cursor-pointer items-center border-0 bg-transparent text-left text-pa-fg transition-colors duration-150",
        "hover:bg-pa-surface active:bg-pa-surface",
        selected && "font-medium",
        unavailable && "cursor-default opacity-30 hover:bg-transparent active:bg-transparent",
        className,
      )}
      data-slot="popover-list-row"
      onClick={unavailable ? undefined : onClick}
      type="button"
      {...props}
    >
      {icon ? <span className="flex size-4 shrink-0 items-center">{icon}</span> : null}

      <span className={cn("min-w-0 truncate", detail ? "flex-[1_0_auto]" : "flex-1")}>{children}</span>
      {detail ? (
        <span
          className="ml-3 min-w-0 truncate text-pa-muted tabular-nums"
          data-slot="popover-list-detail"
        >
          {detail}
        </span>
      ) : null}
      <span
        aria-hidden={trailing ? undefined : "true"}
        className="inline-flex w-4 shrink-0 items-center justify-center self-center"
      >
        {trailing}
      </span>
    </button>
  );
}
