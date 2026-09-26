import { CheckIcon } from "lucide-react";
import type * as React from "react";
import { POPUP_ROW } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

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

export function popoverListCheck(selected: boolean): React.ReactNode {
  return selected ? <CheckIcon aria-hidden="true" className="size-3" /> : undefined;
}

/** 不用 HTML `inert`：它会把元素移出无障碍树，而不可选的项仍需被读屏读出。 */
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
        "pa-focus group/row flex w-full cursor-pointer items-center border-0 bg-transparent text-left text-pa-fg hover:bg-pa-surface active:bg-pa-surface",
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
      <span className={cn("min-w-0 truncate", detail ? "flex-[1_0_auto]" : "flex-1")}>
        {children}
      </span>
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
